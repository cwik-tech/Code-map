// Human review records and the real CLI against a temporary Git repository.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readReviews, writeReviews, validateReviews } from '../lib/weakening-reviews.mjs';
import { testChanges } from '../lib/test-changes.mjs';
import { changedFiles } from '../lib/verify-change.mjs';
import { evaluateProfile as v0 } from '../lib/profiles/static-baseline-v0.mjs';
import { evaluateProfile as v1 } from '../lib/profiles/evidence-v1.mjs';
import { runVerify } from '../lib/verify.mjs';
import { loadConfig } from '../lib/project.mjs';
import { request } from './profile-fixtures.mjs';
import { context } from './evidence-v1-fixtures.mjs';
const cli = resolve('bin/code-map.mjs');
const source = (matcher) => `import { test, expect } from 'vitest';\n// fixture context 1\n// fixture context 2\n// fixture context 3\n// fixture context 4\ntest('works', () => { expect(1).${matcher}; });\n`;
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'weakening-review-')), store = mkdtempSync(join(tmpdir(), 'weakening-store-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); });
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@local', ...args], { encoding: 'utf8' }).trim();
  mkdirSync(join(root, 'test')); writeFileSync(join(root, 'test/a.test.ts'), source('toBe(1)'));
  writeFileSync(join(root, 'jest.config.js'), 'module.exports = { bail: 0 };');
  git('init', '-qb', 'main'); git('add', '.'); git('commit', '-qm', 'base');
  const baseSha = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'test/a.test.ts'), source('toBeTruthy()'));
  writeFileSync(join(root, 'jest.config.js'), 'module.exports = { bail: 1 };');
  const analysis = { tests: { testFiles: [{ path: 'test/a.test.ts', kind: 'tests' }] } };
  const changes = () => testChanges(root, { baseSha, headSha: null, change: changedFiles(root, baseSha, null), baseAnalysis: analysis, headAnalysis: analysis });
  return { root, git, changes, store };
}
const check = (evaluate, tests) => evaluate(context({ tests })).obligations.find((x) => x.id === 'completeness.tests-not-weakened').result;
test('v1 requires every assertion and runner review while v0 results stay unchanged', (t) => {
  const { root, changes } = fixture(t), first = changes();
  assert.equal(check(v0, first), 'PASS');
  assert.equal(check(v1, first), 'FAIL');
  const entries = first.reviews.entries;
  assert.equal(entries.length, 2);
  const records = entries.map((x) => ({ id: x.id, file: x.path, digest: x.digest, reason: 'Intentional change.', reviewedBy: 'Human', date: '2026-10-23' }));
  writeReviews(root, records.slice(0, 1), null);
  assert.equal(check(v1, changes()), 'FAIL');
  writeReviews(root, records, readReviews(root).digest);
  assert.equal(check(v1, changes()), 'PASS');
  assert.equal(check(v0, changes()), 'PASS');
  writeFileSync(join(root, 'test/a.test.ts'), source('toBeTruthy()') + '// changed\n');
  const stale = changes();
  assert.equal(stale.reviews.entries.find((x) => x.path === 'test/a.test.ts').review.stale, true);
  assert.equal(check(v1, stale), 'FAIL');
});
test('the command requires a named reviewer and records only a current weakening ID', (t) => {
  const { root, changes, store } = fixture(t), id = changes().reviews.entries[0].id;
  const run = (...args) => spawnSync(process.execPath, [cli, 'review-weakening', '--entry', id, '--reason', 'Intentional.', '--store', store, ...args], { cwd: root, encoding: 'utf8' });
  const missing = run();
  assert.equal(missing.status, 1); assert.match(missing.stderr, /reviewed-by/);
  const good = run('--reviewed-by', 'Human');
  assert.equal(good.status, 0, good.stderr);
  assert.equal(readReviews(root).entries[0].id, id);
  const bad = run('--reviewed-by', 'Human', '--entry', 'weakening:' + '0'.repeat(64));
  assert.equal(bad.status, 1); assert.match(bad.stderr, /current weakening/);
});
test('invalid, duplicate and unsafe review records fail validation and cannot be read', (t) => {
  const { root, changes } = fixture(t), x = changes().reviews.entries[0];
  const record = { id: x.id, file: x.path, digest: x.digest, reason: 'Intentional.', reviewedBy: 'Human', date: '2026-10-23' };
  assert.equal(validateReviews({ reviewsVersion: 1, entries: [record] }).ok, true);
  assert.equal(validateReviews({ reviewsVersion: 1, entries: [record, record] }).ok, false);
  assert.equal(validateReviews({ reviewsVersion: 1, entries: [{ ...record, file: '../outside' }] }).ok, false);
  assert.equal(validateReviews({ reviewsVersion: 1, entries: [{ ...record, date: '2026-02-30' }] }).ok, false);
  assert.equal(validateReviews({ reviewsVersion: 1, entries: [{ ...record, reviewedBy: '' }] }).ok, false);
  mkdirSync(join(root, '.code-map'));
  writeFileSync(join(root, '.code-map/reviews.json'), '{');
  assert.throws(() => readReviews(root), /JSON/);
  assert.equal(check(v0, changes()), 'PASS');
  assert.equal(check(v1, changes()), 'FAIL');
});

