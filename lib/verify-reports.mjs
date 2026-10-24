import { startupInformation } from './electron/startup-report.mjs';
import { compareEnvironments } from './run-compatibility.mjs';
import { traceInformation } from './models/trace-report.mjs';
import { evidenceTier, trustDecision } from './trust.mjs';
import { osvExecution } from './supply/osv.mjs';
import { machineKey, signatureStatus } from './worker/signing.mjs';
import { loadConfig } from './project.mjs';
import { storeLocation } from './store.mjs';
import { harnessInformation } from './harness/report.mjs';
// The test reports, compiler reports and coverage reports of a verification request: Code-map reads each report and its run
// manifest, binds the report to the current head inputs or to the base inputs, and turns its cases or diagnostics into the shape
// of the rule set. It runs no project code. A report counts as evidence only when its manifest binds it. Every other report gets
// an execution record with the reason. Compiler reports (kind tsc) go into their own lists, so the test checks never read them.
// A coverage report of the kind lcov or istanbul-json gives coverage of the head instead of test cases (coverageReport).
// A discovery report gives the test files and cases that the runner found on either side (discoveryReport).
import { mutationExecution } from './mutation/verify.mjs';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { reportCases } from './adapters/report-cases.mjs';
export { reportCases } from './adapters/report-cases.mjs';
import { bindingStatus } from './adapters/run-manifest.mjs';
import { parseTestList } from './adapters/test-list.mjs';
import { parseTscFiles } from './types/discovery.mjs';
import { parseTsc } from './adapters/tsc.mjs';
import { parseMypy } from './adapters/mypy.mjs';
import { parsePyright } from './adapters/pyright.mjs';
import { parseRuff } from './adapters/ruff.mjs';
import { compilerKinds } from './adapters/python-diagnostics.mjs';
import { benchInformation } from './bench-report.mjs';
import { validateSizes } from './size-report.mjs';
import { istanbulCoverage, lcovCoverage } from './changed-coverage.mjs';
import { isInside, realPath } from './inspect.mjs';
import { auditExecution } from './supply/npm-audit.mjs';
import { loadRun } from './worker/runs.mjs';

const maxManifestBytes = 1024 * 1024, maxReportBytes = 50 * 1024 * 1024;
/** For all reports of one request together: Code-map reads at most 64 report files and 256 MiB of them, and at most 400,000 test cases and 400,000 compiler diagnostics count. */
export const reportLimits = { reports: 64, bytes: 256 * 1024 * 1024, cases: 400000, diagnostics: 400000, mutants: 400000 };
const adapterKinds = [...compilerKinds, 'junit', 'jest-json', 'vitest-json', 'tsc-files', 'lcov', 'istanbul-json', 'sizes', 'vitest-list', 'jest-list', 'playwright-list', 'mocha-list'], listKinds = ['vitest-list', 'jest-list', 'playwright-list', 'mocha-list'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const message = (error) => (error instanceof Error ? error.message : String(error));
const amount = (count, unit) => unit === 'bytes' && count % 1048576 === 0 ? `${count / 1048576} MiB` : `${count.toLocaleString('en-US')} ${unit}`;
const failedCase = (item) => item.status === 'failed' || item.status === 'errored';
/** Text for stderr: each control character (and each bidirectional control) becomes a visible escape such as \u001b, so text from a request cannot drive the terminal. */
export const shown = (value) => String(value).replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** The bytes of a regular file of at most `max` bytes. O_NONBLOCK keeps a FIFO from stopping the run. The checks and the read use one open file. */
export function readLimited(path, max, what) {
  let descriptor;
  try { descriptor = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0)); } catch (error) { throw new Error(`Cannot read the ${what} ${shown(path)}: ${shown(message(error))}`); }
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile()) throw new Error(`The ${what} ${shown(path)} is not a file.`);
    if (info.size > max) throw new Error(`The ${what} ${shown(path)} is larger than ${max} bytes.`);
    return readFileSync(descriptor);
  } finally { closeSync(descriptor); }
}

/** The absolute path of a repository-relative path of the request. A symlink that leads outside the repository is refused. */
function insidePath(repository, path, field) {
  const full = resolve(repository, path);
  if (!isInside(realPath(repository), realPath(full))) throw new Error(`The ${field} ${shown(path)} in reportInputs is outside the repository. Code-map reads report files only inside the repository.`);
  return full;
}

