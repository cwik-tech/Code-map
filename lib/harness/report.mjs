// Checks untrusted harness results before verify shows them as information.
import { isDeepStrictEqual } from 'node:util';
import { isRelativePath } from '../adapters/run-manifest.mjs';
import { validBlockCoverage, validCoverageProgress } from './coverage.mjs';
import { validateOracles } from '../oracles.mjs';
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const modes = ['migrate', 'differential', 'property', 'fuzz', 'decision-table', 'state-model', 'route', 'zod-boundaries', 'json-boundaries', 'range-boundaries', 'fault'];
const boundedInteger = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function validDescriptor(value) {
  return value === null || (record(value) && (value.type === 'link' ? typeof value.target === 'string' && value.target.length <= 65536
    : value.type === 'file' && digest(value.digest) && digest(value.normalizedDigest) && boundedInteger(value.mode, 0o777)));
}
function validEffects(value) {
  return record(value) && typeof value.stdout === 'string' && typeof value.stderr === 'string' && value.stdout.length + value.stderr.length <= 262144
    && Array.isArray(value.rejections) && value.rejections.length <= 100 && value.rejections.every((error) => record(error)
      && typeof error.name === 'string' && error.name.length <= 200 && typeof error.message === 'string' && error.message.length <= 4096)
    && Array.isArray(value.files) && value.files.length <= 10000 && value.files.every((file) => record(file) && isRelativePath(file.path)
      && ['created', 'changed', 'removed'].includes(file.change) && validDescriptor(file.before) && validDescriptor(file.after));
}
function validRows(rows) {
  return Array.isArray(rows) && rows.length <= 256 && rows.every((row, index) => record(row) && row.row === index
    && typeof row.confirmed === 'boolean' && typeof row.current === 'boolean' && (!row.current || row.confirmed)
    && (row.oracle === null || (record(row.oracle) && isRelativePath(row.oracle.file) && typeof row.oracle.name === 'string'
      && (row.oracle.suite === null || typeof row.oracle.suite === 'string') && typeof row.oracle.criterion === 'string'))
    && (row.confirmed ? row.oracle !== null && validateOracles({ oracleVersion: 1, entries: [row.record] }).ok
      && ['file', 'suite', 'name', 'criterion'].every((key) => row.record[key] === row.oracle[key]) : row.record === null));
}
function validCorpus(value) {
  return record(value) && ['outcome', 'v8-block-and-outcome'].includes(value.guidance) && boundedInteger(value.size, 10000) && boundedInteger(value.mutations, 10000)
    && Array.isArray(value.classes) && (value.guidance === 'outcome' ? value.classes.length === value.size : value.classes.length <= value.size) && value.classes.every((item) => typeof item === 'string')
    && new Set(value.classes).size === value.classes.length
    && (value.guidance === 'outcome' || validBlockCoverage(value))
    && (value.seeds === undefined || (Array.isArray(value.seeds) && value.seeds.length === value.size
      && value.seeds.every((seed, index) => record(seed) && Object.hasOwn(seed, 'input') && (value.guidance === 'outcome' ? seed.outcome === value.classes[index] : value.classes.includes(seed.outcome)))));
}
function validDataRows(rows) {
  return Array.isArray(rows) && rows.length <= 1000 && Buffer.byteLength(JSON.stringify(rows)) <= 200000
    && rows.every((row) => record(row) && Object.values(row).every((cell) => cell === null || typeof cell === 'string'
      || typeof cell === 'boolean' || (typeof cell === 'number' && Number.isFinite(cell))));
}
function validMigration(value) {
  const counts = (items) => Array.isArray(items) && items.length <= 500 && items.every((item) => record(item)
    && typeof item.table === 'string' && item.table.length <= 65536 && boundedInteger(item.rows, Number.MAX_SAFE_INTEGER));
  return record(value) && ['PASS', 'FAIL', 'UNKNOWN'].includes(value.status) && counts(value.before) && counts(value.after)
    && Array.isArray(value.applied) && value.applied.length <= 100 && value.applied.every(isRelativePath)
    && (value.status !== 'PASS' || (Array.isArray(value.checks) && value.checks.length > 0 && value.checks.every((check) => check?.status === 'PASS' && isDeepStrictEqual(check.actual, check.expected))))
    && (value.checks === undefined || (Array.isArray(value.checks) && value.checks.length <= 100 && value.checks.every((check) => record(check)
      && typeof check.query === 'string' && /^\s*SELECT\b/i.test(check.query) && check.query.length <= 10000 && ['PASS', 'FAIL'].includes(check.status)
      && validDataRows(check.expected) && validDataRows(check.actual) && (check.status === 'PASS') === isDeepStrictEqual(check.expected, check.actual))))
    && (value.failedFile === null || isRelativePath(value.failedFile))
    && (value.status !== 'FAIL' || (typeof value.error === 'string' && value.error.length <= 4096))
    && (value.status !== 'UNKNOWN' || (typeof value.reason === 'string' && value.reason.length <= 4096));
}
/** Returns a bounded summary. V1 also requests the differential base and paired-input count. */
export function harnessInformation(text, { evidence = false } = {}) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 16 * 1024 * 1024) return { error: 'The harness report exceeds 16 MiB.' };
  let value;
  try { value = JSON.parse(text); } catch { return { error: 'The harness report is not valid JSON.' }; }
  if (!record(value) || value.reportType !== 'code-map-harness' || value.harnessVersion !== 1 || !modes.includes(value.mode)
    || value.finite !== true || !Array.isArray(value.calls) || value.calls.length > 20000 || !Array.isArray(value.failures) || value.failures.length > 20000
    || value.executed !== value.calls.length) return { error: 'The harness report has an invalid shape or exceeds its limits.' };
  for (const call of value.calls) {
    const result = call?.result;
    if (!record(call) || !['base', 'head'].includes(call.side) || !record(result) || !['returned', 'threw', 'crashed', 'hang', 'UNKNOWN'].includes(result.status)
      || typeof result.durationMs !== 'number' || !Number.isFinite(result.durationMs) || result.durationMs < 0) return { error: 'The harness report has an invalid call.' };
    if (result.coverage !== undefined && !validBlockCoverage(result.coverage)) return { error: 'The harness report has invalid block coverage.' };
    if (result.effects !== undefined && !validEffects(result.effects)) return { error: 'The harness report has invalid side effects.' };
    if (result.status === 'returned' && !Object.hasOwn(result, 'output')) return { error: 'The harness report has no returned output.' };
    if (['threw', 'crashed'].includes(result.status) && (!record(result.error) || typeof result.error.name !== 'string' || typeof result.error.message !== 'string')) return { error: 'The harness report has an invalid error.' };
    if (result.status === 'UNKNOWN' && typeof result.reason !== 'string') return { error: 'The harness report has no UNKNOWN reason.' };
  }
  if (value.mode === 'migrate' && !validMigration(value.migration)) return { error: 'The harness report has invalid migration data.' };
  if (['json-boundaries', 'range-boundaries'].includes(value.mode) || value.boundaryResults !== undefined) {
    if (!record(value.boundaries) || !Array.isArray(value.boundaries.cases) || value.boundaries.cases.length > 20000
      || !Array.isArray(value.boundaries.unknown) || value.boundaries.unknown.length > 20000
      || !Array.isArray(value.boundaryResults) || value.boundaryResults.length !== value.boundaries.cases.length
      || value.boundaryResults.length !== value.calls.length
      || !value.boundaries.cases.every((item) => record(item) && Object.hasOwn(item, 'input') && typeof item.expected === 'boolean')
      || !value.boundaryResults.every((item, index) => record(item) && item.case === index && item.call === index
        && item.expected === value.boundaries.cases[index].expected
        && isDeepStrictEqual(value.calls[index].input, value.boundaries.cases[index].input)
        && item.actual === (value.calls[index].result.status === 'returned' && typeof value.calls[index].result.output === 'boolean' ? value.calls[index].result.output : null))) {
      return { error: 'The harness report has invalid boundary call links.' };
    }
  }
  if (value.rows !== undefined && !validRows(value.rows)) return { error: 'The harness report has invalid trusted rows.' };
  if (value.corpus !== undefined && !validCorpus(value.corpus)) return { error: 'The harness report has invalid corpus metadata.' };
  if ((value.coverage !== undefined || value.corpus?.guidance === 'v8-block-and-outcome')
    && (value.mode !== 'fuzz' || !validCoverageProgress(value.coverage, value.calls, value.corpus))) return { error: 'The harness report has invalid coverage progress.' };
  for (const failure of value.failures) if (!record(failure) || !['difference', 'property', 'invariant', 'crash', 'hang', 'UNKNOWN', 'mismatch', 'missing-timeout', 'escaped-error'].includes(failure.kind)) return { error: 'The harness report has an invalid failure.' };
  if (['fuzz', 'property'].includes(value.mode) && (!Number.isInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff)) return { error: 'The harness report has an invalid seed.' };
  if (value.mode === 'differential' && (typeof value.inputDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.inputDigest)
    || !record(value.normalization) || !Array.isArray(value.normalization.ignoreFields) || !value.normalization.ignoreFields.every((x) => typeof x === 'string'))) return { error: 'The differential report has invalid corpus provenance.' };
  return { information: { mode: value.mode, calls: value.calls.length, failures: value.failures.length, finite: true,
    ...(evidence ? { base: value.base?.sha ?? null, inputs: differentialInputs(value), unknownCalls: value.calls.some((x) => x.result.status === 'UNKNOWN') } : {}),
    ...(value.mode === 'migrate' ? { migration: value.migration } : {}),
    seed: value.seed ?? null, inputDigest: value.inputDigest ?? null, normalization: value.normalization ?? null,
    boundaries: value.boundaries ?? null, boundaryResults: value.boundaryResults ?? [],
    rows: value.rows ?? [], corpus: value.corpus ?? null, ...(value.coverage === undefined ? {} : { coverage: value.coverage }),
    effects: value.calls.map((call) => ({ side: call.side, input: call.input, effects: call.result.effects ?? null })),
    outcomes: value.failures, note: 'Information only. This finite harness run does not change static-baseline-v0.' } };
}

/** A differential input needs one base call and one head call with the same input. */
function differentialInputs(value) {
  if (value.mode !== 'differential' || value.calls.length % 2) return 0;
  for (let index = 0; index < value.calls.length; index += 2) {
    const a = value.calls[index], b = value.calls[index + 1];
    if (a.side !== 'base' || b.side !== 'head' || JSON.stringify(a.input) !== JSON.stringify(b.input)
      || ['UNKNOWN', 'hang', 'crashed'].includes(a.result.status) || ['UNKNOWN', 'hang', 'crashed'].includes(b.result.status)) return 0;
  }
  return value.calls.length / 2;
}
