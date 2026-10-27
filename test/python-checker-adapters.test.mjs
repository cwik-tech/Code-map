import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMypy } from '../lib/adapters/mypy.mjs';
import { parsePyright } from '../lib/adapters/pyright.mjs';
import { parseRuff } from '../lib/adapters/ruff.mjs';

const options = { repository: '/work/repo' };
const mypy = (fields = {}) => ({ file: 'src/leaf.py', line: 2, column: 0, severity: 'error', code: 'assignment', message: 'Incompatible type "str"', hint: 'Use "int"', ...fields });
const pyright = (fields = {}) => ({ file: 'src/leaf.py', severity: 'error', rule: 'reportAssignmentType', message: 'Incompatible type "str"\n  Expected "int"',
  range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } }, ...fields });
const ruff = (fields = {}) => ({ filename: 'src/leaf.py', code: 'F401', message: '`os` imported but unused', location: { row: 2, column: 1 }, end_location: { row: 2, column: 5 }, fix: null, ...fields });
const pyrightReport = (entries, summary = {}) => JSON.stringify({ generalDiagnostics: entries, summary: { errorCount: 1, warningCount: 0, informationCount: 0, ...summary } });
const adapters = [
  ['mypy-json', (text, opts) => parseMypy(text, { ...opts, format: 'json' }), (entry) => JSON.stringify(mypy(entry)), 'file'],
  ['mypy-text', (text, opts) => parseMypy(text, { ...opts, format: 'text' }), (entry) => `${entry?.file ?? 'src/leaf.py'}:2:1: error: Incompatible type "str"  [assignment]`, 'file'],
  ['pyright-json', parsePyright, (entry) => pyrightReport([pyright(entry)]), 'file'],
  ['ruff-json', parseRuff, (entry) => JSON.stringify([ruff(entry)]), 'filename'],
];
for (const [name, parse, sample, pathKey] of adapters) {
  test(`${name} validates diagnostics and rejects malformed paths and bounded input`, () => {
    const valid = parse(sample(), options);
    assert.equal(valid.ok, true, valid.error);
    assert.deepEqual([valid.report.diagnostics[0].file, valid.report.diagnostics[0].line, valid.report.diagnostics[0].column], ['src/leaf.py', 2, 1]);
    assert.equal(parse(sample({ [pathKey]: '../outside.py' }), options).ok, false);
    assert.equal(parse(sample({ [pathKey]: 'src/evil\u202e.py' }), options).ok, false);
    assert.equal(parse(sample(), { ...options, maxBytes: 8 }).ok, false);
    assert.equal(parse(sample(), { ...options, maxDiagnostics: 0 }).ok, false);
    assert.equal(parse('{}', options).ok, false);
    assert.equal(parse(42, options).ok, false);
  });
}

test('mypy notes attach to errors and summary counts must agree', () => {
  const text = 'src/leaf.py:2:1: error: Bad type  [assignment]\nsrc/leaf.py:2:1: note: Expected "int"\n  More detail\nFound 1 error in 1 file (checked 2 source files)\n';
  const parsed = parseMypy(text, { ...options, format: 'text' });
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.report.diagnostics.length, 1);
  assert.match(parsed.report.diagnostics[0].message, /Expected "int"\nMore detail/);
  assert.equal(parseMypy(text.replace('Found 1 error', 'Found 2 errors'), { ...options, format: 'text' }).ok, false);
  const json = parseMypy(JSON.stringify(mypy()), options);
  assert.match(json.report.diagnostics[0].message, /Use "int"/);
  assert.equal(parseMypy(JSON.stringify(mypy({ code: null, message: 'Cannot continue' })), options).report.incomplete, true);
});

test('pyright validates all summary severities and both range endpoints', () => {
  const entries = [pyright(), pyright({ severity: 'warning' }), pyright({ severity: 'information' })];
  assert.equal(parsePyright(pyrightReport(entries, { warningCount: 1, informationCount: 1 }), options).ok, true);
  assert.equal(parsePyright(pyrightReport(entries), options).ok, false);
  assert.equal(parsePyright(pyrightReport([pyright({ range: { start: { line: 0, character: 0 }, end: { line: -1, character: 0 } } })]), options).ok, false);
});

test('ruff retains only a fixable flag and syntax errors mark incomplete reports', () => {
  const parsed = parseRuff(JSON.stringify([ruff({ fix: { applicability: 'safe', message: 'Remove import', edits: [{ content: '', location: { row: 2, column: 1 }, end_location: { row: 2, column: 5 } }] } })]), options);
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.report.diagnostics[0].fixable, true);
  assert.equal(Object.hasOwn(parsed.report.diagnostics[0], 'fix'), false);
  assert.equal(parseRuff(JSON.stringify([ruff({ code: null })]), options).report.incomplete, true);
  assert.equal(parseRuff(JSON.stringify([ruff({ location: null })]), options).ok, false);
});

test('Python adapters refuse an entire report when a later entry or note is malformed', () => {
  const json = JSON.stringify(mypy());
  assert.equal(parseMypy(`${json}\n{}`, options).ok, false);
  assert.equal(parseMypy(`${json}\n${JSON.stringify(mypy({ severity: 'note', file: '../outside.py' }))}`, options).ok, false);
  assert.equal(parseMypy('src/leaf.py:2:1: error: Bad  [assignment]\nFound 0 errors in 1 file', { ...options, format: 'text' }).ok, false);
  assert.equal(parsePyright(pyrightReport([pyright(), {}]), options).ok, false);
  assert.equal(parseRuff(JSON.stringify([ruff(), {}]), options).ok, false);
  assert.equal(parseRuff(JSON.stringify([ruff({ fix: { applicability: 'safe', message: 'Fix', edits: [{}] } })]), options).ok, false);
});

test('mypy JSON notes attach without changing the error count and unknown columns stay null', () => {
  const parsed = parseMypy(`${JSON.stringify(mypy({ hint: null, column: -1 }))}\n${JSON.stringify(mypy({ severity: 'note', code: null, message: 'Expected int', hint: null }))}`, options);
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.report.errors, 1);
  assert.equal(parsed.report.diagnostics.length, 1);
  assert.equal(parsed.report.diagnostics[0].column, null);
  assert.match(parsed.report.diagnostics[0].message, /Expected int/);
});

test('mypy refuses zero text columns and overflowing converted JSON columns', () => {
  assert.equal(parseMypy('src/leaf.py:1:0: error: Bad type  [assignment]', { ...options, format: 'text' }).ok, false);
  assert.equal(parseMypy(JSON.stringify(mypy({ column: Number.MAX_SAFE_INTEGER })), options).ok, false);
});

test('ruff refuses a fix with a reversed edit range', () => {
  const fix = { applicability: 'safe', message: 'Remove import', edits: [{ content: '', location: { row: 2, column: 5 }, end_location: { row: 2, column: 1 } }] };
  assert.equal(parseRuff(JSON.stringify([ruff({ fix })]), options).ok, false);
});
