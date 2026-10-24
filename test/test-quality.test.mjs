import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { analyzeProject, createReport } from '../lib/analysis.mjs';
import { collect, mapData, renderPage } from '../lib/build.mjs';
import { defaults } from '../lib/project.mjs';
import { readCoverage } from '../lib/coverage.mjs';
import { labelStatus, labelsTodo, loadTestLabels, stampTestLabels } from '../lib/test-labels.mjs';
import { deriveFindings } from '../lib/findings.mjs';
import { summarizeTests } from '../lib/test-summary.mjs';

function project(sources, tests, extra = {}) {
  const resolve = createResolver(new Set([...Object.keys(sources), ...Object.keys(tests)]), { aliases: [], baseUrl: null });
  const files = Object.entries(sources).map(([path, text]) => ({ ...analyzeFile(path, text, resolve), tests: [], source: text, status: 'missing', summary: '' }));
  const testFiles = Object.entries(tests).map(([path, text]) => {
    const facts = analyzeFile(path, text, resolve, { tests: true });
    return { path, imports: facts.imports, edges: facts.edges, uses: facts.uses, valueUses: facts.valueUses, externals: facts.externals, scan: facts.testScan };
  });
  return { project: 'fixture', ref: 'working tree', sha: 'fixture', coverageSnapshot: 'working-tree', files, testFiles, coChanges: { changes: {} }, changes: { uncommitted: [] }, ...extra };
}
const analyze = (data, extra) => { data.analysis = analyzeProject(data, extra); return data.analysis.tests; };
const unit = (tests, name) => tests.units.find((item) => item.name === name);
const scan = (text, path = 'test/a.test.ts') => analyzeFile(path, text, createResolver(new Set([path, 'src/a.ts']), { aliases: [], baseUrl: null }), { tests: true }).testScan;
const kinds = (text) => scan(text).cases.map((item) => [item.name, item.failures.map((failure) => failure.kind)]);
const source = { 'src/a.ts': "export function parse(x) { if (!x) throw new Error('bad'); return x; }\nexport function other() { throw new Error('always'); }\n" };

test('the scanner finds cases and statuses, including framework aliases, parameterized definitions and functions passed by name', () => {
  const found = scan(`import { test as check, describe, it } from 'vitest';
import * as nt from 'node:test';
check('aliased', () => { expect(1).toBe(1); });
describe.skip('parked suite', () => { it('inherits skip', () => { expect(1).toBe(1); }); });
it.only('focused', () => { expect(1).toBe(1); });
it.todo('later');
it.each([1, 2])('row %s', (n) => { expect(n).toBe(n); });
nt.test('options', { skip: process.env.CI }, () => { assert.ok(true); });
check('by reference', run);
function run() { expect(2).toBe(2); }
`);
  assert.deepEqual(found.cases.map((item) => [item.name, item.status, item.each, item.assertions]), [
    ['aliased', 'active', false, 1], ['inherits skip', 'skipped', false, 1], ['focused', 'focused', false, 1], ['later', 'todo', false, 0],
    ['row %s', 'active', true, 1], ['options', 'conditional', false, 1], ['by reference', 'active', false, 1],
  ]);
  assert.equal(found.framework, 'vitest');
  assert.deepEqual(found.focused.map((item) => item.name), ['focused']);
});

test('quoted and shorthand Node test options retain skipped or conditional inventory (review S1)', () => {
  const tests = analyze(project(source, { 'test/a.test.ts': `import { test } from 'node:test'; import { parse } from '../src/a';
    const skip = flag, todo = flag, only = flag;
    test('quoted skip', { 'skip': true }, () => expect(() => parse('')).toThrow());
    test('quoted todo', { 'todo': 'later' }, () => expect(() => parse('')).toThrow());
    test('shorthand skip', { skip }, () => expect(() => parse('')).toThrow());
    test('shorthand todo', { todo }, () => expect(() => parse('')).toThrow());
    test('shorthand only', { only }, () => expect(() => parse('')).toThrow());
    test('quoted false', { 'skip': false }, () => {});` }));
  assert.deepEqual(tests.cases.map((item) => item.status), ['skipped', 'todo', 'conditional', 'conditional', 'conditional', 'active']);
  assert.equal(unit(tests, 'parse').failureDirect, 0);
});

