// Real-change labels come from people. This runner uses only the accepted static profile.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOracleBytes } from '../lib/oracle-files.mjs';
import { validateRequest } from '../lib/verify-request.mjs';

const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const states = ['PASS', 'FAIL', 'UNKNOWN', 'NOT_APPLICABLE'];
const sha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const requestFields = ['base', 'intent', 'changeType', 'allowedPaths', 'acceptanceCriteria'];
/** Validates labels before any repository operation. Execution, external reports and rule sets other than the default are refused. */
export function validateLabel(value) {
  const fail = (message) => { throw new Error(`Invalid label: ${message}`); };
  if (!record(value) || value.labelVersion !== 1) fail('labelVersion must be 1.');
  if (Object.keys(value).some((x) => !['labelVersion', 'repository', 'commit', 'request', 'expected', 'labeledBy'].includes(x))) fail('unknown field.');
  if (typeof value.repository !== 'string' || !isAbsolute(value.repository) || /[\0\r\n]/.test(value.repository)) fail('repository must be an absolute local path.');
  if (typeof value.commit !== 'string' || !sha.test(value.commit)) fail('commit must be a full immutable SHA.');
  if (typeof value.labeledBy !== 'string' || !value.labeledBy.trim() || value.labeledBy.length > 200 || /\p{Cc}/u.test(value.labeledBy)) fail('labeledBy must name a person.');
  if (!record(value.request) || Object.keys(value.request).some((x) => !requestFields.includes(x))) fail('unsupported request field. No execution or rule set other than the default is allowed.');
  if (!record(value.expected) || !Object.keys(value.expected).length || Object.keys(value.expected).length > 1000
    || !Object.entries(value.expected).every(([key, state]) => /^[A-Za-z0-9._-]{1,200}$/.test(key) && states.includes(state))) fail('expected must map check IDs to valid results.');
  const request = { requestType: 'code-map-verification-request', schemaVersion: 1, ...value.request, head: value.commit,
    profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
    execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } };
  const checked = validateRequest(request);
  if (!checked.ok) fail(checked.errors.map((x) => `${x.path}: ${x.message}`).join(' '));
  return { ...value, request: checked.request };
}
/** Compares exact results and a FAIL-versus-other confusion matrix. Missing checks never count as true negatives. */
export function compareLabels(expected, obligations) {
  const found = new Map(obligations.map((x) => [x.id, x.result])), matrix = { TP: 0, FP: 0, TN: 0, FN: 0 }, mismatches = [];
  for (const [id, label] of Object.entries(expected)) {
    const actual = found.get(id) ?? null;
    if (actual !== label) mismatches.push({ id, expected: label, actual });
    if (actual === null) { if (label === 'FAIL') matrix.FN++; }
    else matrix[label === 'FAIL' ? actual === 'FAIL' ? 'TP' : 'FN' : actual === 'FAIL' ? 'FP' : 'TN']++;
  }
  return { matrix, mismatches };
}
/** Runs labeled cases sequentially, with temporary requests and stores. It makes no checkout and runs no project command. */
export function replayLabels(folder) {
  const names = readdirSync(folder).filter((x) => x.endsWith('.json')).sort();
  if (!names.length || names.length > 1000) throw new Error('Labels folder must contain 1 to 1000 JSON files.');
  const labels = names.map((name) => {
    try { return { name, ...validateLabel(JSON.parse(readOracleBytes(join(folder, name), 1024 * 1024).toString('utf8'))) }; }
    catch (cause) { throw new Error(`${name}: ${cause.message}`, { cause }); }
  });
  const work = mkdtempSync(join(tmpdir(), 'code-map-labels-')), cases = [], matrix = { TP: 0, FP: 0, TN: 0, FN: 0 };
  const git = (root, args) => execFileSync('git', ['--no-optional-locks', '-C', root, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 }).trim();
  try {
    for (const label of labels) {
      const before = git(label.repository, ['status', '--porcelain']);
      try {
        if (git(label.repository, ['rev-parse', '--verify', `${label.commit}^{commit}`]) !== label.commit) throw new Error('Label commit does not identify a commit.');
        const path = join(work, 'request.json'); writeFileSync(path, JSON.stringify(label.request));
        const run = spawnSync(process.execPath, [cli, 'verify', '--request', path, '--store', join(work, 'store'), '--out-dir', join(work, 'out')],
          { cwd: label.repository, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
        if (![0, 1, 2, 3].includes(run.status)) throw new Error(`Verification failed: ${run.error?.message ?? run.stderr}`);
        const summary = JSON.parse(run.stdout), results = JSON.parse(readFileSync(summary.files.results, 'utf8'));
        if (!Array.isArray(results.obligations) || !results.obligations.every((x) => record(x) && typeof x.id === 'string' && states.includes(x.result))) throw new Error('Invalid verification output.');
        const compared = compareLabels(label.expected, results.obligations);
        for (const key of Object.keys(matrix)) matrix[key] += compared.matrix[key];
        cases.push({ file: label.name, commit: label.commit, labeledBy: label.labeledBy, readiness: summary.readiness, ...compared });
      } finally {
        if (git(label.repository, ['status', '--porcelain']) !== before) throw new Error('Repository status changed during labeled replay.');
      }
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
  return { reportType: 'code-map-labeled-replay', profileId: 'static-baseline-v0', cases, matrix,
    precision: matrix.TP + matrix.FP ? matrix.TP / (matrix.TP + matrix.FP) : null,
    recall: matrix.TP + matrix.FN ? matrix.TP / (matrix.TP + matrix.FN) : null };
}
