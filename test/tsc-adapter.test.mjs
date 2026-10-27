// The adapter for the text output of the TypeScript compiler (tsc --noEmit --pretty false, tsc -b --pretty false).
// The report is untrusted input: the parser refuses a line that it does not know and a path with a control character.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTsc, supportedProducers } from '../lib/adapters/tsc.mjs';

const repository = '/work/repo';
const parse = (lines, options = {}) => parseTsc(Array.isArray(lines) ? lines.join('\n') : lines, { repository, ...options });
const places = (result) => result.report.diagnostics.map((item) => [item.file, item.line, item.column, item.category, item.code]);

test('the adapter declares its producer and reads relative and absolute paths into repository-relative paths', () => {
  assert.deepEqual(supportedProducers.map((item) => item.name), ['TypeScript compiler (tsc and tsc -b)']);
  const result = parse(["src/a.ts(2,14): error TS2741: Property 'b' is missing in type '{ a: string; }' but required in type 'B'.",
    `${repository}/src/b.ts(3,1): error TS2307: Cannot find module './missing.js' or its corresponding type declarations.`, '']);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(places(result), [['src/a.ts', 2, 14, 'error', 2741], ['src/b.ts', 3, 1, 'error', 2307]]);
  assert.deepEqual([result.report.errors, result.report.outside, result.report.summary], [2, 0, null]);
  const nested = parse(['src/a.ts(1,1): warning TS6133: x is declared but never used.', '../shared/b.ts(4,2): error TS2322: Type mismatch.'], { workingDirectory: 'packages/app' });
  assert.deepEqual(places(nested), [['packages/app/src/a.ts', 1, 1, 'warning', 6133], ['packages/shared/b.ts', 4, 2, 'error', 2322]], 'a relative path starts at the working folder of the run');
});

test('an indented line continues the message of the diagnostic before it', () => {
  const result = parse(["src/a.ts(3,14): error TS2322: Type '{ a: { c: string; }; }' is not assignable to type 'B'.", "  The types of 'a.c' are incompatible between these types.",
    "    Type 'string' is not assignable to type 'number'.", 'src/b.ts(1,1): error TS1005: ";" expected.']);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.report.diagnostics.map((item) => item.message), [
    "Type '{ a: { c: string; }; }' is not assignable to type 'B'.\nThe types of 'a.c' are incompatible between these types.\nType 'string' is not assignable to type 'number'.", '";" expected.']);
});

test('a Windows path with backslashes, a CRLF line end and a byte-order mark are read', () => {
  const relative = parse('\ufeffsrc\\core\\engine.ts(3,7): error TS2322: Type mismatch.\r\n  Second line.\r\n');
  assert.equal(relative.ok, true, relative.error);
  assert.deepEqual([places(relative), relative.report.diagnostics[0].message], [[['src/core/engine.ts', 3, 7, 'error', 2322]], 'Type mismatch.\nSecond line.']);
  const absolute = parseTsc('C:\\work\\repo\\src\\a.ts(1,2): error TS2304: Cannot find name \'x\'.\nc:\\work\\repo\\src\\b.ts(1,1): error TS2304: Cannot find name \'y\'.\n',
    { repository: 'C:\\work\\repo' });
  assert.equal(absolute.ok, true, absolute.error);
  assert.deepEqual(places(absolute).map(([file]) => file), ['src/a.ts', 'src/b.ts']);
  const other = parse('D:\\elsewhere\\x.ts(1,1): error TS2304: Cannot find name \'x\'.\n');
  assert.deepEqual([other.report.diagnostics, other.report.outside, other.report.errors], [[], 1, 1], 'a drive letter on a POSIX repository is an absolute path outside it');
});

test('a diagnostic outside the repository is not listed, but it is counted', () => {
  const result = parse(['../other/x.ts(1,1): error TS2322: Outside.', '/elsewhere/y.ts(2,2): warning TS6133: Outside too.', `${repository}-copy/z.ts(1,1): error TS1: Next to it.`,
    `${repository}/src/../../repo/src/a.ts(1,1): error TS2322: Inside after normalization.`]);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(places(result), [['src/a.ts', 1, 1, 'error', 2322]]);
  assert.deepEqual([result.report.outside, result.report.errors], [3, 3], 'the error count includes the errors outside the repository');
});