/** The diagnostics of a compiler report. A path in the report is relative to the working folder of the run, or absolute. */
function diagnosticsOf(text, repository, run, maxDiagnostics, kind) {
  const parse = { tsc: parseTsc, 'mypy-json': parseMypy, 'mypy-text': parseMypy, 'pyright-json': parsePyright, 'ruff-json': parseRuff }[kind];
  const parsed = parse(text, { repository, workingDirectory: run.workingDirectory, maxBytes: maxReportBytes, maxDiagnostics, format: kind === 'mypy-text' ? 'text' : 'json' });
  return parsed.ok ? { report: parsed.report } : { error: parsed.error };
}

const tooMany = (limits) => `The request lists more than ${limits.reports} reports. Code-map reads only the first ${limits.reports}, so this report does not count.`;
const tooLarge = (limits) => `Together with the reports before it, this report has more than ${amount(limits.bytes, 'bytes')}. Code-map reads at most ${amount(limits.bytes, 'bytes')} of reports for one request, so this report does not count.`;

/** The bytes and the run manifest of an artifact and manifest pair in the repository, or the reason why Code-map does not read them. */
function readPair(repository, input, seen, used, limits) {
  const artifactPath = insidePath(repository, input.artifact, 'artifact'), manifestPath = insidePath(repository, input.manifest, 'manifest');
  // Two spellings of one file ("x" and "./x", or a symlink) are one report.
  if (seen.has(realPath(artifactPath))) return { refused: ['duplicate', 'The request lists this report more than one time. Only the first entry counts.'] };
  seen.add(realPath(artifactPath));
  if (used.reports >= limits.reports) return { refused: ['limit', tooMany(limits)] };
  used.reports++;
  let bytes, size = 0;
  try { size = statSync(artifactPath).size; } catch { /* readLimited gives the reason */ }
  if (used.bytes + size > limits.bytes) return { refused: ['limit', tooLarge(limits)] };
  try { bytes = readLimited(artifactPath, Math.min(maxReportBytes, limits.bytes - used.bytes), 'report'); } catch (error) { return { refused: ['artifact', message(error)] }; }
  used.bytes += bytes.length;
  try { return { bytes, run: JSON.parse(readLimited(manifestPath, maxManifestBytes, 'run manifest').toString('utf8')), root: repository, policy: 'self-attested', artifact: input.artifact }; } catch (error) {
    return { refused: ['manifest', `${error instanceof SyntaxError ? `The run manifest ${input.manifest} is not valid JSON.` : message(error)} The report stays unverified and cannot satisfy readiness.`] };
  }
}

/**
 * The artifact and the run manifest of a stored run of code-map run, or the reason why it does not count. Code-map wrote both
 * into the private store, so the report is "isolated". Its test file names are absolute paths in the workspace of the run.
 */
function readRun(repository, input, store, seen, used, limits) {
  if (seen.has(`run:${input.run}`)) return { refused: ['duplicate', 'The request lists this run more than one time. Only the first entry counts.'] };
  seen.add(`run:${input.run}`);
  if (used.reports >= limits.reports) return { refused: ['limit', tooMany(limits)] };
  used.reports++;
  let stored;
  try { stored = loadRun(store, input.run, repository, maxReportBytes); } catch (error) { return { refused: ['run', `${message(error)} The run does not count.`] }; }
  if (used.bytes + stored.bytes.length > limits.bytes) return { refused: ['limit', tooLarge(limits)] };
  used.bytes += stored.bytes.length;
  if (sha256(stored.bytes) !== stored.record.artifact.digest) return { refused: ['run', `The artifact of the run ${input.run} does not have the digest in its record. The run does not count.`] };
  return { bytes: stored.bytes, run: stored.manifest, root: stored.record.workspace.tree, policy: 'isolated', nodeModules: stored.record.workspace.nodeModules, dependencies: stored.record.dependencies ?? null, trust: stored.record.trust, artifact: stored.record.artifact.path };
}

