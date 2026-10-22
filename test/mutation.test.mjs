import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMutant, canary, fileHash, mutantsFor } from '../lib/mutation.mjs';
import { outcome, parseResult, testsFor } from '../lib/mutation-run.mjs';
import { readMutation } from '../lib/mutation-report.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const source = "export function checked(x) {\n  if (!x) throw new Error('bad');\n  return x * 2;\n}\nexport function unchecked(x) {\n  if (!x) throw new Error('bad');\n  return x * 2;\n}\n";
const tests = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { checked, unchecked } from '../src/a.mjs';\n"
  + "test('checked rejects', () => assert.throws(() => checked(0), /bad/));\ntest('checked doubles', () => assert.equal(checked(2), 4));\n"
  + "test('unchecked runs', () => { unchecked(2); assert.ok(true); });\n";

function repository(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-mutate-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); }
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'fixture');
  return { root, git };
}
function code(root, args) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 120000, env });
}

test('mutants remove failure exits and replace return values, without duplicates for the same failure path', () => {
  const text = "export function parse(x) {\n  if (!x) throw new Error('bad');\n  try { return JSON.parse(x); } catch (error) { return { error: 'json' }; }\n}\n"
    + "export async function route(req) { if (!req.ok) return Response.json({ e: 1 }, { status: 400 }); return { ok: true }; }\n"
    + "export function later(p) { return p.then(() => 1).catch(() => null); }\n";
  const found = mutantsFor('src/a.ts', text, ['parse', 'route', 'later']);
  assert.deepEqual(found.map((item) => [item.unit.split('#')[1], item.line, item.kind, item.replacement]), [
    ['parse', 2, 'remove-throw', ';'], ['parse', 3, 'rethrow-in-catch', '{ throw error; }'], ['parse', 3, 'return-undefined', 'undefined'],
    ['route', 5, 'status-to-200', '200'], ['route', 5, 'return-undefined', 'undefined'],
    ['later', 6, 'rethrow-in-catch', '(error) => { throw error; }'], ['later', 6, 'return-undefined', 'undefined'],
  ]);
  assert.ok(found.every((item) => item.valid));
  assert.equal(applyMutant(text, found[0]).split('\n')[1], '  if (!x) ;');
  assert.equal(canary('bin/x.mjs', '#!/usr/bin/env node\nconsole.log(1);\n').split('\n')[0], '#!/usr/bin/env node', 'a #! line stays first');
});

test('results separate failing tests from files that cannot load, and outcomes keep timeouts and errors apart', () => {
  const tap = "TAP version 13\nok 1 - passes\n  ---\n  type: 'test'\n  ...\nnot ok 2 - fails\n  ---\n  code: 'ERR_ASSERTION'\n  ...\n"
    + "not ok 3 - b.test.mjs\n  ---\n  exitCode: 1\n  code: 'ERR_TEST_FAILURE'\n  ...\n1..3\n# tests 3\n# pass 1\n# fail 2\n";
  assert.deepEqual(parseResult('tap', tap), { discovered: 2, passed: 1, failed: ['fails'], fileErrors: ['b.test.mjs'] });
  const folder = mkdtempSync(join(tmpdir(), 'code-map-json-result-'));
  try {
    const report = join(folder, 'result.json');
    writeFileSync(report, JSON.stringify({ numTotalTests: 2, numPassedTests: 1, testResults: [
      { name: 'a.test.ts', status: 'failed', assertionResults: [{ fullName: 'a works', status: 'passed' }, { fullName: 'a rejects', status: 'failed' }] },
      { name: 'b.test.ts', status: 'failed', message: 'Cannot find module', assertionResults: [] }] }));
    assert.deepEqual(parseResult('json', '', report), { discovered: 2, passed: 1, failed: ['a rejects'], fileErrors: ['b.test.ts'] });
  } finally { rmSync(folder, { recursive: true, force: true }); }
  const base = [{ result: { discovered: 3, passed: 3, failed: [], fileErrors: [] } }];
  const result = (fields, status = 1) => [{ status, timedOut: false, result: { discovered: 3, passed: 2, failed: [], fileErrors: [], ...fields } }];
  assert.deepEqual(outcome(result({ failed: ['checked rejects'] }), base), { status: 'detected', killedBy: ['checked rejects'] });
  assert.deepEqual(outcome(result({ passed: 3 }, 0), base), { status: 'survived' });
  assert.equal(outcome([{ status: null, timedOut: true, result: null }], base).status, 'timeout');
  assert.equal(outcome(result({ fileErrors: ['a.test.mjs'], failed: ['x'] }), base).status, 'error', 'a file that cannot load is not a detection');
  assert.equal(outcome(result({ discovered: 2, failed: ['x'] }), base).status, 'error', 'fewer discovered tests is not a detection');
  assert.equal(outcome(result({}), base).status, 'error', 'a nonzero exit without a failing test is not a detection');
});

