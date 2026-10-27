// The workspace of one run: a new private folder under the store with a copy of the snapshot (tree/), the home folder of the
// run (home/) and its temporary folder (tmp/). The run writes only here. Code-map reads the repository with read-only Git
// commands and copies files out of it. It never writes into the repository, and it removes the workspace after the run.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, readlinkSync, realpathSync,
  rmSync, symlinkSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isRelativePath } from '../adapters/run-manifest.mjs';
import { git, gitBytes } from '../git.mjs';
import { isInside, realPath } from '../inspect.mjs';
import { requirePrivateFolder } from '../store.mjs';
import { artifactScript } from './artifact.mjs';
import { sandboxCommand } from './backend.mjs';

/** One `git cat-file --batch` reads at most this many bytes of blobs. A larger blob is read alone. */
const batchBytes = 256 * 1024 * 1024, chunk = 1024 * 1024;
const readFlags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const safe = (path) => typeof path === 'string' && path.length > 0 && !path.includes('\0') && !path.startsWith('/') && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');

/** Makes the workspace folders, private to the user (0700). The workspace of a run ID must be new. Returns their real paths. */
export function createWorkspace(root, runId) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  requirePrivateFolder(root, 'Remove it, or choose another store with --store <folder>.');
  const folder = join(realpathSync(root), runId);
  mkdirSync(folder, { mode: 0o700 });
  for (const name of ['tree', 'home', 'tmp']) mkdirSync(join(folder, name), { mode: 0o700 });
  return { folder, tree: join(folder, 'tree'), home: join(folder, 'home'), tmp: join(folder, 'tmp') };
}

const collision = (path, error) => new Error(`The snapshot has two paths that differ only in letter case, or a file and a folder with one name (${path}). `
  + 'The file system of the store cannot hold both, so Code-map refuses the copy.', { cause: error });

/**
 * Writes the entries in three steps: every folder, then every file, then every symlink. No symlink exists while Code-map
 * makes a folder or writes a file, so no write can go through a link. A link whose name matches a folder is refused.
 */