/**
 * One report input of the request: its execution record for the results and, when it counts as evidence, the report for the
 * rule set. An input is an artifact and manifest pair, or a stored run of code-map run. A report counts only when its run
 * manifest binds it to the current head inputs or to the base inputs, Code-map can read it, the manifest records an exit status
 * and the discovery, and an exit status of 0 does not come with a failed case. `used` counts the reports, bytes and cases
 * before this one, against `limits` (refer to reportLimits). `store` is the store of the stored runs.
 */
function loadReport(repository, input, sides, seen, used, limits, store, extended = false, keys = [], trust = {}, trusted = [], local = null) {
  const fromRun = typeof input.run === 'string';
  const execution = { artifact: input.artifact ?? null, manifest: input.manifest ?? null, ...(fromRun ? { run: input.run } : {}), kind: null, side: 'head', binding: 'UNBOUND',
    tier: 'static', attestation: null, eligible: false, reasons: [], cases: null, failed: null };
  const reason = (key, text) => execution.reasons.push({ key, message: text });
  const refused = (key, text) => { reason(key, text); return { execution, report: null }; };
  const source = fromRun ? readRun(repository, input, store, seen, used, limits) : readPair(repository, input, seen, used, limits);
  if (source.refused) return refused(...source.refused);
  const { bytes, run, root, policy } = source;
  execution.artifact = source.artifact;
  execution.signature = signatureStatus(run, keys);
  execution.tier = evidenceTier({ imported: !fromRun, isolated: fromRun,
    localSigned: local !== null && signatureStatus(run, [local.publicKey]).state === 'valid', trustedSigned: signatureStatus(run, trusted).state === 'valid' });
  if (execution.signature.state === 'invalid') return refused('signature', 'The manifest signature is invalid or its signer is unknown. The report does not count.');
  const digest = sha256(bytes);
  let side = input.side === 'base' ? 'base' : 'head', binding = bindingStatus(run, sides[side].inputs, { artifactDigest: digest });
  if (binding.state !== 'BOUND') {
    // A report of the base commit is stale for the head. It counts for the base when it binds there.
    const base = bindingStatus(run, sides.base.inputs, { artifactDigest: digest });
    if (base.state === 'BOUND' || (base.state === 'STALE' && run.source?.sha === sides.base.sha && sides.base.sha !== sides.head.sha)) { side = 'base'; binding = base; }
  }
  // Accepted decision 5: Code-map trusts a manifest that the project's own run wrote, with the label "self-attested". A manifest
  // can claim any policy, so only a stored run of code-map run, which Code-map wrote, has the label "isolated".
  Object.assign(execution, { side, binding: binding.state, attestation: binding.state === 'BOUND' ? policy : null, reasons: [...binding.reasons] });
  if (binding.state !== 'BOUND') return { execution, report: null };
  execution.environment = run.environment;
  const listed = run.artifacts.filter((entry) => entry.digest === digest), kind = (listed.find((entry) => entry.path === execution.artifact) ?? listed[0]).kind;
  execution.kind = kind;
  execution.trust = trustDecision(execution.tier, run.command, trust, source.trust);
  if (!execution.trust.allowed) return refused('trust', execution.trust.message);
  if (kind === 'electron-startup') {
    const checked = startupInformation(bytes.toString('utf8'), run);
    if (!checked.ok) return refused('parse', checked.error);
    execution.eligible = true;
    execution.attestation = 'self-attested';
    return { execution, report: null, electronStartup: { ...checked.report, run: { command: run.command, tools: run.tools, environment: run.environment } } };
  }
  if (kind === 'bench') {
    const checked = benchInformation(bytes.toString('utf8'), run);
    if (!checked.ok) return refused('parse', checked.error);
    execution.eligible = true;
    return { execution, report: null, bench: { ...checked.report, run: { tools: run.tools, environment: run.environment } } };
  }
  if (kind === 'xstate-trace') {
    execution.xstateTrace = traceInformation(bytes.toString('utf8'), sides[side].analysis?.models?.states ?? []);
    return { execution, report: null };
  }
  if (kind === 'harness') {
    const checked = harnessInformation(bytes.toString('utf8'), { evidence: extended });
    if (checked.error) return refused('parse', checked.error);
    execution.harness = checked.information;
    if (extended) {
      if (!Number.isInteger(run.exitStatus) || run.discovery === null) return refused('run', 'Harness evidence needs an exit status and discovery scope.');
      execution.eligible = true;
    }
    return { execution, report: null };
  }
  // The rule set has no supply-chain check, so a bound npm audit report goes to the executions only, as information.
  if (kind === 'stryker-json' || kind === 'mutmut-text') return { execution: mutationExecution(execution, bytes.toString('utf8'), run, used, limits, sides[side].analysis?.files ?? []), report: null };
  if (kind === 'osv-snapshot') return { execution: osvExecution(execution, bytes.toString('utf8'), run, sides), report: null };
  if (kind === 'npm-audit') return { execution: auditExecution(execution, bytes.toString('utf8'), run), report: null };
  if (!adapterKinds.includes(kind)) return refused('kind', `Code-map has no adapter for reports of the kind ${kind}. It reads ${adapterKinds.join(', ')}.`);
  if (kind === 'tsc-files') {
    const parsed = parseTscFiles(bytes.toString('utf8'), { repository: root, workingDirectory: run.workingDirectory });
    if (!parsed.ok) return refused('parse', parsed.error);
    if (run.exitStatus !== 0 || run.discovery.filters.length || execution.binding !== 'BOUND') return refused('compiler-files', 'File discovery requires a bound successful unfiltered run.');
    execution.eligible = true;
    return { execution, report: null, compilerFiles: { artifact: execution.artifact, files: parsed.files } };
  }
  if (kind === 'sizes') {
    let value;
    try { value = JSON.parse(bytes.toString('utf8')); } catch { return refused('parse', 'The size report is not valid JSON.'); }
    const checked = validateSizes(value);
    if (!checked.ok) return refused('parse', checked.error);
    if (run.exitStatus !== 0) return refused('exit-status', 'A size report needs a successful build with exit status 0.');
    if (run.discovery === null) return refused('discovery', 'The size report has no discovery scope.');
    execution.eligible = true;
    return { execution, report: null, sizes: { artifact: input.artifact, ...checked.report } };
  }
  if (kind === 'lcov' || kind === 'istanbul-json') return coverageReport(execution, bytes.toString('utf8'), { repository, run, input: extended ? { ...input, artifact: execution.artifact } : input, reason, refused });
  if (listKinds.includes(kind)) return discoveryReport(execution, bytes.toString('utf8'), { repository: root, run, input: { ...input, artifact: execution.artifact }, kind, reason, refused, maxEntries: limits.cases - used.discovery });
  const testFiles = new Set((sides[side].analysis.tests?.testFiles ?? []).map((file) => file.path)), compiler = compilerKinds.includes(kind), text = bytes.toString('utf8');
  const read = compiler ? diagnosticsOf(text, root, run, limits.diagnostics, kind) : reportCases(text, kind, root, run, testFiles);
  if (read.error) return refused('parse', `Code-map cannot read the report: ${read.error}`);
  // A compiler report has diagnostics, not test cases: its record counts the errors and the diagnostics outside the repository.
  if (compiler) Object.assign(execution, { errors: read.report.errors, outside: read.report.outside });
  else Object.assign(execution, { cases: read.cases.length, failed: read.cases.filter(failedCase).length });
  if (!compiler && read.mismatches.length) reason('report-counts', 'The declared test counts disagree with the test cases. The report does not count.');
  if (!compiler && read.fileFailures.length) reason('file-failures', 'The report has failed test files without failed cases. The report does not count.');
  if (!Number.isInteger(run.exitStatus)) reason('exit-status', 'The run manifest records no exit status, so Code-map cannot tell whether the run ended normally.');
  if (run.discovery === null) reason('discovery', 'The run manifest records no discovery scope and filters, so Code-map cannot tell which tests or files the run selected.');
  if (run.exitStatus === 0 && (compiler ? kind === 'ruff-json' ? 0 : execution.errors : execution.failed) > 0) {
    reason('exit-status', `The run ended with exit status 0, but the report has ${compiler ? 'error diagnostics' : 'failed cases'}. The report and its manifest disagree.`);
  }
  const cases = compiler ? 0 : read.cases.length, diagnosticCount = compiler ? read.report.diagnostics.length : 0;
  if (used.cases + cases > limits.cases) reason('limit', `Together with the reports before it, this report has more than ${amount(limits.cases, 'test cases')}. Code-map counts at most ${amount(limits.cases, 'test cases')} for one request, so this report does not count.`);
  if (used.diagnostics + diagnosticCount > limits.diagnostics) reason('limit', `Together with the reports before it, this report has more than ${amount(limits.diagnostics, 'compiler diagnostics')}. Code-map counts at most ${amount(limits.diagnostics, 'compiler diagnostics')} for one request, so this report does not count.`);
  if (execution.reasons.length) return { execution, report: null };
  execution.eligible = true;
  used.cases += cases;
  used.diagnostics += diagnosticCount;
  const { command, workingDirectory, tools, environment } = run, { diagnostics, errors, outside } = read.report ?? {};
  return { execution, report: { artifact: execution.artifact, kind, digest, attestation: policy, ...(fromRun ? { nodeModules: source.nodeModules, dependencies: source.dependencies } : {}), filtered: run.discovery.filters.length > 0, exitStatus: run.exitStatus,
    comparisonEligible: compareEnvironments(environment, environment).eligible,
    ...(compiler ? { diagnostics, errors, outside, incomplete: Boolean(read.report.incomplete || (kind !== 'tsc' && ![0, 1].includes(run.exitStatus))) } : { cases: read.cases }), run: { command, workingDirectory, tools, environment } } };
}

