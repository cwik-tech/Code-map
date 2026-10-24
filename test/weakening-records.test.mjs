// Review schema, file safety and full assertion identities.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareTestFile } from '../lib/assertion-compare.mjs';
import { validateReviews, readReviews, writeReviews, reviewWeakening } from '../lib/weakening-reviews.mjs';
import { readReviewTarget } from '../lib/weakening-files.mjs';
import { testsRow } from '../lib/verify-tests-text.mjs';
const record = () => ({ id: 'weakening:' + 'a'.repeat(64), file: 'test/a.test.ts', digest: 'b'.repeat(64),
  reason: 'Intentional.', reviewedBy: 'Human', date: '2026-10-23' });
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'review-records-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
test('schema rejects unknown fields and malformed record identities', () => {
  const value = { reviewsVersion: 1, entries: [record()] };
  assert.equal(validateReviews({ ...value, extra: true }).ok, false);
  assert.equal(validateReviews({ ...value, reviewsVersion: 2 }).ok, false);
  assert.equal(validateReviews({ ...value, entries: [{ ...record(), extra: true }] }).ok, false);
  assert.equal(validateReviews({ ...value, entries: [{ ...record(), id: 'unknown' }] }).ok, false);
  assert.equal(validateReviews({ ...value, entries: [{ ...record(), digest: 'abc' }] }).ok, false);
  assert.equal(validateReviews({ ...value, entries: [{ ...record(), reason: ' ' }] }).ok, false);
  assert.equal(validateReviews({ ...value, entries: [{ ...record(), file: '.git/HEAD' }] }).ok, false);
});
test('writes preserve prior records and reject concurrent changes', (t) => {
  const root = fixture(t);
  assert.equal(readReviews(root), null);
  const digest = writeReviews(root, [record()], null);
  assert.deepEqual(readReviews(root).entries, [record()]);
  assert.throws(() => writeReviews(root, [], null), /changed/);
  writeReviews(root, [], digest);
  assert.deepEqual(readReviews(root).entries, []);
});
test('rejects symlinked review folders, files and oversized records', (t) => {
  const root = fixture(t);
  mkdirSync(join(root, 'outside'));
  symlinkSync(join(root, 'outside'), join(root, '.code-map'));
  assert.throws(() => writeReviews(root, [record()], null), /symlink/);
  rmSync(join(root, '.code-map')); mkdirSync(join(root, '.code-map'));
  writeFileSync(join(root, 'outside/data'), '{}');
  symlinkSync(join(root, 'outside/data'), join(root, '.code-map/reviews.json'));
  assert.throws(() => readReviews(root), /regular/);
  rmSync(join(root, '.code-map/reviews.json'));
  writeFileSync(join(root, '.code-map/reviews.json'), ' '.repeat(4 * 1024 * 1024 + 1));
  assert.throws(() => readReviews(root), /larger/);
});
test('review target reads reject traversal and symlinked parent folders', (t) => {
  const root = fixture(t);
  mkdirSync(join(root, 'outside')); writeFileSync(join(root, 'outside/a.test.ts'), 'test');
  symlinkSync(join(root, 'outside'), join(root, 'test'));
  assert.equal(readReviewTarget(root, null, 'test/a.test.ts'), null);
  assert.equal(readReviewTarget(root, null, '../outside'), null);
});
test('identical case names get distinct IDs and full assertion texts affect their IDs', () => {
  const header = "import { test, expect } from 'vitest';\n";
  const old = `expect(value).toBe('${'a'.repeat(200)}first${'z'.repeat(100)}')`;
  const other = old.replace('first', 'other');
  const body = (text) => `test('same', () => { ${text}; });\n`;
  const compare = (base) => compareTestFile({ basePath: 'test/a.test.ts', headPath: 'test/a.test.ts',
    baseText: header + body(base) + body(base), headText: header + body('expect(value).toBeTruthy()') + body('expect(value).toBeTruthy()') });
  const first = compare(old), second = compare(other);
  assert.equal(first.length, 2);
  assert.notEqual(first[0].id, first[1].id);
  assert.equal(first[0].base.text, second[0].base.text);
  assert.notEqual(first[0].id, second[0].id);
});
test('every entry needs review beyond the old display cap', (t) => {
  const root = fixture(t);
  const entries = Array.from({ length: 51 }, (_, index) => ({ id: 'weakening:' + index.toString(16).padStart(64, '0'),
    path: 'test/a.test.ts', digest: record().digest }));
  writeReviews(root, entries.slice(0, 50).map((x) => ({ ...record(), id: x.id })), null);
  const bound = reviewWeakening(root, entries);
  assert.equal(bound.total, 51);
  assert.equal(bound.unreviewed, 1);
  assert.equal(bound.entries[50].review, null);
});
test('the report explains v1 review requirements and retains the v0 information label', () => {
  const words = { code: String, plain: String };
  assert.match(testsRow({}, { ...words, profileId: 'evidence-v1' }), /current human reviews/);
  assert.match(testsRow({}, { ...words, profileId: 'static-baseline-v0' }), /No check reads this information/);
});
