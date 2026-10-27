// The triage file (C41): `.code-map-triage.json` at the repository root, a file that a team commits. Each entry names a finding
// by its fingerprint and its rule, with a state, a reason, an owner and a date. A suppression also has an expiry date.
// The file is not an input of the analysis: Code-map applies it when it reads a stored analysis. The caller gives the current
// date (YYYY-MM-DD, UTC), so no function here reads the clock.
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findingRules } from './findings.mjs';

export const triageFile = '.code-map-triage.json';
export const triageVersion = 1;
/** `confirmed` and `dismissed` are labels for precision. `dismissed` and an active `suppressed` hide a finding. */
export const states = ['confirmed', 'dismissed', 'suppressed'];
/** A suppression ends at most this many days after the date of its entry. */
const maxSuppressionDays = 365;
const maxEntries = 10000, maxReason = 1000, maxOwner = 100, maxFileBytes = 4 * 1024 * 1024, shownErrors = 20, dayMs = 24 * 60 * 60 * 1000;
const fileFields = ['triageVersion', 'entries'], entryFields = ['fingerprint', 'ruleId', 'state', 'reason', 'owner', 'date', 'expires'];
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const text = (value, max, oneLine = false) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !(oneLine && /[\n\r]/.test(value));

/** The calendar date (UTC) of a time, for the CLI. */
export const calendarDate = (date) => date.toISOString().slice(0, 10);

/** The day number of a calendar date in the form YYYY-MM-DD, or null when the text is not such a date. */
function dayOf(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value ? null : time / dayMs;
}

function requireDay(today) {
  const now = dayOf(today);
  if (now === null) throw new Error(`The current date must be a calendar date in the form YYYY-MM-DD, not ${JSON.stringify(today)}.`);
  return now;
}

/** The problems of one entry, as [field, message] pairs. Unknown fields and duplicates are checked by validateTriage. */
export function entryErrors(entry, today) {
  const now = requireDay(today), errors = [], add = (field, message) => errors.push([field, message]);
  if (typeof entry.fingerprint !== 'string' || !/^[0-9a-f]{16}$/.test(entry.fingerprint)) add('fingerprint', 'must be the 16 hexadecimal characters of a finding fingerprint.');
  if (typeof entry.ruleId !== 'string' || !Object.hasOwn(findingRules, entry.ruleId)) add('ruleId', `must be a rule ID of Code-map: ${Object.keys(findingRules).join(', ')}.`);
  if (!states.includes(entry.state)) add('state', 'must be confirmed, dismissed or suppressed.');
  if (!text(entry.reason, maxReason)) add('reason', `is necessary: a text of 1 to ${maxReason} characters that says why.`);
  if (!text(entry.owner, maxOwner, true)) add('owner', `is necessary: a name of 1 to ${maxOwner} characters on one line.`);
  const date = dayOf(entry.date), expires = dayOf(entry.expires);
  // One day more than the current date allows for the time zones of the people who write the file.
  if (date === null) add('date', 'must be a calendar date in the form YYYY-MM-DD.');
  else if (date > now + 1) add('date', `is after the current date ${today}.`);
  if (entry.state !== 'suppressed') { if (entry.expires !== undefined) add('expires', 'applies only to the state suppressed.'); }
  else if (entry.expires === undefined) add('expires', `is necessary for the state suppressed: a date at most ${maxSuppressionDays} days after the date.`);
  else if (expires === null) add('expires', 'must be a calendar date in the form YYYY-MM-DD.');
  else if (date !== null && expires < date) add('expires', `must not be before the date ${entry.date}.`);
  else if (date !== null && expires - date > maxSuppressionDays) add('expires', `must be at most ${maxSuppressionDays} days after the date ${entry.date}.`);
  return errors;
}

/** { ok: true, triage } or { ok: false, errors: [{ path, message }] } for the parsed JSON of a triage file. */
export function validateTriage(value, today) {
  requireDay(today);
  if (!isRecord(value)) return { ok: false, errors: [{ path: '', message: 'must be an object with triageVersion and entries.' }] };
  const errors = [], add = (path, message) => errors.push({ path, message });
  for (const key of Object.keys(value)) if (!fileFields.includes(key)) add(key, `is not a known field. The fields are ${fileFields.join(' and ')}.`);
  if (value.triageVersion !== triageVersion) add('triageVersion', `must be ${triageVersion}.`);
  if (!Array.isArray(value.entries)) { add('entries', 'must be a list.'); return { ok: false, errors }; }
  if (value.entries.length > maxEntries) add('entries', `must have at most ${maxEntries} entries.`);
  const seen = new Map();
  value.entries.forEach((entry, index) => {
    const at = `entries[${index}]`;
    if (!isRecord(entry)) { add(at, 'must be an object.'); return; }
    for (const key of Object.keys(entry)) if (!entryFields.includes(key)) add(`${at}.${key}`, `is not a known field. The fields are ${entryFields.join(', ')}.`);
    for (const [field, message] of entryErrors(entry, today)) add(`${at}.${field}`, message);
    if (seen.has(entry.fingerprint)) add(`${at}.fingerprint`, `repeats the fingerprint of entries[${seen.get(entry.fingerprint)}]. A finding can have one entry.`);
    else if (typeof entry.fingerprint === 'string') seen.set(entry.fingerprint, index);
  });
  return errors.length ? { ok: false, errors } : { ok: true, triage: { triageVersion, entries: value.entries } };
}

