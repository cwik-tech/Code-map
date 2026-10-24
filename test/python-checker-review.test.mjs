import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePyright } from '../lib/adapters/pyright.mjs';
import { parseRuff } from '../lib/adapters/ruff.mjs';
import { compilerLifecycle } from '../lib/compiler-lifecycle.mjs';
import { compilerLines } from '../lib/compiler-report.mjs';
import { evaluateProfile } from '../lib/profiles/evidence-v1.mjs';
import { context } from './evidence-v1-fixtures.mjs';
import { analysis, source, modified, compilerReport, diagnostic } from './profile-fixtures.mjs';

const cleanPython = (fields = {}) => compilerReport([], { kind: 'pyright-json', ...fields });
const mixed = (reports, fields = {}) => context({ typescript: true,
  head: { ...context().head, analysis: analysis({ files: [source('src/a.ts'), source('src/leaf.py')] }) },
  compiler: { head: reports, base: [] }, ...fields });
const cleanMet = (c) => evaluateProfile(c).categories.structuralIntegrity.bands[5][0].met;
const consumerContext = (reports, consumer = 'src/use.ts', fields = {}) => {
  const c = mixed(reports, fields), path = /\.pyi?$/.test(consumer) ? 'src/leaf.py' : 'src/a.ts';
  return { ...c, evidence: { ...c.evidence, api: { ...c.evidence.api, items: [
    { group: 'public', status: 'CHANGED', path, name: 'value', consumers: { items: [{ path: consumer }] } },
  ] } } };
};
const publicResult = (c) => evaluateProfile(c).obligations.find((x) => x.id === 'structure.public-interface').result;

test('a pyright-only report cannot satisfy TypeScript compiler or consumer evidence', () => {
  assert.equal(cleanMet(mixed([cleanPython()])), false);
  assert.equal(publicResult(consumerContext([cleanPython()])), 'UNKNOWN');
});

test('clean Python evidence cannot hide a failing TypeScript compiler', () => {
  assert.equal(cleanMet(mixed([cleanPython(), compilerReport([diagnostic('src/a.ts')])])), false);
});

test('Python consumers need Python evidence even when tsc is clean', () => {
  assert.equal(publicResult(consumerContext([compilerReport()], 'src/use.py')), 'UNKNOWN');
  assert.equal(publicResult(consumerContext([compilerReport()], 'src/use.pyi')), 'UNKNOWN');
});

test('a mixed project satisfies compiler and consumer evidence with both clean reports', () => {
  const reports = [compilerReport(), cleanPython()];
  assert.equal(cleanMet(mixed(reports)), true);
  assert.equal(publicResult(consumerContext(reports)), 'PASS');
  assert.equal(publicResult(consumerContext(reports, 'src/use.py')), 'PASS');
  assert.equal(cleanMet(mixed([cleanPython()], { typescript: false })), true);
});

test('each reported language needs a complete clean compiler run', () => {
  assert.equal(cleanMet(mixed([compilerReport(), cleanPython({ incomplete: true })])), false);
  assert.equal(cleanMet(mixed([compilerReport(), cleanPython({ filtered: true })])), false);
  assert.equal(cleanMet(mixed([compilerReport(), cleanPython({ exitStatus: 2 })])), false);
});

test('incomplete and interrupted TypeScript reports cannot establish a clean compiler', () => {
  assert.equal(cleanMet(mixed([compilerReport([], { incomplete: true }), cleanPython()])), false);
  assert.equal(cleanMet(mixed([compilerReport([], { exitStatus: 1 }), cleanPython()])), false);
});