test('review IDs survive a head rename', (t) => {
  const { root, git, changes } = fixture(t);
  const first = changes().reviews.entries.find((x) => x.type === 'assertion').id;
  git('mv', 'test/a.test.ts', 'test/moved.test.ts');
  const scanned = (path) => ({ tests: { testFiles: [{ path, kind: 'tests' }] } });
  const moved = testChanges(root, { baseSha: git('rev-parse', 'HEAD'), headSha: null,
    change: changedFiles(root, git('rev-parse', 'HEAD'), null),
    baseAnalysis: scanned('test/a.test.ts'), headAnalysis: scanned('test/moved.test.ts') });
  assert.equal(moved.reviews.entries.find((x) => x.type === 'assertion').id, first);
});
test('deleted runner files can receive a review that becomes stale when the file returns', (t) => {
  const { root, store } = fixture(t);
  rmSync(join(root, 'jest.config.js'));
  // Removing bail is stronger. Use a removed threshold to establish a real weakening.
  writeFileSync(join(root, 'jest.config.js'), 'module.exports = { coverageThreshold: { global: { lines: 80 } } };');
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@local', ...args], { encoding: 'utf8' }).trim();
  git('add', 'jest.config.js'); git('commit', '-qm', 'threshold');
  const baseSha = git('rev-parse', 'HEAD');
  rmSync(join(root, 'jest.config.js'));
  const empty = { tests: { testFiles: [] } };
  const result = testChanges(root, { baseSha, headSha: null, change: changedFiles(root, baseSha, null), baseAnalysis: empty, headAnalysis: empty });
  const entry = result.reviews.entries.find((x) => x.type === 'runner');
  const out = spawnSync(process.execPath, [cli, 'review-weakening', '--entry', entry.id, '--reason', 'Retired runner.', '--reviewed-by', 'Human', '--store', store], { cwd: root, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(check(v1, testChanges(root, { baseSha, headSha: null, change: changedFiles(root, baseSha, null), baseAnalysis: empty, headAnalysis: empty })), 'PASS');
  writeFileSync(join(root, 'jest.config.js'), 'module.exports = {};');
  const restored = testChanges(root, { baseSha, headSha: null, change: changedFiles(root, baseSha, null), baseAnalysis: empty, headAnalysis: empty });
  assert.equal(restored.reviews.entries[0].review.stale, true);
  assert.equal(check(v1, restored), 'FAIL');
});

test('verify uses current reviews on a worktree and binds committed heads to their own bytes', (t) => {
  const { root, git } = fixture(t), work = mkdtempSync(join(tmpdir(), 'review-verify-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const path = join(work, 'request.json'), store = join(work, 'store');
  const verify = (profileId, head = 'worktree') => {
    writeFileSync(path, JSON.stringify(request({ base: 'main', head, allowedPaths: ['**'], profileId,
      ratingRulesVersion: profileId === 'evidence-v1' ? 'ratings-v1' : 'ratings-v0' })));
    return runVerify(root, loadConfig(root), { request: path, store });
  };
  const outcome = (run) => run.results.obligations.find((x) => x.id === 'completeness.tests-not-weakened').result;
  const first = verify('evidence-v1');
  assert.equal(outcome(first), 'FAIL');
  assert.equal(outcome(verify('static-baseline-v0')), 'PASS');
  const records = first.results.tests.reviews.entries.map((x) => ({ id: x.id, file: x.path, digest: x.digest,
    reason: 'Intentional change.', reviewedBy: 'Human', date: '2026-10-23' }));
  writeReviews(root, records, null);
  assert.equal(outcome(verify('evidence-v1')), 'PASS');
  git('add', 'test/a.test.ts', 'jest.config.js'); git('commit', '-qm', 'head');
  const head = git('rev-parse', 'HEAD');
  // The base stays the first commit after main moves.
  git('branch', 'base', head + '^');
  const verifyCommit = () => {
    writeFileSync(path, JSON.stringify(request({ base: 'base', head, allowedPaths: ['**'],
      profileId: 'evidence-v1', ratingRulesVersion: 'ratings-v1' })));
    return runVerify(root, loadConfig(root), { request: path, store });
  };
  writeFileSync(join(root, 'test/a.test.ts'), source('toBeTruthy()') + '// local drift\n');
  assert.equal(outcome(verifyCommit()), 'PASS');
});
test('the command rejects a store inside the repository before writing analyses', (t) => {
  const { root, changes } = fixture(t), id = changes().reviews.entries[0].id;
  const result = spawnSync(process.execPath, [cli, 'review-weakening', '--entry', id, '--reason', 'Intentional.',
    '--reviewed-by', 'Human', '--store', join(root, 'cache')], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /store.*inside the repository/);
});
