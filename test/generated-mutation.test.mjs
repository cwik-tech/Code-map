// Generated mutation evidence stays outside profile checks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generatedCandidates } from '../lib/mutation/generated.mjs';
import { generatedCommand } from '../lib/verify-test-validation.mjs';
import { authorize, budgets, project, sandboxed } from './worker-fixtures.mjs';

const words = [process.execPath, '--test', '--test-reporter=junit', '--test-reporter-destination=junit.xml'];
const template = [...words, '{testFile}'];
test('expands exactly one whole-word test selector', () => {
  assert.deepEqual(generatedCommand(template, 'test/a.test.mjs'), [...words, 'test/a.test.mjs']);
  assert.throws(() => generatedCommand(words, 'test/a.test.mjs'), /one.*testFile/);
  assert.throws(() => generatedCommand([...template, '{testFile}'], 'test/a.test.mjs'), /one.*testFile/);
  assert.throws(() => generatedCommand([...words, '--file={testFile}'], 'test/a.test.mjs'), /one.*testFile/);
});
test('selects changed source lines through static test links and bound line hits', () => {
  const analysis = { files: [{ path: 'src/a.mjs', imports: [] }, { path: 'src/b.mjs', imports: [] }],
    api: { testImports: [{ source: 'test/a.test.mjs', target: 'src/a.mjs', kind: 'value' }] } };
  const changed = new Map([['src/a.mjs', [1, 2]], ['src/b.mjs', [1]]]);
  assert.deepEqual([...generatedCandidates(analysis, 'test/a.test.mjs', changed, [])], [['src/a.mjs', [1, 2]]]);
  const coverage = [{ kind: 'lcov', files: new Map([['src/a.mjs', { lines: new Map([[1, 0], [2, 1]]), branches: new Map() }]]) }];
  assert.deepEqual([...generatedCandidates(analysis, 'test/a.test.mjs', changed, coverage)], [['src/a.mjs', [2]]]);
});
function runFixture(t, authorized = true) {
  const f = project(t);
  f.put('src/check.mjs', 'export function check(x) { return x < 2; }\n');
  f.git('add', '.'); f.git('commit', '-qm', 'bug'); f.git('tag', '-f', 'base');
  f.put('src/check.mjs', 'export function check(x) { return x <= 2; }\n');
  f.put('test/generated.test.mjs', "import { describe, it } from 'node:test'; import assert from 'node:assert/strict'; import { check } from '../src/check.mjs';\ndescribe('generated', () => { it('[AC:edge] accepts edge', () => assert.equal(check(2), true)); it('accepts zero', () => assert.equal(check(0), true)); });\n");
  f.put('test/weak.test.mjs', "import { describe, it } from 'node:test'; import assert from 'node:assert/strict'; import { check } from '../src/check.mjs';\ndescribe('weak', () => it('accepts zero', () => assert.equal(check(0), true)));\n");
  f.git('add', '.'); f.git('commit', '-qm', 'head');
  const declarations = ['generated', 'weak'].map((name) => {
    const file = `test/${name}.test.mjs`;
    return { file, ...(name === 'generated' ? { name: '[AC:edge] accepts edge' } : {}), mutationAuthorization: authorize(f, authorized ? [...words, file] : words) };
  });
  const request = { requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base', head: 'HEAD', intent: 'Accept the edge.',
    acceptanceCriteria: [{ id: 'edge', text: 'Accept the edge.' }], allowedPaths: null, changeType: 'fix', profileId: 'static-baseline-v0',
    ratingRulesVersion: 'ratings-v0', reportInputs: [], generatedTests: declarations,
    execution: { enabled: true, authorization: authorize(f, words), budgets,
      commands: [{ id: 'tests', words, generatedTestWords: template, kind: 'junit', artifact: 'junit.xml', sides: ['head'] }] } };
  const path = join(f.work, 'request.json'); writeFileSync(path, JSON.stringify(request));
  const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'verify', '--request', path, '--store', f.store], { cwd: f.root, encoding: 'utf8', timeout: 60000 });
  assert.notEqual(result.status, 4, result.stderr);
  const summary = JSON.parse(result.stdout);
  return { results: JSON.parse(readFileSync(summary.files.results, 'utf8')), markdown: readFileSync(summary.files.report, 'utf8'), store: f.store };
}
test('links a killed changed-line mutant and a surviving mutant to generated files and criterion tags', sandboxed, (t) => {
  const { results, markdown, store } = runFixture(t);
  const [strong, weak] = results.generatedTestMutations;
  assert.equal(strong.head.status, 'passed');
  assert.equal(strong.base.status, 'failed');
  assert.equal(strong.failureSensitive, true);
  assert.equal(strong.mutants[0].status, 'Killed');
  assert.equal(strong.mutants[0].selectedFailure, true);
  const run = join(store, 'runs', strong.mutants[0].run), record = JSON.parse(readFileSync(join(run, 'run.json'), 'utf8'));
  assert.equal(record.artifact, null);
  assert.equal(record.mutationReport.file, 'mutant-report');
  assert.equal(existsSync(join(run, 'manifest.json')), false);
  assert.deepEqual(strong.supports, ['acceptance.edge']);
  assert.equal(strong.oracle.state, 'UNCONFIRMED');
  assert.equal(weak.failureSensitive, false);
  assert.equal(weak.mutants[0].status, 'Survived');
  assert.equal(results.obligations.find((x) => x.id === 'fix.reproduced').result, 'UNKNOWN');
  assert.match(markdown, /Generated test mutation/);
});
test('refuses file selection when authorization only matches the broader command', (t) => {
  const { results } = runFixture(t, false);
  assert.equal(results.generatedTestMutations[0].head.status, 'unavailable');
  assert.equal(results.generatedTestMutations[0].mutants.length, 0);
  assert.equal(results.generatedTestMutations[0].failureSensitive, false);
  assert.match(results.generatedTestMutations[0].reason, /command/i);
});

