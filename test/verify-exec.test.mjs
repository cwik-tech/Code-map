// Real worker execution and copied-test evidence through the verification command.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorize, budgets, project, sandboxed, snapshot } from './worker-fixtures.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const words = [process.execPath, '--test', '--test-reporter=junit', '--test-reporter-destination=junit.xml'];
const command = { id: 'tests', words, kind: 'junit', artifact: 'junit.xml', sides: ['base', 'head'] };
function verify(fixture, fields = {}, commands = [command], runBudgets = budgets) {
  const authorization = authorize(fixture, words), path = join(fixture.work, 'request.json');
  writeFileSync(path, JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base', head: 'HEAD',
    intent: 'Fix addition.', acceptanceCriteria: [], allowedPaths: null, changeType: 'fix', profileId: 'static-baseline-v0',
    ratingRulesVersion: 'ratings-v0', reportInputs: [], execution: { enabled: true, authorization, budgets: runBudgets, commands }, ...fields }));
  const result = spawnSync(process.execPath, [cli, 'verify', '--request', path, '--store', fixture.store], { cwd: fixture.root, encoding: 'utf8', timeout: 30000 });
  assert.notEqual(result.status, 4, result.stderr);
  const summary = JSON.parse(result.stdout);
  return { results: JSON.parse(readFileSync(summary.files.results, 'utf8')), markdown: readFileSync(summary.files.report, 'utf8') };
}
function fix(fixture) {
  fixture.put('src/sum.mjs', 'export function sum(a, b) { return a + b + (a === 10 ? 0 : 0); }\n');
  fixture.put('test/new.test.mjs', "import { describe, it } from 'node:test'; import assert from 'node:assert/strict'; import { sum } from '../src/sum.mjs';\ndescribe('regression', () => { it('fixed', () => assert.equal(sum(10, 1), 11)); });\n");
  fixture.git('add', '.'); fixture.git('commit', '-qm', 'head');
}

test('verify runs both sides as isolated comparable reports', sandboxed, (t) => {
  const fixture = project(t); fix(fixture);
  const { results } = verify(fixture);
  assert.deepEqual(results.executionRuns.map((run) => [run.side, run.status]), [['base', 'completed'], ['head', 'completed']]);
  assert.deepEqual(results.executions.map((run) => [run.side, run.attestation, run.eligible]), [['base', 'isolated', true], ['head', 'isolated', true]]);
  assert.equal(results.obligations.find((item) => item.id === 'behavior.no-new-failures')?.result, 'PASS');
});

test('copied regression and generated tests fail on base and pass on head without changing fix checks', sandboxed, (t) => {
  const fixture = project(t);
  fixture.put('src/sum.mjs', 'export function sum(a, b) { return a === 10 ? 0 : a + b; }\n');
  fixture.git('add', '.'); fixture.git('commit', '-qm', 'bug'); fixture.git('tag', '-f', 'base'); fix(fixture);
  const { results, markdown } = verify(fixture, { regressionTests: [{ file: 'test/new.test.mjs', name: 'fixed' }], generatedTests: [{ file: 'test/new.test.mjs' }] });
  assert.deepEqual(results.testValidation.map((item) => [item.type, item.base.status, item.head.status, item.confirmed]),
    [['regression', 'failed', 'passed', true], ['generated', 'failed', 'passed', true]]);
  assert.equal(results.obligations.find((item) => item.id === 'fix.reproduced').result, 'UNKNOWN');
  assert.match(markdown, /confirmed/i);
});

test('a named case that passes on both sides proves no bug', sandboxed, (t) => {
  const fixture = project(t); fix(fixture);
  const { results } = verify(fixture, { regressionTests: [{ file: 'test/new.test.mjs', name: 'fixed' }] });
  assert.deepEqual([results.testValidation[0].base.status, results.testValidation[0].head.status, results.testValidation[0].confirmed], ['passed', 'passed', false]);
  assert.match(results.testValidation[0].reason, /proves nothing/);
});

test('an unauthorized command is refused and produces no evidence', (t) => {
  const fixture = project(t); fix(fixture);
  const { results } = verify(fixture, {}, [{ ...command, words: [process.execPath, '-e', 'throw Error("ran")'] }]);
  assert.deepEqual(results.executionRuns.map((run) => run.status), ['refused', 'refused']);
  assert.deepEqual(results.executions, []);
});

