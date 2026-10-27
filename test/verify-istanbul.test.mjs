// Acceptance tests of bound Istanbul JSON coverage in `code-map verify` through the CLI: `code-map manifest --kind istanbul-json`
// binds coverage-final.json, and verify shows statement and function coverage of the changed code next to the line coverage of LCOV.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReport } from '../lib/verify-report.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const valid = { requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base', head: 'HEAD', intent: 'Let the engine take a flag.', acceptanceCriteria: [],
  allowedPaths: ['src/**', 'test/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
  execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } };
const engine = ['export function engine(flag: boolean) {', '  const a = 1;', '  if (flag) {', '    return a + 1;', '  }', '  const b = 2;', '  const c = 3;', '  const d = 4;', '  return a + b + c + d;', '}', ''].join('\n');
const junit = '<?xml version="1.0"?>\n<testsuites><testsuite name="test/engine.test.ts" tests="1" failures="0">'
  + '<testcase classname="test/engine.test.ts" file="test/engine.test.ts" name="engine returns ten"></testcase></testsuite></testsuites>\n';
const at = (line, column, endLine = line, endColumn = column + 12) => ({ start: { line, column }, end: { line: endLine, column: endColumn } });
/** The Istanbul entry of the engine after a run of engine(false): the return on line 4 did not run, and the if took only its else. */
const istanbulEntry = (path) => ({ path, _coverageSchema: '1a1c01bbd47fc00a2c39e90264f33305804495a9', hash: 'h',
  statementMap: { 0: at(2, 2), 1: at(3, 2, 5, 3), 2: at(4, 4), 3: at(6, 2), 4: at(7, 2), 5: at(8, 2), 6: at(9, 2) }, s: { 0: 1, 1: 1, 2: 0, 3: 1, 4: 1, 5: 1, 6: 1 },
  fnMap: { 0: { name: 'engine', decl: at(1, 16, 1, 22), loc: at(1, 39, 10, 1), line: 1 } }, f: { 0: 1 },
  branchMap: { 0: { loc: at(3, 2, 5, 3), type: 'if', locations: [at(3, 2, 5, 3), { start: {}, end: {} }], line: 3 } }, b: { 0: [0, 1] } });
const istanbul = (root) => JSON.stringify({ [join(root, 'src/core/engine.ts')]: istanbulEntry(join(root, 'src/core/engine.ts')) });
const lcov = (root) => [`SF:${join(root, 'src/core/engine.ts')}`, 'FN:1,engine', 'FNDA:1,engine', 'FNF:1', 'FNH:1', ...[1, 1, 1, 0, 0, 1, 1, 1, 1, 1].map((hits, index) => `DA:${index + 1},${hits}`),
  'BRDA:3,0,0,1', 'BRDA:3,0,1,-', 'end_of_record', ''].join('\n');

/** A committed TypeScript project with one test. Git ignores reports/ and coverage/. The tag "base" names its commit. */
function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-istanbul-')), work = mkdtempSync(join(tmpdir(), 'code-map-istanbul-work-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' }).trim();
  put('.gitignore', 'reports/\ncoverage/\n');
  put('src/core/engine.ts', 'export function engine() { return 1; }\n');
  put('test/engine.test.ts', "import { test, expect } from 'vitest';\nimport { engine } from '../src/core/engine';\ntest('engine returns ten', () => { expect(engine(false)).toBe(10); });\n");
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'base'); git('tag', 'base');
  const run = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
  /** Writes a report and its manifest with `code-map manifest`, and returns the pair for reportInputs. */
  const bind = (artifact, kind, text) => {
    put(artifact, text);
    const manifest = artifact.replace(/\.[a-z]+$/, '.manifest.json');
    const written = run(['manifest', '--artifact', artifact, '--kind', kind, '--exit-status', '0', '--out', manifest, '--', 'npx', 'vitest', 'run', '--coverage']);
    assert.equal(written.status, 0, written.stderr);
    return { artifact, manifest };
  };
  let count = 0;
  const verify = (fields) => {
    const path = join(work, `request-${count++}.json`);
    writeFileSync(path, JSON.stringify({ ...valid, ...fields }));
    const output = run(['verify', '--request', path, '--store', join(work, 'store'), '--out-dir', join(work, 'out')]);
    assert.equal(output.status, 3, output.stderr);
    const summary = JSON.parse(output.stdout);
    return { results: JSON.parse(readFileSync(summary.files.results, 'utf8')), markdown: readFileSync(summary.files.report, 'utf8') };
  };
  return { root, put, git, bind, verify };
}

