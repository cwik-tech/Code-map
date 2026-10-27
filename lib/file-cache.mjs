// Per-file analysis facts in the private store's files/ folder.
// Keys cover file content, path, analyzer source, parser version, configuration, dependency lock and settings.
// Cache hits require the same import-resolution answers. Cross-file analysis always runs again.
// Damaged or unreadable entries are misses.
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, futimesSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { analyzeFile } from './analyze.mjs';
import { analyzer, canonical } from './inputs.mjs';
import { ownership, rootProblem } from './store.mjs';

const cacheVersion = 3;
/** The limits of the files folder. When a run writes entries, pruning removes the entries used least recently until both fit. */
const cacheLimits = { entries: 200000, bytes: 200 * 1024 * 1024 };
const entryPattern = /^[0-9a-f]{64}\.json\.gz$/, temporaryPattern = /^[0-9a-f]{64}\.json\.gz\.\d+\.[0-9a-f]{12}\.tmp$/;
const leftoverAge = 24 * 60 * 60 * 1000;
/** A hit sets the time of an entry that is older than this, so the time of use orders the pruning with few writes. */
const touchAge = 60 * 60 * 1000;
/** A larger entry is damaged or planted. */
const maxEntryBytes = 256 * 1024 * 1024;
const lists = ['imports', 'externals', 'exports', 'declarations', 'edges', 'reexports', 'exportDetails'];
const integrity = (resolutions, facts) => createHash('sha256').update(JSON.stringify(resolutions)).update('\0').update(facts).digest('hex');
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isAnswer = (item) => Array.isArray(item) && item.length === 4 && typeof item[3] === 'string' && typeof item[0] === 'string' && typeof item[1] === 'string' && (item[2] === null || typeof item[2] === 'string');

/** Hashes file inputs and settings. A new analyzer option also changes the key. */
export function fileKey(path, text, settings, version = analyzer(), inputs = {}) {
  return createHash('sha256').update(canonical({ cacheVersion, analyzer: version, settings, inputs, path })).update('\0').update(text).digest('hex');
}

/** Opens the per-file cache. Unsafe folders disable reuse. `finish` prunes entries and returns run counts. */
export function openFileCache(root, { limits = cacheLimits, inputs = {} } = {}) {
  const folder = join(root, 'files'), version = analyzer(), reason = folderProblem(root, folder);
  const counts = { hits: 0, misses: 0, written: 0, removed: 0 };
  const analyze = (path, text, resolve, options = {}) => {
    const key = fileKey(path, text, { ...options, tests: !!options.tests }, version, inputs), entry = reason ? null : read(folder, key, path);
    if (entry && entry.resolutions.every(([from, specifier, target, mode]) => resolve(from, specifier, mode) === target)) { counts.hits++; return entry.facts; }
    counts.misses++;
    // Each answer of the resolver, once for each question. The same questions with the same answers give the same facts.
    const answers = new Map();
    const recording = (from, specifier, mode = 'static') => {
      const question = JSON.stringify([from, specifier, mode]);
      if (!answers.has(question)) answers.set(question, [from, specifier, resolve(from, specifier, mode), mode]);
      return answers.get(question)[2];
    };
    const facts = JSON.stringify(analyzeFile(path, text, recording, options)), resolutions = [...answers.values()];
    if (!reason && write(folder, key, `{"cacheVersion":${cacheVersion},"key":"${key}","path":${JSON.stringify(path)},"resolutions":${JSON.stringify(resolutions)},"integrity":"${integrity(resolutions, facts)}","facts":${facts}}`)) counts.written++;
    // A miss gives the facts through JSON too, so a hit and a miss give equal facts.
    return JSON.parse(facts);
  };
  const finish = () => {
    if (!reason && counts.written) { try { counts.removed = prune(folder, limits); } catch { /* another process changed the folder */ } }
    return reason ? { state: 'unavailable', reason, ...counts } : { state: 'on', ...counts };
  };
  return { analyze, finish };
}

