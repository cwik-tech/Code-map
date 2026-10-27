// Acceptance tests of bound LCOV coverage in `code-map verify` through the CLI: `code-map manifest --kind lcov` binds the report,
// verify maps the changed lines of the head to its DA and BRDA records, and the results and the report show the line coverage.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const valid = { requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base', head: 'HEAD', intent: 'Let the engine take a flag.', acceptanceCriteria: [],
  allowedPaths: ['src/**', 'test/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
  execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } };
const engine = ['export function engine(flag: boolean) {', '  const a = 1;', '  if (flag) {', '    return a + 1;', '  }', '  const b = 2;', '  const c = 3;', '  const d = 4;', '  return a + b + c + d;', '}', ''].join('\n');
const junit = '<?xml version="1.0"?>\n<testsuites><testsuite name="test/engine.test.ts" tests="1" failures="0">'
  + '<testcase classname="test/engine.test.ts" file="test/engine.test.ts" name="engine returns one"></testcase></testsuite></testsuites>\n';

/** A committed TypeScript project with one test. Git ignores reports/ and coverage/. The tag "base" names its commit. */
function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-coverage-')), work = mkdtempSync(join(tmpdir(), 'code-map-coverage-work-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' }).trim();
  put('.gitignore', 'reports/\ncoverage/\n');
  put('src/core/engine.ts', 'export function engine() { return 1; }\n');
  put('test/engine.test.ts', "import { test, expect } from 'vitest';\nimport { engine } from '../src/core/engine';\ntest('engine returns one', () => { expect(engine(false)).toBe(10); });\n");
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

/** An LCOV record. `root` gives absolute SF paths, as Jest, c8 and nyc write them. */
const record = (path, hits, branches = []) => [`SF:${path}`, ...hits.map((count, index) => `DA:${index + 1},${count}`),
  ...branches.map(([line, branch, taken]) => `BRDA:${line},0,${branch},${taken}`), `LF:${hits.length}`, `LH:${hits.filter((count) => count > 0).length}`, 'end_of_record'].join('\n');

test('a bound LCOV report of the head gives line coverage of the changed lines: 80% lets Verification Coverage reach 3 of 5', (t) => {
  const { root, put, git, bind, verify } = project(t);
  put('src/core/engine.ts', engine);
  git('add', '.'); git('commit', '-qm', 'head');
  const tests = bind('reports/junit.xml', 'junit', junit);
  // Lines 4 and 5 did not run, and one of the two branches on line 3 was not taken. The record outside the repository does not count.
  const coverage = bind('coverage/lcov.info', 'lcov', `TN:\n${record(join(root, 'src/core/engine.ts'), [1, 1, 1, 0, 0, 1, 1, 1, 1, 1], [[3, 0, 1], [3, 1, '-']])}\n`
    + `${record('test/engine.test.ts', [1, 1, 1])}\n${record('/elsewhere/lib.ts', [1])}\n`);
  assert.equal(JSON.parse(readFileSync(join(root, coverage.manifest), 'utf8')).artifacts[0].kind, 'lcov');
  const { results, markdown } = verify({ reportInputs: [tests, coverage] });

  const lcov = results.executions.find((item) => item.artifact === 'coverage/lcov.info');
  assert.deepEqual([lcov.kind, lcov.side, lcov.binding, lcov.eligible, lcov.cases, lcov.coverage], ['lcov', 'head', 'BOUND', true, null, { files: 2, outside: 1 }]);
  assert.deepEqual(results.coverage, { measure: 'line coverage', reports: ['coverage/lcov.info'], lineReports: ['coverage/lcov.info'],
    changedLines: { covered: 8, total: 10, share: 80, threshold: 80 },
    changedBranches: { covered: 1, total: 2, share: 50, threshold: 70, sources: { lcov: 1, 'istanbul-json': 0 }, files: { measured: 1, unmeasured: [] } },
    changedStatements: null, changedFunctions: null,
    files: { total: 1, measured: 1, unmeasured: [], details: [{ path: 'src/core/engine.ts', source: 'lcov', lines: { covered: 8, total: 10 }, branches: { covered: 1, total: 2 },
      statements: null, functions: null, uncoveredLines: [4, 5], uncoveredBranches: ['3:0:1'], uncoveredStatements: [], functionJoins: [] }] },
    outsideRepository: 1 });
  assert.deepEqual([results.ratings.verificationCoverage.state, results.ratings.verificationCoverage.value], ['RATED', 3]);
  assert.ok(!results.limits.some((text) => /cannot bind a coverage report/.test(text)), JSON.stringify(results.limits));

  const section = markdown.split('\n## ').find((part) => part.startsWith('Coverage of the changed code'));
  assert.ok(section, 'the report has a section for the coverage');
  for (const pattern of [/\| Changed executable lines \(line coverage\) \| 8 of 10 \| 80% \| 80% \|/, /\| Changed branches \| 1 of 2 \| 50% \| 70% \|/, /`coverage\/lcov\.info`/, /1 record of the coverage reports is outside the repository/]) {
    assert.match(section, pattern);
  }
  assert.match(markdown, /`coverage\/lcov\.info` \(lcov\) \| Head \| Yes, self-attested \| Coverage of 2 files \|/);
  assert.match(markdown, /\| Reports \| 2 reports\. 2 reports count as evidence\. \|/);
  // The coverage gap of the head analysis is about the working-folder coverage of inspect, so it names the bound reports instead.
  assert.match(results.gaps.find((gap) => gap.key === 'coverage').text, /comes only from the bound coverage reports of the request/);
  assert.doesNotMatch(markdown, /coverage is not used|No coverage report was found/);
  assert.doesNotMatch(markdown, /statement coverage/i);
  assert.doesNotMatch(section, /[;—]|\b(should|may|might|could)\b/i);
});