test('a report from another language cannot suppress a definite public call break', () => {
  const c = consumerContext([cleanPython()]);
  const calls = { sites: [{ path: 'src/use.ts', likelyBreak: true, export: { path: 'src/a.ts', name: 'value' } }], unread: [] };
  assert.equal(publicResult({ ...c, evidence: { ...c.evidence, calls } }), 'FAIL');
  const py = consumerContext([compilerReport()], 'src/use.py');
  assert.equal(publicResult({ ...py, evidence: { ...py.evidence, calls: { ...calls,
    sites: [{ path: 'src/use.py', likelyBreak: true, export: { path: 'src/leaf.py', name: 'value' } }] } } }), 'FAIL');
});

test('public diagnostics apply only to consumers of the report language', () => {
  const wrong = cleanPython({ errors: 1, exitStatus: 1, diagnostics: [diagnostic('src/use.ts')] });
  assert.equal(publicResult(consumerContext([wrong])), 'UNKNOWN');
  assert.equal(publicResult(consumerContext([cleanPython({ incomplete: true })], 'src/use.py')), 'UNKNOWN');
  assert.equal(publicResult(consumerContext([cleanPython({ errors: 1, exitStatus: 1,
    diagnostics: [diagnostic('src/use.py', 'reportArgumentType', { tool: 'pyright' })] })], 'src/use.py')), 'FAIL');
});

const pyrightText = (fields = {}) => JSON.stringify({ generalDiagnostics: [
  { file: 'src/leaf.py', severity: 'error', message: 'File-level type error', ...fields },
], summary: { errorCount: 1, warningCount: 0, informationCount: 0 } });

test('pyright file-level diagnostics keep null coordinates through lifecycle Markdown and type checks', () => {
  const parsed = parsePyright(pyrightText(), { repository: '/work/repo' });
  assert.equal(parsed.ok, true, parsed.error);
  assert.deepEqual([parsed.report.diagnostics[0].line, parsed.report.diagnostics[0].column], [null, null]);
  const head = compilerReport(parsed.report.diagnostics, { ...parsed.report, kind: 'pyright-json', exitStatus: 1 });
  const before = cleanPython();
  const lifecycle = compilerLifecycle({ head: [head], base: [before] }, { comparable: true, complete: true });
  assert.deepEqual(lifecycle.counts, { new: 1, existing: 0, resolved: 0, unknown: 0 });
  assert.equal(lifecycle.entries[0].diagnostic.line, null);
  assert.match(compilerLines(lifecycle, 20).join('\n'), /src\/leaf\.py:0:0 pyright syntax.*File-level type error/);
  const result = evaluateProfile(mixed([head], { typescript: false, change: modified('src/leaf.py') }));
  assert.equal(result.obligations.find((x) => x.id === 'structure.types-compatible').result, 'FAIL');
  assert.equal(compilerLifecycle({ head: [head], base: [head] }, { comparable: true, complete: true }).counts.existing, 1);
});

for (const range of [null, {}, { start: { line: 0, character: 0 } }, { start: { line: 0, character: 0 }, end: { line: -1, character: 0 } }]) {
  test(`pyright refuses a present malformed range ${JSON.stringify(range)}`, () => {
    assert.equal(parsePyright(pyrightText({ range }), { repository: '/work/repo' }).ok, false);
  });
}

const ruffText = (message) => JSON.stringify([{ filename: 'src/leaf.py', code: 'F401', message: 'Unused import',
  location: { row: 1, column: 1 }, end_location: { row: 1, column: 3 },
  fix: { applicability: 'safe', message, edits: [{ content: '', location: { row: 1, column: 1 }, end_location: { row: 1, column: 3 } }] },
}]);

test('ruff accepts a null fix title and retains only the fixable flag', () => {
  const result = parseRuff(ruffText(null), { repository: '/work/repo' });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.report.diagnostics[0].fixable, true);
  assert.equal(Object.hasOwn(result.report.diagnostics[0], 'fix'), false);
  assert.equal(parseRuff(ruffText(42), { repository: '/work/repo' }).ok, false);
  assert.equal(parseRuff(ruffText(undefined), { repository: '/work/repo' }).ok, false);
});
