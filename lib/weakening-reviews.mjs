// Human weakening review records. The caller supplies the date and the snapshot texts.
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readOracleBytes } from './oracle-files.mjs';
export const reviewFile = '.code-map/reviews.json';
const maxBytes = 4 * 1024 * 1024;
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = (x, max) => typeof x === 'string' && x.trim().length > 0 && x.length <= max && !/[\p{Cc}]/u.test(x);
const fields = ['id', 'file', 'digest', 'reason', 'reviewedBy', 'date'];
/** Safe relative repository file paths, including runner configurations. */
export const safeReviewPath = (path) => typeof path === 'string' && path.length <= 1024 && path.length > 0
  && !/[\\:\p{Cc}]/u.test(path) && !path.split('/').some((part) => !part || ['.', '..', '.git', 'node_modules'].includes(part.toLowerCase()));
/** SHA-256 of the supplied bytes or identity text. */
export const reviewDigest = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** Strict schema validation. No unknown field or duplicate weakening ID is accepted. */
export function validateReviews(value) {
  const errors = [], add = (path, message) => errors.push({ path, message });
  if (!record(value)) return { ok: false, errors: [{ path: '', message: 'Must be a review object.' }] };
  for (const key of Object.keys(value)) if (!['reviewsVersion', 'entries'].includes(key)) add(key, 'Unknown field.');
  if (value.reviewsVersion !== 1) add('reviewsVersion', 'Must be 1.');
  if (!Array.isArray(value.entries) || value.entries.length > 10000) add('entries', 'Must list at most 10000 records.');
  else {
    const seen = new Set();
    value.entries.forEach((item, index) => {
      const at = `entries[${index}]`;
      if (!record(item)) { add(at, 'Must be an object.'); return; }
      for (const key of Object.keys(item)) if (!fields.includes(key)) add(`${at}.${key}`, 'Unknown field.');
      if (!safeReviewPath(item.file) || item.file.length > 1024) add(`${at}.file`, 'Must be a safe relative file path.');
      for (const [key, max] of [['reason', 2000], ['reviewedBy', 100]]) if (!text(item[key], max)) add(`${at}.${key}`, `Must be nonempty text of at most ${max} characters.`);
      if (typeof item.id !== 'string' || !/^weakening:[a-f0-9]{64}$/.test(item.id)) add(`${at}.id`, 'Must be a weakening ID.');
      if (typeof item.digest !== 'string' || !/^[a-f0-9]{64}$/.test(item.digest)) add(`${at}.digest`, 'Must be a SHA-256 digest.');
      const date = typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? Date.parse(`${item.date}T00:00:00Z`) : NaN;
      if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== item.date) add(`${at}.date`, 'Must be a calendar date.');
      const key = item.id;
      if (seen.has(key)) add(at, 'Duplicate weakening ID.');
      seen.add(key);
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true, entries: structuredClone(value.entries) };
}
function folderOf(repository, create = false) {
  const folder = join(repository, '.code-map'), info = lstatSync(folder, { throwIfNoEntry: false });
  if (info && (info.isSymbolicLink() || !info.isDirectory())) throw new Error('The review folder .code-map must be a folder, not a symlink.');
  if (!info && create) mkdirSync(folder, { mode: 0o700 });
  return folder;
}
/** Reads at most 4 MiB. A missing file has no records. Invalid files fail with field paths. */
export function readReviews(repository) {
  folderOf(repository);
  const path = join(repository, reviewFile), info = lstatSync(path, { throwIfNoEntry: false });
  if (!info) return null;
  if (!info.isFile()) throw new Error('The review file must be a regular file.');
  const bytes = readOracleBytes(path, maxBytes);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch (cause) { throw new Error('The review file is not valid JSON.', { cause }); }
  const checked = validateReviews(value);
  if (!checked.ok) throw new Error(`Invalid review file: ${checked.errors.slice(0, 20).map((x) => `${x.path}: ${x.message}`).join('\n')}`);
  return { entries: checked.entries, digest: reviewDigest(bytes) };
}
/** Replaces the file through a rename after checking its prior digest. */
export function writeReviews(repository, entries, digest) {
  const checked = validateReviews({ reviewsVersion: 1, entries });
  if (!checked.ok) throw new Error(`Invalid review record: ${checked.errors.map((x) => `${x.path}: ${x.message}`).join('\n')}`);
  const content = JSON.stringify({ reviewsVersion: 1, entries: checked.entries }, null, 2) + '\n';
  if (Buffer.byteLength(content) > maxBytes) throw new Error('The review file is larger than 4 MiB.');
  folderOf(repository, true);
  const path = join(repository, reviewFile), temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
    if ((readReviews(repository)?.digest ?? null) !== digest) throw new Error('The review file changed. Run the command again.');
    renameSync(temporary, path);
  } catch (error) { rmSync(temporary, { force: true }); throw error; }
  return reviewDigest(content);
}

/** Bind every detected entry. A changed digest makes the corresponding review stale. */
export function reviewWeakening(repository, entries) {
  let file = null, error = null;
  try { file = readReviews(repository); } catch (cause) { error = cause.message; }
  const records = new Map((file?.entries ?? []).map((item) => [item.id, item]));
  const bound = entries.map((item) => {
    const found = records.get(item.id), stale = !!found && (!item.digest || found.digest !== item.digest);
    return { ...item, review: found ? { ...found, stale, accepted: !stale } : null };
  });
  return { path: reviewFile, error, total: bound.length, unreviewed: bound.filter((x) => !x.review?.accepted).length,
    entries: bound };
}
