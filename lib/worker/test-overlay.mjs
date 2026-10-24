// Copies declared head test files into a private base snapshot before project code starts.
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, gitBytes } from '../git.mjs';
import { safeTestPath } from '../verify-exec-request.mjs';

const maxFile = 2 * 1024 * 1024, maxTotal = 16 * 1024 * 1024;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** Refuses every symlink component, including links that currently stay inside the tree. */
function checkedPath(root, path, create = false) {
  if (!safeTestPath(path)) throw new Error(`Unsafe copied test path: ${JSON.stringify(path)}.`);
  const parts = path.split('/');
  let full = root;
  for (const [index, part] of parts.entries()) {
    full = join(full, part);
    let info = lstatSync(full, { throwIfNoEntry: false });
    if (!info && create && index < parts.length - 1) { mkdirSync(full, { mode: 0o700 }); info = lstatSync(full); }
    if (info?.isSymbolicLink()) throw new Error(`The copied test path ${path} contains a symlink.`);
    if (index < parts.length - 1 && !info?.isDirectory()) throw new Error(`The copied test parent of ${path} is not a directory.`);
    if (index === parts.length - 1 && info && !info.isFile()) throw new Error(`The copied test ${path} is not a regular file.`);
  }
  return full;
}
/** Reads bounded regular head files. A committed file comes directly from its Git blob. */
export function readTestOverlay(repository, { head, files }) {
  if (!Array.isArray(files) || !files.length || files.length > 100 || new Set(files).size !== files.length) throw new Error('An overlay needs 1 to 100 distinct test files.');
  let total = 0;
  return files.map((path) => {
    if (!safeTestPath(path)) throw new Error(`Unsafe copied test path: ${JSON.stringify(path)}.`);
    let bytes;
    if (head === null) {
      const full = checkedPath(repository, path), descriptor = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const info = fstatSync(descriptor);
        if (!info.isFile() || info.size > maxFile) throw new Error(`The copied test ${path} is not a regular file within 2 MiB.`);
        bytes = readFileSync(descriptor);
      } finally { closeSync(descriptor); }
    } else {
      if (typeof head !== 'string' || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(head)) throw new Error('A test overlay needs a full head commit SHA.');
      const entry = git(repository, ['ls-tree', '-z', '-l', head, '--', path]).split('\0').find((line) => line.slice(line.indexOf('\t') + 1) === path);
      const [mode, type, oid, size] = (entry ?? '').split('\t')[0].trim().split(/\s+/);
      if (!['100644', '100755'].includes(mode) || type !== 'blob' || Number(size) > maxFile) throw new Error(`The copied test ${path} is not a regular head file within 2 MiB.`);
      bytes = gitBytes(repository, ['cat-file', 'blob', oid]);
    }
    total += bytes.length;
    if (bytes.length > maxFile || total > maxTotal) throw new Error('Copied tests exceed the 2 MiB file or 16 MiB total limit.');
    return { path, bytes, digest: digest(bytes) };
  });
}
/** Applies the already read files before the sandbox starts, and returns their distinct snapshot digest. */
export function applyTestOverlay(tree, files, inputs) {
  for (const file of files) {
    const full = checkedPath(tree, file.path, true);
    const descriptor = openSync(full, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try { writeFileSync(descriptor, file.bytes); } finally { closeSync(descriptor); }
  }
  const tests = files.map(({ path, digest }) => ({ path, digest }));
  return { tests, digest: digest(JSON.stringify({ source: inputs.sha, worktree: inputs.worktree?.contentDigest ?? null, tests })) };
}
