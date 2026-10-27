// Strict oracle records, safe file writes and digest binding.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateOracles, readOracles, writeOracles, oracleDigest, bindOracles } from '../lib/oracles.mjs';
const entry = () => ({ file: 'test/a.test.mjs', suite: 'a', name: 'works', criterion: 'AC1', digest: 'a'.repeat(64), method: 'Compared with the specification.', confirmedBy: 'Reviewer', date: '2026-10-23' });
test('validates oracle identities and rejects unknown fields, unsafe paths, bad dates and duplicate records', () => {
  assert.equal(validateOracles({ oracleVersion: 1, entries: [entry()] }).ok, true);
  for (const fields of [{ file: '../a' }, { file: '/a' }, { file: '.git/a' }, { digest: 'abc' }, { confirmedBy: '' }, { date: '2026-02-30' }, { extra: true }]) {
    assert.equal(validateOracles({ oracleVersion: 1, entries: [{ ...entry(), ...fields }] }).ok, false);
  }
  assert.equal(validateOracles({ oracleVersion: 1, entries: [entry(), entry()] }).ok, false);
  assert.equal(validateOracles({ oracleVersion: 1, entries: [], extra: true }).ok, false);
});
test('writes atomically, refuses concurrent changes and rejects invalid or oversized oracle files', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'oracles-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(readOracles(root), null);
  writeOracles(root, [entry()], null);
  assert.deepEqual(readOracles(root).entries, [entry()]);
  assert.throws(() => writeOracles(root, [], null), /changed/);
  writeFileSync(join(root, '.code-map/oracles.json'), '{');
  assert.throws(() => readOracles(root), /JSON/);
  writeFileSync(join(root, '.code-map/oracles.json'), ' '.repeat(4 * 1024 * 1024 + 1));
  assert.throws(() => readOracles(root), /larger/);
});
test('records become stale when the test file digest changes', () => {
  const text = 'test source', record = { ...entry(), digest: oracleDigest(text) };
  assert.equal(bindOracles([record], new Map([[record.file, text]]))[0].stale, false);
  assert.equal(bindOracles([record], new Map([[record.file, text + '\n']]))[0].stale, true);
  assert.equal(bindOracles([record], new Map())[0].stale, true);
});
test('refuses a symlinked oracle folder', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'oracles-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'outside')); symlinkSync(join(root, 'outside'), join(root, '.code-map'));
  assert.throws(() => writeOracles(root, [entry()], null), /symlink/);
});
