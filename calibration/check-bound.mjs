// Bound report expectations come from compiler-evidence and the 80% line and 70% branch predicates.
import { gitignore, testHeader } from './common.mjs';

const base = { '.gitignore': gitignore, 'src/a.ts': 'export const a = 1;\n',
  'test/a.test.ts': `${testHeader}test('works', () => { assert.equal(a, 1); });\n` };
const head = { 'src/a.ts': 'export const a: number = 2;\n' };
const tests = (status = 'passed') => ({ name: 'tests', side: 'head', cases: [{ file: 'test/a.test.ts', name: 'works', status }] });
const bound = (name, kind, text, exitStatus = 0) => ({ name, kind, side: 'head', text, exitStatus,
  command: kind === 'tsc' ? ['npx', 'tsc', '--noEmit', '--pretty', 'false'] : ['npx', 'vitest', 'run', '--coverage'] });
const expected = (checks) => ({ readiness: 'INSUFFICIENT_EVIDENCE', checks });
const lcov = (lines, branches) => `SF:src/a.ts\nDA:1,${lines}\nBRDA:1,0,0,${branches}\nBRDA:1,0,1,1\nend_of_record\n`;
const at = { start: { line: 1, column: 0 }, end: { line: 1, column: 27 } };
const istanbul = (hits) => JSON.stringify({ 'src/a.ts': { path: 'src/a.ts', statementMap: { 0: at }, s: { 0: 1 }, fnMap: {}, f: {},
  branchMap: { 0: { type: 'if', line: 1, loc: at, locations: [at, at] } }, b: { 0: [hits, 1] } } });

export const cases = [false, true].flatMap((defect) => {
  const suffix = defect ? 'defect' : 'clean', outcome = defect ? 'FAIL' : 'PASS', hits = defect ? 0 : 1;
  return [
    { id: `bound-tsc-${suffix}`, name: 'A bound compiler report checks the changed file', defect, base,
      head: { 'src/a.ts': defect ? "export const a: number = 'wrong';\n" : head['src/a.ts'] },
      reports: [bound('compiler', 'tsc', defect ? "src/a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.\n" : '', defect ? 2 : 0)],
      expected: expected({ 'structure.types-compatible': outcome }) },
    { id: `bound-lcov-lines-${suffix}`, name: 'LCOV changed lines meet or miss 80 percent', defect, base, head,
      reports: [tests(), bound('coverage', 'lcov', lcov(hits, 1))], expected: expected({ 'vc.changed-lines-80': outcome }) },
    { id: `bound-lcov-branches-${suffix}`, name: 'LCOV changed branches meet or miss 70 percent', defect, base, head,
      reports: [tests(), bound('coverage', 'lcov', lcov(1, hits))], expected: expected({ 'vc.changed-branches-70': outcome }) },
    { id: `bound-istanbul-branches-${suffix}`, name: 'Istanbul branches replace LCOV branches for the threshold', defect, base, head,
      reports: [tests(), bound('coverage', 'lcov', lcov(1, 1)), bound('istanbul', 'istanbul-json', istanbul(hits))],
      expected: expected({ 'vc.changed-branches-70': outcome, 'vc.changed-lines-80': 'PASS' }) },
    { id: `bound-changed-tests-${suffix}`, name: 'Changed test files must run in the head report', defect, base,
      head: { ...head, 'test/a.test.ts': base['test/a.test.ts'] + '// Updated test file.\n' },
      reports: [{ name: 'tests', side: 'head', cases: [{ file: defect ? 'test/other.test.ts' : 'test/a.test.ts', name: 'works', status: 'passed' }] },
        bound('coverage', 'lcov', lcov(1, 1))], expected: expected({ 'vc.changed-test-files-ran': outcome, 'vc.active-test-files-ran': outcome }) },
    { id: `bound-active-tests-${suffix}`, name: 'All active test files must run in the head report', defect, base, head,
      reports: [{ name: 'tests', side: 'head', cases: [{ file: defect ? 'test/other.test.ts' : 'test/a.test.ts', name: 'works', status: 'passed' }] },
        bound('coverage', 'lcov', lcov(1, 1))], expected: expected({ 'vc.active-test-files-ran': outcome }) },
  ];
});
