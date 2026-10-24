// The analysis store: one immutable, gzip-compressed file for each analysis ID, outside the mapped repository.
// Follow-up commands read an analysis from here, so they never collect again and never read changed code by accident.
// The folder files/ in the same store holds the per-file cache of lib/file-cache.mjs.
import { randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

export const storeVersion = 1;
/** The store keeps the analyses used most recently; older ones are deleted when a new one is saved. */
export const keepAnalyses = 20;
const idPattern = /^A-[0-9a-f]{16}$/, filePattern = /^A-[0-9a-f]{16}\.json\.gz$/, temporaryPattern = /^A-[0-9a-f]{16}\.json\.gz\.\d+\.[0-9a-f]{12}\.tmp$/;
const leftoverAge = 24 * 60 * 60 * 1000;
/** Node cannot hold a JSON string much larger than 512 MiB, so a stored file that expands beyond 1 GiB is damaged or planted. */
const maxStoredBytes = 1024 * 1024 * 1024;
const commitSha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * --store, else CODE_MAP_STORE, else XDG_CACHE_HOME/code-map, else ~/.cache/code-map. A relative XDG_CACHE_HOME is ignored,
 * as the XDG specification requires. `explicit`: --store or an environment variable chose the folder, so printed commands
 * must name it. A follow-up can run with another --store or environment, so a folder that is also the default counts too.
 */
export function storeLocation(option, env = process.env) {
  const fallback = join(homedir(), '.cache', 'code-map'), xdg = env.XDG_CACHE_HOME && isAbsolute(env.XDG_CACHE_HOME) ? join(env.XDG_CACHE_HOME, 'code-map') : null;
  const root = option ? resolve(option) : env.CODE_MAP_STORE ? resolve(env.CODE_MAP_STORE) : xdg ?? fallback;
  return { root, explicit: !!option || !!env.CODE_MAP_STORE || xdg !== null };
}

export function validId(id) {
  if (!idPattern.test(id)) throw new Error(`"${id}" is not an analysis ID. An analysis ID looks like A-0123456789abcdef.`);
  return id;
}

const folderOf = (root) => join(root, 'analyses');
const fileOf = (root, id) => join(folderOf(root), `${validId(id)}.json.gz`);

/** null when the store has no such analysis; throws when the file is there but unreadable. Use marks it as recent. */
export function loadAnalysis(root, id) {
  const path = fileOf(root, id), folder = folderOf(root);
  const unreadable = (problem, cause) => new Error(`Analysis ${id} in the store (${path}) is unreadable: ${problem}. Create it again with code-map inspect --summary.`, { cause });
  if (!entryOf(folder)) return null;
  requireRoot(root);
  requirePrivate(folder);
  const entry = entryOf(path);
  if (!entry) return null;
  if (entry.isSymbolicLink()) throw unreadable('it is a symlink');
  // The checks and the read use one open file, so the file cannot change between them. O_NOFOLLOW refuses a symlink there.
  let descriptor;
  try { descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); } catch (error) { throw unreadable(error instanceof Error ? error.message : String(error), error); }
  let bytes;
  try {
    const info = fstatSync(descriptor), refused = !info.isFile() ? 'it is not a file' : ownership(info);
    if (refused) throw unreadable(refused);
    bytes = readFileSync(descriptor);
  } finally { closeSync(descriptor); }
  let stored;
  try { stored = JSON.parse(gunzipSync(bytes, { maxOutputLength: maxStoredBytes }).toString('utf8')); } catch (error) {
    throw unreadable(error instanceof Error ? error.message : String(error), error);
  }
  const problem = problemOf(stored, id);
  if (problem) throw unreadable(problem);
  // The time of use orders the pruning. A store that the user can only read still serves the analysis.
  try { const now = new Date(); utimesSync(path, now, now); } catch { /* read-only store: keep the old time */ }
  return stored;
}

