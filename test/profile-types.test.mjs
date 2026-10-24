// The check "Types are compatible" of static-baseline-v0 with bound TypeScript compiler reports (context.compiler), and the
// Structural Integrity rating that such a report allows (proposal, section 5 and decision 4).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateObligation } from '../lib/ratings.mjs';
import { analysis, compilerReport, diagnostic, evaluate, passing, request, source } from './profile-fixtures.mjs';

const id = 'structure.types-compatible';
const typed = (head = [], base = [], fields = {}) => evaluate({ typescript: true, compiler: { head, base }, ...fields });
/** src/b.ts imports the changed file src/a.ts. */
const importer = { source: 'src/b.ts', target: 'src/a.ts', specifier: './a', kind: 'value', mode: 'static', line: 1, typeNames: [], valueNames: ['a'] };
const withImporter = analysis({ files: [source('src/a.ts', { tests: { direct: ['test/a.test.ts'], transitive: [] } }), source('src/b.ts', { imports: [importer] })] });

test('without a bound compiler report the type check stays UNKNOWN, and its next action names the tsc report kind', () => {
  const { byId, value } = typed();
  assert.equal(byId[id].result, 'UNKNOWN');
  assert.match(byId[id].rationale, /No bound TypeScript compiler report of the head exists/);
  assert.doesNotMatch(byId[id].rationale, /cannot import/);
  assert.match(byId[id].nextAction, /code-map manifest --kind tsc/);
  assert.match(byId[id].nextAction, /Refer to docs\/verify\.md, section 'Bound compiler reports'\.$/);
  assert.equal(value('structuralIntegrity'), 2, 'level 3 needs the type check');
});

test('an error in a changed file fails the type check without blocking, and Structural Integrity stays at 2', () => {
  const result = typed([compilerReport([diagnostic('src/a.ts', 2322, { line: 3, column: 14 })])]), item = result.byId[id];
  assert.deepEqual([item.result, item.eligible, item.required, item.blocking], ['FAIL', true, true, false]);
  assert.deepEqual(item.evidenceIds, ['diagnostic:reports/tsc.txt:src/a.ts:3:14:TS2322']);
  assert.match(item.rationale, /1 error in changed files or in files that import one: src\/a\.ts\(3,14\) TS2322: Error TS2322 in src\/a\.ts\./);
  assert.match(item.nextAction, /src\/a\.ts/);
  assert.equal(result.value('structuralIntegrity'), 2, 'a type error is not a level-1 failure');
  assert.notEqual(result.ready.state, 'BLOCKED');
});

test('an error in a source file or a test file that imports a changed file fails the type check', () => {
  const source = typed([compilerReport([diagnostic('src/b.ts')])], [], { head: { analysis: withImporter } });
  assert.deepEqual([source.byId[id].result, source.byId[id].evidenceIds], ['FAIL', ['diagnostic:reports/tsc.txt:src/b.ts:1:1:TS2322']]);
  const tests = typed([compilerReport([diagnostic('test/a.test.ts')])]);
  assert.equal(tests.byId[id].result, 'FAIL', 'test/a.test.ts imports the changed file src/a.ts');
});

test('an error only in an unrelated file passes, and the bound report then allows 3 of 5, and an unfiltered test run 4 of 5', () => {
  const report = compilerReport([diagnostic('src/b.ts'), diagnostic('src/a.ts', 6133, { category: 'warning' })], { outside: 2 });
  const result = typed([report]), item = result.byId[id];
  assert.deepEqual([item.result, item.eligible, item.evidenceIds, item.nextAction], ['PASS', true, ['report:reports/tsc.txt'], null]);
  assert.match(item.rationale, /no error in a changed file or in a file that imports one\. 1 error is in other files\. Code-map ignored 2 diagnostics outside the repository\./);
  assert.equal(result.value('structuralIntegrity'), 3);
  assert.ok(result.ratings.structuralIntegrity.predicates.met.includes(`obligation:${id}`));
  assert.equal(typed([report], [], passing).value('structuralIntegrity'), 4);
  assert.equal(typed([compilerReport()]).byId[id].result, 'PASS', 'an empty report of a run with exit status 0 passes');
});

test('the errors that a bound base report also has are named as earlier errors, and the check still fails', () => {
  const head = compilerReport([diagnostic('src/a.ts', 2322, { line: 9 }), diagnostic('src/a.ts', 2304)]);
  const base = compilerReport([diagnostic('src/a.ts', 2322, { line: 4, message: 'Error TS2322 in src/a.ts.' })], { artifact: 'reports/base-tsc.txt' });
  const item = typed([head], [base]).byId[id];
  assert.equal(item.result, 'FAIL');
  assert.match(item.rationale, /1 of these errors is also in a bound base report, so it is an earlier error: src\/a\.ts\(9,1\) TS2322/);
  const renamed = typed([compilerReport([diagnostic('src/a.ts')])], [compilerReport([diagnostic('src/old.ts', 2322, { message: 'Error TS2322 in src/a.ts.' })])],
    { change: { files: [{ path: 'src/a.ts', status: 'R', from: 'src/old.ts' }], paths: ['src/a.ts', 'src/old.ts'], complete: true } });
  assert.match(renamed.byId[id].rationale, /also in a bound base report/, 'a base error follows the rename of its file');
  assert.doesNotMatch(typed([head]).byId[id].rationale, /earlier error/);
});