test('failure assertions cover thrown, rejected and returned errors, but checks that an error is absent are not failure assertions', () => {
  assert.deepEqual(kinds(`import assert from 'node:assert/strict';
test('throws', () => expect(() => parse('')).toThrow());
test('rejects', async () => { await expect(load()).rejects.toThrow(); await assert.rejects(load()); });
test('status', () => { assert.equal(res.status, 400); assert.notEqual(out.status, 0); });
test('ok false', () => expect(result.ok).toBe(false));
test('error value', () => expect(r.error).toBeDefined());
test('error text', () => expect(screen.getByText('invalid_request')).toBeVisible());
test('absent error', () => expect(r.error).toBeUndefined());
test('hidden message', () => expect(page.getByText('request is invalid')).toHaveCount(0));
test('does not throw', () => expect(() => parse('x')).not.toThrow());
test('success status', () => assert.equal(res.status, 200));
`), [['throws', ['throws']], ['rejects', ['rejects', 'rejects']], ['status', ['status', 'status']], ['ok false', ['ok-false']], ['error value', ['error-value']],
    ['error text', ['error-message']], ['absent error', []], ['hidden message', []], ['does not throw', []], ['success status', []]]);
});

test('smells: fixed waits, but not time limits, and swallowed errors only around assertions in the case itself', () => {
  const found = scan(`function cleanup() { try { remove(); } catch {} }
test('waits', async () => { await new Promise((resolve) => setTimeout(resolve, 100)); expect(1).toBe(1); });
test('time limit', async () => { await Promise.race([work, new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 500))]); expect(1).toBe(1); });
test('swallows', () => { try { expect(run()).toBe(1); } catch {} });
test('cleans up', () => { cleanup(); expect(1).toBe(1); });
test('nothing', () => { run(); });
`);
  assert.deepEqual(found.cases.map((item) => [item.name, item.smells]), [['waits', ['fixed-wait']], ['time limit', []], ['swallows', ['swallowed-error']], ['cleans up', []], ['nothing', []]]);
  assert.equal(found.cases[4].assertions, 0);
});

test('failure exits record throws, catches, error values, error statuses and the line or branch that coverage can measure', () => {
  const facts = analyzeFile('src/x.ts', `export function run(x) {
  if (!x) throw new Error('bad');
  if (x === 1) {
    throw new Error('one');
  }
  try { return JSON.parse(x); }
  catch {
    return { error: 'json' };
  }
}
export function route(req) { if (!req.ok) return NextResponse.json({ error: 'x' }, { status: 400 }); return { ok: false, error: 'y' }; }
`, createResolver(new Set(['src/x.ts']), { aliases: [], baseUrl: null }));
  assert.deepEqual(facts.declarations[0].metrics.failureExits, [{ line: 2, kind: 'throw', branch: 0 }, { line: 4, kind: 'throw' }, { line: 7, kind: 'catch', probe: 8 }]);
  assert.deepEqual(facts.declarations[1].metrics.failureExits, [{ line: 11, kind: 'status', branch: 0 }]);
});

test('parked tests stay inventory and conditional tests stay candidates; neither satisfies failure evidence (TQ-01)', () => {
  const skipped = analyze(project(source, { 'test/a.test.ts': "import { parse } from '../src/a';\ntest.skip('rejects bad input', () => expect(() => parse(null)).toThrow());\n" }));
  assert.equal(unit(skipped, 'parse').status, 'unreached');
  assert.equal(skipped.summary.counts.running, 0);
  assert.equal(skipped.summary.counts.skipped, 1);
  const conditional = analyze(project(source, { 'test/a.test.ts': "import { parse } from '../src/a';\ntest.skipIf(process.env.CI)('rejects bad input', () => expect(() => parse(null)).toThrow());\n" }));
  assert.deepEqual([unit(conditional, 'parse').status, unit(conditional, 'parse').candidates], ['no-failure-assertion', 1]);
  const focused = analyze(project(source, { 'test/a.test.ts': "import { parse } from '../src/a';\ntest.only('rejects bad input', () => expect(() => parse(null)).toThrow());\n" }));
  assert.equal(unit(focused, 'parse').status, 'direct');
  assert.equal(focused.summary.observations[0].key, 'focused');
});

