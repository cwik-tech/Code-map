// Reads harness-owned inputs within a copied workspace. All reads have explicit limits.
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { relative, resolve, isAbsolute } from 'node:path';
/** Resolves a file inside root. A symlink cannot escape root. */
export function inside(root, path) {
  const base = realpathSync(root), full = realpathSync(resolve(base, path)), rest = relative(base, full);
  if (rest === '..' || rest.startsWith('../') || isAbsolute(rest)) throw new Error(`Harness path leaves the workspace: ${path}`);
  return full;
}
/** Reads a bounded JSON file. A non-regular file is refused. */
export function fileBytes(root, path, max = 262144) {
  const full = inside(root, path), fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > max) throw new Error(`Harness JSON file exceeds its limit or is not regular: ${path}`);
    return readFileSync(fd);
  } finally { closeSync(fd); }
}

/** Parses one bounded JSON input within the workspace. */
export function jsonFile(root, path, max = 262144) { return JSON.parse(fileBytes(root, path, max).toString('utf8')); }