/** Writes to a temporary file and renames it, so a reader never sees half a file. Folders and files are private to the user. */
export function saveAnalysis(root, stored) {
  const problem = problemOf(stored, stored?.id);
  if (problem) throw new Error(`The store refuses analysis ${stored?.id}: ${problem}.`);
  const folder = folderOf(root);
  if (entryOf(root) && !statSync(root).isDirectory()) throw new Error(`The analysis store ${root} is not a folder. Choose another one with --store <folder>.`);
  if (!entryOf(folder)) mkdirSync(folder, { recursive: true, mode: 0o700 });
  requireRoot(root);
  requirePrivate(folder);
  const path = fileOf(root, stored.id), temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporary, gzipSync(JSON.stringify(stored)), { mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
  prune(folder, stored.id);
  return path;
}

/**
 * Why a stored analysis cannot be used, or null. Follow-ups give the repository, the ref, the commits and the labels and
 * coverage paths to Git and to the file system, so a planted or damaged file must not choose an option, a folder or a file.
 */
function problemOf(stored, id) {
  if (!isRecord(stored)) return 'not an object';
  if (stored.storeVersion !== storeVersion) return `store version ${stored.storeVersion}, expected ${storeVersion}`;
  if (stored.id !== id) return `it holds ${stored.id}`;
  if (stored.data?.analysis?.schemaVersion !== 1) return 'no analysis with schema version 1';
  if (!Array.isArray(stored.findings) || !isRecord(stored.inputs)) return 'no findings or inputs';
  const { repository, selector, sha, labels, coverage } = stored.inputs;
  if (typeof repository !== 'string' || !isAbsolute(repository) || repository.includes('\0')) return 'its repository is not an absolute path';
  if (!isRecord(selector) || typeof selector.worktree !== 'boolean') return 'its selector is not the working tree or a ref';
  if (!safeRef(selector.ref)) return 'its ref starts with "-" or holds a line break or NUL, so Git could read it as an option';
  if (!commitSha.test(sha) || !commitSha.test(stored.data.sha)) return 'its commit is not a full commit SHA';
  if (!isRecord(labels) || !insideRepository(labels.path)) return 'its labels file is not inside the repository';
  if (coverage !== null && (!isRecord(coverage) || !insideRepository(coverage.path))) return 'its coverage file is not inside the repository';
  return null;
}

/** null (no --ref) or a ref that Git cannot read as an option. A ref can hold spaces, for example main@{2 days ago}. */
const safeRef = (ref) => ref === null || (typeof ref === 'string' && ref.length > 0 && !ref.startsWith('-') && !/[\0\n\r]/.test(ref));
/** A repository-relative path. `inspect --summary` refuses a labels or coverage file outside the repository before it collects. */
export const insideRepository = (path) => typeof path === 'string' && path.length > 0 && !/[\0\n\r]/.test(path) && !isAbsolute(path) && !/^[A-Za-z]:/.test(path)
  && path.split(/[\\/]/).every((part) => part !== '..');

const entryOf = (path) => { try { return lstatSync(path); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; } };

/** Another user who can change the folder or a stored file can replace an analysis that follow-ups trust. No owners on Windows. */
export const ownership = (info) => typeof process.getuid !== 'function' ? null : info.uid !== process.getuid() ? 'another user owns it'
  : (info.mode & 0o022) !== 0 ? 'other users can change it' : null;

/**
 * The root can be shared (for example /tmp), but then only with the sticky bit, so that no other user can rename or replace
 * the private analyses folder inside it. A folder that another user owns and others can change is refused.
 */
function requireRoot(root) {
  if (typeof process.getuid !== 'function') return;
  const problem = rootProblem(statSync(root), process.getuid());
  if (problem) throw new Error(`The analysis store ${root} is not safe: ${problem}. Choose another store with --store <folder>.`);
}

/**
 * Why a store root is not safe, or null. The owner of a folder can rename what is in it, so another owner could swap the
 * analyses folder after the check. Only the system (uid 0) can own a shared root, and only with the sticky bit, as /tmp.
 */
export function rootProblem(info, uid) {
  const sticky = (info.mode & 0o1000) !== 0;
  if (!info.isDirectory()) return 'it is not a folder';
  if (info.uid !== uid && !(info.uid === 0 && sticky)) return 'another user owns it';
  if ((info.mode & 0o022) !== 0 && !sticky) return 'other users can change it, and it has no sticky bit';
  return null;
}

/**
 * Writes a private file (0600) through a new temporary file and a rename. The temporary file must be new ('wx'), and the
 * rename replaces a symlink at the target, so the write never goes through a link that someone planted.
 */
export function writePrivateFile(path, text) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  requirePrivateFolder(dirname(path), 'Choose a private output folder.');
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try { writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' }); renameSync(temporary, path); } catch (error) { rmSync(temporary, { force: true }); throw error; }
}

/**
 * The bytes of a private file of the store, or null when it does not exist: a regular file that the user owns, that others
 * cannot change, and of at most `max` bytes. O_NOFOLLOW refuses a symlink, and the checks and the read use one open file.
 */
export function readPrivateFile(path, max) {
  let descriptor;
  try { descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  try {
    const info = fstatSync(descriptor), problem = !info.isFile() ? 'it is not a file' : ownership(info) ?? (info.size > max ? `it is larger than ${max} bytes` : null);
    if (problem) throw new Error(problem);
    return readFileSync(descriptor);
  } finally { closeSync(descriptor); }
}

/** A private folder of the store, made when it is missing. The root follows the rule of rootProblem, and the folder must be private to the user. */
export function storeFolder(root, name) {
  if (entryOf(root) && !statSync(root).isDirectory()) throw new Error(`The analysis store ${root} is not a folder. Choose another one with --store <folder>.`);
  const folder = join(root, name);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  requireRoot(root);
  requirePrivate(folder);
  return folder;
}

function requirePrivate(folder) { requirePrivateFolder(folder, 'Remove it, or choose another store with --store <folder>.'); }

/** A folder that only the user can change: not a symlink, owned by the user, not writable by others. `advice` ends the error. */
export function requirePrivateFolder(folder, advice) {
  const info = lstatSync(folder), problem = info.isSymbolicLink() ? 'it is a symlink' : !info.isDirectory() ? 'it is not a folder' : ownership(info);
  if (problem) throw new Error(`The folder ${folder} is not a private folder that you own: ${problem}. ${advice}`);
}

/** Another process can rename or delete an entry at the same time, so an entry that is gone is skipped. Only Code-map's own temporary files are deleted. */
function prune(folder, keep) {
  const now = Date.now();
  const entries = readdirSync(folder).flatMap((name) => { try { return [{ name, time: statSync(join(folder, name)).mtimeMs }]; } catch { return []; } });
  for (const entry of entries) if (temporaryPattern.test(entry.name) && now - entry.time > leftoverAge) rmSync(join(folder, entry.name), { force: true });
  const analyses = entries.filter((entry) => filePattern.test(entry.name) && entry.name !== `${keep}.json.gz`).sort((a, b) => b.time - a.time);
  for (const entry of analyses.slice(keepAnalyses - 1)) rmSync(join(folder, entry.name), { force: true });
}