test('mapData preserves renamed and star re-export links for failure assertions (review 1)', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'code-map-reexports-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const entries = {
    'package.json': '{}',
    'src/a.ts': source['src/a.ts'],
    'src/barrel.ts': "export { parse as parseInput } from './a';",
    'src/index.ts': "export * from './barrel';",
    'test/a.test.ts': "import { parseInput } from '../src/index'; test('rejects empty', () => expect(() => parseInput('')).toThrow());",
  };
  for (const [path, text] of Object.entries(entries)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@local', 'commit', '-qm', 'fixture']);
  const data = mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true);
  assert.equal(unit(data.analysis.tests, 'parse').status, 'direct');
  assert.equal(data.files.find((file) => file.path === 'src/barrel.ts').reexports[0].imported, 'parse');
});

test('enclosing skipped and conditional suites dominate focused children (review 6)', () => {
  const tests = analyze(project(source, { 'test/a.test.ts': `import { parse } from '../src/a';
    describe.skip('parked', () => test.only('skip child', () => expect(() => parse('')).toThrow()));
    describe.skipIf(flag)('conditional', () => test.only('conditional child', () => expect(() => parse('')).toThrow()));
    describe.skipIf(flag)('nested', () => describe.only('focused suite', () => test('nested child', () => expect(() => parse('')).toThrow())));
  ` }));
  assert.deepEqual(tests.cases.map((item) => item.status), ['skipped', 'conditional', 'conditional']);
  assert.equal(unit(tests, 'parse').status, 'no-failure-assertion');
  assert.equal(tests.summary.counts.running, 0);
  assert.equal(tests.summary.counts.failureCases, 0);
});

test('focused empty tests retain the no-assertions smell (review 6)', () => {
  const tests = analyze(project(source, { 'test/a.test.ts': "test.only('empty', () => {});" }));
  assert.ok(tests.cases[0].smells.includes('no-assertions'));
  assert.equal(tests.summary.observations.find((item) => item.key === 'noAssertions').count, 1);
});

test('a failure assertion counts only for the function it names, its variable, its caught error or its helper arguments (TQ-02)', () => {
  const status = (text) => { const tests = analyze(project(source, { 'test/a.test.ts': `import { parse, other } from '../src/a';\n${text}\n` })); return [unit(tests, 'parse').status, unit(tests, 'other').status]; };
  assert.deepEqual(status("test('mixed', () => { expect(parse('ok')).toBe('ok'); expect(() => other()).toThrow(); });"), ['no-failure-assertion', 'direct']);
  assert.deepEqual(status("test('uncalled helper', () => { function never() { expect(() => other()).toThrow(); } expect(parse('ok')).toBe('ok'); });"), ['no-failure-assertion', 'unreached']);
  assert.deepEqual(status("test('variable', () => { const r = parse(''); other; expect(r.error).toBeDefined(); });"), ['direct', 'no-failure-assertion']);
  assert.deepEqual(status("test('caught', () => { other; try { parse(''); } catch (error) { expect(error.message).toMatch(/bad/); } });"), ['direct', 'no-failure-assertion']);
  assert.deepEqual(status("function expectInvalid(fn) { expect(fn).toThrow(); }\ntest('helper', () => { other; expectInvalid(() => parse(null)); });"), ['direct', 'no-failure-assertion']);
  assert.deepEqual(status("test('one call', () => { const r = parse(''); expect(screen.getByText('invalid input')).toBeVisible(); });"), ['direct', 'unreached']);
});

