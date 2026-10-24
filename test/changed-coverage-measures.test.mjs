// Statement, function and branch coverage of the changed code from Istanbul JSON and LCOV FN records, and the join of each
// changed function to a function of the head analysis. All functions here are pure.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedCoverage, coverageSection, istanbulCoverage, lcovCoverage } from '../lib/changed-coverage.mjs';

const repository = '/work/repo';
const at = (line, column, endLine = line, endColumn = column + 10) => ({ start: { line, column }, end: { line: endLine, column: endColumn } });
const empty = { start: {}, end: {} };
/** An Istanbul file entry from lists: statements [location, count], functions [name, decl, loc, count], branches [loc, type, [[location, count]]]. */
function entry(path, { statements = [], functions = [], branches = [] } = {}) {
  const keyed = (list, value) => Object.fromEntries(list.map((item, index) => [index, value(item)]));
  return { path, statementMap: keyed(statements, ([location]) => location), s: keyed(statements, ([, count]) => count),
    fnMap: keyed(functions, ([name, decl, loc]) => ({ name, decl, loc, line: decl.start.line })), f: keyed(functions, ([, , , count]) => count),
    branchMap: keyed(branches, ([loc, type, paths]) => ({ loc, type, locations: paths.map(([location]) => location), line: loc.start.line })),
    b: keyed(branches, ([, , paths]) => paths.map(([, count]) => count)) };
}
const istanbul = (entries, artifact = 'coverage/coverage-final.json', options = {}) => {
  const read = istanbulCoverage(JSON.stringify(Object.fromEntries(entries.map((item) => [item.path, item]))), { repository, ...options });
  assert.equal(read.error, undefined, read.error);
  return { artifact, ...read };
};
const lcov = (text, artifact = 'coverage/lcov.info') => ({ artifact, ...lcovCoverage(text, { repository }) });
const changes = (entries) => new Map(Object.entries(entries));

test('the statements whose source range touches a changed line count, and a statement ran when its count is more than 0', () => {
  // Line 4 changed. The statement on lines 3 to 5 touches it, the statement on line 4 is on it, and the statements on lines 2 and 8 do not touch it.
  const report = istanbul([entry('src/a.ts', { statements: [[at(2, 2), 1], [at(3, 2, 5, 3), 1], [at(4, 4), 0], [at(8, 0), 0]] })]);
  const measure = changedCoverage(changes({ 'src/a.ts': [4] }), [report]);
  assert.deepEqual(measure.changedStatements, { covered: 1, total: 2 });
  assert.deepEqual([measure.files[0].statements, measure.files[0].uncoveredStatements, measure.files[0].lines], [{ covered: 1, total: 2 }, [4], null]);
  assert.deepEqual([measure.unmeasured, measure.lineReports, measure.reports], [['src/a.ts'], [], ['coverage/coverage-final.json']], 'Istanbul JSON gives no line coverage');
});

test('a function with a changed body line counts, and its join to the function of the analysis with the same start line is exact', () => {
  const report = istanbul([entry('src/a.ts', { functions: [['engine', at(1, 16, 1, 22), at(1, 40, 10, 1), 2], ['helper', at(12, 9, 12, 15), at(12, 20, 14, 1), 0]] })]);
  const analysis = [{ path: 'src/a.ts', name: 'engine', start: 1, end: 10 }, { path: 'src/a.ts', name: 'helper', start: 12, end: 14 }, { path: 'src/b.ts', name: 'engine', start: 1, end: 3 }];
  const measure = changedCoverage(changes({ 'src/a.ts': [6] }), [report], analysis);
  assert.deepEqual([measure.changedFunctions, measure.joins], [{ covered: 1, total: 1 }, { exact: 1, ambiguous: 0, missing: 0 }]);
  assert.deepEqual(measure.files[0].functionJoins, [{ name: 'engine', line: 1, covered: true, join: 'exact', analysis: 'engine' }], 'helper does not touch line 6');
});

