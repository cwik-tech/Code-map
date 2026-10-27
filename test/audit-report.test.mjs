// Harness evidence refuses incomplete or contradictory data oracles.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harnessInformation } from '../lib/harness/report.mjs';
const envelope = { reportType: 'code-map-harness', harnessVersion: 1, finite: true, calls: [], failures: [], executed: 0 };
test('migration PASS without a data oracle is not accepted as evidence', () => {
  assert.match(harnessInformation(JSON.stringify({ ...envelope, mode: 'migrate', migration: { status: 'PASS', before: [], after: [], applied: [], failedFile: null } })).error, /migration/);
});
test('boundary reports reject nonexistent call links', () => {
  assert.match(harnessInformation(JSON.stringify({ ...envelope, mode: 'json-boundaries', boundaries: { cases: [{ input: 1, expected: true }], unknown: [] }, boundaryResults: [{ case: 0, call: 99, expected: true, actual: true }] })).error, /boundar/);
});
test('migration row evidence rejects unsupported nested cells', () => {
  const rows = [{ id: { unsupported: 1 } }];
  const migration = { status: 'PASS', before: [], after: [], applied: ['change.sql'], failedFile: null,
    checks: [{ query: 'SELECT id FROM users', expected: rows, actual: rows, status: 'PASS' }] };
  assert.match(harnessInformation(JSON.stringify({ ...envelope, mode: 'migrate', migration })).error, /migration/);
});
