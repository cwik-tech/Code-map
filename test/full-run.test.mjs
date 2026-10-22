import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiFingerprint } from '../lib/descriptions.mjs';
import { fileHash } from '../lib/mutation.mjs';
import { testHash } from '../lib/test-labels.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const source = "export function twice(x) {\n  if (x < 0) throw new Error('negative');\n  return x * 2;\n}\n";
const tests = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { twice } from '../src/a.mjs';\ntest('doubles', () => assert.equal(twice(2), 4));\ntest('rejects negative', () => assert.throws(() => twice(-1), /negative/));\n";

function fixture(t, enriched = true) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-full-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'test')); mkdirSync(join(root, 'docs/code-map'), { recursive: true });
  writeFileSync(join(root, 'src/a.mjs'), source); writeFileSync(join(root, 'test/a.test.mjs'), tests);
  if (enriched) {
    writeFileSync(join(root, 'docs/code-map/descriptions.json'), JSON.stringify({ files: { 'src/a.mjs': {
      summary: 'Doubles a nonnegative number.', api: apiFingerprint({ exports: ['twice'] }), sourceHash: fileHash(source) } } }));
    writeFileSync(join(root, 'docs/code-map/test-labels.json'), JSON.stringify({ files: { 'test/a.test.mjs': {
      hash: testHash(tests), cases: { doubles: { intent: 'happy' }, 'rejects negative': { intent: 'unhappy' } } } } }));
  }
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args]);
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'fixture');
  return root;
}

function run(root, args = []) {
  const env = { ...process.env, CODE_MAP_CLAUDE: join(root, 'missing-claude') };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8', timeout: 25000 });
}

test('default run verifies tests and all eligible mutants, builds the map, and reuses unchanged results', (t) => {
  const root = fixture(t);
  const first = run(root);
  assert.equal(first.status, 0, first.stderr);
  const reportPath = join(root, 'docs/code-map/mutation.json');
  assert.equal(existsSync(reportPath), true, 'the default command must run mutation checks');
  const original = readFileSync(reportPath, 'utf8'), report = JSON.parse(original);
  assert.equal(report.workflow.complete, true);
  assert.equal(report.workflow.tests[0].passed, 2);
  assert.deepEqual(report.files['src/a.mjs'].mutants.map(item => item.status), ['detected', 'detected']);
  assert.match(readFileSync(join(root, 'coverage/lcov.info'), 'utf8'), /SF:src\/a.mjs/);
  const page = readFileSync(join(root, 'docs/code-map/code-map.html'), 'utf8');
  assert.match(page, /Doubles a nonnegative number/);
  assert.match(page, /"intent":"unhappy"/);
  const second = run(root);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stderr, /unchanged.*reus/i);
  assert.equal(readFileSync(reportPath, 'utf8'), original);

  const forced = run(root, ['all', '--force']);
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(forced.stderr, /Verifying/);
  assert.doesNotMatch(forced.stderr, /reusing test and mutation/);

  rmSync(join(root, 'coverage/lcov.info'));
  const missingCoverage = run(root);
  assert.equal(missingCoverage.status, 0, missingCoverage.stderr);
  assert.match(missingCoverage.stderr, /Verifying/);

  writeFileSync(join(root, 'test/a.test.mjs'), tests.replace('4)', '5)'));
  const changed = run(root);
  assert.notEqual(changed.status, 0, 'changed tests must invalidate the execution cache');
  assert.match(changed.stderr, /test.*fail/i);
});

test('an explicit mutation budget never caches unchecked candidates as a complete run', (t) => {
  const root = fixture(t);
  const result = run(root, ['all', '--max-mutants', '1']);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /incomplete/i);
  const report = JSON.parse(readFileSync(join(root, 'docs/code-map/mutation.json'), 'utf8'));
  assert.equal(report.workflow.complete, false);
  assert.equal(report.units[0].status, 'partial');
  assert.equal(existsSync(join(root, 'docs/code-map/code-map.html')), false);
});

test('committing unchanged code and editing documentation preserve verified execution results', (t) => {
  const root = fixture(t);
  const first = run(root);
  assert.equal(first.status, 0, first.stderr);
  const receipt = readFileSync(join(root, 'docs/code-map/mutation.json'), 'utf8');
  writeFileSync(join(root, 'README.md'), 'Updated instructions.\n');
  writeFileSync(join(root, 'docs/status.md'), 'Updated evidence.\n');
  execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'documentation and generated artifacts']);
  const next = run(root);
  assert.equal(next.status, 0, next.stderr);
  assert.match(next.stderr, /unchanged.*reus/i);
  assert.equal(readFileSync(join(root, 'docs/code-map/mutation.json'), 'utf8'), receipt);
});

test('explicit documentation inputs invalidate execution receipts when their content changes', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, '.code-map.json'), JSON.stringify({ executionInputs: ['docs/template.md'] }));
  writeFileSync(join(root, 'docs/template.md'), 'first template');
  const first = run(root);
  assert.equal(first.status, 0, first.stderr);
  const before = JSON.parse(readFileSync(join(root, 'docs/code-map/mutation.json'), 'utf8')).workflow.fingerprint;
  writeFileSync(join(root, 'docs/template.md'), 'changed template');
  const next = run(root);
  assert.equal(next.status, 0, next.stderr);
  assert.match(next.stderr, /Verifying/);
  assert.notEqual(JSON.parse(readFileSync(join(root, 'docs/code-map/mutation.json'), 'utf8')).workflow.fingerprint, before);
});

test('a first run reports unavailable enrichment instead of silently claiming a complete map', (t) => {
  const root = fixture(t, false);
  const result = run(root);
  assert.equal(result.status, 1, 'an unavailable model must exit itself, without waiting for the caller timeout');
  assert.match(result.stderr, /Claude.*(unavailable|not found)|enrichment.*failed/i);
  assert.equal(existsSync(join(root, 'docs/code-map/mutation.json')), false);
  const quick = run(root, ['build', '--worktree']);
  assert.equal(quick.status, 0, quick.stderr);
  assert.equal(existsSync(join(root, 'docs/code-map/code-map.html')), true);
});