const section = (markdown) => markdown.split('\n## ').find((part) => part.startsWith('Coverage of the changed code'));

test('a bound Istanbul JSON report gives statement and function coverage next to the line coverage of LCOV, and its branches replace the LCOV branches', (t) => {
  const { root, put, git, bind, verify } = project(t);
  put('src/core/engine.ts', engine);
  git('add', '.'); git('commit', '-qm', 'head');
  const tests = bind('reports/junit.xml', 'junit', junit), line = bind('coverage/lcov.info', 'lcov', lcov(root));
  const json = bind('coverage/coverage-final.json', 'istanbul-json', istanbul(root));
  assert.equal(JSON.parse(readFileSync(join(root, json.manifest), 'utf8')).artifacts[0].kind, 'istanbul-json');
  const { results, markdown } = verify({ reportInputs: [tests, line, json] });

  const execution = results.executions.find((item) => item.artifact === 'coverage/coverage-final.json');
  assert.deepEqual([execution.kind, execution.side, execution.binding, execution.eligible, execution.cases, execution.coverage], ['istanbul-json', 'head', 'BOUND', true, null, { files: 1, outside: 0, sourceMapped: 0 }]);
  const { coverage } = results;
  assert.deepEqual([coverage.reports, coverage.lineReports, coverage.changedLines], [['coverage/lcov.info', 'coverage/coverage-final.json'], ['coverage/lcov.info'], { covered: 8, total: 10, share: 80, threshold: 80 }]);
  assert.deepEqual(coverage.changedStatements, { measure: 'statement coverage', covered: 6, total: 7, share: 85.7, files: { measured: 1, unmeasured: [] } });
  assert.deepEqual(coverage.changedFunctions, { measure: 'function coverage', covered: 1, total: 1, share: 100, files: { measured: 1, unmeasured: [] }, join: { exact: 1, ambiguous: 0, missing: 0 } });
  assert.deepEqual(coverage.changedBranches, { covered: 1, total: 2, share: 50, threshold: 70, sources: { lcov: 0, 'istanbul-json': 1 }, files: { measured: 1, unmeasured: [] } }, 'the branches are not added together');
  const [file] = coverage.files.details;
  assert.deepEqual([file.source, file.uncoveredStatements, file.uncoveredBranches, file.functionJoins], ['istanbul-json', [4], ['3:0:0'], [{ name: 'engine', line: 1, covered: true, join: 'exact', analysis: 'engine' }]]);
  assert.deepEqual([results.ratings.verificationCoverage.state, results.ratings.verificationCoverage.value], ['RATED', 3], 'statement and function coverage are not rating conditions');

  const text = section(markdown);
  for (const pattern of [/\| Changed executable lines \(line coverage\) \| 8 of 10 \| 80% \| 80% \| 0 files \|/, /\| Changed branches \| 1 of 2 \| 50% \| 70% \| 0 files \|/,
    /\| Changed statements \(statement coverage\) \| 6 of 7 \| 85\.7% \| None \| 0 files \|/, /\| Changed functions \(function coverage\) \| 1 of 1 \| 100% \| None \| 0 files \|/,
    /no rating condition uses them/, /branches and functions of 1 changed code file from Istanbul JSON/, /joined 1 of 1 changed function to one function of the head analysis/]) assert.match(text, pattern);
  assert.match(markdown, /`coverage\/coverage-final\.json` \(istanbul-json\) \| Head \| Yes, self-attested \| Coverage of 1 file \|/);
  assert.doesNotMatch(text, /[;—]|\b(should|may|might|could)\b/i);

  // The longest report: full lists of checks, reports, limits and gaps, and a coverage section with every row and paragraph.
  const many = (total, make) => Array.from({ length: total }, (_, index) => make(index)), [first] = results.obligations;
  const long = renderReport({ ...results, intent: 'many words '.repeat(200), limits: many(30, (index) => `Limit ${index}.`), gaps: many(30, (index) => ({ key: `g${index}`, source: 'graph', text: `Gap ${index}.` })),
    obligations: [...many(45, (index) => ({ ...first, id: `f.${index}`, result: 'FAIL', eligible: true, applicability: 'APPLICABLE' })), ...many(45, (index) => ({ ...first, id: `u.${index}`, result: 'UNKNOWN', eligible: false }))],
    executions: many(30, (index) => ({ ...execution, artifact: `r${index}.json` })), coverage: { ...coverage, outsideRepository: 3,
      changedStatements: { ...coverage.changedStatements, files: { measured: 10, unmeasured: many(50, (index) => `src/s${index}.ts`) } },
      changedFunctions: { ...coverage.changedFunctions, join: { exact: 1, ambiguous: 4, missing: 5 }, files: { measured: 30, unmeasured: many(50, (index) => `src/n${index}.ts`) } },
      changedBranches: { ...coverage.changedBranches, files: { measured: 20, unmeasured: many(50, (index) => `src/b${index}.ts`) } },
      files: { ...coverage.files, total: 80, measured: 20, unmeasured: many(50, (index) => `src/f${index}.ts`) } } });
  assert.match(long, /Statement coverage does not measure 70 changed code files: `src\/s0\.ts`.* and 60 more\. Function coverage does not measure 50 changed code files/);
  assert.match(long, /Branch coverage does not measure 60 changed code files: `src\/b0\.ts`.* and 50 more\./);
  assert.ok(long.split('\n').length <= 200, `${long.split('\n').length} lines`);
  const manyMaps = renderReport({ ...results, coverageEvidence: { ...results.coverageEvidence,
    mapping: many(64, (index) => ({ artifact: `coverage/${index}.json`, entries: 1, unmapped: 1, errors: [] })) },
    obligations: many(90, (index) => ({ ...first, id: `unknown.${index}`, result: 'UNKNOWN', eligible: false })),
    executions: many(64, () => execution), gaps: many(30, (index) => ({ key: `gap.${index}`, text: 'Gap.' })) });
  assert.ok(manyMaps.split('\n').length <= 200, `${manyMaps.split('\n').length} lines with source maps`);
});