/** The error text for a list of problems, at most 20 of them. */
export function problems(title, errors) {
  const lines = errors.slice(0, shownErrors).map((error) => `  ${error.path ? `${error.path}: ` : ''}${error.message}`);
  return [title, ...lines, ...(errors.length > shownErrors ? [`  and ${errors.length - shownErrors} more problems`] : [])].join('\n');
}

/** The triage file of a repository with its SHA-256 digest, or null when there is none. An unreadable or invalid file throws. */
export function readTriage(repository, today) {
  const path = join(repository, triageFile);
  let info;
  const unreadable = (error) => new Error(`Code-map cannot read the triage file ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  try { info = lstatSync(path); } catch (error) { if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null; throw unreadable(error); }
  if (!info.isFile()) throw new Error(`The triage file ${path} is not a regular file. Replace it with a JSON file, or remove it.`);
  if (info.size > maxFileBytes) throw new Error(`The triage file ${path} is larger than ${maxFileBytes / 1024 / 1024} MiB.`);
  let bytes;
  try { bytes = readFileSync(path); } catch (error) { throw unreadable(error); }
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch (error) { throw new Error(`The triage file ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  const checked = validateTriage(value, today);
  if (!checked.ok) throw new Error(problems(`The triage file ${path} is not valid:`, checked.errors));
  return { path, digest: sha256(bytes), entries: checked.triage.entries };
}

/**
 * Writes the entries through a new temporary file and a rename, so a reader never sees half a file. `digest` is that of the
 * file that the caller read (null: no file). When the file changed after that read, nothing is written. Returns the new digest.
 */
export function writeTriage(repository, entries, digest) {
  const path = join(repository, triageFile), content = JSON.stringify({ triageVersion, entries }, null, 2) + '\n';
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  let mode = 0o644;
  try { mode = statSync(path).mode & 0o777; } catch { /* a new file */ }
  try {
    writeFileSync(temporary, content, { mode, flag: 'wx' });
    let now = null;
    try { now = sha256(readFileSync(path)); } catch { /* no file */ }
    if (now !== digest) throw new Error(`The triage file ${path} changed while Code-map wrote it. Run the command again.`);
    renameSync(temporary, path);
  } catch (error) { rmSync(temporary, { force: true }); throw error; }
  return sha256(content);
}

/**
 * The entry of each finding (`notes`, by finding ID), and the entries that expired or match no finding. An entry applies to
 * the finding with its fingerprint and its rule. In a comparison, it also applies to the head finding that matches its base
 * finding, for example after a rename. A dismissal and a suppression before its end hide the finding.
 */
export function applyTriage(triage, findings, today, comparison = null) {
  const now = requireDay(today), byFingerprint = new Map(triage.entries.map((entry) => [entry.fingerprint, entry]));
  const baseFingerprints = new Map((comparison?.base.findings ?? []).map((finding) => [finding.id, finding.fingerprint]));
  const notes = new Map(), used = new Map(), otherRule = new Set();
  const expiredOf = (entry) => entry.state === 'suppressed' && dayOf(entry.expires) < now;
  for (const finding of findings) {
    let entry = byFingerprint.get(finding.fingerprint), matchedBy = 'fingerprint';
    const status = comparison?.result.statuses[finding.id];
    if (!entry && status?.base) { entry = byFingerprint.get(baseFingerprints.get(status.base)); matchedBy = status.matchedBy; }
    if (!entry) continue;
    if (entry.ruleId !== finding.ruleId) { otherRule.add(entry); continue; }
    const expired = expiredOf(entry);
    used.set(entry, finding.id);
    notes.set(finding.id, { entry, matchedBy, expired, hidden: entry.state === 'dismissed' || (entry.state === 'suppressed' && !expired) });
  }
  const pick = ({ fingerprint, ruleId, state, owner }) => ({ fingerprint, ruleId, state, owner });
  return { notes,
    expired: triage.entries.filter(expiredOf).map((entry) => ({ fingerprint: entry.fingerprint, ruleId: entry.ruleId, owner: entry.owner, expires: entry.expires, finding: used.get(entry) ?? null })),
    unused: triage.entries.filter((entry) => !used.has(entry)).map((entry) => ({ ...pick(entry), cause: otherRule.has(entry) ? 'rule-differs' : 'no-finding' })) };
}