function place(tree, entries, writeFiles, links) {
  for (const entry of entries) if (!safe(entry.path)) throw new Error(`The snapshot has an unsafe path ${JSON.stringify(entry.path)}. Code-map refuses the copy.`);
  const folders = new Set(entries.flatMap((entry) => entry.path.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/'))));
  for (const folder of [...folders].sort()) {
    try { mkdirSync(join(tree, folder), { mode: 0o700 }); } catch (error) { if (error?.code !== 'EEXIST' || !lstatSync(join(tree, folder)).isDirectory()) throw collision(folder, error); }
  }
  writeFiles((path, write) => { try { write(join(tree, path)); } catch (error) { throw ['EEXIST', 'EISDIR', 'ENOTDIR'].includes(error?.code) ? collision(path, error) : error; } });
  for (const { path, target } of links) { try { symlinkSync(target, join(tree, path)); } catch (error) { throw collision(path, error); } }
  return entries.length;
}

/** The contents of these blobs, in batches of at most batchBytes, each through one `git cat-file --batch`. */
function* blobBatches(repository, blobs) {
  for (let start = 0; start < blobs.length;) {
    let end = start, size = 0;
    while (end < blobs.length && (end === start || size + blobs[end].size <= batchBytes)) size += blobs[end++].size;
    const batch = blobs.slice(start, end), output = gitBytes(repository, ['cat-file', '--batch'], batch.map((blob) => blob.oid).join('\n') + '\n'), contents = new Map();
    let offset = 0;
    for (const blob of batch) {
      const headerEnd = output.indexOf(0x0a, offset), [, type, length] = output.subarray(offset, headerEnd).toString('utf8').split(' ');
      if (type !== 'blob') throw new Error(`Git cannot read the blob ${blob.oid} of ${blob.path}.`);
      contents.set(blob.oid, output.subarray(headerEnd + 1, headerEnd + 1 + Number(length)));
      offset = headerEnd + 1 + Number(length) + 1;
    }
    yield batch.map((blob) => ({ ...blob, bytes: contents.get(blob.oid) }));
    start = end;
  }
}

/**
 * Copies the files of a commit into `tree`: the blobs as Git stores them, through `git ls-tree` and `git cat-file`. No filter,
 * no export-ignore and no export-subst applies, and no program of the repository runs. A submodule has no files here.
 */
export function exportCommit(repository, sha, tree) {
  const entries = git(repository, ['ls-tree', '-r', '-z', '-l', '--full-tree', sha]).split('\0').filter(Boolean).flatMap((line) => {
    const tab = line.indexOf('\t'), [mode, type, oid, size] = line.slice(0, tab).trim().split(/\s+/);
    return type === 'blob' ? [{ mode, oid, size: Number(size), path: line.slice(tab + 1) }] : [];
  });
  const files = entries.filter((entry) => entry.mode !== '120000'), links = entries.filter((entry) => entry.mode === '120000');
  const targets = [...blobBatches(repository, links)].flat().map((link) => ({ path: link.path, target: link.bytes.toString('utf8') }));
  return place(tree, entries, (write) => {
    for (const batch of blobBatches(repository, files)) for (const file of batch) write(file.path, (path) => writeFileSync(path, file.bytes, { flag: 'wx', mode: file.mode === '100755' ? 0o700 : 0o600 }));
  }, targets);
}

/** Copies one regular file without following a symlink at its name. False when the entry is not a regular file now. */
function copyFile(source, target, mode) {
  const input = openSync(source, readFlags);
  try {
    if (!fstatSync(input).isFile()) return false;
    const output = openSync(target, 'wx', mode), buffer = Buffer.allocUnsafe(chunk);
    try { for (let size; (size = readSync(input, buffer)) > 0;) writeSync(output, buffer, 0, size); } finally { closeSync(output); }
    return true;
  } finally { closeSync(input); }
}

/**
 * Copies the working tree into `tree`: the tracked files and the untracked files that Git does not ignore. A deleted file, a
 * submodule and a nested repository are left out. A file behind a folder symlink that leads outside the repository is refused.
 */
export function copyWorktree(repository, tree) {
  const top = realpathSync(repository), files = [], links = [], folders = new Map();
  const inside = (folder) => { if (!folders.has(folder)) folders.set(folder, isInside(top, realPath(folder))); return folders.get(folder); };
  for (const path of new Set(git(repository, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))) {
    if (path.endsWith('/')) continue; // an untracked nested repository
    if (!safe(path)) throw new Error(`The working tree has an unsafe path ${JSON.stringify(path)}. Code-map refuses the copy.`);
    const full = join(repository, path);
    if (!inside(dirname(full))) throw new Error(`The working-tree file ${path} is behind a symlink that leads outside the repository. Code-map refuses the copy.`);
    let info;
    try { info = lstatSync(full); } catch { continue; }
    if (info.isSymbolicLink()) links.push({ path, target: readlinkSync(full) });
    else if (info.isFile()) files.push({ path, source: full, mode: (info.mode & 0o111) !== 0 ? 0o700 : 0o600 });
  }
  return place(tree, [...files, ...links], (write) => { for (const file of files) write(file.path, (path) => copyFile(file.source, path, file.mode)); }, links);
}

const cloneFolder = (source, target) => spawnSync('/bin/cp', ['-c', '-R', source, target], { stdio: 'ignore' }).status === 0;

/** Makes clone entries private before project code starts. Symlinks keep their targets and are never followed. */
function privateClone(folder) {
  chmodSync(folder, 0o700);
  for (const name of readdirSync(folder)) {
    const path = join(folder, name), info = lstatSync(path);
    if (info.isDirectory()) privateClone(path);
    else if (info.isFile()) chmodSync(path, (info.mode & 0o111) !== 0 ? 0o700 : 0o600);
  }
}

/**
 * Gives the run the node_modules folder of the working folder. On macOS it is a copy-on-write clone (cp -c, APFS). When the
 * clone fails, and always on Linux, it is a read-only link. On macOS, that is a symlink that the run can read but not change.
 * On Linux, it is an empty folder where bubblewrap mounts the folder read-only. `mode` says which, for the record.
 */
export function linkNodeModules(repository, tree, { platform = process.platform, clone = cloneFolder } = {}) {
  const original = join(realpathSync(repository), 'node_modules'), target = join(tree, 'node_modules');
  let info = null, source;
  try { source = realpathSync(original); info = lstatSync(source); } catch { /* no node_modules */ }
  if (!info?.isDirectory()) return { mode: 'none', source: null };
  if (existsSync(target)) return { mode: 'snapshot', source: null };
  // A symlink uses a read-only link, so buildPolicy checks its real target before any of its files enter the sandbox.
  if (platform === 'darwin' && !lstatSync(original).isSymbolicLink() && clone(source, target)) {
    privateClone(target);
    return { mode: 'clone', source: null };
  }
  rmSync(target, { recursive: true, force: true });
  if (platform === 'darwin') symlinkSync(source, target); else mkdirSync(target, { mode: 0o700 });
  return { mode: 'read-only-link', source };
}

/**
 * The bytes and the SHA-256 digest of the artifact of a run. It must be a regular file of at most `max` bytes whose real path
 * is inside the workspace. The fixed collector runs inside the sandbox and refuses symlinks. The host reads only its pipe.
 */
export function collectArtifact(tree, path, max, { backend, policy, environment } = {}) {
  if (!isRelativePath(path)) throw new Error(`The artifact path ${JSON.stringify(path)} is not a relative path inside the workspace.`);
  if (!backend || !policy || !environment) throw new Error('Artifact collection needs the sandbox of the run. Code-map refuses a host read.');
  if (!Number.isSafeInteger(max) || max < 1 || max > 50 * 1024 * 1024) throw new Error('The artifact byte limit must be from 1 through 52428800.');
  const command = sandboxCommand(backend, policy, [process.execPath, '-e', artifactScript, tree, path, String(max)], policy.workspace);
  const result = spawnSync(command.file, command.args, { cwd: policy.workspace, env: environment, timeout: 30000, maxBuffer: max + 65536 });
  if (result.error || result.status !== 0) throw new Error(`The artifact ${path} ${result.error?.message ?? result.stderr?.toString('utf8') ?? 'cannot be copied inside the sandbox'}.`);
  const bytes = result.stdout;
  if (bytes.length > max) throw new Error(`The artifact ${path} is larger than ${max} bytes.`);
  return { bytes, digest: sha256(bytes) };
}

/** Lets the user enter each folder again, because the run can remove the permissions of a folder in its workspace. Links are not followed. */
function unlock(folder) {
  try { chmodSync(folder, 0o700); } catch { return; }
  for (const name of readdirSync(folder)) { const path = join(folder, name); if (lstatSync(path).isDirectory()) unlock(path); }
}

/** Removes the workspace without following a link in it. True when the workspace is gone. */
export function removeWorkspace(folder) {
  try { rmSync(folder, { recursive: true, force: true }); } catch {
    try { unlock(folder); rmSync(folder, { recursive: true, force: true }); } catch { /* the record says that the workspace stays */ }
  }
  return !existsSync(folder);
}