/** Why the cache cannot use the folder, or null. It creates the folder, private to the user, as the store does. */
function folderProblem(root, folder) {
  try {
    // As in the store, the root can be a symlink, so its target counts. The files folder itself must not be a symlink.
    const uid = typeof process.getuid === 'function' ? process.getuid() : null, stat = (path, look = lstatSync) => { try { return look(path); } catch { return null; } };
    const rootInfo = stat(root, statSync), rootIssue = rootInfo && uid !== null ? rootProblem(rootInfo, uid) : null;
    if (rootIssue) return `the store folder is not safe: ${rootIssue}`;
    if (!stat(folder)) mkdirSync(folder, { recursive: true, mode: 0o700 });
    const info = lstatSync(folder), issue = info.isSymbolicLink() ? 'it is a symlink' : !info.isDirectory() ? 'it is not a folder' : ownership(info);
    return issue ? `the files folder is not a private folder that you own: ${issue}` : null;
  } catch (error) {
    return `Code-map cannot use the files folder: ${error?.code ?? (error instanceof Error ? error.message : String(error))}`;
  }
}

/** Reads one entry through one open file. Invalid or unavailable entries return null. */
function read(folder, key, path) {
  let descriptor;
  try { descriptor = openSync(join(folder, `${key}.json.gz`), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)); } catch { return null; }
  try {
    // O_NONBLOCK prevents a FIFO from waiting before this file check.
    const info = fstatSync(descriptor);
    if (!info.isFile() || ownership(info) || info.size > maxEntryBytes) return null;
    const entry = JSON.parse(gunzipSync(readFileSync(descriptor), { maxOutputLength: maxEntryBytes }).toString('utf8'));
    if (!isRecord(entry) || entry.cacheVersion !== cacheVersion || entry.key !== key || entry.path !== path || !Array.isArray(entry.resolutions) || !entry.resolutions.every(isAnswer)) return null;
    const facts = entry.facts;
    if (entry.integrity !== integrity(entry.resolutions, JSON.stringify(facts))) return null;
    if (!isRecord(facts) || facts.path !== path || !lists.every((name) => Array.isArray(facts[name])) || !isRecord(facts.uses) || !isRecord(facts.valueUses)) return null;
    if (Date.now() - info.mtimeMs > touchAge) { try { const now = new Date(); futimesSync(descriptor, now, now); } catch { /* a read-only store keeps the old time */ } }
    return entry;
  } catch { return null; } finally { closeSync(descriptor); }
}

/** Writes through a new private temporary file and a rename, so a reader never sees half an entry. False when the write fails. */
function write(folder, key, text) {
  const path = join(folder, `${key}.json.gz`), temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try { writeFileSync(temporary, gzipSync(text, { level: 1 }), { mode: 0o600, flag: 'wx' }); renameSync(temporary, path); return true; } catch {
    try { rmSync(temporary, { force: true }); } catch { /* nothing to remove */ }
    return false;
  }
}

/** Removes old temporary files, then the oldest entries until both limits hold. Other files stay. */
function prune(folder, limits) {
  const now = Date.now(), entries = [];
  for (const name of readdirSync(folder)) {
    let info;
    try { info = lstatSync(join(folder, name)); } catch { continue; } // another process removed it
    if (temporaryPattern.test(name) && now - info.mtimeMs > leftoverAge) rmSync(join(folder, name), { force: true });
    else if (entryPattern.test(name) && info.isFile()) entries.push({ name, time: info.mtimeMs, size: info.size });
  }
  let count = entries.length, bytes = entries.reduce((sum, entry) => sum + entry.size, 0), removed = 0;
  entries.sort((a, b) => a.time - b.time || (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    if (count <= limits.entries && bytes <= limits.bytes) break;
    rmSync(join(folder, entry.name), { force: true });
    count--; bytes -= entry.size; removed++;
  }
  return removed;
}