test('a changed file without an SF record is not measured, a base coverage report gives no coverage, and no head report leaves Verification Coverage Unassessed', (t) => {
  const { root, put, bind, verify } = project(t);
  const base = bind('coverage/base.info', 'lcov', `${record(join(root, 'src/core/engine.ts'), [1])}\n`);
  put('src/core/engine.ts', engine);
  put('src/core/extra.ts', 'export const extra = 1;\nexport const more = 2;\n');
  const tests = bind('reports/junit.xml', 'junit', junit);
  const coverage = bind('coverage/lcov.info', 'lcov', `${record('src/core/engine.ts', Array(10).fill(1), [[3, 0, 1], [3, 1, 1]])}\n`);
  const { results, markdown } = verify({ head: 'worktree', reportInputs: [tests, coverage, base] });
  const executions = Object.fromEntries(results.executions.map((item) => [item.artifact, item]));
  assert.deepEqual([executions['coverage/base.info'].side, executions['coverage/base.info'].binding, executions['coverage/base.info'].eligible], ['base', 'BOUND', false]);
  assert.deepEqual(executions['coverage/base.info'].reasons.map((reason) => reason.key), ['side']);
  assert.deepEqual([results.coverage.reports, results.coverage.changedLines.covered, results.coverage.files.unmeasured], [['coverage/lcov.info'], 10, ['src/core/extra.ts']]);
  assert.deepEqual([results.ratings.verificationCoverage.value, results.ratings.verificationCoverage.predicates.unmet], [2, ['vc.changed-lines-80', 'vc.changed-branches-70']]);
  assert.match(markdown, /1 changed code file has no SF record in the LCOV reports: `src\/core\/extra\.ts`\. Code-map counts it as not measured, never as covered/);

  const none = verify({ head: 'worktree', reportInputs: [tests] });
  assert.equal(none.results.coverage, null);
  assert.equal(none.results.ratings.verificationCoverage.state, 'UNASSESSED');
  assert.match(none.markdown, /No bound coverage report of the head exists/);
  assert.match(none.results.gaps.find((gap) => gap.key === 'coverage').text, /^Coverage comes from coverage\/lcov\.info/, 'without a bound report, the gap of inspect stays');
});

test('a report of the kind lcov without an SF record does not count, and the results say why', (t) => {
  const { put, bind, verify } = project(t);
  put('src/core/engine.ts', engine);
  const tests = bind('reports/junit.xml', 'junit', junit), coverage = bind('coverage/lcov.info', 'lcov', '<testsuites/>\n');
  const { results } = verify({ head: 'worktree', reportInputs: [tests, coverage] });
  const lcov = results.executions.find((item) => item.artifact === 'coverage/lcov.info');
  assert.deepEqual([lcov.binding, lcov.eligible, lcov.reasons.map((reason) => reason.key)], ['BOUND', false, ['parse']]);
  assert.equal(results.coverage, null);
});

test('verify reports measured export gaps, project totals and coverage lost after an insertion', (t) => {
  const { put, git, bind, verify } = project(t);
  const base = bind('coverage/base.info', 'lcov', 'SF:src/core/engine.ts\nDA:1,1\nBRDA:1,0,0,1\nend_of_record\n');
  put('src/core/engine.ts', '// inserted\nexport function engine() { return 1; }\n');
  git('add', '.'); git('commit', '-qm', 'head');
  const head = bind('coverage/head.info', 'lcov', 'SF:src/core/engine.ts\nDA:2,0\nBRDA:2,0,0,0\nFN:2,engine\nFNDA:0,engine\nend_of_record\n');
  const { results, markdown } = verify({ reportInputs: [base, head] });
  assert.deepEqual(results.coverageEvidence.lost.totals, { lines: 1, branches: 1 });
  assert.deepEqual(results.coverageEvidence.project.totals.functions, { covered: 0, total: 1 });
  assert.deepEqual(results.coverageEvidence.unexecutedExports.details, [{ path: 'src/core/engine.ts', name: 'engine', line: 2 }]);
  assert.match(markdown, /coverage lost on unchanged lines/);
  assert.match(markdown, /measured function hits/);
  assert.equal(results.profileId, 'static-baseline-v0');
});