test('acceptance: mutate detects a checked exit, keeps an unchecked one as survived, proves the copy loads, and leaves the repository unchanged', (t) => {
  const { root, git } = repository(t, { 'src/a.mjs': source, 'test/a.test.mjs': tests });
  const run = code(root, ['mutate', '--ref', 'HEAD', '--file', 'src/a.mjs', '--out', 'out/mutation.json']);
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(readFileSync(join(root, 'out/mutation.json'), 'utf8'));
  assert.deepEqual(report.files['src/a.mjs'].mutants.map((item) => [item.unit.split('#')[1], item.line, item.kind, item.status, item.killedBy ?? []]), [
    ['checked', 2, 'remove-throw', 'detected', ['checked rejects']], ['checked', 3, 'return-undefined', 'detected', ['checked doubles']],
    ['unchecked', 6, 'remove-throw', 'survived', []], ['unchecked', 7, 'return-undefined', 'survived', []],
  ]);
  assert.deepEqual(report.units.map((item) => [item.status, item.canary, item.baseline[0].discovered, item.baseline[0].passed]), [['checked', 'error', 3, 3], ['checked', 'error', 3, 3]]);
  assert.equal(report.units[1].baselineReused, true, 'the receipt records reuse for identical baseline commands');
  assert.equal(report.units[1].canaryReused, true, 'the canary is reusable only for the same source file and tests');
  assert.match(run.stdout, /src\/a.mjs#unchecked: checked, 1 test files, 0 detected, 2 not detected/);
  assert.equal(readFileSync(join(root, 'src/a.mjs'), 'utf8'), source);
  assert.equal(git('status', '--short', '--untracked-files=no'), '');
  const inspect = code(root, ['inspect', '--ref', 'HEAD', '--mutation', 'out/mutation.json']);
  assert.equal(inspect.status, 0, inspect.stderr);
  const inspected = JSON.parse(inspect.stdout);
  const unchecked = inspected.tests.units.find((item) => item.name === 'unchecked');
  assert.deepEqual([unchecked.exits[0].mutant, unchecked.mutation.counts.survived, unchecked.mutation.run], ['survived', 2, 'checked']);
  assert.equal(inspected.tests.units.find((item) => item.name === 'checked').exits[0].mutant, 'detected');
  assert.equal(inspected.testSummary.observations.find((item) => item.key === 'mutantsSurvived').count, 1);
  assert.equal(inspected.testSummary.nextSteps[0].source, 'measured');
});

test('HTTP mutations change the status argument without mistaking response bodies or text limits for statuses', () => {
  const text = `export function clip(value) { return text(value, 500); }
export function method(value) { return formatter.text(value, 500); }
export function body() { return Response.json({ amount: 500 }, { status: 404 }); }
export function response() { return new Response('bad', { status: 503 }); }
export function route(res) { res.status(422).json({ size: 500 }); }
export function header(res) { res.writeHead(502).end(); }
export function hono(c) { return c.text('bad', 401); }
export function payload(res) { return res.json({ status: 500 }); }
`;
  const found = mutantsFor('src/status.mjs', text, ['clip', 'method', 'body', 'response', 'route', 'header', 'hono', 'payload']);
  assert.deepEqual(found.filter(item => item.kind === 'status-to-200').map(item => [item.unit.split('#')[1], item.original]),
    [['body', '404'], ['response', '503'], ['route', '422'], ['header', '502'], ['hono', '401']]);
});

test('mutate runs no mutant when the selected tests fail without one', (t) => {
  const { root } = repository(t, { 'src/a.mjs': source, 'test/a.test.mjs': tests.replace('assert.equal(checked(2), 4)', 'assert.equal(checked(2), 5)') });
  const run = code(root, ['mutate', '--ref', 'HEAD', '--file', 'src/a.mjs', '--function', 'checked', '--out', 'mutation.json']);
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(readFileSync(join(root, 'mutation.json'), 'utf8'));
  assert.deepEqual([report.units[0].status, report.files['src/a.mjs'].mutants.length], ['baseline-failed', 0]);
  assert.deepEqual(report.units[0].excluded.map((item) => [item.path, item.failed]), [['test/a.test.mjs', ['checked doubles']]], 'the failing test file is recorded');
});

test('mutation test processes cannot accidentally fall back to the live Claude executable', (t) => {
  const controlled = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { existsSync } from 'node:fs';\nimport { checked } from '../src/a.mjs';\n"
    + "test('isolated provider environment', () => { assert.equal(typeof process.env.CODE_MAP_CLAUDE, 'string'); assert.equal(existsSync(process.env.CODE_MAP_CLAUDE), false); assert.throws(() => checked(0), /bad/); });\n";
  const { root } = repository(t, { 'src/a.mjs': source, 'test/a.test.mjs': controlled });
  const run = code(root, ['mutate', '--worktree', '--file', 'src/a.mjs', '--function', 'checked']);
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(readFileSync(join(root, 'docs/code-map/mutation.json'), 'utf8'));
  assert.equal(report.units[0].status, 'checked');
  assert.equal(report.files['src/a.mjs'].mutants[0].status, 'detected');
});

test('a report is evidence only while its file is unchanged, and Stryker reports are read too', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'code-map-mutation-report-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  writeFileSync(join(folder, 'ours.json'), JSON.stringify({ tool: 'code-map mutate', files: { 'src/a.mjs': { hash: fileHash(source), mutants: [{ unit: 'src/a.mjs#unchecked', line: 6, kind: 'remove-throw', status: 'survived' }] } },
    units: [{ key: 'src/a.mjs#unchecked', status: 'checked', tests: ['test/a.test.mjs'], canary: 'error' }] }));
  const current = readMutation(folder, {}, { mutation: 'ours.json' }, new Map([['src/a.mjs', source]]));
  assert.deepEqual([current.tool, current.files['src/a.mjs'].length, current.stale, current.units.length], ['code-map mutate', 1, [], 1]);
  const changed = readMutation(folder, {}, { mutation: 'ours.json' }, new Map([['src/a.mjs', source + '// edited\n']]));
  assert.deepEqual([changed.files, changed.stale, changed.units], [{}, ['src/a.mjs'], []]);
  writeFileSync(join(folder, 'stryker.json'), JSON.stringify({ schemaVersion: '2', files: { 'src/a.mjs': { source, mutants: [
    { id: '1', mutatorName: 'BlockStatement', replacement: '{}', status: 'Survived', location: { start: { line: 6, column: 10 } } },
    { id: '2', mutatorName: 'ConditionalExpression', replacement: 'false', status: 'Killed', location: { start: { line: 2, column: 7 } } }] } } }));
  // A crafted report cannot put markup into the page: lines must be integers, statuses known, and text fields plain strings.
  const attack = '<img src=x onerror=alert(1)>';
  writeFileSync(join(folder, 'crafted.json'), JSON.stringify({ tool: 'code-map mutate', files: { 'src/a.mjs': { hash: fileHash(source), mutants: [
    { unit: 'src/a.mjs#unchecked', line: attack, kind: { toString: 1 }, original: ['x'], replacement: attack, status: attack, killedBy: attack }] } },
    units: [{ key: 'src/a.mjs#unchecked', status: attack, tests: attack, canary: attack, excluded: [{ path: attack, failed: attack }] }] }));
  const crafted = readMutation(folder, {}, { mutation: 'crafted.json' }, new Map([['src/a.mjs', source]]));
  assert.deepEqual(crafted.files['src/a.mjs'][0], { unit: 'src/a.mjs#unchecked', line: null, kind: '', original: '', replacement: attack, status: 'ignored', killedBy: [] });
  assert.deepEqual(crafted.units[0], { key: 'src/a.mjs#unchecked', status: 'checked', tests: [], canary: null, excluded: [{ path: attack, failed: [] }] });
  const stryker = readMutation(folder, {}, { mutation: 'stryker.json' }, new Map([['src/a.mjs', source]]));
  assert.deepEqual(stryker.files['src/a.mjs'].map((item) => [item.line, item.kind, item.status]), [[6, 'BlockStatement', 'survived'], [2, 'ConditionalExpression', 'detected']]);
});

test('declared subprocess tests remain selected alongside direct assertion tests', () => {
  const unit = { path: 'lib/server.mjs', direct: [0], viaCases: [], declaredTests: ['test/http.test.mjs'] };
  const analysis = { files: [{ path: unit.path, tests: { direct: ['test/direct.test.mjs'] } }], tests: {
    cases: [{ path: 'test/direct.test.mjs' }], testFiles: [
      { path: 'test/direct.test.mjs', kind: 'tests', framework: 'node:test', type: 'unit' },
      { path: 'test/http.test.mjs', kind: 'tests', framework: 'node:test', type: 'integration' },
    ],
  } };
  assert.deepEqual(testsFor(unit, analysis).map(file => file.path), ['test/direct.test.mjs', 'test/http.test.mjs']);
});
