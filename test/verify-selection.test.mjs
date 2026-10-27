// Real isolated selection includes affected and baseline tests and retains failed attempts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { authorize, budgets, project, sandboxed } from './worker-fixtures.mjs';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const runner = `import { writeFileSync } from 'node:fs';
const cases = [];
for (const file of process.argv.slice(2)) {
  try { const test = await import('./' + file); test.check(); cases.push('<testcase file="' + file + '" name="works"/>'); }
  catch { cases.push('<testcase file="' + file + '" name="works"><failure/></testcase>'); process.exitCode = 1; }
}
writeFileSync('junit.xml', '<testsuites><testsuite name="selected">' + cases.join('') + '</testsuite></testsuites>');
`;
function execute(fixture, authorized) {
  const selected = ['test/baseline.test.mjs', 'test/sum.test.mjs'];
  const words = [process.execPath, 'runner.mjs', '{testFiles}'];
  const authorization = authorize(fixture, authorized ? [process.execPath, 'runner.mjs', ...selected] : words);
  const command = { id: 'selected', words, baselineSuite: ['test/baseline.test.mjs'], kind: 'junit', artifact: 'junit.xml', sides: ['base', 'head'] };
  const request = { requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base', head: 'HEAD', intent: 'Compare selected tests.',
    acceptanceCriteria: [], allowedPaths: null, changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
    execution: { enabled: true, authorization, budgets, commands: [command, { ...command, id: 'retry', sides: ['head'] }] } };
  const path = join(fixture.work, 'request.json'); writeFileSync(path, JSON.stringify(request));
  const result = spawnSync(process.execPath, [cli, 'verify', '--request', path, '--store', fixture.store], { cwd: fixture.root, encoding: 'utf8', timeout: 30000 });
  assert.notEqual(result.status, 4, result.stderr);
  return JSON.parse(readFileSync(JSON.parse(result.stdout).files.results, 'utf8'));
}
function prepare(t) {
  const fixture = project(t);
  fixture.put('runner.mjs', runner);
  fixture.put('test/baseline.test.mjs', 'export function check() {}\n');
  fixture.put('test/unrelated.test.mjs', 'throw Error("unrelated test ran");\n');
  fixture.put('test/sum.test.mjs', "import { sum } from '../src/sum.mjs'; export function check() { if (sum(1, 1) !== 2) throw Error('broken'); }\n");
  fixture.git('add', '.'); fixture.git('commit', '-qm', 'selection fixture'); fixture.git('tag', '-f', 'base');
  fixture.put('src/sum.mjs', 'export function sum() { return 0; }\n');
  fixture.git('add', '.'); fixture.git('commit', '-qm', 'break sum');
  return fixture;
}
test('impact plus baseline selection excludes unrelated tests and retains every failed attempt', sandboxed, (t) => {
  const result = execute(prepare(t), true);
  assert.deepEqual(result.executionRuns.map((x) => x.selection.files), Array(3).fill(['test/baseline.test.mjs', 'test/sum.test.mjs']));
  assert.deepEqual(result.executionRuns.map((x) => x.selection.total), [2, 2, 2]);
  assert.deepEqual(result.executions.map((x) => [x.side, x.failed]), [['base', 0], ['head', 1], ['head', 1]]);
  assert.deepEqual(result.executionRuns.map((x) => x.selection.observed.files.map((file) => [file.file, file.failed])),
    [[['test/baseline.test.mjs', 0], ['test/sum.test.mjs', 0]], [['test/baseline.test.mjs', 0], ['test/sum.test.mjs', 1]],
      [['test/baseline.test.mjs', 0], ['test/sum.test.mjs', 1]]]);
  assert.equal(result.obligations.find((x) => x.id === 'behavior.no-new-failures').result, 'FAIL');
});
test('authorization of template words does not authorize expanded selection', sandboxed, (t) => {
  const result = execute(prepare(t), false);
  assert.deepEqual(result.executionRuns.map((x) => x.status), ['refused', 'refused', 'refused']);
  assert.deepEqual(result.executions, []);
  assert.match(result.executionRuns[0].reasons.join(' '), /other command words/);
});
