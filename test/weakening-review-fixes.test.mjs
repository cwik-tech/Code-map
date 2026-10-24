// Regressions from the skeptical review of C27.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareTestFile } from '../lib/assertion-compare.mjs';
import { validateReviews, writeReviews } from '../lib/weakening-reviews.mjs';
import { testChanges } from '../lib/test-changes.mjs';
import { changedFiles } from '../lib/verify-change.mjs';
import { evaluateProfile } from '../lib/profiles/evidence-v1.mjs';
import { context } from './evidence-v1-fixtures.mjs';

test('different complete assertion plans have different weakening IDs with bounded display text', () => {
  const header = "import { test, expect } from 'vitest';\n", assertion = 'expect(1).toBe(1);';
  const compare = (tail) => compareTestFile({ basePath: 'test/a.test.ts', headPath: 'test/a.test.ts',
    baseText: header + `test('plans', () => { expect.assertions(Number('${'1'.repeat(200)}${tail}')); ${assertion} });`,
    headText: header + `test('plans', () => { ${assertion} });` })[0];
  const first = compare('2'), second = compare('3');
  assert.equal(first.kind, 'plan-removed');
  assert.equal(first.base.text, second.base.text);
  assert.ok(first.base.text.length <= 160);
  assert.notEqual(first.id, second.id);
});
test('review paths exclude Git metadata and dependencies regardless of case', () => {
  const entry = { id: 'weakening:' + 'a'.repeat(64), file: '.GIT/HEAD', digest: 'b'.repeat(64),
    reason: 'Intentional.', reviewedBy: 'Human', date: '2026-10-23' };
  assert.equal(validateReviews({ reviewsVersion: 1, entries: [entry] }).ok, false);
  assert.equal(validateReviews({ reviewsVersion: 1, entries: [{ ...entry, file: 'Node_Modules/pkg/jest.config.js' }] }).ok, false);
});
test('reviewed known weakening cannot hide unread runner settings beyond the display cap', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'review-unknown-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@local', ...args], { encoding: 'utf8' }).trim();
  const paths = Array.from({ length: 51 }, (_, index) => `p${String(index).padStart(2, '0')}/jest.config.js`);
  const before = 'module.exports = { bail: 0, coverageThreshold: { global: { lines: 80 } } };';
  for (const path of paths) { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), before); }
  git('init', '-qb', 'main'); git('add', '.'); git('commit', '-qm', 'base');
  const baseSha = git('rev-parse', 'HEAD');
  for (const path of paths.slice(0, 50)) writeFileSync(join(root, path), before + '// changed');
  writeFileSync(join(root, paths[50]), 'module.exports = { bail: computeBail(), coverageThreshold: { global: { lines: 60 } } };');
  const analysis = { tests: { testFiles: [] } };
  const changes = () => testChanges(root, { baseSha, headSha: null, change: changedFiles(root, baseSha, null), baseAnalysis: analysis, headAnalysis: analysis });
  const first = changes();
  assert.equal(first.runnerSettings.entries.length, 50);
  assert.equal(first.runnerSettings.unknown, 0);
  writeReviews(root, first.reviews.entries.map((x) => ({ id: x.id, file: x.path, digest: x.digest,
    reason: 'Intentional.', reviewedBy: 'Human', date: '2026-10-23' })), null);
  const result = evaluateProfile(context({ tests: changes() })).obligations.find((x) => x.id === 'completeness.tests-not-weakened');
  assert.equal(result.result, 'UNKNOWN');
});
test('an invalid review file without weakening is unknown and existing failures cannot be waived', () => {
  const check = (c) => evaluateProfile(c).obligations.find((x) => x.id === 'completeness.tests-not-weakened').result;
  assert.equal(check(context({ tests: { reviews: { error: 'Invalid JSON', total: 0, unreviewed: 0, entries: [] } } })), 'UNKNOWN');
  assert.equal(check(context({ weakening: { removed: [{ path: 'test/a.test.ts', name: 'works' }], weakened: [] },
    tests: { reviews: { error: null, total: 1, unreviewed: 0, entries: [] } } })), 'FAIL');
});
