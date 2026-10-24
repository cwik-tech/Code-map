import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildManifest } from '../lib/manifest.mjs';
import { loadConfig } from '../lib/project.mjs';
import { runVerify } from '../lib/verify.mjs';

function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'trace-c08-')), work = mkdtempSync(join(tmpdir(), 'trace-c08-out-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  put('.gitignore', 'coverage/\n');
  put('src/a.js', "export { b } from './b.js';\nexport const a = 1;\n");
  put('src/b.js', 'export const b = 2;\n');
  put('src/c.js', 'export const c = 3;\n');
  put('test/a.test.js', "import { test } from 'node:test';\nimport { a } from '../src/a.js';\ntest('a', () => {});\n");
  put('test/other.test.js', "import { test } from 'node:test';\ntest('other', () => {});\n");
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@local', 'commit', '-qm', 'fixture'], { cwd: root });
  const config = loadConfig(root);
  const bind = (kind, text, discovery, stale = false) => {
    const artifact = `coverage/${kind}.txt`, manifest = `coverage/${kind}.manifest.json`;
    put(artifact, text);
    const run = buildManifest(root, config, { artifact, kind, exitStatus: '0', command: ['node', '--test', 'test/a.test.js'], filters: [] });
    run.discovery = discovery;
    if (stale) run.config = '0'.repeat(64);
    put(manifest, JSON.stringify(run));
    return { artifact, manifest };
  };
  const verify = (reportInputs = []) => {
    const request = join(work, 'request.json');
    writeFileSync(request, JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1, base: 'HEAD', head: 'worktree',
      intent: 'Compare runtime test links.', acceptanceCriteria: [], allowedPaths: ['**'], changeType: 'other',
      profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs,
      execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } }));
    const result = runVerify(root, config, { request, store: join(work, 'store'), 'out-dir': join(work, 'out') });
    return { results: result.results, markdown: readFileSync(result.paths.markdownPath, 'utf8') };
  };
  return { bind, verify };
}
const lcov = 'SF:src/a.js\nDA:1,1\nend_of_record\nSF:src/b.js\nDA:1,0\nend_of_record\nSF:src/c.js\nDA:1,1\nend_of_record\nSF:test/a.test.js\nDA:1,1\nend_of_record\nSF:/outside.js\nDA:1,1\nend_of_record\n';
const links = [{ path: 'src/a.js', state: 'confirmed' }, { path: 'src/b.js', state: 'not observed' }, { path: 'src/c.js', state: 'runtime only' }];

test('runtime traces confirm, refute and add static test links', (t) => {
  const { bind, verify } = project(t);
  const unfiltered = bind('lcov', lcov, { scope: 'tests', filters: [] });
  const before = verify([unfiltered]);
  const report = bind('lcov', lcov, { scope: 'tests', filters: ['test/a.test.js'] });
  const { results, markdown } = verify([report]);
  assert.equal(results.tests.runtimeLinks.state, 'KNOWN');
  assert.deepEqual(results.tests.runtimeLinks.files, [{ path: 'test/a.test.js', state: 'KNOWN', reason: null, reports: [report.artifact], links, linkTotal: 3 }]);
  assert.deepEqual(results.tests.runtimeLinks.counts, { confirmed: 1, 'not observed': 1, 'runtime only': 1 });
  assert.equal(results.tests.runtimeLinks.untraced, 1);
  assert.match(markdown, /Runtime test links: 1 confirmed, 1 not observed and 1 runtime only/);
  assert.deepEqual(results.ratings, before.results.ratings);
  assert.deepEqual(results.obligations, before.results.obligations);
  assert.equal(before.results.tests.runtimeLinks.state, 'UNKNOWN');
  assert.match(before.markdown, /Runtime test links are UNKNOWN/);
});

test('Istanbul statements validate a single selected test file', (t) => {
  const { bind, verify } = project(t);
  const entry = (path, hits) => ({ path, statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } } }, s: { 0: hits }, fnMap: {}, f: {}, branchMap: {}, b: {} });
  const report = bind('istanbul-json', JSON.stringify({ 'src/a.js': entry('src/a.js', 1), 'src/b.js': entry('src/b.js', 0), 'src/c.js': entry('src/c.js', 2) }),
    { scope: 'tests', filters: [], selection: { policy: 'impact-v1', state: 'KNOWN', reason: 'Selected one test.', sources: ['src/a.js'], files: ['test/a.test.js'], total: 1 } });
  assert.deepEqual(verify([report]).results.tests.runtimeLinks.files[0].links, links);
});

for (const [name, discovery, stale] of [
  ['unfiltered reports', { scope: 'test/a.test.js', filters: [] }, false],
  ['multiple test files', { scope: 'tests', filters: ['test/a.test.js', 'test/other.test.js'] }, false],
  ['test name filters', { scope: 'tests', filters: ['a'] }, false],
  ['conflicting selections', { scope: 'tests', filters: ['test/other.test.js'], selection: { policy: 'impact-v1', state: 'KNOWN', reason: 'Selected one test.', sources: [], files: ['test/a.test.js'], total: 1 } }, false],
  ['stale reports', { scope: 'tests', filters: ['test/a.test.js'] }, true],
]) test(`${name} do not establish a runtime test link`, (t) => {
  const { bind, verify } = project(t);
  const report = bind('lcov', lcov, discovery, stale);
  const { results } = verify([report]);
  assert.equal(results.tests.runtimeLinks.state, 'UNKNOWN');
  assert.deepEqual(results.tests.runtimeLinks.files, []);
  assert.equal(results.tests.runtimeLinks.untraced, 2);
  assert.match(results.tests.runtimeLinks.reason, /No bound.*single test file/);
});
