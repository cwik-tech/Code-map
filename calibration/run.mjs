// Builds each calibration case in a temporary Git repository, runs `code-map verify` on it and compares the results with
// the expected ones. `scripts/calibrate.mjs` and `test/calibration.test.mjs` both use it, so the two report the same numbers.
// V0 cases bind fixture reports. V1 worker cases run fixture tests only in the restricted worker.
// It writes only below the system temporary folder, and each case removes its folder, also after an error.
import { categories } from '../lib/ratings.mjs';
import { extraEvidence, fixtureOracle, sandboxAvailable } from './evidence-runs.mjs';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const reportCommand = ['npx', 'vitest', 'run', '--reporter=junit'];
const timeoutMs = 120000, verifyExitCodes = [0, 1, 2, 3];

/** The request fields that a case can leave out. The runner fills them from this default and from the case's reports. */
const defaultRequest = { intent: 'Change the project.', allowedPaths: ['src/**', 'test/**'], changeType: 'other' };
const budgets = { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 };
/** The temporary folders of the cases that run now. removeTemporaryFolders removes them when the process stops early. */
const active = new Set();

const put = (root, path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
const git = (root, ...args) => execFileSync('git', ['-C', root, '-c', 'user.name=stream', '-c', 'user.email=stream@local', ...args], { encoding: 'utf8' }).trim();
const xml = (value) => String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
const errorText = (error) => (error instanceof Error ? error.message : String(error));

/** Runs `node bin/code-map.mjs <args>` in `cwd`. The status is the exit code, or null when the command timed out or did not start. */
const codeMap = (args, cwd) => new Promise((resolve) => {
  execFile(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
    (error, stdout, stderr) => resolve({ status: error === null ? 0 : Number.isInteger(error.code) ? error.code : null, stdout, stderr }));
});

/** Removes the temporary folders of the cases that still run. The script calls it when it gets SIGINT or SIGTERM. */
export function removeTemporaryFolders() {
  for (const dir of active) rmSync(dir, { recursive: true, force: true });
  active.clear();
}

/** A JUnit report for these cases: one testsuite named after the file, and one testcase for each case. */
function junitXml(cases) {
  const rows = cases.map((item) => {
    const inner = item.status === 'failed' ? '<failure message="expected failure"/>' : item.status === 'skipped' ? '<skipped/>' : '';
    return `<testcase classname="${xml(item.file)}" file="${xml(item.file)}" name="${xml(item.name)}">${inner}</testcase>`;
  }).join('');
  const file = cases[0]?.file ?? 'test/run.test.ts';
  return `<?xml version="1.0"?>\n<testsuites><testsuite name="${xml(cases[0]?.suite ?? file)}" tests="${cases.length}" failures="${cases.filter((item) => item.status === 'failed').length}">${rows}</testsuite></testsuites>\n`;
}

const reportArtifact = (report) => `reports/${report.name}.${({ tsc: 'txt', lcov: 'info', 'istanbul-json': 'json' })[report.kind] ?? 'xml'}`;

/** Writes one report and its run manifest with `code-map manifest`. The working tree must be at the side that the report names. */
async function writeReport(root, report) {
  const artifact = reportArtifact(report), manifest = `reports/${report.name}.manifest.json`;
  const exitStatus = report.exitStatus ?? ((report.cases ?? []).some((item) => item.status === 'failed') ? 1 : 0);
  put(root, artifact, report.text ?? junitXml(report.cases));
  const output = await codeMap(['manifest', '--artifact', artifact, '--kind', report.kind ?? 'junit', '--exit-status', String(exitStatus), '--out', manifest, '--', ...(report.command ?? reportCommand)], root);
  if (output.status !== 0) throw new Error(`code-map manifest failed for the report ${report.name}: ${output.stderr.trim() || `status ${output.status}`}`);
}

/** Runs `code-map verify` and returns its summary and its results JSON. A timeout, exit code 4 or a crash is an error of the case. */
async function runVerify(root, requestPath, store, out) {
  const output = await codeMap(['verify', '--request', requestPath, '--store', store, '--out-dir', out], root);
  if (output.status === null) throw new Error('code-map verify timed out or did not start.');
  if (!verifyExitCodes.includes(output.status)) throw new Error(`code-map verify ended with status ${output.status}: ${output.stderr.trim()}`);
  const summary = JSON.parse(output.stdout);
  return { summary, results: JSON.parse(readFileSync(summary.files.results, 'utf8')) };
}

/**
 * The differences between a run and its case: the readiness, each check that the case names, each other check that failed, and
 * each report that did not bind to its side. A case has at most one seeded defect, so a check that it does not name must not fail.
 */
function differences(item, expected, summary, results, checks) {
  const named = expected.checks ?? {}, list = [];
  if (summary.readiness !== expected.readiness) list.push({ part: 'readiness', expected: expected.readiness, actual: summary.readiness });
  for (const [id, want] of Object.entries(named)) if ((checks[id] ?? 'absent') !== want) list.push({ part: id, expected: want, actual: checks[id] ?? 'absent' });
  for (const [id, actual] of Object.entries(checks)) if (!Object.hasOwn(named, id) && actual === 'FAIL') list.push({ part: id, expected: 'not FAIL', actual });
  for (const [category, want] of Object.entries(expected.ratings ?? {})) {
    if (!categories.includes(category) || !(want === 'Unassessed' || Number.isInteger(want) && want >= 1 && want <= 5)) {
      throw new Error(`Invalid expected rating ${category}: ${want}. Use a category and a band from 1 to 5 or Unassessed.`);
    }
    const rating = results.ratings[category], actual = rating?.state === 'UNASSESSED' ? 'Unassessed' : rating?.value ?? 'absent';
    if (actual !== want) list.push({ part: `ratings.${category}`, expected: want, actual });
  }
  for (const report of item.reports ?? []) {
    const run = results.executions.find((entry) => entry.artifact === reportArtifact(report));
    const state = run ? `${run.binding} ${run.side}${run.eligible ? '' : ' (not eligible)'}` : 'absent';
    if (state !== `BOUND ${report.side}`) list.push({ part: `report ${report.name}`, expected: `BOUND ${report.side}`, actual: state });
  }
  return list;
}

/** Maps obligations and coverage rating conditions to the corpus result vocabulary. */
function checkResults(results) {
  const checks = Object.fromEntries(results.obligations.map((obligation) => [obligation.id, obligation.result]));
  for (const rating of Object.values(results.ratings)) {
    for (const [state, ids] of Object.entries(rating.predicates)) {
      for (const id of ids) if (id.startsWith('vc.')) checks[id] = ({ met: 'PASS', unmet: 'FAIL', unknown: 'UNKNOWN' })[state];
    }
  }
  return checks;
}

/** Builds a case, runs verify on it and compares. An error gives a result with `error` set, and the case folder is still removed. */
async function runCase(item, temporaryRoot) {
  const dir = mkdtempSync(join(temporaryRoot, 'code-map-calibration-')), root = join(dir, 'repo'), work = join(dir, 'work');
  active.add(dir);
  const about = { profileId: item.profileId ?? 'static-baseline-v0', id: item.id, name: item.name, defect: item.defect === true, knownFailure: item.knownFailure === true, expected: item.expected ?? {} };
  try {
    if (item.workerReports?.length && !sandboxAvailable) return { ...about, skipped: 'needs /usr/bin/sandbox-exec (macOS)', readiness: null, checks: {}, mismatches: [], durationMs: 0, error: null, passed: true };
    mkdirSync(root); mkdirSync(work);
    for (const [path, content] of Object.entries(item.base ?? {})) put(root, path, content);
    git(root, 'init', '-q', '-b', 'main'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'base'); git(root, 'tag', 'base');
    for (const report of item.reports ?? []) if (report.side === 'base') await writeReport(root, report);
    const extra = await extraEvidence(root, item, 'base', join(work, 'store'), budgets);
    for (const [path, content] of Object.entries(item.head ?? {})) { if (content === null) rmSync(join(root, path), { force: true }); else put(root, path, content); }
    if (item.headKind !== 'worktree') { git(root, 'add', '-A'); git(root, 'commit', '-qm', 'head'); git(root, 'tag', 'tip'); }
    fixtureOracle(root, item);
    for (const report of item.reports ?? []) if (report.side === 'head') await writeReport(root, report);
    extra.push(...await extraEvidence(root, item, 'head', join(work, 'store'), budgets));

    const request = { requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base',
      head: item.headKind === 'worktree' ? 'worktree' : 'tip', acceptanceCriteria: [], profileId: item.profileId ?? 'static-baseline-v0',
      ratingRulesVersion: item.profileId === 'evidence-v1' ? 'ratings-v1' : 'ratings-v0', execution: { enabled: false, authorization: null, budgets },
      reportInputs: [...(item.reports ?? []).map((report) => ({ artifact: reportArtifact(report), manifest: `reports/${report.name}.manifest.json` })), ...extra],
      ...defaultRequest, ...(item.request ?? {}) };
    const requestPath = join(work, 'request.json');
    writeFileSync(requestPath, JSON.stringify(request));

    const started = performance.now();
    const { summary, results } = await runVerify(root, requestPath, join(work, 'store'), join(work, 'out'));
    const durationMs = performance.now() - started;
    const checks = checkResults(results);
    const mismatches = differences(item, about.expected, summary, results, checks);
    return { ...about, readiness: summary.readiness, checks, ratings: Object.fromEntries(Object.entries(results.ratings).map(([id, { state, value }]) => [id, { state, value }])), mismatches, durationMs, error: null, passed: mismatches.length === 0 };
  } catch (error) {
    const text = errorText(error);
    return { ...about, readiness: null, checks: {}, mismatches: [{ part: 'run', expected: 'a verify result', actual: text }], durationMs: null, error: text, passed: false };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    active.delete(dir);
  }
}

/**
 * The confusion matrix of one check. The truth of a case is the result that it names for the check, or "not FAIL" when it does
 * not name the check. An expected FAIL is a positive, and an actual FAIL is a detection. A case without a verify result counts
 * as a false negative when it expects FAIL, and it does not count otherwise.
 */
function metricFor(results, checkId) {
  const counts = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const item of results) {
    if (item.skipped) continue;
    const positive = item.expected.checks?.[checkId] === 'FAIL', detected = item.checks[checkId] === 'FAIL';
    if (item.error !== null && !positive) continue;
    counts[positive ? (detected ? 'tp' : 'fn') : (detected ? 'fp' : 'tn')]++;
  }
  const { tp, fp, fn } = counts;
  return { ...counts, precision: tp + fp === 0 ? null : tp / (tp + fp), recall: tp + fn === 0 ? null : tp / (tp + fn) };
}

