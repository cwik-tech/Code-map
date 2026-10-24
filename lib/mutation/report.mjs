// Bounded Stryker input and changed-line mutation information. No rating uses these results.
import { plain } from '../verify-markdown.mjs';
import { isRelativePath } from '../adapters/run-manifest.mjs';
const statuses = { Killed: 'killed', Survived: 'survived', Timeout: 'timeout', NoCoverage: 'noCoverage', CompileError: 'compileError', Ignored: 'ignored', RuntimeError: 'error' };
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const position = (x) => record(x) && Number.isSafeInteger(x.line) && x.line > 0 && Number.isSafeInteger(x.column) && x.column >= 0;
/** Reads untrusted JSON with byte and mutant limits. */
export function parseStryker(text, { maxBytes = 50 * 1024 * 1024, maxMutants = 400000 } = {}) {
  const fail = (error) => ({ ok: false, error });
  if (typeof text !== 'string' || Buffer.byteLength(text) > maxBytes) return fail('The mutation report exceeds the byte limit.');
  let value;
  try { value = JSON.parse(text); } catch { return fail('The mutation report is not valid JSON.'); }
  if (!record(value) || !record(value.files)) return fail('The mutation report needs files.');
  const mutants = [];
  for (const [path, file] of Object.entries(value.files)) {
    if (!isRelativePath(path) || !record(file) || !Array.isArray(file.mutants)) return fail('Invalid mutation file.');
    for (const item of file.mutants) {
      if (mutants.length >= maxMutants) return fail('The mutation report exceeds the mutant limit.');
      if (!record(item) || typeof item.status !== 'string' || !Object.hasOwn(statuses, item.status) || typeof item.mutatorName !== 'string' || !item.mutatorName.length
        || !record(item.location) || !position(item.location.start) || !position(item.location.end)
        || item.location.end.line < item.location.start.line
        || (item.location.end.line === item.location.start.line && item.location.end.column < item.location.start.column)) return fail('Invalid mutant.');
      const candidate = item.equivalentCandidate;
      if (Object.hasOwn(item, 'equivalentCandidate') && (item.status !== 'Survived' || !record(candidate)
        || typeof candidate.reason !== 'string' || !candidate.reason.trim().length || candidate.reason.length > 2000)) return fail('Invalid equivalent candidate.');
      mutants.push({ path, status: item.status, mutator: item.mutatorName, location: item.location,
        ...(candidate ? { equivalentCandidate: { reason: candidate.reason } } : {}) });
    }
  }
  return { ok: true, report: { mutants } };
}
/** Stryker score counts killed and timed-out mutants as detected. Errors and ignored mutants do not enter the denominator. */
export function summarizeMutation(report, changed) {
  const counts = { killed: 0, survived: 0, timeout: 0, noCoverage: 0, compileError: 0, ignored: 0, error: 0, equivalentCandidate: 0, ordinarySurvived: 0 }, survivors = [], equivalentCandidates = [];
  for (const item of report.mutants) {
    if (changed && !(changed.get(item.path) ?? []).some((line) => line >= item.location.start.line && line <= item.location.end.line - (item.location.end.column === 0 ? 1 : 0))) continue;
    counts[statuses[item.status]]++;
    if (item.status === 'Survived') {
      const survivor = { path: item.path, line: item.location.start.line, mutator: item.mutator };
      survivors.push(survivor);
      if (item.equivalentCandidate) {
        counts.equivalentCandidate++;
        equivalentCandidates.push({ ...survivor, reason: item.equivalentCandidate.reason });
      } else counts.ordinarySurvived++;
    }
  }
  const measured = counts.killed + counts.timeout + counts.survived + counts.noCoverage;
  return { counts, score: measured ? 100 * (counts.killed + counts.timeout) / measured : null, survivors, equivalentCandidates,
    note: 'A survivor is a lead, not proof of a missing test. Equivalent candidates still count as survived in the score. A person must review each candidate.' };
}
/** Compact text for the verification report. */
export function mutationWords(items = []) {
  return items.length ? ['## Mutation information', '', ...items.slice(0, 3).flatMap((item) => [
    `Report: ${plain(item.artifact ?? 'mutation report')}.`,
    `Score of changed code: ${item.score === null ? 'unmeasured' : `${item.score.toFixed(2)}%`}.`,
    Object.entries(item.counts).map(([key, value]) => `${key}: ${value}`).join(', '), plain(item.note),
    ...item.survivors.slice(0, 3).map((s) => `- ${plain(s.path, 160)}:${s.line} ${plain(s.mutator, 160)}`), '',
    ...(item.equivalentCandidates ?? []).slice(0, 3).map((s) => `- Equivalent candidate: ${plain(s.path, 160)}:${s.line} ${plain(s.mutator, 160)}. ${plain(s.reason, 240)}`),
  ]), 'Full mutation results are in verification-results.json.', ''] : [];
}