test('failure targets exclude expected constructors and expected values (review 12)', () => {
  const tests = analyze(project({ 'src/a.ts': "export function parse() { throw new Error('bad'); } export class ExpectedError { constructor() { throw new Error('constructor'); } } export function expected() { throw new Error('expected'); }" }, {
    'test/a.test.ts': `import assert from 'node:assert/strict'; import { parse, ExpectedError, expected } from '../src/a';
      test('expect throw', () => expect(() => parse()).toThrow(ExpectedError));
      test('assert throw', () => assert.throws(() => parse(), ExpectedError));
      test('expected value', () => expect(parse().error).toEqual(expected()));
      test('caught value', () => { try { parse(); } catch (error) { expect(error).toEqual(expected()); } });`,
  }));
  assert.deepEqual(tests.cases.map((item) => item.failureTargets), Array(4).fill(['src/a.ts#parse']));
  assert.equal(unit(tests, 'parse').status, 'direct');
  assert.equal(unit(tests, 'ExpectedError').status, 'no-failure-assertion');
  assert.equal(unit(tests, 'expected').status, 'no-failure-assertion');
});

test('an expected operand alone never receives fallback failure attribution (review 12)', () => {
  const tests = analyze(project(source, { 'test/a.test.ts': `import { parse } from '../src/a';
    test('expected operand only', () => expect(() => external()).toThrow(parse));` }));
  assert.deepEqual(tests.cases[0].failureTargets, []);
  assert.equal(unit(tests, 'parse').status, 'no-failure-assertion');
});

test('a test name alone never closes a gap (TQ-03)', () => {
  const tests = analyze(project(source, { 'test/a.test.ts': "import { parse } from '../src/a';\ntest('handles invalid input', () => expect(parse('ok')).toBe('ok'));\n" }));
  assert.deepEqual([unit(tests, 'parse').status, unit(tests, 'parse').candidates, tests.cases[0].evidence], ['no-failure-assertion', 1, 'name']);
  assert.ok(tests.summary.observations.some((item) => item.key === 'nameOnly'));
});