/**
 * A bound LCOV or Istanbul JSON report (lib/changed-coverage.mjs). It is not a test report: it gives no test case, and only a report
 * of the head counts as coverage. Its paths are relative to the working directory of the run, and the paths outside the repository
 * do not count. The record of an Istanbul JSON report also counts the entries that still have an input source map (`sourceMapped`).
 */
function coverageReport(execution, text, { repository, run, input, reason, refused }) {
  const options = { repository, workingDirectory: run.workingDirectory, real: realPath }, lcov = execution.kind === 'lcov';
  const coverage = lcov ? lcovCoverage(text, options) : istanbulCoverage(text, { ...options, maxBytes: maxReportBytes });
  if (coverage.error) return refused('parse', `Code-map cannot read the report: ${coverage.error}`);
  if (coverage.records === 0) return refused('parse', `Code-map cannot read the report: ${lcov ? 'it has no SF record, so it is not an LCOV report' : 'it has no file entry, so it measures no file'}.`);
  execution.coverage = { files: coverage.files.size, outside: coverage.outside, ...(lcov ? {} : { sourceMapped: coverage.sourceMapped }) };
  if (!Number.isInteger(run.exitStatus)) reason('exit-status', 'The run manifest records no exit status, so Code-map cannot tell whether the run ended normally.');
  if (run.discovery === null) reason('discovery', 'The run manifest records no discovery scope and filters, so Code-map cannot tell which tests the run selected.');
  if (execution.reasons.length) return { execution, report: null };
  const measured = { artifact: execution.artifact, kind: coverage.kind, files: coverage.files, outside: coverage.outside, discovery: run.discovery,
    mapping: { entries: coverage.sourceMapped ?? 0, unmapped: coverage.unmapped ?? 0, errors: coverage.mappingErrors ?? [] },
    ratingFiles: lcov ? coverage.files : istanbulCoverage(text, { ...options, maxBytes: maxReportBytes, remap: false }).files };
  if (execution.side !== 'head') {
    reason('side', 'The coverage report is bound to the base. Only a bound coverage report of the head gives coverage of the change.');
    return { execution, report: null, baseCoverage: measured };
  }
  execution.eligible = true;
  return { execution, report: null, coverage: measured };
}

