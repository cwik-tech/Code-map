// Hypotheses of a language model (C44): an optional file that the request names in "hypotheses". Code-map reads it as untrusted
// input with a size limit and a strict schema, checks each evidence ID against the evidence IDs that the results use, and keeps
// each hypothesis apart from the evidence. A hypothesis is "grounded" when each of its evidence IDs is in the results, and
// "ungrounded" when one or more are not. runVerify reads the file only after the checks, the ratings and the readiness are final,
// so a hypothesis cannot change them. An invalid file gives no hypothesis and a list of errors, and the run goes on.
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { isRelativePath } from './adapters/run-manifest.mjs';
import { isInside, realPath } from './inspect.mjs';
import { message, readLimited } from './verify-reports.mjs';

export const hypothesesVersion = 1;
export const hypothesisKinds = ['risk', 'missing-test', 'intent-mismatch', 'other'];
/** A file has at most 256 KiB and 100 hypotheses. Each hypothesis names 1 to 50 evidence IDs. The other numbers are the maximum lengths in characters. */
export const hypothesisLimits = { bytes: 256 * 1024, items: 100, evidenceIds: 50, evidenceId: 500, model: 200, claim: 4000, testName: 300, testText: 20000 };
const label = 'model output, not evidence', shownErrors = 20;
const identifier = /^[A-Za-z0-9._-]{1,64}$/, control = /\p{Cc}/u;
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const unknownKeys = (value, known, prefix, error) => { for (const key of Object.keys(value)) if (!known.includes(key)) error(prefix + key, 'Unknown field.'); };

/** Checks the parsed content of a hypotheses file. It returns a copy of a valid file, or every error with its field path. */
export function validateHypotheses(value) {
  if (!isRecord(value)) return { ok: false, errors: [{ path: '', message: 'A hypotheses file must be a JSON object.' }] };
  const errors = [], error = (path, text) => errors.push({ path, message: text }), limits = hypothesisLimits;
  if (value.hypothesesVersion !== hypothesesVersion) error('hypothesesVersion', 'Must be the integer 1.');
  if (!isText(value.model, limits.model)) error('model', `Must be nonempty text of at most ${limits.model} characters that names the model.`);
  if (!Array.isArray(value.items)) error('items', 'Must be an array of hypotheses.');
  else if (value.items.length > limits.items) error('items', `Must have at most ${limits.items} hypotheses.`);
  else { const seen = new Set(); value.items.forEach((item, index) => hypothesis(item, `items[${index}]`, seen, error)); }
  unknownKeys(value, ['hypothesesVersion', 'model', 'items'], '', error);
  return errors.length ? { ok: false, errors } : { ok: true, hypotheses: structuredClone(value) };
}

function hypothesis(item, prefix, seen, error) {
  const limits = hypothesisLimits;
  if (!isRecord(item)) { error(prefix, 'Must be an object with id, kind, claim and evidenceIds.'); return; }
  if (typeof item.id !== 'string' || !identifier.test(item.id)) error(`${prefix}.id`, 'Must be 1 to 64 letters, digits, ".", "_" or "-".');
  else if (seen.has(item.id)) error(`${prefix}.id`, `Duplicate hypothesis ID "${item.id}".`);
  else seen.add(item.id);
  if (!hypothesisKinds.includes(item.kind)) error(`${prefix}.kind`, `Must be one of: ${hypothesisKinds.join(', ')}.`);
  if (!isText(item.claim, limits.claim)) error(`${prefix}.claim`, `Must be nonempty text of at most ${limits.claim} characters.`);
  if (!Array.isArray(item.evidenceIds) || item.evidenceIds.length < 1 || item.evidenceIds.length > limits.evidenceIds) error(`${prefix}.evidenceIds`, `Must be an array of 1 to ${limits.evidenceIds} evidence IDs.`);
  else {
    const ids = new Set();
    item.evidenceIds.forEach((id, index) => {
      const path = `${prefix}.evidenceIds[${index}]`;
      if (typeof id !== 'string' || id.length === 0 || id.length > limits.evidenceId || control.test(id)) error(path, `Must be an evidence ID of 1 to ${limits.evidenceId} characters without control characters.`);
      else if (ids.has(id)) error(path, 'Duplicate evidence ID.');
      else ids.add(id);
    });
  }
  if (Object.hasOwn(item, 'proposedTest')) proposedTest(item.proposedTest, `${prefix}.proposedTest`, error);
  unknownKeys(item, ['id', 'kind', 'claim', 'evidenceIds', 'proposedTest'], `${prefix}.`, error);
}

