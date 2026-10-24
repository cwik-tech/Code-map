// Reads Jest `--json` results and Vitest JSON-reporter results into the same case shape as the JUnit adapter.
// Imported results show what ran only under the discovery scope and filters that the run manifest records.
// They do not prove that the runner found every test. Pure: no file access, no clock and no execution.
import { isAbsolute, relative } from 'node:path';

/** Declared producers. The parser checks the shape, not the producer version. */
export const supportedProducers = [
  { name: 'Jest --json output', versions: 'the testResults[].assertionResults[] shape (Jest 27 and later)' },
  { name: 'Vitest JSON reporter', versions: 'the Jest-compatible testResults[].assertionResults[] shape' },
];
const formats = ['jest-json', 'vitest-json'];
const statuses = { passed: 'passed', failed: 'failed', pending: 'skipped', skipped: 'skipped', disabled: 'skipped', todo: 'skipped' };
const declaredCounts = ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests'];
const maxMessage = 4096, maxErrors = 100;
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value) => Number.isInteger(value) && value >= 0;

/**
 * Returns `{ ok: true, report }` or `{ ok: false, errors: [{ path, message }] }`.
 * `value` is the parsed JSON or its text. `options.repository` is the absolute repository path; every test file must be inside it.
 */
export function parseTestResults(value, { repository, format = 'jest-json', maxCases = 200000, maxBytes = 50 * 1024 * 1024 } = {}) {
  const errors = [];
  let dropped = 0;
  const error = (path, message) => { if (errors.length < maxErrors) errors.push({ path, message }); else dropped++; };
  const knownRepository = typeof repository === 'string' && isAbsolute(repository);
  if (!knownRepository) error('options.repository', 'Must be the absolute path of the repository.');
  if (typeof value === 'string' && (value.length > maxBytes || Buffer.byteLength(value, 'utf8') > maxBytes)) return { ok: false, errors: [{ path: '', message: `The results are larger than ${maxBytes} bytes.` }] };
  if (!formats.includes(format)) error('options.format', `Must be one of: ${formats.join(', ')}.`);
  let results = value;
  if (typeof value === 'string') {
    try { results = JSON.parse(value); } catch { return { ok: false, errors: [{ path: '', message: 'The text is not valid JSON.' }] }; }
  }
  if (!isRecord(results)) return { ok: false, errors: [...errors, { path: '', message: 'The results must be a JSON object.' }] };
  for (const key of declaredCounts) if (results[key] !== undefined && !isCount(results[key])) error(key, 'Must be a non-negative integer.');
  if (!Array.isArray(results.testResults)) {
    error('testResults', 'Must be an array.');
    return { ok: false, errors };
  }
  const cases = [], files = [];
  results.testResults.forEach((entry, index) => {
    const path = `testResults[${index}]`;
    if (!isRecord(entry)) { error(path, 'Must be an object.'); return; }
    const file = knownRepository ? repositoryPath(entry.name, repository) : null;
    if (file === null && knownRepository) error(`${path}.name`, 'Must be a test file path inside the repository.');
    if (entry.status !== undefined && typeof entry.status !== 'string') error(`${path}.status`, 'Must be a string.');
    if (entry.message !== undefined && typeof entry.message !== 'string') error(`${path}.message`, 'Must be a string.');
    if (!Array.isArray(entry.assertionResults)) { error(`${path}.assertionResults`, 'Must be an array.'); return; }
    entry.assertionResults.forEach((assertion, position) => {
      const item = readCase(assertion, `${path}.assertionResults[${position}]`, error);
      if (item === null) return;
      if (cases.length === maxCases) { error(`${path}.assertionResults[${position}]`, `The results have more than ${maxCases} test cases.`); return; }
      cases.push({ ...item, file });
    });
    files.push({ file, status: typeof entry.status === 'string' ? entry.status : null, message: typeof entry.message === 'string' && entry.message ? entry.message.slice(0, maxMessage) : null,
      cases: entry.assertionResults.length });
  });
  if (dropped) errors.push({ path: '', message: `${dropped} more errors are not listed.` });
  if (errors.length) return { ok: false, errors };
  const totals = { tests: cases.length, passed: 0, failed: 0, errored: 0, skipped: 0, todo: 0 };
  for (const item of cases) { totals[item.status]++; if (item.todo) totals.todo++; }
  const observed = { numTotalTests: totals.tests, numPassedTests: totals.passed, numFailedTests: totals.failed, numPendingTests: totals.skipped - totals.todo, numTodoTests: totals.todo };
  const mismatches = declaredCounts.filter((key) => results[key] !== undefined && results[key] !== observed[key])
    .map((key) => ({ suite: null, field: key, declared: results[key], observed: observed[key] }));
  return { ok: true, report: { format, cases, files, totals, mismatches } };
}

/** One assertion result in the shared case shape. Returns null and records errors when a field has the wrong type. */
function readCase(value, path, error) {
  if (!isRecord(value)) { error(path, 'Must be an object.'); return null; }
  let valid = true;
  const bad = (key, message) => { error(`${path}.${key}`, message); valid = false; };
  if (typeof value.title !== 'string') bad('title', 'Must be a string.');
  if (!Object.hasOwn(statuses, value.status)) bad('status', `Must be one of: ${Object.keys(statuses).join(', ')}.`);
  if (value.ancestorTitles !== undefined && (!Array.isArray(value.ancestorTitles) || !value.ancestorTitles.every((title) => typeof title === 'string'))) bad('ancestorTitles', 'Must be an array of strings.');
  if (value.duration !== undefined && value.duration !== null && (typeof value.duration !== 'number' || !Number.isFinite(value.duration) || value.duration < 0)) bad('duration', 'Must be a non-negative number of milliseconds or null.');
  if (value.failureMessages !== undefined) {
    if (!Array.isArray(value.failureMessages)) bad('failureMessages', 'Must be an array of strings.');
    else value.failureMessages.forEach((message, index) => { if (typeof message !== 'string') bad(`failureMessages[${index}]`, 'Must be a string.'); });
  }
  if (value.fullName !== undefined && typeof value.fullName !== 'string') bad('fullName', 'Must be a string.');
  if (!valid) return null;
  const ancestors = value.ancestorTitles ?? [], messages = value.failureMessages ?? [];
  return { suite: ancestors.length ? ancestors.join(' > ') : null, classname: null, name: value.title, status: statuses[value.status], todo: value.status === 'todo',
    time: typeof value.duration === 'number' ? value.duration / 1000 : null, message: messages.length ? messages[0].slice(0, maxMessage) : null };
}

/** A repository-relative path with "/" separators, or null when the path is not a string or is outside the repository. */
function repositoryPath(name, repository) {
  if (typeof name !== 'string' || name.length === 0 || name.includes('\0')) return null;
  const inside = isAbsolute(name) ? relative(repository, name) : name;
  const parts = inside.split(/[\\/]/);
  if (isAbsolute(inside) || parts.some((part) => part === '..') || parts.every((part) => part === '' || part === '.')) return null;
  return parts.filter((part) => part !== '' && part !== '.').join('/');
}
