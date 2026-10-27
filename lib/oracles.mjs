// Human oracle records. The caller supplies the date and the snapshot texts.
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeTestPath } from './verify-exec-request.mjs';
import { readOracleBytes } from './oracle-files.mjs';
export const oracleFile = '.code-map/oracles.json';
const maxBytes = 4 * 1024 * 1024;
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = (x, max) => typeof x === 'string' && x.trim().length > 0 && x.length <= max && !/[\p{Cc}]/u.test(x);
const fields = ['file', 'suite', 'name', 'criterion', 'digest', 'method', 'confirmedBy', 'date'];
/** SHA-256 of the exact test file bytes. */
export const oracleDigest = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** Strict schema validation. No unknown field or duplicate case and criterion is accepted. */
export function validateOracles(value) {
  const errors = [], add = (path, message) => errors.push({ path, message });
  if (!record(value)) return { ok: false, errors: [{ path: '', message: 'Must be an oracle object.' }] };
  for (const key of Object.keys(value)) if (!['oracleVersion', 'entries'].includes(key)) add(key, 'Unknown field.');
  if (value.oracleVersion !== 1) add('oracleVersion', 'Must be 1.');
  if (!Array.isArray(value.entries) || value.entries.length > 10000) add('entries', 'Must list at most 10000 records.');
  else {
    const seen = new Set();
    value.entries.forEach((item, index) => {
      const at = `entries[${index}]`;
      if (!record(item)) { add(at, 'Must be an object.'); return; }
      for (const key of Object.keys(item)) if (!fields.includes(key)) add(`${at}.${key}`, 'Unknown field.');
      if (!safeTestPath(item.file) || item.file.length > 1024) add(`${at}.file`, 'Must be a safe relative test file path.');
      if (!(item.suite === null || text(item.suite, 1000))) add(`${at}.suite`, 'Must be a suite name or null.');
      for (const [key, max] of [['name', 1000], ['method', 2000], ['confirmedBy', 100]]) if (!text(item[key], max)) add(`${at}.${key}`, `Must be nonempty text of at most ${max} characters.`);
      if (typeof item.criterion !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(item.criterion)) add(`${at}.criterion`, 'Must be a criterion ID.');
      if (typeof item.digest !== 'string' || !/^[a-f0-9]{64}$/.test(item.digest)) add(`${at}.digest`, 'Must be a SHA-256 digest.');
      const date = typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? Date.parse(`${item.date}T00:00:00Z`) : NaN;
      if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== item.date) add(`${at}.date`, 'Must be a calendar date.');
      const key = JSON.stringify([item.file, item.suite, item.name, item.criterion]);
      if (seen.has(key)) add(at, 'Duplicate case and criterion.');
      seen.add(key);
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true, entries: structuredClone(value.entries) };
}
function folderOf(repository, create = false) {
  const folder = join(repository, '.code-map'), info = lstatSync(folder, { throwIfNoEntry: false });
  if (info && (info.isSymbolicLink() || !info.isDirectory())) throw new Error('The oracle folder .code-map must be a folder, not a symlink.');
  if (!info && create) mkdirSync(folder, { mode: 0o700 });
  return folder;
}
/** Reads at most 4 MiB. A missing file has no records. Invalid files fail with field paths. */
export function readOracles(repository) {
  folderOf(repository);
  const path = join(repository, oracleFile), info = lstatSync(path, { throwIfNoEntry: false });
  if (!info) return null;
  if (!info.isFile()) throw new Error('The oracle file must be a regular file.');
  const bytes = readOracleBytes(path, maxBytes);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch (cause) { throw new Error('The oracle file is not valid JSON.', { cause }); }
  const checked = validateOracles(value);
  if (!checked.ok) throw new Error(`Invalid oracle file: ${checked.errors.slice(0, 20).map((x) => `${x.path}: ${x.message}`).join('\n')}`);
  return { entries: checked.entries, digest: oracleDigest(bytes) };
}
/** Replaces the file through a rename after checking its prior digest. */
export function writeOracles(repository, entries, digest) {
  const checked = validateOracles({ oracleVersion: 1, entries });
  if (!checked.ok) throw new Error(`Invalid oracle record: ${checked.errors.map((x) => `${x.path}: ${x.message}`).join('\n')}`);
  const content = JSON.stringify({ oracleVersion: 1, entries: checked.entries }, null, 2) + '\n';
  if (Buffer.byteLength(content) > maxBytes) throw new Error('The oracle file is larger than 4 MiB.');
  folderOf(repository, true);
  const path = join(repository, oracleFile), temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
    if ((readOracles(repository)?.digest ?? null) !== digest) throw new Error('The oracle file changed. Run the command again.');
    renameSync(temporary, path);
  } catch (error) { rmSync(temporary, { force: true }); throw error; }
  return oracleDigest(content);
}
/** Binds each record to the selected head snapshot. Missing files are stale too. */
export function bindOracles(entries, texts) {
  return entries.map((entry) => ({ ...entry, stale: !texts.has(entry.file) || oracleDigest(texts.get(entry.file)) !== entry.digest }));
}