/**
 * A bound discovery report (lib/adapters/test-list.mjs). It is not a test report: it gives the test files and cases that the
 * runner found, not what ran. Either side counts, but the discovery run must end with exit status 0, because a
 * runner that fails to collect a test file lists less. A report has at most `maxEntries` entries.
 */
function discoveryReport(execution, text, { repository, run, input, kind, reason, refused, maxEntries }) {
  // One system call for each path: the runner listed files that exist. realPath walks up through each missing folder, which is
  // too slow for a list of 400,000 untrusted paths.
  const real = (path) => { try { return realpathSync.native(path); } catch { return path; } };
  const parsed = parseTestList(text, { format: kind, repository, workingDirectory: run.workingDirectory, real, maxBytes: maxReportBytes, maxEntries });
  if (!parsed.ok) return refused('parse', `Code-map cannot read the report: ${parsed.error}`);
  const { files, cases, outside } = parsed.report;
  execution.discovered = { files: files.length, cases: cases === null ? null : cases.length, outside };
  if (!Number.isInteger(run.exitStatus)) reason('exit-status', 'The run manifest records no exit status, so Code-map cannot tell whether the run ended normally.');
  else if (run.exitStatus !== 0) reason('exit-status', `The discovery run ended with exit status ${run.exitStatus}, so the runner can have failed to collect some test files.`);
  if (run.discovery === null) reason('discovery', 'The run manifest records no discovery scope and filters, so Code-map cannot tell which tests the runner looked for.');
  if (execution.reasons.length) return { execution, report: null };
  execution.eligible = true;
  return { execution, report: null, discovery: { artifact: input.artifact, kind, side: execution.side, run: { command: run.command, workingDirectory: run.workingDirectory, tools: run.tools, environment: run.environment }, filtered: run.discovery.filters.length > 0, files, cases } };
}