/** The confusion matrix of each check that at least one of the cases names, by check ID in sorted order. */
export function metricsOf(results) {
  results = results.filter((item) => !item.skipped);
  const checks = [...new Set(results.flatMap((item) => Object.keys(item.expected?.checks ?? {})))].sort();
  return Object.fromEntries(checks.map((id) => [id, metricFor(results, id)]));
}

/** Numeric band agreement, split by seeded defects and clean cases. Unknown observations never count as agreement. */
export function bandMetricsOf(results) {
  const selected = results.filter((item) => !item.skipped);
  const names = [...new Set(selected.flatMap((item) => Object.keys(item.expected.ratings ?? {})))].sort();
  const empty = () => ({ total: 0, agreed: 0, mismatched: 0, unassessed: 0, unavailable: 0 });
  return Object.fromEntries(names.map((name) => {
    const groups = { defect: empty(), clean: empty() };
    for (const item of selected.filter((item) => Object.hasOwn(item.expected.ratings ?? {}, name))) {
      const group = groups[item.defect ? 'defect' : 'clean'], actual = item.ratings?.[name];
      group.total++;
      if (item.error || !actual) group.unavailable++;
      else if (actual.state === 'UNASSESSED') group.unassessed++;
      else if (actual.state === 'RATED' && actual.value === item.expected.ratings[name]) group.agreed++;
      else group.mismatched++;
    }
    return [name, groups];
  }));
}

