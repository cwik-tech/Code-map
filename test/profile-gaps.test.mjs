// The gaps of the rule set static-baseline-v0 that its review found: files that the analysis does not read, consumers
// outside the source roots, the way out of a roots difference, evidence for open checks, and the cost of large reports.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analysis, evaluate, modified, report, request, testCase } from './profile-fixtures.mjs';

test('a changed declaration file keeps both import checks UNKNOWN, because the analysis does not read declaration files', () => {
  const { byId } = evaluate({ change: modified('src/a.ts', 'src/types.d.ts') });
  for (const id of ['structure.imports-resolve', 'completeness.consumers-updated']) {
    assert.equal(byId[id].result, 'UNKNOWN', id);
    assert.ok(byId[id].evidenceIds.includes('path:src/types.d.ts'), id);
  }
});

test('a deleted source file keeps the consumer check UNKNOWN when code outside the source roots can still import it', () => {
  const deleted = { files: [{ path: 'src/b.ts', status: 'D', from: null }], paths: ['src/b.ts'], complete: true };
  const outside = { count: 2, paths: ['scripts/run.ts', 'tools/build.ts'] };
  const { byId } = evaluate({ change: deleted, base: { analysis: analysis({ outsideRoots: outside }) }, head: { analysis: analysis({ outsideRoots: outside }) } });
  assert.equal(byId['completeness.consumers-updated'].result, 'UNKNOWN');
  assert.match(byId['completeness.consumers-updated'].rationale, /2 code files outside the source roots/);
  assert.ok(byId['completeness.consumers-updated'].evidenceIds.includes('path:scripts/run.ts'));
  const inside = evaluate({ change: deleted });
  assert.equal(inside.byId['completeness.consumers-updated'].result, 'PASS', 'without code outside the roots, the analysis sees every consumer');
});

test('the next action for different source roots leads out of the loop: a roots setting in its own commit, used as the base', () => {
  const { byId } = evaluate({ comparable: false, comparisonReasons: ['roots'] });
  const next = byId['structure.imports-resolve'].nextAction;
  assert.match(next, /in its own commit before the change/);
  assert.match(next, /use that commit as the base/);
});

test('each check that this version cannot close names the request field or the analysis that it comes from', () => {
  const kinds = [request({ changeType: 'refactor' }), request({ changeType: 'fix' }), request({ changeType: 'feature', acceptanceCriteria: [{ id: 'login', text: 'A user can log in.' }] }), request({ allowedPaths: null })];
  for (const item of kinds) {
    const { obligations } = evaluate({ request: item, typescript: true });
    for (const obligation of obligations.filter((entry) => entry.result === 'UNKNOWN')) assert.ok(obligation.evidenceIds.length > 0, `${item.changeType}: ${obligation.id} names evidence`);
  }
  const { byId } = evaluate({ request: request({ changeType: 'feature', acceptanceCriteria: [{ id: 'login', text: 'A user can log in.' }] }) });
  assert.deepEqual(byId['acceptance.login'].evidenceIds, ['request:acceptanceCriteria.login']);
});

test('large bound reports are evaluated in time that grows with their size, not with test files times cases', () => {
  const files = Array.from({ length: 1500 }, (_, index) => `test/t${index}.test.ts`);
  const cases = files.flatMap((file) => Array.from({ length: 100 }, (_, index) => testCase('passed', `case ${index}`, file)));
  const tests = { cases: files.map((path) => ({ path, suite: 'a', name: 'case 0', status: 'active' })), testFiles: files.map((path) => ({ path, kind: 'tests' })), unreadable: [] };
  const sources = analysis({ tests, files: [{ path: 'src/a.ts', imports: [], tests: { direct: files, transitive: [] }, exports: [] }] });
  const started = process.hrtime.bigint();
  evaluate({ change: modified('src/a.ts', ...files.slice(0, 500)), head: { analysis: sources }, base: { analysis: sources }, reports: { head: [report(cases)], base: [], ineligible: [] } });
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 3000, 'the evaluation takes less than 3 seconds');
});

test('a test case name does not repeat its file when the report uses the file as the suite name', () => {
  const failing = { ...testCase('failed', 'engine returns one', 'test/engine.test.ts'), suite: 'test/engine.test.ts' };
  const { byId } = evaluate({ reports: { head: [report([failing])], base: [], ineligible: [] } });
  assert.match(byId['behavior.no-new-failures'].rationale, /test\/engine\.test\.ts > engine returns one/);
  assert.doesNotMatch(byId['behavior.no-new-failures'].rationale, /test\/engine\.test\.ts > test\/engine\.test\.ts/);
});