test('a budget stop keeps its record and no evidence', sandboxed, (t) => {
  const fixture = project(t); fix(fixture);
  fixture.put('test/hang.test.mjs', 'setInterval(() => {}, 1000);\n'); fixture.git('add', '.'); fixture.git('commit', '-qm', 'hang');
  const { results } = verify(fixture, {}, [{ ...command, sides: ['head'] }], { ...budgets, wallClockSeconds: 1 });
  assert.equal(results.executionRuns[0].stoppedBy, 'wallClockSeconds');
  assert.deepEqual(results.executions, []);
});

test('a copied test path behind a symlink is refused', sandboxed, (t) => {
  const fixture = project(t); fix(fixture);
  symlinkSync(fixture.work, join(fixture.root, 'escape'));
  const { results } = verify(fixture, { head: 'worktree', regressionTests: [{ file: 'escape/secret.test.mjs' }] });
  assert.equal(results.testValidation[0].confirmed, false);
  assert.equal(results.testValidation[0].base.status, 'unavailable');
});

test('a new failure from comparable worker runs blocks the change', sandboxed, (t) => {
  const fixture = project(t);
  fixture.put('src/sum.mjs', 'export function sum() { return 0; }\n'); fixture.git('add', '.'); fixture.git('commit', '-qm', 'break');
  const { results } = verify(fixture);
  assert.equal(results.obligations.find((item) => item.id === 'behavior.no-new-failures').result, 'FAIL');
  assert.equal(results.readiness.state, 'BLOCKED');
});

test('base and head runs keep their requested sides when both select the same commit', sandboxed, (t) => {
  const fixture = project(t);
  const { results } = verify(fixture);
  assert.deepEqual(results.executions.map((run) => run.side), ['base', 'head']);
});

test('disabled execution keeps existing results and never runs declared commands', (t) => {
  const fixture = project(t); fix(fixture);
  const { results } = verify(fixture, { execution: { enabled: false, authorization: null, budgets, commands: [command] } });
  assert.deepEqual(results.executions, []);
  assert.equal(Object.hasOwn(results, 'executionRuns'), false);
  assert.equal(Object.hasOwn(results, 'testValidation'), false);
});

test('different reported cases cannot confirm a file-level regression', sandboxed, (t) => {
  const fixture = project(t);
  fixture.put('src/sum.mjs', 'export function sum() { return 0; }\n'); fixture.git('add', '.'); fixture.git('commit', '-qm', 'bug'); fixture.git('tag', '-f', 'base');
  fix(fixture);
  fixture.put('test/new.test.mjs', "import { describe, it } from 'node:test'; import assert from 'node:assert/strict'; import { sum } from '../src/sum.mjs';\ndescribe('dynamic', () => { it(sum(10, 1) === 0 ? 'base only' : 'head only', () => assert.equal(sum(10, 1), 11)); });\n");
  fixture.git('add', '.'); fixture.git('commit', '-qm', 'dynamic tests');
  const { results } = verify(fixture, { regressionTests: [{ file: 'test/new.test.mjs' }] });
  assert.deepEqual([results.testValidation[0].base.status, results.testValidation[0].head.status], ['failed', 'passed']);
  assert.equal(results.testValidation[0].confirmed, false);
  assert.match(results.testValidation[0].reason, /identit/);
});


test('enabled verification preserves every Git file with a split index', sandboxed, (t) => {
  const fixture = project(t); fix(fixture);
  fixture.git('update-index', '--split-index');
  fixture.git('status', '--porcelain');
  const before = snapshot(fixture.root);
  const { results } = verify(fixture);
  assert.equal(results.executionRuns.length, 2);
  assert.deepEqual(snapshot(fixture.root), before);
});

test('uncommitted head test files reproduce the bug in the isolated base copy', sandboxed, (t) => {
  const fixture = project(t);
  fixture.put('src/sum.mjs', 'export function sum(a, b) { return a === 10 ? 0 : a + b; }\n');
  fixture.git('add', '.'); fixture.git('commit', '-qm', 'bug'); fixture.git('tag', '-f', 'base');
  fixture.put('src/sum.mjs', 'export function sum(a, b) { return a + b; }\n');
  fixture.put('test/new.test.mjs', "import { describe, it } from 'node:test'; import assert from 'node:assert/strict'; import { sum } from '../src/sum.mjs';\ndescribe('bug', () => it('fixed', () => assert.equal(sum(10, 1), 11)));\n");
  const { results } = verify(fixture, { head: 'worktree', regressionTests: [{ file: 'test/new.test.mjs', name: 'fixed' }] });
  assert.equal(results.testValidation[0].confirmed, true);
  assert.equal(results.head.worktreeDigest.length, 64);
});