test('an Istanbul JSON report alone gives no line coverage, so Verification Coverage stays Unassessed, and the results show the files without an entry', (t) => {
  const { root, put, bind, verify } = project(t);
  put('src/core/engine.ts', engine);
  put('src/core/extra.ts', 'export const extra = 1;\n');
  // The entry of extra.ts still has an input source map, so Code-map leaves it out and counts it.
  const report = JSON.parse(istanbul(root)), mapped = join(root, 'src/core/extra.ts');
  report[mapped] = { ...istanbulEntry(mapped), inputSourceMap: { version: 3, sources: ['extra.ts'], mappings: '' } };
  const tests = bind('reports/junit.xml', 'junit', junit), json = bind('coverage/coverage-final.json', 'istanbul-json', JSON.stringify(report));
  const { results, markdown } = verify({ head: 'worktree', reportInputs: [tests, json] });
  const { coverage } = results, rating = results.ratings.verificationCoverage;
  assert.deepEqual(results.executions.find((item) => item.artifact === 'coverage/coverage-final.json').coverage, { files: 1, outside: 0, sourceMapped: 1 });
  assert.match(markdown, /\| Coverage of 1 file, 1 entry with a source map excluded from ratings \|/);
  assert.match(section(markdown), /Statement coverage does not measure 1 changed code file: `src\/core\/extra\.ts`\. Function coverage does not measure 1 changed code file: `src\/core\/extra\.ts`\./);
  assert.deepEqual([coverage.lineReports, coverage.changedLines.total, coverage.files.measured, coverage.files.unmeasured], [[], 0, 0, ['src/core/engine.ts', 'src/core/extra.ts']]);
  assert.deepEqual([coverage.changedStatements.covered, coverage.changedStatements.total, coverage.changedStatements.files], [6, 7, { measured: 1, unmeasured: ['src/core/extra.ts'] }]);
  assert.deepEqual([rating.state, rating.missingEvidence], ['UNASSESSED', ['A bound line-coverage report of the head']]);
  assert.match(section(markdown), /No bound LCOV report of the head exists, so Code-map has no line coverage of the changed code\./);
  assert.match(section(markdown), /\| Changed statements \(statement coverage\) \| 6 of 7 \| 85\.7% \| None \| 1 file \|/);
});