test('LCOV FN and FNDA records give function coverage: FN takes its end line from FN, or else from the joined analysis function', () => {
  const text = ['SF:src/a.ts', 'FN:1,engine', 'FN:12,14,helper', 'FN:20,unused', 'FN:30,dup', 'FN:31,dup', 'FNDA:3,engine', 'FNDA:0,helper', 'FNDA:0,dup', 'FNDA:4,dup', 'FNF:5', 'FNH:2',
    'DA:5,1', 'DA:13,0', 'end_of_record', ''].join('\n');
  const analysis = [{ path: 'src/a.ts', name: 'engine', start: 1, end: 10 }];
  const measure = changedCoverage(changes({ 'src/a.ts': [5, 13, 30, 31] }), [lcov(text)], analysis);
  // engine (1 to 10 from the analysis) touches line 5. helper (12 to 14) touches line 13. unused has no end line and no join, so it is line 20 only.
  // Two FN records with one name take the FNDA records of that name in their order.
  assert.deepEqual(measure.files[0].functionJoins, [{ name: 'engine', line: 1, covered: true, join: 'exact', analysis: 'engine' },
    { name: 'helper', line: 12, covered: false, join: 'missing', analysis: null }, { name: 'dup', line: 30, covered: false, join: 'missing', analysis: null },
    { name: 'dup', line: 31, covered: true, join: 'missing', analysis: null }]);
  assert.deepEqual([measure.changedFunctions, measure.joins, measure.files[0].source], [{ covered: 2, total: 4 }, { exact: 1, ambiguous: 0, missing: 3 }, 'lcov']);
  assert.deepEqual(measure.changedStatements, null, 'LCOV never gives statement coverage');
  const plain = changedCoverage(changes({ 'src/a.ts': [5] }), [lcov('SF:src/a.ts\nDA:5,1\nend_of_record\n')]);
  assert.deepEqual([plain.changedFunctions, plain.files[0].functions], [null, null], 'an LCOV record without FN, FNDA or FNF records does not measure functions');
  const none = changedCoverage(changes({ 'src/a.ts': [5] }), [lcov('SF:src/a.ts\nFNF:0\nFNH:0\nDA:5,1\nend_of_record\n')]);
  assert.deepEqual([none.changedFunctions, none.files[0].functions], [{ covered: 0, total: 0 }, { covered: 0, total: 0 }], 'FNF:0 measures a file without functions');
});

test('the join is ambiguous when two functions start on one line, and missing when the analysis has no function on that line', () => {
  const report = istanbul([entry('src/a.ts', { functions: [['outer', at(3, 13, 3, 14), at(3, 13, 3, 60), 1], ['inner', at(3, 30, 3, 31), at(3, 30, 3, 58), 1],
    ['callback', at(7, 9, 7, 10), at(7, 9, 9, 1), 0], ['solo', at(11, 9, 11, 13), at(11, 20, 12, 1), 1]] })]);
  const analysis = [{ path: 'src/a.ts', name: 'outer', start: 3, end: 3 }, { path: 'src/a.ts', name: 'outer/<anonymous 1>', start: 3, end: 3 }, { path: 'src/a.ts', name: 'solo', start: 11, end: 12 },
    { path: 'src/a.ts', name: 'other', start: 11, end: 11 }];
  const joins = changedCoverage(changes({ 'src/a.ts': [3, 8, 12] }), [report], analysis).files[0].functionJoins;
  assert.deepEqual(joins.map((item) => [item.name, item.join, item.analysis]), [['outer', 'ambiguous', null], ['inner', 'ambiguous', null], ['callback', 'missing', null], ['solo', 'ambiguous', null]]);
});

test('Istanbul branches use the locations that touch a changed line, and the else of an if without an else uses the location of the if', () => {
  const report = istanbul([entry('src/a.ts', { branches: [[at(3, 2, 5, 3), 'if', [[at(3, 2, 5, 3), 0], [empty, 4]]], [at(8, 9, 8, 30), 'cond-expr', [[at(8, 16), 1], [at(8, 25), 0]]],
    [at(10, 9, 12, 30), 'binary-expr', [[at(10, 9), 1], [at(12, 9), 0]]]] })]);
  const measure = changedCoverage(changes({ 'src/a.ts': [4, 12] }), [report]);
  // The if on lines 3 to 5 has both paths on line 4. The ternary on line 8 does not change. Only the second operand of the binary expression is on line 12.
  assert.deepEqual([measure.changedBranches, measure.files[0].uncoveredBranches, measure.files[0].source], [{ covered: 1, total: 3 }, ['3:0:0', '10:2:1'], 'istanbul-json']);
});

test('for a file that an LCOV and an Istanbul report both measure, the branches and functions come from Istanbul JSON, and Code-map does not add the two', () => {
  const text = ['SF:/work/repo/src/a.ts', 'FN:1,engine', 'FNDA:1,engine', 'DA:3,1', 'DA:4,0', 'BRDA:3,0,0,1', 'BRDA:3,0,1,-', 'end_of_record', ''].join('\n');
  const report = istanbul([entry('/work/repo/src/a.ts', { statements: [[at(3, 2, 5, 3), 1], [at(4, 4), 0]], functions: [['engine', at(1, 16, 1, 22), at(1, 40, 10, 1), 1]],
    branches: [[at(3, 2, 5, 3), 'if', [[at(3, 2, 5, 3), 0], [empty, 1]]]] })]);
  const measure = changedCoverage(changes({ 'src/a.ts': [3, 4] }), [lcov(text), report]);
  // The two LCOV branches are on line 3, and the two Istanbul branches touch lines 3 and 4. Code-map counts only the Istanbul branches.
  assert.deepEqual([measure.changedLines, measure.changedBranches, measure.changedFunctions, measure.changedStatements], [{ covered: 1, total: 2 }, { covered: 1, total: 2 }, { covered: 1, total: 1 }, { covered: 1, total: 2 }]);
  assert.deepEqual([measure.files[0].source, measure.lineReports, measure.reports], ['istanbul-json', ['coverage/lcov.info'], ['coverage/lcov.info', 'coverage/coverage-final.json']]);
  const section = coverageSection(measure, { changedLines: 80, changedBranches: 70 });
  assert.deepEqual(section.changedBranches.sources, { lcov: 0, 'istanbul-json': 1 });
});

