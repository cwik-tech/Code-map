// The test reports of a verification request: Code-map reads each report and its run manifest, binds the report to the
// current head inputs or to the base inputs, and turns its cases into the shape of the rule set. It runs no project code.
// A report counts as evidence only when its manifest binds it; every other report gets an execution record with the reason.
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { parseJUnit } from './adapters/junit.mjs';
import { bindingStatus } from './adapters/run-manifest.mjs';
import { parseTestResults } from './adapters/test-results-json.mjs';
import { isInside, realPath } from './inspect.mjs';

const maxManifestBytes = 1024 * 1024, maxReportBytes = 50 * 1024 * 1024;
/** For all reports of one request together: Code-map reads at most 64 report files and 256 MiB of them, and at most 400,000 test cases count. */
export const reportLimits = { reports: 64, bytes: 256 * 1024 * 1024, cases: 400000 };
const adapterKinds = ['junit', 'jest-json', 'vitest-json'];
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

/** The repository-relative path of a test file name in a report: an absolute name inside the repository, or a name relative to the working directory of the run. */
function placeOf(name, workingDirectory, repository) {
  if (typeof name !== 'string' || name.length === 0 || name.includes('\0')) return null;
  const path = posix.normalize(isAbsolute(name) ? relative(repository, name).split(sep).join('/') : posix.join(workingDirectory, name.replaceAll('\\', '/')));
  return path === '.' || path === '..' || path.startsWith('../') || posix.isAbsolute(path) ? null : path;
}

/** The test cases of a report in the shape of the rule set: { file, suite, name, status }. */
function casesOf(text, kind, repository, run, testFiles) {
  if (kind === 'junit') {
    const parsed = parseJUnit(text, { maxBytes: maxReportBytes });
    if (!parsed.ok) return { error: parsed.error };
    // A JUnit case names its file in the file attribute. Some producers name it only in the class name, which counts when it is a known test file.
    const fileOf = (item) => placeOf(item.file, run.workingDirectory, repository) ?? [placeOf(item.classname, run.workingDirectory, repository)].find((path) => testFiles.has(path)) ?? null;
    return { cases: parsed.report.cases.map((item) => ({ file: fileOf(item), suite: item.suite ?? null, name: item.name, status: item.status })) };
  }
  const parsed = parseTestResults(text, { repository, format: kind, maxBytes: maxReportBytes });
  if (!parsed.ok) return { error: parsed.errors.slice(0, 3).map((error) => `${error.path || 'report'}: ${error.message}`).join(' ') };
  return { cases: parsed.report.cases.map((item) => ({ file: item.file, suite: item.suite ?? null, name: item.name, status: item.status })) };
}

/**
 * One report pair of the request: its execution record for the results and, when it counts as evidence, the report for the
 * rule set. A report counts only when its run manifest binds it to the current head inputs or to the base inputs, Code-map
 * can read it, the manifest records an exit status and the discovery, and an exit status of 0 does not come with a failed case.
 * `used` counts the reports, bytes and cases before this one, against `limits` (refer to reportLimits).
 */