/**
 * The execution records of all report pairs, the eligible test reports of each side (`reports`), the eligible compiler reports of
 * each side (`compiler`) and the eligible coverage reports of the head (`coverage`) for the rule set. Reports above `limits` do not count.
 */
export function loadReports(repository, inputs, sides, limits = reportLimits, store = undefined, { extended = false } = {}) {
  const seen = new Set(), used = { reports: 0, bytes: 0, cases: 0, discovery: 0, diagnostics: 0, mutants: 0 }, executions = [], reports = { head: [], base: [], ineligible: [] }, compiler = { head: [], base: [] }, coverage = [], baseCoverage = [], discovery = [], sizes = { head: [], base: [] }, bench = { head: [], base: [] }, electronStartup = { head: [], base: [] }, compilerFiles = { head: [], base: [] };
  const local = machineKey(store ?? storeLocation().root, { create: false });
  const config = loadConfig(repository), trusted = config.trustedRunKeys ?? [], keys = [...(local ? [local.publicKey] : []), ...trusted];
  for (const input of inputs) {
    const { execution, report, coverage: measured, baseCoverage: measuredBase, sizes: sized, bench: timed, electronStartup: startup, discovery: found, compilerFiles: checkedFiles } = loadReport(repository, input, sides, seen, used, limits, store, extended, keys, config.trust, trusted, local);
    executions.push(execution);
    if (report) (compilerKinds.includes(report.kind) ? compiler : reports)[execution.side].push(report);
    else if (checkedFiles) compilerFiles[execution.side].push(checkedFiles);
    else if (startup) electronStartup[execution.side].push(startup);
    else if (timed) bench[execution.side].push(timed);
    else if (sized) sizes[execution.side].push(sized);
    else if (measured) coverage.push(measured);
    else if (measuredBase) baseCoverage.push(measuredBase);
    else if (found) { discovery.push(found); used.discovery += found.cases?.length ?? found.files.length; }
    else if (execution.kind !== 'osv-snapshot' && !execution.audit && !execution.harness && !execution.xstateTrace && execution.kind !== 'stryker-json' && execution.kind !== 'mutmut-text') reports.ineligible.push({ artifact: execution.artifact ?? `run:${input.run}`, reason: execution.reasons.map((item) => item.message).join(' ') || `The binding state is ${execution.binding}.` });
  }
  for (const head of executions.filter((item) => item.side === 'head' && item.environment)) {
    head.environmentComparisons = executions.filter((item) => item.side === 'base' && item.kind === head.kind && item.environment)
      .map((base) => ({ artifact: base.artifact, ...compareEnvironments(head.environment, base.environment) }));
  }
  compiler.refused = executions.filter((item) => item.binding === 'BOUND' && !item.eligible && ['mypy-json', 'mypy-text', 'pyright-json'].includes(item.kind));
  return { executions, reports, compiler, coverage, baseCoverage, sizes, bench, electronStartup, discovery, compilerFiles };
}
