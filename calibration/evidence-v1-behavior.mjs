// Behavioral expectations come from proposal sections 5 and 8. Worker cases require sandbox-exec.
const source = (expression) => `export function sum(a, b) { return ${expression}; }\n`;
const testText = "import { describe, it } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from '../src/sum.mjs';\ndescribe('sum', () => { it('adds [AC:AC1]', () => assert.equal(sum(1, 2), 3)); });\n";
const base = { '.gitignore': 'reports/\n.code-map/oracles.json\n', 'src/sum.mjs': source('a + b'), 'test/sum.test.mjs': testText };
const words = [process.execPath, '--test', '--test-reporter=junit', '--test-reporter-destination=junit.xml'];
const workerReports = ['base', 'head'].map((side) => ({ side, words, kind: 'junit', artifact: 'junit.xml' }));
const check = (id, result, blocking = false, extra = {}) => ({ readiness: blocking ? 'BLOCKED' : 'INSUFFICIENT_EVIDENCE', checks: { [id]: result, ...extra } });
const make = (id, defect, fields) => ({ id: `v1-${id}`, name: id.replaceAll('-', ' '), profileId: 'evidence-v1', defect, base,
  head: { 'src/sum.mjs': source('(a + b)') }, ...fields });
const regressionTests = [{ file: 'test/sum.test.mjs', name: 'adds [AC:AC1]' }];
const fix = { changeType: 'fix', regressionTests };
const report = (failed) => ({ name: 'head', side: 'head', cases: [{ file: 'test/sum.test.mjs', name: 'adds [AC:AC1]', suite: 'sum', status: failed ? 'failed' : 'passed' }] });
export const behavioralCases = [
  make('refactor-defect', true, { workerReports, request: { changeType: 'refactor' }, head: { 'src/sum.mjs': source('0') },
    expected: check('refactor.behavior-preserved', 'FAIL', true, { 'behavior.no-new-failures': 'FAIL' }) }),
  make('refactor-clean', false, { workerReports, request: { changeType: 'refactor' }, expected: check('refactor.behavior-preserved', 'PASS') }),
  make('reproduction-defect', true, { workerReports, request: fix, expected: check('fix.reproduced', 'FAIL') }),
  make('reproduction-clean', false, { workerReports, base: { ...base, 'src/sum.mjs': source('0') }, request: fix,
    expected: check('fix.reproduced', 'PASS') }),
  make('regression-defect', true, { workerReports, base: { ...base, 'src/sum.mjs': source('0') }, head: { 'src/sum.mjs': source('1') }, request: fix,
    expected: check('fix.regression-check', 'FAIL', true, { 'behavior.earlier-failures': 'FAIL' }) }),
  make('regression-clean', false, { workerReports, base: { ...base, 'src/sum.mjs': source('0') }, request: fix,
    expected: check('fix.regression-check', 'PASS') }),
  make('acceptance-defect', true, { reports: [report(true)], request: { acceptanceCriteria: [{ id: 'AC1', text: 'Adds two numbers.' }] },
    expected: check('acceptance.AC1', 'FAIL', true, { 'behavior.no-new-failures': 'FAIL' }) }),
  make('acceptance-clean', false, { reports: [report(false)], oracle: { file: 'test/sum.test.mjs', suite: 'sum', name: 'adds [AC:AC1]', criterion: 'AC1' },
    request: { acceptanceCriteria: [{ id: 'AC1', text: 'Adds two numbers.' }] }, expected: check('acceptance.AC1', 'PASS') }),
];