/** Runs the corpus, `concurrency` cases at a time. `only` limits the run to these case IDs. The results keep the order of the cases. */
export async function runCorpus(cases, { only = null, concurrency = 1, sandboxAvailable = existsSync('/usr/bin/sandbox-exec'), temporaryRoot = tmpdir() } = {}) {
  const selected = only === null ? cases : cases.filter((item) => only.has(item.id));
  const results = new Array(selected.length), started = performance.now();
  let next = 0;
  const worker = async () => { while (next < selected.length) { const index = next++; const item = selected[index];
    results[index] = item.worker && !sandboxAvailable
      ? { ...item, skipped: 'sandbox-exec is unavailable', checks: {}, mismatches: [], durationMs: null, readiness: null, error: null, passed: false }
      : await runCase(item, temporaryRoot); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, selected.length)) }, worker));
  return { results, bandMetrics: bandMetricsOf(results), metrics: metricsOf(results), metricsByProfile: Object.fromEntries([...new Set(results.map((x) => x.profileId))].map((id) => [id, metricsOf(results.filter((x) => x.profileId === id))])), totalDurationMs: performance.now() - started };
}

/** The state of one case result: it matches, it is a known failure, a known failure now matches, or it differs without a mark. */
export function caseState(result) {
  if (result.skipped) return 'SKIP';
  if (result.passed) return result.knownFailure ? 'fixed' : 'ok';
  return result.knownFailure ? 'known failure' : result.error !== null ? 'ERROR' : 'MISMATCH';
}