function proposedTest(value, prefix, error) {
  if (!isRecord(value)) { error(prefix, 'Must be an object with file, name and text.'); return; }
  if (!isRelativePath(value.file) || value.file.length > 1024 || control.test(value.file)) {
    error(`${prefix}.file`, 'Must be a repository-relative path with "/" separators, no "." or ".." part and no control characters.');
  }
  if (!isText(value.name, hypothesisLimits.testName)) error(`${prefix}.name`, `Must be nonempty text of at most ${hypothesisLimits.testName} characters.`);
  if (!isText(value.text, hypothesisLimits.testText)) error(`${prefix}.text`, `Must be nonempty text of at most ${hypothesisLimits.testText} characters.`);
  unknownKeys(value, ['file', 'name', 'text'], `${prefix}.`, error);
}

/**
 * The hypotheses file `path` of a request, relative to the repository: { path, state, sha256, model, errors, items }. The state is
 * VALID or INVALID. An INVALID file has no items and at most 20 errors. A symlink that leads outside the repository is refused.
 */
export function readHypotheses(repository, path) {
  const refused = (errors, sha256 = null) => ({ path, state: 'INVALID', sha256, model: null, errors: errors.slice(0, shownErrors), errorCount: errors.length, items: [] });
  const full = resolve(repository, path);
  if (!isInside(realPath(repository), realPath(full))) return refused([{ path: '', message: `The hypotheses file ${path} is outside the repository. Code-map reads it only inside the repository.` }]);
  let bytes, value;
  try { bytes = readLimited(full, hypothesisLimits.bytes, 'hypotheses file'); } catch (error) { return refused([{ path: '', message: message(error) }]); }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  try { value = JSON.parse(bytes.toString('utf8')); } catch { return refused([{ path: '', message: `The hypotheses file ${path} is not valid JSON.` }], sha256); }
  const checked = validateHypotheses(value);
  if (!checked.ok) return refused(checked.errors, sha256);
  return { path, state: 'VALID', sha256, model: checked.hypotheses.model, errors: [], errorCount: 0, items: checked.hypotheses.items };
}

/**
 * The evidence IDs that the results use: the evidence of each check and each rating condition, each changed path, each report,
 * each test case that a bound head report ran, and each field of the request. The results keep only the first 50 changed paths and
 * a part of the cases, so the caller gives the complete lists.
 */
export function resultEvidence(results, { paths = [], caseIds = [], criteria = [] } = {}) {
  return new Set([...(results.obligations ?? []).flatMap((item) => item.evidenceIds ?? []),
    ...Object.values(results.ratings ?? {}).flatMap((rating) => Object.values(rating.predicateEvidence ?? {}).flat()),
    ...paths.map((path) => `path:${path}`), ...(results.executions ?? []).map((item) => `report:${item.artifact}`), ...caseIds,
    ...['base', 'head', 'intent', 'changeType', 'allowedPaths', 'acceptanceCriteria', ...criteria.map((item) => `acceptanceCriteria.${item.id}`)].map((field) => `request:${field}`)]);
}

/** Each hypothesis of a read file with `grounded` and `missingEvidenceIds`, and the summary of the file for the results. */
export function groundHypotheses(loaded, known) {
  const items = loaded.items.map((item) => {
    const missing = item.evidenceIds.filter((id) => !known.has(id));
    return { ...item, grounded: missing.length === 0, missingEvidenceIds: missing };
  });
  const grounded = items.filter((item) => item.grounded).length, { items: _, ...file } = loaded;
  return { file: { ...file, label, total: items.length, grounded, ungrounded: items.length - grounded }, items };
}
