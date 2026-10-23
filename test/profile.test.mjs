import assert from 'node:assert/strict';
import { test } from 'node:test';
import { profile, thresholds } from '../lib/profiles/static-baseline-v0.mjs';
import { categories, exitCode, validateObligation } from '../lib/ratings.mjs';
import { analysis, evaluate, finding, modified, passing, report, request, run, source, testCase } from './profile-fixtures.mjs';

test('the profile names its version and requires all four categories', () => {
  assert.deepEqual(profile, { id: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', requiredCategories: categories });
  assert.deepEqual(thresholds, { changedLines: 80, changedBranches: 70 });
  const { categories: inputs } = evaluate();
  assert.deepEqual(Object.keys(inputs), categories);
  for (const input of Object.values(inputs)) assert.ok(input.required && input.rubric.version === 'ratings-v0' && input.obligations.every((item) => item.category === input.category), input.category);
});

test('each obligation passes validateObligation, and each FAIL or UNKNOWN names a next action', () => {
  const contexts = [{}, { typescript: true }, { comparable: false, comparisonReasons: ['roots'] }, { change: modified() }, passing,
    ...['refactor', 'fix', 'feature'].map((changeType) => ({ typescript: true, request: request({ changeType, acceptanceCriteria: changeType === 'feature' ? [] : [{ id: 'AC-1', text: 'a holds' }] }) })),
    { request: request({ allowedPaths: null }) }, { change: modified('.code-map.json', 'lib/x.py') }];
  // These checks stay UNKNOWN in v0, so the rationale must also tell what would close them.
  const alwaysOpen = /^(refactor\.|fix\.|feature\.consumer|acceptance\.)|types-compatible|migrations-docs/;
  for (const fields of contexts) for (const item of evaluate(fields).obligations) {
    assert.equal(validateObligation(item).ok, true, `${item.id}: ${JSON.stringify(validateObligation(item).errors)}`);
    assert.ok(item.title.length > 0 && item.rationale.length > 0, item.id);
    if (item.result === 'PASS' || item.result === 'NOT_APPLICABLE') assert.equal(item.nextAction, null, item.id);
    else assert.ok(typeof item.nextAction === 'string' && item.nextAction.length > 0, `${item.id} has no next action`);
    if (item.result === 'UNKNOWN' && alwaysOpen.test(item.id)) assert.match(item.rationale, /would close this check/, item.id);
  }
});

test('Structural Integrity is 3 when the required checks pass, and 4 with declared rules and loaded tests', () => {
  const clean = evaluate();
  assert.deepEqual(['structure.architecture-rules', 'structure.imports-resolve', 'structure.no-new-cycle'].map((id) => clean.byId[id].result), ['PASS', 'PASS', 'PASS']);
  assert.equal(clean.byId['structure.types-compatible'].result, 'NOT_APPLICABLE');
  assert.match(clean.byId['structure.types-compatible'].applicabilityReason, /no TypeScript source file/);
  assert.equal(clean.value('structuralIntegrity'), 3);
  assert.equal(evaluate(passing).value('structuralIntegrity'), 4);
  assert.equal(evaluate({ reports: { head: [report([testCase()], { filtered: true })], base: [], ineligible: [] } }).value('structuralIntegrity'), 3, 'a filtered run proves no load');
  assert.equal(evaluate({ reports: { head: [report([testCase('errored')])], base: [], ineligible: [] } }).value('structuralIntegrity'), 3, 'an errored file did not load');
});

test('a project without architecture rules gets NOT_APPLICABLE for the rule check, with its reason', () => {
  const result = evaluate({ ...passing, head: { analysis: analysis({ rules: { declared: [], invalid: [], violations: [] } }) } });
  const item = result.byId['structure.architecture-rules'];
  assert.deepEqual([item.applicability, item.result, item.eligible], ['NOT_APPLICABLE', 'NOT_APPLICABLE', true]);
  assert.match(item.applicabilityReason, /declares no architecture rule/);
  assert.equal(result.value('structuralIntegrity'), 3, 'level 4 needs declared rules');
});

test('a NEW ARCH-RULE finding fails and blocks, and gives 1 of 5', () => {
  const result = evaluate({ head: { findings: [finding('ARCH-RULE', 'ARCH-RULE-1')] }, labels: { 'ARCH-RULE-1': 'NEW' } });
  const item = result.byId['structure.architecture-rules'];
  assert.deepEqual([item.result, item.blocking, item.required, item.evidenceIds], ['FAIL', true, true, ['ARCH-RULE-1']]);
  assert.equal(item.nextAction, 'code-map inspect --analysis head-1 --base-analysis base-1 --findings --baseline new --rule ARCH-RULE');
  assert.deepEqual(result.ratings.structuralIntegrity.failures, ['si.new-architecture-break']);
  assert.equal(result.value('structuralIntegrity'), 1);
  assert.equal(evaluate({ head: { findings: [finding('ARCH-RULE', 'ARCH-RULE-1')] }, labels: { 'ARCH-RULE-1': 'EXISTING' } }).byId['structure.architecture-rules'].result, 'PASS');
});

test('the rule check is UNKNOWN for an invalid rule or an ARCH-RULE finding without a label', () => {
  const invalid = evaluate({ head: { analysis: analysis({ rules: { declared: [], invalid: ['ui => db'], violations: [] } }) } });
  assert.equal(invalid.byId['structure.architecture-rules'].result, 'UNKNOWN');
  assert.match(invalid.byId['structure.architecture-rules'].rationale, /ui => db/);
  const unlabeled = evaluate({ head: { findings: [finding('ARCH-RULE', 'ARCH-RULE-1')] }, labels: { 'ARCH-RULE-1': 'UNKNOWN' } });
  assert.equal(unlabeled.byId['structure.architecture-rules'].result, 'UNKNOWN');
  assert.equal(unlabeled.value('structuralIntegrity'), 2);
});

test('a new import that does not resolve gives 1 of 5, and a lost consumer fails Change Completeness with 1 of 5', () => {
  const findings = [finding('IMPORT-UNRESOLVED', 'IMPORT-UNRESOLVED-1')], labels = { 'IMPORT-UNRESOLVED-1': 'NEW' };
  const added = evaluate({ head: { findings }, labels, importOrigins: new Map([['IMPORT-UNRESOLVED-1', 'new-import']]) });
  assert.equal(added.byId['structure.imports-resolve'].result, 'FAIL');
  assert.equal(added.byId['structure.imports-resolve'].blocking, false);
  assert.equal(added.byId['completeness.consumers-updated'].result, 'PASS');
  assert.equal(added.value('structuralIntegrity'), 1);
  const lost = evaluate({ head: { findings: [finding('IMPORT-NAME-MISSING', 'IMPORT-NAME-MISSING-1', ['src/b.ts', 'src/a.ts'])] }, labels: { 'IMPORT-NAME-MISSING-1': 'NEW' },
    importOrigins: new Map([['IMPORT-NAME-MISSING-1', 'lost-consumer']]) });
  assert.equal(lost.byId['structure.imports-resolve'].result, 'PASS');
  assert.deepEqual([lost.byId['completeness.consumers-updated'].result, lost.byId['completeness.consumers-updated'].blocking], ['FAIL', false]);
  assert.deepEqual(lost.ratings.changeCompleteness.failures, ['cc.consumer-lost-target']);
  assert.equal(lost.value('changeCompleteness'), 1);
});

test('an alias import that resolved in the base and breaks in the head fails, and so does a new broken alias import', () => {
  const edge = (specifier, target, line = 1) => ({ source: 'src/b.ts', target, specifier, kind: 'value', mode: 'static', line, typeNames: [], valueNames: ['a'] });
  const side = (...imports) => ({ analysis: analysis({ files: [source('src/a.ts'), source('src/b.ts', { imports })] }) });
  const lost = evaluate({ base: side(edge('@/a', 'src/a.ts')), head: side(edge('@/a', null)) }), consumers = lost.byId['completeness.consumers-updated'];
  assert.deepEqual([consumers.result, consumers.evidenceIds, lost.value('changeCompleteness')], ['FAIL', ['import:src/b.ts:1'], 1]);
  const moved = evaluate({ change: { files: [{ path: 'src/c.ts', status: 'R', from: 'src/b.ts' }], paths: ['src/b.ts', 'src/c.ts'], complete: true }, base: side(edge('@/a', 'src/a.ts')),
    head: { analysis: analysis({ files: [source('src/a.ts'), source('src/c.ts', { imports: [{ ...edge('@/a', null), source: 'src/c.ts' }] })] }) } });
  assert.deepEqual(moved.byId['completeness.consumers-updated'].evidenceIds, ['import:src/c.ts:1'], 'a moved consumer keeps the import of its base path');
  const added = (specifier, old = []) => evaluate({ change: modified('src/b.ts'), base: side(edge('@/a', 'src/a.ts'), ...old),
    head: side(edge('@/a', 'src/a.ts'), edge('@acme/ui', 'src/a.ts', 3), edge(specifier, null, 2)) });
  const broken = added('@/missing'), resolves = broken.byId['structure.imports-resolve'];
  assert.deepEqual([resolves.result, resolves.evidenceIds, broken.value('structuralIntegrity')], ['FAIL', ['import:src/b.ts:2'], 1]);
  // A package, a style file, a package path that no other import resolves and an import that was already broken in the base do not fail.
  for (const result of [...['react', 'lodash/fp', '@/styles/x.css', '@acme/ui/x'].map((specifier) => added(specifier)), added('@/gone', [edge('@/gone', null, 2)])]) {
    assert.equal(result.byId['structure.imports-resolve'].result, 'PASS');
  }
});

test('an undecided origin, another language or a changed file whose imports the analysis does not check make both import checks UNKNOWN', () => {
  const undecided = evaluate({ head: { findings: [finding('IMPORT-UNRESOLVED', 'IMPORT-UNRESOLVED-1')] }, labels: { 'IMPORT-UNRESOLVED-1': 'NEW' } });
  const other = evaluate({ change: modified('src/a.ts', 'tools/run.py') });
  const testOnly = evaluate({ change: modified('test/a.test.ts') }), outside = evaluate({ change: modified('src/a.ts', 'scripts/x.ts') });
  for (const result of [undecided, other, testOnly, outside]) for (const id of ['structure.imports-resolve', 'completeness.consumers-updated']) assert.equal(result.byId[id].result, 'UNKNOWN', id);
  assert.deepEqual([other, testOnly, outside].map((result) => result.byId['structure.imports-resolve'].evidenceIds), [['path:tools/run.py'], ['path:test/a.test.ts'], ['path:scripts/x.ts']]);
  assert.equal(testOnly.ratings.structuralIntegrity.state, 'UNASSESSED', 'the analysis checks no import of a test file');
  // The head lost src/a.ts. The analysis does not record the broken import of the unchanged test, so the consumer check cannot pass.
  const deleted = evaluate({ change: { files: [{ path: 'src/a.ts', status: 'D', from: null }], paths: ['src/a.ts'], complete: true }, head: { analysis: analysis({ files: [source('src/b.ts')] }) } });
  assert.deepEqual([deleted.byId['completeness.consumers-updated'].result, deleted.byId['completeness.consumers-updated'].evidenceIds], ['UNKNOWN', ['path:test/a.test.ts']]);
});

test('a NEW value-import cycle fails only when no cycle of the base contains it', () => {
  const base = { analysis: analysis({ cycles: { all: [], value: [{ files: ['src/b.ts', 'src/old.ts'], edges: [] }] } }) };
  const change = { files: [{ path: 'src/a.ts', status: 'R', from: 'src/old.ts' }], paths: ['src/a.ts', 'src/old.ts'], complete: true };
  const kept = evaluate({ base, change, head: { findings: [finding('CYCLE-VALUE', 'CYCLE-VALUE-1', ['src/a.ts', 'src/b.ts'])] }, labels: { 'CYCLE-VALUE-1': 'NEW' } });
  assert.equal(kept.byId['structure.no-new-cycle'].result, 'PASS');
  const grown = evaluate({ base, change, head: { findings: [finding('CYCLE-VALUE', 'CYCLE-VALUE-2', ['src/a.ts', 'src/b.ts', 'src/c.ts'])] }, labels: { 'CYCLE-VALUE-2': 'NEW' } });
  assert.equal(grown.byId['structure.no-new-cycle'].result, 'FAIL');
  assert.equal(grown.value('structuralIntegrity'), 2, 'a new cycle is not a level-1 failure');
});

test('the type check is UNKNOWN with TypeScript, and a feature gets a consumer-contract check in its place', () => {
  const typed = evaluate({ typescript: true });
  assert.equal(typed.byId['structure.types-compatible'].result, 'UNKNOWN');
  assert.equal(typed.value('structuralIntegrity'), 2, 'level 3 needs the type check');
  const feature = evaluate({ typescript: true, request: request({ changeType: 'feature', acceptanceCriteria: [{ id: 'AC-1', text: 'a holds' }] }) });
  assert.equal(feature.byId['structure.types-compatible'], undefined);
  assert.deepEqual([feature.byId['feature.consumer-contracts'].category, feature.byId['feature.consumer-contracts'].result], ['structuralIntegrity', 'UNKNOWN']);
});

test('a dynamic, unclassified, loader or skipped import of a changed file keeps Structural Integrity at 2', () => {
  const edge = (fields) => ({ source: 'src/a.ts', target: 'src/b.ts', specifier: './b', kind: 'value', mode: 'static', line: 1, typeNames: [], valueNames: ['b'], ...fields });
  const withEdge = (fields) => analysis({ files: [source('src/a.ts', { imports: [edge(fields)] }), source('src/b.ts')] });
  for (const fields of [{ specifier: null, target: null, mode: 'dynamic' }, { kind: 'unknown' }, ...['./icon.svg?raw', '@/icon.svg?raw', '!!raw-loader!./b'].map((specifier) => ({ target: null, specifier }))]) {
    assert.equal(evaluate({ head: { analysis: withEdge(fields) } }).value('structuralIntegrity'), 2, JSON.stringify(fields));
  }
  const skipped = analysis({ importNames: { missing: [], unchecked: { commonJs: 1 }, skipped: [{ source: 'src/a.ts', target: 'src/b.ts', line: 1, reason: 'commonJs' }] } });
  assert.equal(evaluate({ head: { analysis: skipped } }).value('structuralIntegrity'), 2);
  assert.equal(evaluate({ head: { analysis: withEdge({}) } }).value('structuralIntegrity'), 3);
});

test('without comparable analyses, findings give no PASS or FAIL and three categories are Unassessed', () => {
  const result = evaluate({ comparable: false, comparisonReasons: ['roots'], head: { findings: [finding('ARCH-RULE', 'ARCH-RULE-1'), finding('TEST-FOCUSED', 'TEST-FOCUSED-1')] },
    labels: { 'ARCH-RULE-1': 'NEW', 'TEST-FOCUSED-1': 'NEW' } });
  for (const id of ['structure.architecture-rules', 'structure.imports-resolve', 'structure.no-new-cycle', 'completeness.consumers-updated', 'completeness.no-focused-test', 'completeness.tests-not-weakened']) {
    assert.equal(result.byId[id].result, 'UNKNOWN', id);
    assert.match(result.byId[id].rationale, /not comparable, because the source roots differ\./);
  }
  assert.equal(result.ready.state, 'INSUFFICIENT_EVIDENCE', 'an unconfirmed NEW label cannot block');
  for (const name of ['structuralIntegrity', 'verificationCoverage', 'changeCompleteness']) assert.equal(result.ratings[name].state, 'UNASSESSED', name);
  // The next action fits each reason, and the rationale gives the reason in words, not as its key.
  const fits = { repository: /one repository/, analyzer: /one Code-map version/, config: /\.code-map\.json unchanged/, environment: /one Node\.js version/,
    roots: /"roots" in \.code-map\.json/, 'worktree-changed': /no person or tool edits/, 'freshness-unknown': /no person or tool edits/, 'renames-unavailable': /git diff/ };
  for (const reasons of [...Object.keys(fits).map((key) => [key]), ['roots', 'environment']]) {
    const { rationale, nextAction } = evaluate({ comparable: false, comparisonReasons: reasons }).byId['completeness.consumers-updated'];
    for (const key of reasons) assert.ok(fits[key].test(nextAction) && !rationale.includes(`(${key}`) && !(key.includes('-') && rationale.includes(key)), `${key}: ${rationale} ${nextAction}`);
  }
});

test('a change without a changed code file in the analysis leaves Structural Integrity Unassessed', () => {
  const result = evaluate({ change: modified('src/notes.md') });
  assert.equal(result.ratings.structuralIntegrity.state, 'UNASSESSED');
  assert.deepEqual(result.ratings.structuralIntegrity.missingEvidence, ['At least one changed source file whose imports the analysis checks']);
});

test('Verification Coverage stays Unassessed without a bound coverage report', () => {
  const none = evaluate(), bound = evaluate(passing);
  assert.deepEqual([none.byId['coverage.head-run'].result, none.ratings.verificationCoverage.state], ['UNKNOWN', 'UNASSESSED']);
  for (const id of ['coverage.head-run', 'behavior.no-new-failures']) assert.match(none.byId[id].nextAction, /Refer to docs\/verify\.md, section 'Bound test reports'\.$/, id);
  assert.deepEqual([bound.byId['coverage.head-run'].result, bound.ratings.verificationCoverage.state], ['PASS', 'UNASSESSED']);
  assert.match(bound.ratings.verificationCoverage.missingEvidence[0], /line-coverage report/);
});

test('an unfiltered run that ran no case gives 1 of 5 when the change touched code that is not a test', () => {
  const empty = (fields = {}) => ({ head: [report([testCase('skipped')], fields)], base: [], ineligible: [] });
  const result = evaluate({ reports: empty() });
  assert.equal(result.byId['coverage.head-run'].result, 'FAIL');
  assert.equal(result.value('verificationCoverage'), 1);
  assert.equal(evaluate({ reports: empty({ filtered: true }) }).ratings.verificationCoverage.state, 'UNASSESSED');
  assert.equal(evaluate({ reports: empty(), change: modified('test/a.test.ts') }).ratings.verificationCoverage.state, 'UNASSESSED');
});

test('the coverage thresholds give 3 at 80% of changed lines and 4 at 70% of changed branches', () => {
  const measured = (lines, branches) => evaluate({ ...passing, coverage: { changedLines: { covered: lines, total: 100 }, changedBranches: { covered: branches, total: 100 } } }).value('verificationCoverage');
  assert.deepEqual([measured(79, 100), measured(80, 69), measured(80, 70)], [2, 3, 4]);
  const unran = evaluate({ reports: { head: [report([testCase('passed', 'other', 'test/b.test.ts')])], base: [], ineligible: [] }, change: modified('src/a.ts', 'test/a.test.ts'),
    coverage: { changedLines: { covered: 100, total: 100 }, changedBranches: { covered: 100, total: 100 } } });
  assert.equal(unran.value('verificationCoverage'), 2, 'each changed test file must run');
});

test('a failed case that no base report of the same run has is a new failure and blocks', () => {
  const failing = report([testCase('failed')]);
  const alone = evaluate({ reports: { head: [failing], base: [], ineligible: [] } });
  assert.deepEqual([alone.byId['behavior.no-new-failures'].result, alone.byId['behavior.no-new-failures'].required], ['FAIL', false]);
  assert.deepEqual(alone.ready.blocking, ['behavior.no-new-failures']);
  assert.equal(alone.byId['behavior.earlier-failures'].result, 'UNKNOWN');
  const otherRun = report([testCase('failed')], { artifact: 'reports/base.xml', run: { ...run, command: ['npx', 'vitest', 'run', 'a'] } });
  assert.equal(evaluate({ reports: { head: [failing], base: [otherRun], ineligible: [] } }).byId['behavior.no-new-failures'].result, 'FAIL');
  const moved = { files: [{ path: 'test/a.test.ts', status: 'R', from: 'test/old.test.ts' }], paths: ['test/a.test.ts', 'test/old.test.ts'], complete: true };
  const earlier = evaluate({ change: moved, reports: { head: [failing], base: [report([testCase('errored', 'works', 'test/old.test.ts')], { artifact: 'reports/base.xml' })], ineligible: [] } });
  assert.equal(earlier.byId['behavior.no-new-failures'].result, 'PASS');
  assert.equal(earlier.byId['behavior.earlier-failures'].result, 'FAIL');
  assert.notEqual(earlier.ready.state, 'BLOCKED');
});

test('a run that failed without a failed case, or no head report, makes the failure check UNKNOWN', () => {
  assert.equal(evaluate({ reports: { head: [report([testCase()], { exitStatus: 1 })], base: [], ineligible: [] } }).byId['behavior.no-new-failures'].result, 'UNKNOWN');
  assert.equal(evaluate({ reports: { head: [report([testCase()], { exitStatus: null })], base: [], ineligible: [] } }).byId['behavior.no-new-failures'].result, 'UNKNOWN');
  const none = evaluate();
  assert.deepEqual(['behavior.no-new-failures', 'behavior.earlier-failures'].map((id) => none.byId[id].result), ['UNKNOWN', 'UNKNOWN']);
  assert.equal(evaluate(passing).byId['behavior.no-new-failures'].result, 'PASS');
});

test('Behavioral Confidence stays Unassessed, and the checks of the request stay UNKNOWN', () => {
  assert.equal(evaluate(passing).ratings.behavioralConfidence.state, 'UNASSESSED');
  const refactor = evaluate({ ...passing, request: request({ changeType: 'refactor', acceptanceCriteria: [{ id: 'AC-1', text: 'a holds' }] }) });
  assert.deepEqual(['refactor.behavior-preserved', 'acceptance.AC-1'].map((id) => [refactor.byId[id].result, refactor.byId[id].blocking]), [['UNKNOWN', true], ['UNKNOWN', false]]);
  const fix = evaluate({ request: request({ changeType: 'fix' }) });
  assert.deepEqual(['fix.reproduced', 'fix.regression-check'].map((id) => fix.byId[id].result), ['UNKNOWN', 'UNKNOWN']);
  assert.equal(fix.ratings.behavioralConfidence.state, 'UNASSESSED');
});

test('the scope check fails for a changed path or a rename source outside the allowed paths', () => {
  assert.equal(evaluate().byId['scope.allowed-paths'].result, 'PASS');
  const outside = evaluate({ change: modified('src/a.ts', 'scripts/x.ts') });
  assert.deepEqual([outside.byId['scope.allowed-paths'].result, outside.byId['scope.allowed-paths'].evidenceIds], ['FAIL', ['path:scripts/x.ts']]);
  const moved = evaluate({ change: { files: [{ path: 'src/a.ts', status: 'R', from: 'lib/a.ts' }], paths: ['lib/a.ts', 'src/a.ts'], complete: true } });
  assert.equal(moved.byId['scope.allowed-paths'].result, 'FAIL');
  assert.equal(evaluate({ request: request({ allowedPaths: ['SRC/**', 'test/**'] }) }).byId['scope.allowed-paths'].result, 'FAIL', 'the match is case-sensitive');
});

test('the scope and settings checks are UNKNOWN when nothing changed, and scope is open without allowed paths', () => {
  const nothing = evaluate({ change: modified() });
  assert.deepEqual(['scope.allowed-paths', 'completeness.settings-unchanged'].map((id) => nothing.byId[id].result), ['UNKNOWN', 'UNKNOWN']);
  const open = evaluate({ request: request({ allowedPaths: null }) });
  assert.deepEqual([open.byId['scope.declared'].applicability, open.byId['scope.declared'].result], ['UNKNOWN', 'UNKNOWN']);
  assert.equal(open.ratings.changeCompleteness.state, 'UNASSESSED');
});

test('a settings edit fails without blocking', () => {
  for (const path of ['.code-map.json', 'docs/code-map/test-labels.json']) {
    const result = evaluate({ request: request({ allowedPaths: ['**'] }), change: modified('src/a.ts', path) });
    assert.deepEqual([result.byId['completeness.settings-unchanged'].result, result.byId['completeness.settings-unchanged'].blocking], ['FAIL', false], path);
    assert.notEqual(result.ready.state, 'BLOCKED');
  }
});

test('a NEW focused test fails and blocks, and an unreadable changed test file makes the test checks UNKNOWN', () => {
  const focused = evaluate({ head: { findings: [finding('TEST-FOCUSED', 'TEST-FOCUSED-1', ['test/a.test.ts'])] }, labels: { 'TEST-FOCUSED-1': 'NEW' } });
  assert.deepEqual([focused.byId['completeness.no-focused-test'].result, focused.byId['completeness.no-focused-test'].blocking], ['FAIL', true]);
  const unreadable = evaluate({ change: modified('test/run.sh'), head: { analysis: analysis({ tests: { ...analysis().tests, unreadable: ['test/run.sh'] } }) } });
  for (const id of ['completeness.no-focused-test', 'completeness.tests-not-weakened']) assert.equal(unreadable.byId[id].result, 'UNKNOWN', id);
});

test('a removed or weakened base case fails, and incomplete renames make a removal UNKNOWN', () => {
  const removed = { removed: [{ path: 'test/a.test.ts', suite: 'a', name: 'works', line: 3 }], weakened: [] };
  assert.equal(evaluate({ weakening: removed }).byId['completeness.tests-not-weakened'].result, 'FAIL');
  assert.equal(evaluate({ weakening: removed, change: { ...modified('src/a.ts'), complete: false } }).byId['completeness.tests-not-weakened'].result, 'UNKNOWN');
  const weakened = { removed: [], weakened: [{ findingId: 'TEST-PARKED-1', ruleId: 'TEST-PARKED', path: 'test/a.test.ts', name: 'works' }] };
  const result = evaluate({ weakening: weakened });
  assert.deepEqual([result.byId['completeness.tests-not-weakened'].result, result.byId['completeness.tests-not-weakened'].evidenceIds], ['FAIL', ['TEST-PARKED-1']]);
  assert.equal(evaluate().byId['completeness.tests-not-weakened'].result, 'PASS');
});

test('Change Completeness is 3 when the required checks pass, and 2 when an outside file can import a changed file unseen', () => {
  assert.equal(evaluate().value('changeCompleteness'), 3);
  assert.equal(evaluate().byId['completeness.migrations-docs'].result, 'UNKNOWN');
  const skipped = analysis({ importNames: { missing: [], unchecked: { noExports: 1 }, skipped: [{ source: 'src/b.ts', target: 'src/a.ts', line: 2, reason: 'noExports' }] } });
  assert.equal(evaluate({ head: { analysis: skipped } }).value('changeCompleteness'), 2);
  const computed = analysis({ files: [source('src/a.ts'), source('src/b.ts', { imports: [{ source: 'src/b.ts', target: null, specifier: null, kind: 'value', mode: 'dynamic', line: 4 }] })] });
  assert.equal(evaluate({ head: { analysis: computed } }).value('changeCompleteness'), 2);
  const feature = evaluate({ request: request({ changeType: 'feature' }) });
  assert.deepEqual([feature.byId['feature.acceptance-criteria'].result, feature.value('changeCompleteness')], ['UNKNOWN', 2]);
});

test('static-baseline-v0 never gives READY, even with clean static evidence and a passing bound report', () => {
  for (const changeType of ['refactor', 'feature', 'fix', 'other']) for (const fields of [{}, passing, { ...passing, typescript: true }]) {
    const result = evaluate({ ...fields, request: request({ changeType }) });
    assert.equal(result.ready.state, 'INSUFFICIENT_EVIDENCE', changeType);
    assert.equal(exitCode(result.ready.state), 3);
  }
});

test('only a NEW architecture-rule break, a NEW focused test and a new test failure give BLOCKED', () => {
  const blockers = [
    [{ head: { findings: [finding('ARCH-RULE', 'ARCH-RULE-1')] }, labels: { 'ARCH-RULE-1': 'NEW' } }, 'structure.architecture-rules'],
    [{ head: { findings: [finding('TEST-FOCUSED', 'TEST-FOCUSED-1', ['test/a.test.ts'])] }, labels: { 'TEST-FOCUSED-1': 'NEW' } }, 'completeness.no-focused-test'],
    [{ reports: { head: [report([testCase('failed')])], base: [], ineligible: [] } }, 'behavior.no-new-failures']];
  for (const [fields, id] of blockers) assert.deepEqual([evaluate(fields).ready.state, evaluate(fields).ready.blocking], ['BLOCKED', [id]], id);
  const others = evaluate({ head: { findings: [finding('IMPORT-UNRESOLVED', 'IMPORT-UNRESOLVED-1'), finding('IMPORT-NAME-MISSING', 'IMPORT-NAME-MISSING-1', ['src/b.ts', 'src/a.ts']),
    finding('CYCLE-VALUE', 'CYCLE-VALUE-1', ['src/a.ts', 'src/b.ts'])] }, labels: { 'IMPORT-UNRESOLVED-1': 'NEW', 'IMPORT-NAME-MISSING-1': 'NEW', 'CYCLE-VALUE-1': 'NEW' },
  importOrigins: new Map([['IMPORT-UNRESOLVED-1', 'new-import'], ['IMPORT-NAME-MISSING-1', 'lost-consumer']]), change: modified('.code-map.json', 'scripts/x.ts', 'src/a.ts'),
  weakening: { removed: [{ path: 'test/a.test.ts', suite: 'a', name: 'works', line: 3 }], weakened: [] }, reports: { head: [report([testCase('skipped')])], base: [], ineligible: [] } });
  const failed = others.obligations.filter((item) => item.result === 'FAIL').map((item) => item.id).sort();
  assert.deepEqual(failed, ['completeness.consumers-updated', 'completeness.settings-unchanged', 'completeness.tests-not-weakened', 'coverage.head-run', 'scope.allowed-paths',
    'structure.imports-resolve', 'structure.no-new-cycle']);
  assert.deepEqual([others.ready.state, others.ready.blocking], ['INSUFFICIENT_EVIDENCE', []]);
});