test('coverage: real Node LCOV leaves a same-line throw unknown, measures own-line exits, and reads Istanbul-style if branches (TQ-04)', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'code-map-coverage-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const text = "export function parse(x) { if (!x) throw new Error('bad'); return x; }\nexport function own(x) {\n  if (!x) {\n    throw new Error('bad');\n  }\n  try {\n    return JSON.parse(x);\n  } catch (error) {\n    return { error: 'json' };\n  }\n}\n";
  writeFileSync(join(folder, 'a.mjs'), text);
  writeFileSync(join(folder, 'a.test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { parse, own } from './a.mjs';\ntest('happy', () => { assert.equal(parse('ok'), 'ok'); assert.equal(own('1'), 1); });\n");
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // inside node --test, a child test run would report to this run instead of writing LCOV
  const run = spawnSync(process.execPath, ['--test', '--experimental-test-coverage', '--test-reporter=lcov', '--test-reporter-destination=lcov.info', 'a.test.mjs'], { cwd: folder, encoding: 'utf8', timeout: 30000, env });
  if (run.status !== 0 || !existsSync(join(folder, 'lcov.info'))) { t.skip('This Node version cannot write LCOV coverage'); return; }
  const coverage = readCoverage(folder, { coverage: 'lcov.info' });
  const data = project({ 'a.mjs': text }, {}, { coverage });
  const tests = analyze(data, { coverageLines: coverage.lines, coverageBranches: coverage.branches });
  assert.deepEqual(unit(tests, 'parse').exits, [{ line: 1, kind: 'throw', hits: null }]);
  assert.deepEqual(unit(tests, 'own').exits, [{ line: 4, kind: 'throw', hits: 0 }, { line: 8, kind: 'catch', hits: 0 }]);
  assert.equal(JSON.stringify(coverage).includes('"lines"'), false, 'line and branch hits stay out of the page and the report');
  // Istanbul-style records (c8 and Vitest write them) keep the if statement's then/else as one block with two branches.
  writeFileSync(join(folder, 'istanbul.info'), 'SF:a.mjs\nDA:1,3\nBRDA:1,0,0,0\nBRDA:1,0,1,3\nLF:1\nLH:1\nend_of_record\n');
  const istanbul = readCoverage(folder, { coverage: 'istanbul.info' });
  const measured = analyze(project({ 'a.mjs': text }, {}, { coverage: istanbul }), { coverageLines: istanbul.lines, coverageBranches: istanbul.branches });
  assert.equal(unit(measured, 'parse').exits[0].hits, 0);
});

test('scoped reports and summaries keep cases that reach a function through callers, with their routes (TQ-06)', () => {
  const data = project({ 'src/outer.ts': "import { inner } from './inner';\nexport function outer(x) { return inner(x); }\n", 'src/inner.ts': "export function inner(x) { if (!x) throw new Error('bad'); return x; }\n" },
    { 'test/outer.test.ts': "import { outer } from '../src/outer';\ntest('rejects empty', () => expect(() => outer('')).toThrow());\n" });
  const tests = analyze(data);
  const inner = unit(tests, 'inner');
  assert.equal(inner.status, 'indirect');
  assert.deepEqual(inner.viaCases, [{ id: 0, route: ['src/outer.ts#outer', 'src/inner.ts#inner'], checks: true }]);
  const report = createReport(data, { files: ['src/inner.ts'] }, summarizeTests);
  assert.deepEqual(report.tests.cases.map((item) => item.name), ['rejects empty']);
  assert.deepEqual(report.tests.testFiles.map((file) => file.path), ['test/outer.test.ts']);
  assert.equal(report.testSummary.scope, 'selection');
  assert.equal(report.testSummary.counts.cases, 1);
});

test('scoped reports retain all six indirect cases beyond displayed routes (review 10)', () => {
  const data = project({
    'src/outer.ts': "import { inner } from './inner'; export function outer(x) { return inner(x); }",
    'src/inner.ts': "export function inner(x) { if (!x) throw new Error('bad'); return x; }",
  }, { 'test/outer.test.ts': "import { outer } from '../src/outer';\n" + Array.from({ length: 6 }, (_, index) =>
    `test('rejects empty ${index}', () => expect(() => outer('')).toThrow());`).join('\n') });
  const tests = analyze(data);
  assert.equal(unit(tests, 'inner').via, 6);
  assert.equal(unit(tests, 'inner').viaCases.length, 5);
  const report = createReport(data, { files: ['src/inner.ts'] }, summarizeTests);
  assert.equal(report.tests.cases.length, 6);
  assert.equal(report.testSummary.counts.cases, 6);
});

test('scoped label statistics exclude labels from other source scopes (review 10)', () => {
  const data = project({ ...source, 'src/b.ts': 'export function b() { return 1; }' }, {
    'test/current.test.ts': "import { parse } from '../src/a'; test('labeled', () => expect(parse('ok')).toBe('ok')); test('missing', () => parse('ok'));",
    'test/stale.test.ts': "import { parse } from '../src/a'; test('old', () => parse('ok'));",
    'test/unstamped.test.ts': "import { parse } from '../src/a'; test('unstamped', () => parse('ok'));",
    'test/b.test.ts': "import { b } from '../src/b'; test('b', () => expect(b()).toBe(1));",
  }, { testLabels: { file: 'labels.json', files: {
    'test/current.test.ts': { status: 'current', cases: { labeled: { intent: 'happy' } } },
    'test/stale.test.ts': { status: 'stale', cases: {} },
    'test/unstamped.test.ts': { status: 'unstamped', cases: {} },
  } } });
  analyze(data);
  const narrow = createReport(data, { files: ['src/b.ts'] }, summarizeTests);
  const empty = summarizeTests(data.analysis.tests, { paths: [] });
  const relevant = createReport(data, { files: ['src/a.ts'] }, summarizeTests);
  assert.equal(narrow.testSummary.statistics.find((item) => item.key === 'labels').value, 0);
  assert.equal(empty.statistics.find((item) => item.key === 'labels').value, 0);
  assert.equal(narrow.testSummary.statistics.find((item) => item.key === 'labels').detail, 'none: optional, run code-map labels');
  assert.match(relevant.testSummary.statistics.find((item) => item.key === 'labels').detail, /1 stale and 1 unstamped files.*3 cases without a label/);
});

test('files named as tests without recognized cases are listed, not silently dropped (TQ-07)', () => {
  const tests = analyze(project(source, { 'test/b.test.ts': "import { parse } from '../src/a';\nrunner.add('custom syntax', () => parse('x'));\n", 'test/helpers.ts': 'export const fixture = 1;\n' }));
  assert.deepEqual(tests.testFiles.map((file) => [file.path, file.kind]), [['test/b.test.ts', 'unrecognized'], ['test/helpers.ts', 'helper']]);
  assert.equal(tests.summary.counts.testFiles, 0);
  assert.ok(tests.summary.observations.some((item) => item.key === 'unrecognized'));
});

test('label freshness separates unstamped, partial, stale and refreshed labels (TQ-08)', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'code-map-labels-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'labels.json'), file = 'test/a.test.ts';
  const facts = (text) => [{ path: file, ...analyzeFile(file, text, () => null, { tests: true }) }];
  const first = "test('a', () => expect(1).toBe(1));\ntest('b fails', () => expect(() => f()).toThrow());\n";
  writeFileSync(path, JSON.stringify({ files: { [file]: { cases: { a: { intent: 'happy' } } } } }));
  const todo = (text) => labelsTodo(loadTestLabels(path), facts(text), new Map([[file, text]]), 'labels.json');
  assert.equal(labelStatus(loadTestLabels(path).files[file], 'any'), 'unstamped');
  assert.match(todo(first), /unstamped, 2 cases/);
  assert.equal(stampTestLabels(path, facts(first), new Map([[file, first]]), false), 1);
  assert.match(todo(first), /labels missing for some cases, 1 cases[\s\S]*b fails/);
  assert.doesNotMatch(todo(first), /line 1: a /);
  const changed = first + "test('c', () => expect(2).toBe(2));\n";
  assert.match(todo(changed), /stale, 3 cases/);
  assert.equal(stampTestLabels(path, facts(changed), new Map([[file, changed]]), false), 0, 'a plain stamp does not refresh stale labels');
  assert.equal(stampTestLabels(path, facts(changed), new Map([[file, changed]]), false, [file]), 1);
  assert.equal(labelStatus(loadTestLabels(path).files[file], JSON.parse(readFileSync(path, 'utf8')).files[file].hash), 'current');
});