test('a diagnostic without a position has no file, and the summary line must agree with the error count', () => {
  const global = parse(["error TS5058: The specified path does not exist: 'nothere.json'.", 'src/a.ts(1,1): error TS2322: Type mismatch.', '', 'Found 2 errors.']);
  assert.equal(global.ok, true, global.error);
  assert.deepEqual([places(global), global.report.summary], [[[null, null, null, 'error', 5058], ['src/a.ts', 1, 1, 'error', 2322]], 2]);
  for (const line of ['Found 1 error.', 'Found 1 error in src/a.ts:1', 'Found 1 error in the same file, starting at: src/a.ts:1']) {
    assert.equal(parse(['src/a.ts(1,1): error TS2322: Type mismatch.', line]).ok, true, line);
  }
  assert.equal(parse(['Found 0 errors.']).report.summary, 0);
  const wrong = parse(['src/a.ts(1,1): error TS2322: Type mismatch.', 'Found 3 errors in 2 files.']);
  assert.deepEqual([wrong.ok, /says 3 errors, but the report has 1/.test(wrong.error)], [false, true], wrong.error);
});

test('an empty report is a run without diagnostics', () => {
  for (const text of ['', '\n', '\r\n\r\n']) assert.deepEqual(parse(text).report, { diagnostics: [], errors: 0, outside: 0, summary: null }, JSON.stringify(text));
});

test('the parser refuses control characters in paths, unknown lines, pretty output and reports above the limits', () => {
  const refused = [
    [['src/\u001b[31ma.ts(1,1): error TS2322: Type mismatch.'], /line 1.*control character/i],
    [['src/a\u202e.ts(1,1): error TS2322: Type mismatch.'], /line 1.*control character/i],
    [['src/a.ts(1,1): error TS2322: Type mismatch.', '> project@1.0.0 typecheck'], /line 2 is not/i],
    [["\u001b[96msrc/a.ts\u001b[0m:3:14 - error TS2322: Type 'string' is not assignable to type 'number'."], /line 1 is not/i],
    [["src/a.ts:3:14 - error TS2322: Type 'string' is not assignable to type 'number'."], /--pretty false/],
    [['  Continuation without a diagnostic.'], /line 1/i],
    [['src/a.ts(0,1): error TS2322: Line zero.'], /line 1/i],
    [['src/a.ts(1,1): error TS99999999999999999999: Too large.'], /line 1 gives a diagnostic code/i],
    [['error TS0: Code zero.'], /line 1 gives a diagnostic code/i],
  ];
  for (const [lines, pattern] of refused) {
    const result = parse(lines);
    assert.equal(result.ok, false, lines.join(' | '));
    assert.match(result.error, pattern);
    assert.doesNotMatch(result.error, /[\u0000-\u001f\u202e]/, 'the error does not repeat the untrusted text');
  }
  assert.match(parseTsc('x'.repeat(20), { repository, maxBytes: 10 }).error, /larger than 10 bytes/);
  assert.match(parse(['src/a.ts(1,1): error TS1: a.', 'src/a.ts(2,1): error TS1: b.'], { maxDiagnostics: 1 }).error, /more than 1 diagnostic/);
  assert.equal(parseTsc(7, { repository }).ok, false);
  assert.equal(parseTsc('', { repository: 'relative/path' }).ok, false, 'the repository must be an absolute path');
});

test('the parser reads the real output of the bundled TypeScript compiler', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'code-map-tsc-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: 'nodenext', target: 'es2022' }, include: ['src'] }));
  writeFileSync(join(root, 'src', 'a.ts'), "interface B { a: { c: number } }\nconst o = { a: { c: 's' } };\nexport const x: B = o;\n");
  writeFileSync(join(root, 'src', 'b.ts'), "import { x } from './missing.js';\nexport const y: string = x;\n");
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  const output = spawnSync(process.execPath, [tsc, '--noEmit', '--pretty', 'false'], { cwd: root, encoding: 'utf8', timeout: 60000 });
  assert.notEqual(output.status, 0, 'the compiler finds the errors');
  const result = parseTsc(output.stdout, { repository: root });
  assert.equal(result.ok, true, `${result.error}\n${output.stdout}`);
  assert.deepEqual(places(result).map(([file, line, , category, code]) => [file, line, category, code]), [['src/a.ts', 3, 'error', 2322], ['src/b.ts', 1, 'error', 2307]]);
  assert.match(result.report.diagnostics[0].message, /\nType 'string' is not assignable to type 'number'\.$/, 'the message keeps its continuation lines');
});