test('an Istanbul JSON report with counts that do not match its map, or without a file entry, does not count, and the results say why', (t) => {
  const { root, put, bind, verify } = project(t);
  put('src/core/engine.ts', engine);
  const broken = JSON.parse(istanbul(root)), [path] = Object.keys(broken);
  broken[path].b = { 0: [1] };
  const tests = bind('reports/junit.xml', 'junit', junit), bad = bind('coverage/broken.json', 'istanbul-json', JSON.stringify(broken)), none = bind('coverage/empty.json', 'istanbul-json', '{}');
  const { results } = verify({ head: 'worktree', reportInputs: [tests, bad, none] });
  const records = Object.fromEntries(results.executions.map((item) => [item.artifact, item]));
  for (const artifact of ['coverage/broken.json', 'coverage/empty.json']) assert.deepEqual([records[artifact].binding, records[artifact].eligible, records[artifact].reasons.map((reason) => reason.key)], ['BOUND', false, ['parse']]);
  assert.match(records['coverage/broken.json'].reasons[0].message, /^Code-map cannot read the report: .*\.b\["0"\]: Must be an array of 2 counts/);
  assert.match(records['coverage/empty.json'].reasons[0].message, /no file entry/);
  assert.equal(results.coverage, null);
});

test('mapped counters and AST columns appear as information while v0 rating inputs stay unchanged', (t) => {
  const { put, git, bind, verify } = project(t);
  put('src/core/engine.ts', 'export function engine() { return 1; } export function other() { return 2; }\n');
  git('add', '.'); git('commit', '-qm', 'head');
  const baseline = verify({ reportInputs: [] });
  const path = 'dist/engine.js', entry = { path, statementMap: { 0: at(1, 0, 1, 0) }, s: { 0: 0 },
    fnMap: { 0: { name: 'engine', decl: at(1, 0, 1, 0), loc: at(1, 0, 1, 0) },
      1: { name: 'other', decl: at(1, 1, 1, 1), loc: at(1, 1, 1, 1) } }, f: { 0: 0, 1: 1 },
    branchMap: {}, b: {}, inputSourceMap: { version: 3, sources: ['../src/core/engine.ts'], mappings: 'AAAgB,CAAuC' } };
  const json = bind('coverage/mapped.json', 'istanbul-json', JSON.stringify({ [path]: entry }));
  const { results } = verify({ reportInputs: [json] });
  assert.equal(results.coverageEvidence.changed.changedFunctions.join.exact, 2);
  assert.deepEqual(results.coverageEvidence.unexecutedExports.details, [{ path: 'src/core/engine.ts', name: 'engine', line: 1 }]);
  assert.deepEqual(results.ratings, baseline.results.ratings);
  assert.deepEqual(results.obligations, baseline.results.obligations);
});