test('a file that no report measures is not measured by any measure, and a file without an Istanbul entry has no statement or Istanbul function coverage', () => {
  const report = istanbul([entry('src/a.ts', { statements: [[at(1, 0), 1]], functions: [['a', at(1, 9), at(1, 20), 1]] })]);
  const measure = changedCoverage(changes({ 'src/a.ts': [1], 'src/b.ts': [1], 'src/c.ts': [1], 'src/none.ts': [] }), [lcov('SF:src/a.ts\nDA:1,1\nend_of_record\nSF:src/b.ts\nDA:1,0\nend_of_record\n'), report]);
  assert.deepEqual([measure.total, measure.unmeasured], [3, ['src/c.ts']], 'a file without changed lines needs no measure');
  assert.deepEqual(measure.unmeasuredBy, { branches: ['src/c.ts'], statements: ['src/b.ts', 'src/c.ts'], functions: ['src/b.ts', 'src/c.ts'] });
  assert.deepEqual(measure.files.map((file) => [file.path, file.source, file.statements, file.functions]), [['src/a.ts', 'istanbul-json', { covered: 1, total: 1 }, { covered: 1, total: 1 }],
    ['src/b.ts', 'lcov', null, null]]);
});

test('the coverage section gives covered, total, share and the files that are not measured for statements, functions and branches', () => {
  const report = istanbul([entry('src/a.ts', { statements: [[at(1, 0), 1], [at(2, 0), 1], [at(3, 0), 0]], functions: [['a', at(1, 9), at(1, 20, 3, 1), 1]] })]);
  const measure = changedCoverage(changes({ 'src/a.ts': [1, 2, 3], 'src/b.ts': [4] }), [lcov('SF:src/a.ts\nDA:1,1\nDA:2,1\nDA:3,0\nend_of_record\n'), report], [{ path: 'src/a.ts', name: 'a', start: 1, end: 3 }]);
  const section = coverageSection(measure, { changedLines: 80, changedBranches: 70 });
  assert.deepEqual(section.changedStatements, { measure: 'statement coverage', covered: 2, total: 3, share: 66.6, files: { measured: 1, unmeasured: ['src/b.ts'] } });
  assert.deepEqual(section.changedFunctions, { measure: 'function coverage', covered: 1, total: 1, share: 100, files: { measured: 1, unmeasured: ['src/b.ts'] }, join: { exact: 1, ambiguous: 0, missing: 0 } });
  assert.deepEqual(section.changedBranches, { covered: 0, total: 0, share: null, threshold: 70, sources: { lcov: 0, 'istanbul-json': 1 }, files: { measured: 1, unmeasured: ['src/b.ts'] } });
  assert.deepEqual([section.measure, section.lineReports, section.files.total, section.files.measured, section.files.unmeasured], ['line coverage', ['coverage/lcov.info'], 2, 1, ['src/b.ts']]);
  const onlyLcov = coverageSection(changedCoverage(changes({ 'src/a.ts': [1] }), [lcov('SF:src/a.ts\nDA:1,1\nend_of_record\n')]), undefined);
  assert.deepEqual([onlyLcov.changedStatements, onlyLcov.changedFunctions], [null, null]);
});

test('an Istanbul report places its paths as an LCOV report does, merges two entries of one file and leaves out an entry with an input source map', () => {
  const read = istanbul([entry('/work/repo/src/a.ts', { statements: [[at(1, 0), 0]] }), entry('lib/b.ts', { statements: [[at(1, 0), 1]] }), entry('/elsewhere/c.ts'),
    entry('/work/repo/src/gen.js', { statements: [[at(1, 0), 1]] })], 'coverage/unit.json', { workingDirectory: 'packages/app' });
  const source = JSON.parse(JSON.stringify(entry('/work/repo/src/gen.js'))), mapped = istanbulCoverage(JSON.stringify({ [source.path]: { ...source, inputSourceMap: { version: 3 } } }), { repository });
  assert.deepEqual([[...read.files.keys()], read.outside, read.records], [['src/a.ts', 'packages/app/lib/b.ts', 'src/gen.js'], 1, 4]);
  assert.deepEqual([[...mapped.files.keys()], mapped.sourceMapped], [[], 1], 'the locations of a source-mapped entry are of the generated code');
  const second = istanbul([entry('/work/repo/src/a.ts', { statements: [[at(1, 0), 5]] })], 'coverage/e2e.json');
  const measure = changedCoverage(changes({ 'src/a.ts': [1] }), [read, second]);
  assert.deepEqual([measure.changedStatements, measure.reports], [{ covered: 1, total: 1 }, ['coverage/unit.json', 'coverage/e2e.json']], 'one statement, covered by the second report');
  assert.match(istanbulCoverage('{"x": 1}', { repository }).error, /"x".*Must be an object/);
});