test('an error in a file that imported a deleted file in the base fails the type check', () => {
  const deleted = { files: [{ path: 'src/a.ts', status: 'D', from: null }], paths: ['src/a.ts'], complete: true };
  const head = analysis({ files: [source('src/b.ts', { imports: [{ ...importer, target: null }] })] });
  const result = typed([compilerReport([diagnostic('src/b.ts', 2307)])], [], { change: deleted, base: { analysis: withImporter }, head: { analysis: head } });
  assert.equal(result.byId[id].result, 'FAIL');
});

test('an error without a file, a failed run without an error, or only filtered runs keep the type check UNKNOWN', () => {
  const global = typed([compilerReport([diagnostic(null, 5058, { line: null, column: null })])]).byId[id];
  assert.deepEqual([global.result, global.evidenceIds], ['UNKNOWN', ['report:reports/tsc.txt']]);
  assert.match(global.rationale, /1 error without a file/);
  const silent = typed([compilerReport([], { exitStatus: 1 })]).byId[id];
  assert.match(`${silent.result} ${silent.rationale}`, /^UNKNOWN .*did not end with exit status 0/);
  const filtered = typed([compilerReport([], { filtered: true })]).byId[id];
  assert.match(`${filtered.result} ${filtered.rationale}`, /^UNKNOWN .*filter/);
  assert.equal(typed([compilerReport([diagnostic('src/a.ts')], { filtered: true })]).byId[id].result, 'FAIL', 'an error from a filtered run is still an error');
  for (const item of [global, silent, filtered]) assert.ok(item.nextAction.length > 0);
});

test('a syntax or settings error in another file keeps the type check UNKNOWN, because tsc then skips the type check of every file', () => {
  for (const item of [diagnostic('src/b.ts', 1109), diagnostic('tsconfig.json', 5107), diagnostic('src/view.tsx', 17008), diagnostic('src/old.js', 8002), diagnostic('src/b.ts', 6307)]) {
    const result = typed([compilerReport([item])]), check = result.byId[id];
    assert.deepEqual([check.result, check.evidenceIds], ['UNKNOWN', ['report:reports/tsc.txt']], `${item.file} TS${item.code}`);
    assert.match(check.rationale, /1 syntax or settings error in other files: .*skipped the type check of the changed files\.$/);
    assert.match(check.nextAction, /^Correct these errors\./);
    assert.equal(result.value('structuralIntegrity'), 2);
  }
  for (const code of [2322, 6133, 7006, 18048]) assert.equal(typed([compilerReport([diagnostic('src/b.ts', code)])]).byId[id].result, 'PASS', `TS${code} is a type error`);
  assert.equal(typed([compilerReport([diagnostic('node_modules/@types/x/index.d.ts', 2304)])]).byId[id].result, 'PASS', 'a declaration file is TypeScript');
  assert.equal(typed([compilerReport([diagnostic('src/a.ts', 1005), diagnostic('src/b.ts', 1005)])]).byId[id].result, 'FAIL', 'an error in a changed file still fails');
});

test('each result of the type check passes validateObligation, and only FAIL and UNKNOWN name a next action', () => {
  const heads = [[], [compilerReport()], [compilerReport([diagnostic('src/a.ts')])], [compilerReport([diagnostic(null, 5058)])], [compilerReport([], { exitStatus: 1 })], [compilerReport([], { filtered: true })],
    [compilerReport([diagnostic('tsconfig.json', 5107)])]];
  for (const head of heads) {
    const item = typed(head).byId[id];
    assert.equal(validateObligation(item).ok, true, JSON.stringify(validateObligation(item).errors));
    assert.equal(item.nextAction === null, item.result === 'PASS', `${item.result}: ${item.nextAction}`);
  }
});

test('a bound compiler report makes the type check apply in a project without TypeScript files', () => {
  assert.equal(evaluate().byId[id].result, 'NOT_APPLICABLE');
  assert.equal(evaluate({ compiler: { head: [compilerReport([diagnostic('src/a.ts')])], base: [] } }).byId[id].result, 'FAIL');
});

test('compiler reports are not test reports, and a feature keeps the consumer-contract check in place of the type check', () => {
  const result = typed([compilerReport()]);
  for (const check of ['coverage.head-run', 'behavior.no-new-failures']) assert.match(result.byId[check].rationale, /No bound test report of the head exists/, check);
  assert.equal(result.ratings.verificationCoverage.state, 'UNASSESSED');
  assert.equal(result.ready.state, 'INSUFFICIENT_EVIDENCE', 'static-baseline-v0 never gives READY');
  const feature = typed([compilerReport()], [], { request: request({ changeType: 'feature', acceptanceCriteria: [{ id: 'AC-1', text: 'a holds' }] }) });
  assert.equal(feature.byId[id], undefined);
  assert.equal(feature.byId['feature.consumer-contracts'].result, 'UNKNOWN');
  assert.doesNotMatch(feature.byId['feature.consumer-contracts'].rationale, /cannot import/);
});