test('barrel re-exports link tests to the declaring file, and next steps name the source and the test to start from', () => {
  const tests = analyze(project({ ...source, 'src/index.ts': "export { parse as parseInput } from './a';\nexport * from './a';\n" }, {
    'test/a.test.ts': "import { parseInput, other } from '../src/index';\ntest('rejects empty', () => expect(() => parseInput('')).toThrow());\ntest('runs other', () => { try { other(); } catch {} });\n" }));
  assert.equal(unit(tests, 'parse').status, 'direct');
  assert.equal(unit(tests, 'other').status, 'no-failure-assertion');
  assert.match(tests.summary.canAndCannot, /cannot judge whether an existing test checks the correct behavior/);
  assert.ok(tests.summary.nextSteps.some((step) => step.text.includes('other (src/a.ts:2)') && step.text.includes('test/a.test.ts:3')));
  assert.ok(tests.summary.statistics.every((stat) => ['inventory', 'inferred', 'pattern', 'measured', 'git', 'model'].includes(stat.source)));
});

test('the CLI reports fix commits with no test change and prints the label work list', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'code-map-fixes-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
  put('src/a.ts', source['src/a.ts']);
  put('test/a.test.ts', "import { parse } from '../src/a';\ntest('parses', () => expect(parse('x')).toBe('x'));\n");
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'first');
  put('src/a.ts', source['src/a.ts'] + 'export const version = 2;\n');
  git('commit', '-qam', 'Fix the parser crash on empty input');
  const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
  const output = spawnSync(process.execPath, [cli, 'inspect', '--ref', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 15000 });
  assert.equal(output.status, 0, output.stderr);
  const report = JSON.parse(output.stdout);
  assert.equal(report.testSummary.counts.fixWithoutTest, 1);
  assert.match(report.testSummary.observations.find((item) => item.key === 'fixWithoutTest').evidence[0].text, /Fix the parser crash/);
  const labels = spawnSync(process.execPath, [cli, 'labels'], { cwd: root, encoding: 'utf8', timeout: 15000 });
  assert.equal(labels.status, 0, labels.stderr);
  assert.match(labels.stdout, /## test\/a.test.ts \(missing, 1 cases\)/);
});

