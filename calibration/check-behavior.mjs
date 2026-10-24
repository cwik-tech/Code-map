// Cases for the checks that read bound test reports: behavior.no-new-failures, behavior.earlier-failures and coverage.head-run.
// The reports are written by hand and bound with `code-map manifest`, as test/manifest.test.mjs does. Both reports of a case
// record the same command, tools and environment, so the rule set compares the head report with the base report.
import { engineTestHeader, gitignore } from './common.mjs';

const engine1 = 'export function engine() { return 1; }\n';
const testFile = `${engineTestHeader}test('engine returns one', () => { assert.equal(engine(), 1); });\n`;
const base = { '.gitignore': gitignore, 'src/core/engine.ts': engine1, 'test/engine.test.ts': testFile };
const comment = { 'src/core/engine.ts': '// The engine.\nexport function engine() { return 1; }\n' };
const report = (side, status) => ({ side, name: side, cases: [{ file: 'test/engine.test.ts', name: 'engine returns one', status }] });

export const cases = [
  {
    id: 'behavior-new-failure',
    name: 'A case that passed in the base report and fails in the head report blocks the change',
    defect: true,
    base,
    head: { 'src/core/engine.ts': 'export function engine() { return 2; }\n' },
    reports: [report('base', 'passed'), report('head', 'failed')],
    request: { intent: 'Change the engine so the test fails.' },
    expected: { readiness: 'BLOCKED', checks: { 'behavior.no-new-failures': 'FAIL', 'behavior.earlier-failures': 'PASS', 'coverage.head-run': 'PASS' } },
  },
  {
    id: 'behavior-new-failure-no-base',
    name: 'A failed case of a working-tree head without a base report counts as new and blocks',
    defect: true,
    headKind: 'worktree',
    base,
    head: { 'src/core/engine.ts': 'export function engine() { return 2; }\n' },
    reports: [report('head', 'failed')],
    request: { intent: 'Change the engine so the test fails.' },
    expected: { readiness: 'BLOCKED', checks: { 'behavior.no-new-failures': 'FAIL', 'behavior.earlier-failures': 'UNKNOWN' } },
  },
  {
    id: 'behavior-clean',
    name: 'A case that passes in the base and the head reports passes the behavior checks',
    defect: false,
    base,
    head: comment,
    reports: [report('base', 'passed'), report('head', 'passed')],
    request: { intent: 'Change a comment in the engine.' },
    expected: { readiness: 'INSUFFICIENT_EVIDENCE', checks: { 'behavior.no-new-failures': 'PASS', 'behavior.earlier-failures': 'PASS', 'coverage.head-run': 'PASS' } },
  },
  {
    id: 'behavior-earlier-failure',
    // The change itself is clean. The earlier-failures check fails by design: it shows the failure that the base already has.
    name: 'A failure that the base report also has is not new, and the earlier-failures check shows it',
    defect: false,
    base,
    head: comment,
    reports: [report('base', 'failed'), report('head', 'failed')],
    request: { intent: 'Change a comment in the engine.' },
    expected: { readiness: 'INSUFFICIENT_EVIDENCE', checks: { 'behavior.no-new-failures': 'PASS', 'behavior.earlier-failures': 'FAIL', 'coverage.head-run': 'PASS' } },
  },
  {
    id: 'head-run-nothing',
    name: 'A bound head report whose only case is skipped fails the head-run check',
    defect: true,
    base,
    head: comment,
    reports: [report('head', 'skipped')],
    request: { intent: 'Change a comment in the engine.' },
    expected: { readiness: 'INSUFFICIENT_EVIDENCE', checks: { 'coverage.head-run': 'FAIL' } },
  },
];