/** Text columns: the first column is padded on the right, the others on the left. */
function columns(rows) {
  const widths = rows[0].map((_, index) => Math.max(...rows.map((row) => String(row[index]).length)));
  return rows.map((row) => row.map((cell, index) => index === 0 ? String(cell).padEnd(widths[index]) : String(cell).padStart(widths[index])).join('  ').trimEnd());
}

/** The text report of a run: one row for each case, the differences, the confusion matrix of each check and a summary line. */
export function formatReport({ results, metrics, metricsByProfile, bandMetrics = bandMetricsOf(results), totalDurationMs }) {
  const percent = (value) => value === null ? '-' : `${Math.round(value * 100)}%`;
  const caseRows = [['case', 'defect', 'readiness', 'time', 'state'], ...results.map((result) => [result.id, result.defect ? 'yes' : 'no', result.readiness ?? '-',
    result.durationMs === null ? '-' : `${(result.durationMs / 1000).toFixed(1)} s`, caseState(result)])];
  const skips = results.filter((result) => result.skipped).map((result) => `${result.id}: SKIP: ${result.skipped}`);
  const details = results.filter((result) => result.mismatches.length > 0).flatMap((result) => [`${result.id} (${caseState(result)}):`,
    ...result.mismatches.map((entry) => `  ${entry.part}: expected ${entry.expected}, actual ${entry.actual}`)]);
  const fixed = results.filter((result) => caseState(result) === 'fixed').map((result) => `${result.id}: the case now matches. Remove its knownFailure mark.`);
  const metricRows = [['check', 'TP', 'FP', 'TN', 'FN', 'precision', 'recall'],
    ...Object.entries(metrics).map(([id, metric]) => [id, metric.tp, metric.fp, metric.tn, metric.fn, percent(metric.precision), percent(metric.recall)])];
  const count = (state) => results.filter((result) => caseState(result) === state).length, defects = results.filter((result) => result.defect).length;
  return [...columns(caseRows), ...skips, '', ...(details.length ? ['Differences:', ...details, ''] : []), ...(fixed.length ? [...fixed, ''] : []),
    ...(metricsByProfile ? Object.entries(metricsByProfile).flatMap(([id, group]) => [`Rule set: ${id}`, ...columns([metricRows[0], ...Object.entries(group).map(([name, x]) => [name, x.tp, x.fp, x.tn, x.fn, percent(x.precision), percent(x.recall)])]), '']) : []),
    ...(Object.keys(bandMetrics).length ? ['Category band agreement (Unassessed is never numeric agreement):', '',
      ...columns([['category', 'cases', 'total', 'agreed', 'mismatched', 'unassessed', 'unavailable'],
        ...Object.entries(bandMetrics).flatMap(([name, groups]) => Object.entries(groups).map(([kind, x]) => [name, kind, x.total, x.agreed, x.mismatched, x.unassessed, x.unavailable]))]), ''] : []),
    'Confusion matrix of each check (an expected FAIL is a positive, and an actual FAIL is a detection):', '', ...columns(metricRows), '',
    `${results.length} cases (${defects} with a seeded defect, ${results.length - defects} clean): ${count('ok')} match, ${count('known failure')} known failures, `
      + `${count('MISMATCH') + count('ERROR')} unexpected differences, ${count('fixed')} fixed known failures, ${count('SKIP')} skipped. Total ${(totalDurationMs / 1000).toFixed(1)} s.`].join('\n') + '\n';
}