const chrome = process.env.CODE_MAP_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
function browser(data, probe) {
  const folder = mkdtempSync(join(tmpdir(), 'code-map-tests-tab-'));
  try {
    const path = join(folder, 'map.html');
    const script = `<script>try { const result = (() => { ${probe} })(); const out = document.createElement('pre'); out.id = 'probe-result'; out.textContent = JSON.stringify(result); document.body.append(out); } catch (e) { const out = document.createElement('pre'); out.id = 'probe-result'; out.textContent = JSON.stringify({error:String(e)}); document.body.append(out); }</script>`;
    writeFileSync(path, renderPage(data, null).replace('</body>', script + '</body>'));
    const run = spawnSync(chrome, ['--headless', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(folder, 'profile'), '--dump-dom', pathToFileURL(path).href], { encoding: 'utf8', timeout: 25000, maxBuffer: 30 * 1024 * 1024 });
    assert.ifError(run.error);
    const match = /<pre id="probe-result">([\s\S]*?)<\/pre>/.exec(run.stdout);
    assert.ok(match, 'the viewer must finish initialization and emit the probe result');
    const result = JSON.parse(match[1].replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
    assert.equal(result.error, undefined, result.error);
    return result;
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

test('acceptance: the Tests tab shows the summary and its limits, opens a source scope and exports matching evidence', { skip: existsSync(chrome) ? false : 'Set CODE_MAP_CHROME to an installed Chrome executable', timeout: 30000 }, () => {
  const data = project(source, { 'test/a.test.ts': "import { parse, other } from '../src/a';\ntest('rejects empty', () => expect(() => parse('')).toThrow());\ntest('calls other', () => { expect(other).toBeDefined(); });\n" },
    { roots: ['src'], modules: {}, folders: {}, budgets: {}, tour: [], tests: 1, rules: [], coverage: null,
      history: { files: ['src/a.ts'], snapshots: [{ sha: 'fixture', date: '2026-10-21', subject: 'fixture', sizes: [[0, 2]] }] }, changes: { commits: [], base: null, uncommitted: null } });
  data.files[0].tests = ['test/a.test.ts'];
  const result = browser(data, `document.querySelector('[data-tab="tests"]').click();
    const project = panel.innerText;
    state.selected = nodes.get('src/a.ts'); renderPanel();
    const file = panel.innerText;
    const report = currentReport();
    state.tab = 'details'; renderPanel();
    const details = panel.innerHTML;
    panel.querySelector('[data-open-tab="tests"]').click();
    state.colour = 'failure'; renderAll();
    return { project, file, tab: state.tab, details, report: { scope: report.testSummary.scope, units: report.tests.units.map((u) => [u.name, u.status]), cases: report.tests.cases.map((c) => c.name) },
      legend: document.getElementById('legend').innerText, colour: tileColour(nodes.get('src/a.ts#other')), checks: checksList().includes('Test quality') };`);
  assert.match(result.project, /What this can and cannot tell you/);
  assert.match(result.project, /cannot judge whether an existing test checks the correct behavior/i);
  assert.match(result.project, /STATISTICS[\s\S]*WHAT WE SEE[\s\S]*NEXT STEPS[\s\S]*LIMITS OF THIS SCAN/);
  assert.match(result.file, /parse\s+failure assertion found/);
  assert.match(result.file, /other\s+no failure assertion found/);
  assert.deepEqual(result.report, { scope: 'selection', units: [['parse', 'direct'], ['other', 'no-failure-assertion']], cases: ['rejects empty', 'calls other'] });
  assert.match(result.details, /with no failure assertion found/);
  assert.equal(result.tab, 'tests');
  assert.match(result.legend, /no test reaches it[\s\S]*failure assertion found/);
  assert.doesNotMatch(result.legend, /%/);
  assert.equal(result.colour, '#f6d7b0');
  assert.equal(result.checks, true);
});


test('pure public functions retain static candidates, aliases and transitive relationships', () => {
  const data = project({ 'src/a.ts': `export function pure(x: number) { return x + 1; }
function local(x: number) { return x; }
export { local as alias };
export function inner(x: number) { return x; }
export function outer(x: number) { return inner(x); }` }, {
    'test/a.test.ts': "import { outer } from '../src/a'; test('outer', () => { expect(outer(1)).toBe(1); });"
  });
  const found = analyze(data);
  assert.deepEqual(found.exportedFunctions.map(({ name, names, relationship, runtime }) => ({ name, names, relationship, runtime })), [
    { name: 'pure', names: ['pure'], relationship: 'candidate', runtime: 'UNKNOWN' },
    { name: 'local', names: ['alias'], relationship: 'candidate', runtime: 'UNKNOWN' },
    { name: 'inner', names: ['inner'], relationship: 'transitive', runtime: 'UNKNOWN' },
    { name: 'outer', names: ['outer'], relationship: 'direct', runtime: 'UNKNOWN' }
  ]);
  assert.equal(createReport(data).tests.exportedFunctions.length, 4);
  assert.equal(createReport(data).tests.exportedFunctions[0].relationship, 'candidate');
  assert.equal(found.exportedFunctions[2].viaCases[0].route.at(-1), 'src/a.ts#inner');
  assert.equal(found.summary.counts.exportCandidates, 2);
  const candidates = deriveFindings(data.analysis).filter((item) => item.ruleId === 'TEST-EXPORT-CANDIDATE');
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every((item) => item.facts.runtime === 'UNKNOWN' && item.source === 'inferred'));
  assert.equal(found.summary.observations.find((x) => x.key === 'exportCandidates').source, 'inferred');
});

test('exported functions of vendor candidate files give no export candidate finding', () => {
  const data = project({ 'src/a.ts': 'export function own(x: number) { return x; }',
    'components/ui/button.tsx': 'export function Button() { return null; }' }, { 'test/a.test.ts': "test('none', () => {});" });
  const found = analyze(data);
  assert.deepEqual(found.exportedFunctions.filter((item) => item.relationship === 'candidate').map((item) => item.path).sort(), ['components/ui/button.tsx', 'src/a.ts']);
  const candidates = deriveFindings(data.analysis).filter((item) => item.ruleId === 'TEST-EXPORT-CANDIDATE');
  assert.deepEqual(candidates.map((item) => item.location.path), ['src/a.ts']);
});

test('focused expected failures cannot supply failure-assertion evidence', () => {
  const found = analyze(project(source, { 'test/a.test.ts': "import { parse } from '../src/a'; test.fails.only('bad', () => { expect(() => parse(null)).toThrow(); });" }));
  assert.equal(found.cases[0].expectedFailure, true);
  assert.equal(unit(found, 'parse').failureDirect, 0);
  assert.equal(unit(found, 'parse').status, 'no-failure-assertion');
});