test('runner errors and changed case identities cannot count as killed mutants', async () => {
  const { generatedMutantStatus } = await import('../lib/verify-test-validation.mjs');
  const head = [{ file: 'test/a.mjs', suite: 'a', name: 'checks', status: 'passed' }];
  const record = { stoppedBy: null, signal: null, exitStatus: 1 };
  assert.equal(generatedMutantStatus({ exitCode: 0, record }, [{ ...head[0], status: 'failed' }], head), 'Killed');
  assert.equal(generatedMutantStatus({ exitCode: 0, record }, [{ ...head[0], name: 'import failure', status: 'failed' }], head), 'RuntimeError');
  assert.equal(generatedMutantStatus({ exitCode: 0, record }, [{ ...head[0], status: 'errored' }], head), 'RuntimeError');
  assert.equal(generatedMutantStatus({ exitCode: 0, record: { ...record, stoppedBy: 'wallClockSeconds' } }, [], head), 'Timeout');
});

test('only cases that fail a killed mutant support their tagged criteria', async () => {
  const { supportedObligations } = await import('../lib/verify-test-validation.mjs');
  const file = 'test/a.mjs', suite = 'a';
  const links = [{ file, suite, name: 'strong', criteria: ['strong'] }, { file, suite, name: 'weak', criteria: ['weak'] }];
  const cases = [{ file, suite, name: 'strong', status: 'failed' }, { file, suite, name: 'weak', status: 'passed' }];
  assert.deepEqual(supportedObligations([{ status: 'Killed', cases }], links), ['acceptance.strong']);
  assert.deepEqual(supportedObligations([{ status: 'RuntimeError', cases }], links), []);
});

test('unavailable generated outcomes retain every declaration without claiming sensitivity', async () => {
  const { unavailableGenerated } = await import('../lib/verify-test-validation.mjs');
  const result = unavailableGenerated([{ file: 'test/a.mjs', name: 'case' }, { file: 'test/missing.mjs' }], 'Execution is disabled.');
  assert.equal(result.length, 2);
  assert.equal(result[0].name, 'case');
  assert.equal(result[1].head.status, 'unavailable');
  assert.equal(result[1].failureSensitive, false);
});

test('a named generated case receives sensitivity only for its own reported failure', async () => {
  const { generatedSensitivity } = await import('../lib/verify-test-validation.mjs');
  const file = 'test/a.mjs', suite = 'a';
  const selected = { file, name: 'selected' }, entry = { file, suite, name: 'selected', status: 'passed' };
  const head = { status: 'passed', cases: [entry] };
  const other = { ...entry, name: 'other', status: 'failed' };
  assert.equal(generatedSensitivity(selected, head, [{ status: 'Killed', cases: [{ ...entry, status: 'failed' }, other] }]), true);
  assert.equal(generatedSensitivity(selected, head, [{ status: 'Killed', cases: [entry, other] }]), false);
  assert.equal(generatedSensitivity({ file }, head, [{ status: 'Killed', cases: [entry, other] }]), true);
});
test('mapped Istanbul statement hits restrict changed-line candidates without inventing line counters', () => {
  const analysis = { files: [{ path: 'src/a.mjs', imports: [] }],
    api: { testImports: [{ source: 'test/a.test.mjs', target: 'src/a.mjs', kind: 'value' }] } };
  const coverage = [{ kind: 'istanbul-json', files: new Map([['src/a.mjs', { statements: new Map([
    ['1', { from: 1, to: 1, count: 0 }], ['2', { from: 2, to: 3, count: 1 }],
  ]) }]]) }];
  assert.deepEqual([...generatedCandidates(analysis, 'test/a.test.mjs', new Map([['src/a.mjs', [1, 2, 4]]]), coverage)], [['src/a.mjs', [2]]]);
});