function loadReport(repository, input, sides, seen, used, limits) {
  const execution = { artifact: input.artifact, manifest: input.manifest, kind: null, side: 'head', binding: 'UNBOUND', attestation: null, eligible: false, reasons: [], cases: null, failed: null };
  const reason = (key, text) => execution.reasons.push({ key, message: text });
  const refused = (key, text) => { reason(key, text); return { execution, report: null }; };
  const artifactPath = insidePath(repository, input.artifact, 'artifact'), manifestPath = insidePath(repository, input.manifest, 'manifest');
  // Two spellings of one file ("x" and "./x", or a symlink) are one report.
  if (seen.has(realPath(artifactPath))) return refused('duplicate', 'The request lists this report more than one time. Only the first entry counts.');
  seen.add(realPath(artifactPath));
  if (used.reports >= limits.reports) return refused('limit', `The request lists more than ${limits.reports} reports. Code-map reads only the first ${limits.reports}, so this report does not count.`);
  used.reports++;
  let bytes, run, size = 0;
  try { size = statSync(artifactPath).size; } catch { /* readLimited gives the reason */ }
  if (used.bytes + size > limits.bytes) return refused('limit', `Together with the reports before it, this report has more than ${amount(limits.bytes, 'bytes')}. Code-map reads at most ${amount(limits.bytes, 'bytes')} of reports for one request, so this report does not count.`);
  try { bytes = readLimited(artifactPath, Math.min(maxReportBytes, limits.bytes - used.bytes), 'report'); } catch (error) { return refused('artifact', message(error)); }
  used.bytes += bytes.length;
  try { run = JSON.parse(readLimited(manifestPath, maxManifestBytes, 'run manifest').toString('utf8')); } catch (error) {
    return refused('manifest', `${error instanceof SyntaxError ? `The run manifest ${input.manifest} is not valid JSON.` : message(error)} The report stays unverified and cannot satisfy readiness.`);
  }
  const digest = sha256(bytes);
  let side = 'head', binding = bindingStatus(run, sides.head.inputs, { artifactDigest: digest });
  if (binding.state !== 'BOUND') {
    // A report of the base commit is stale for the head. It counts for the base when it binds there.
    const base = bindingStatus(run, sides.base.inputs, { artifactDigest: digest });
    if (base.state === 'BOUND' || (base.state === 'STALE' && run.source?.sha === sides.base.sha && sides.base.sha !== sides.head.sha)) { side = 'base'; binding = base; }
  }
  // Accepted decision 5: Code-map trusts a manifest that the project's own run wrote, with the label "self-attested".
  Object.assign(execution, { side, binding: binding.state, attestation: binding.state === 'BOUND' ? 'self-attested' : null, reasons: [...binding.reasons] });
  if (binding.state !== 'BOUND') return { execution, report: null };
  const listed = run.artifacts.filter((entry) => entry.digest === digest), kind = (listed.find((entry) => entry.path === input.artifact) ?? listed[0]).kind;
  execution.kind = kind;
  if (!adapterKinds.includes(kind)) return refused('kind', `Code-map has no adapter for reports of the kind ${kind}. It reads ${adapterKinds.join(', ')}.`);
  const testFiles = new Set((sides[side].analysis.tests?.testFiles ?? []).map((file) => file.path));
  const read = casesOf(bytes.toString('utf8'), kind, repository, run, testFiles);
  if (read.error) return refused('parse', `Code-map cannot read the report: ${read.error}`);
  execution.cases = read.cases.length;
  execution.failed = read.cases.filter(failedCase).length;
  if (!Number.isInteger(run.exitStatus)) reason('exit-status', 'The run manifest records no exit status, so Code-map cannot tell whether the run ended normally.');
  if (run.discovery === null) reason('discovery', 'The run manifest records no discovery scope and filters, so Code-map cannot tell which tests the run selected.');
  if (run.exitStatus === 0 && execution.failed > 0) reason('exit-status', 'The run ended with exit status 0, but the report has failed cases. The report and its manifest disagree.');
  if (used.cases + read.cases.length > limits.cases) reason('limit', `Together with the reports before it, this report has more than ${amount(limits.cases, 'test cases')}. Code-map counts at most ${amount(limits.cases, 'test cases')} for one request, so this report does not count.`);
  if (execution.reasons.length) return { execution, report: null };
  execution.eligible = true;
  used.cases += read.cases.length;
  const { command, workingDirectory, tools, environment } = run;
  return { execution, report: { artifact: input.artifact, kind, digest, attestation: 'self-attested', filtered: run.discovery.filters.length > 0, exitStatus: run.exitStatus, cases: read.cases,
    run: { command, workingDirectory, tools, environment } } };
}

/** The execution records of all report pairs, and the eligible reports of each side for the rule set. Reports above `limits` do not count. */
export function loadReports(repository, inputs, sides, limits = reportLimits) {
  const seen = new Set(), used = { reports: 0, bytes: 0, cases: 0 }, executions = [], reports = { head: [], base: [], ineligible: [] };
  for (const input of inputs) {
    const { execution, report } = loadReport(repository, input, sides, seen, used, limits);
    executions.push(execution);
    if (report) reports[execution.side].push(report);
    else reports.ineligible.push({ artifact: input.artifact, reason: execution.reasons.map((item) => item.message).join(' ') || `The binding state is ${execution.binding}.` });
  }
  return { executions, reports };
}
