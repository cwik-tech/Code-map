// Bounded byte reads for oracle records and test digests. No symlink is followed at the final component.
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { gitBytes } from './git.mjs';
import { readHead, maxFileBytes } from './impact/head-files.mjs';
/** Reads at most max + 1 bytes through one descriptor. A growing file cannot remove the byte limit. */
export function readOracleBytes(path, max) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) throw new Error('The oracle input must be a regular file.');
    if (info.size > max) throw new Error(`The oracle input is larger than ${max} bytes.`);
    const bytes = Buffer.alloc(max + 1);
    let length = 0, count;
    do { count = readSync(fd, bytes, length, bytes.length - length, null); length += count; } while (count > 0 && length < bytes.length);
    if (length > max) throw new Error(`The oracle input is larger than ${max} bytes.`);
    return bytes.subarray(0, length);
  } finally { closeSync(fd); }
}
/** Reads exact bytes only for paths that the existing snapshot reader accepts as safe test files. */
export function oracleTestBytes(stored, paths) {
  const wanted = new Set(paths), allowed = readHead(stored, (path) => wanted.has(path)).texts;
  const found = new Map(), { repository, selector } = stored.inputs;
  for (const path of allowed.keys()) {
    try {
      const bytes = selector.worktree ? readOracleBytes(join(repository, path), maxFileBytes)
        : gitBytes(repository, ['cat-file', 'blob', `${stored.data.sha}:${path}`]);
      if (bytes.length <= maxFileBytes) found.set(path, bytes);
    } catch { /* An unreadable test has no current digest, so its record stays stale. */ }
  }
  return found;
}
