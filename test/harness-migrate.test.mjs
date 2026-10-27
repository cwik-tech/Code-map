// SQLite transforms execute only through the real restricted worker.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../lib/project.mjs';
import { runHarness, harnessCommand } from '../lib/harness/run.mjs';
import { validateSpec } from '../lib/harness/spec.mjs';
import { harnessInformation } from '../lib/harness/report.mjs';
import { authorize, project, sandboxed } from './worker-fixtures.mjs';
const spec = { harnessVersion: 1, mode: 'migrate', base: 'base', fixture: 'fixture.sql' };
async function execute(t, sql, provider = 'sqlite') {
  const f = project(t);
  f.put('prisma/schema.prisma', `generator client {\n provider = "prisma-client-js"\n}\ndatasource db {\n provider = "${provider}"\n url = env("DATABASE_URL")\n}\nmodel User {\n id Int @id\n}\n`);
  f.put('fixture.sql', 'CREATE TABLE User(id INTEGER PRIMARY KEY); INSERT INTO User VALUES (1), (2);');
  f.git('add', '.'); f.git('commit', '-qm', 'schema');
  f.git('branch', 'before');
  f.put('prisma/migrations/001/migration.sql', sql);
  f.put('prisma/migrations/002/migration.sql', 'INSERT INTO User VALUES (4);');
  f.git('add', '.'); f.git('commit', '-qm', 'migrations');
  const authorization = authorize(f, harnessCommand);
  const result = await runHarness(f.root, loadConfig(f.root), { authorization, spec: { ...spec, base: 'before', assertions: [{ query: 'SELECT id FROM User ORDER BY id', rows: [{ id: 2 }, { id: 3 }, { id: 4 }] }] }, store: f.store },
    { protectedFolders: [f.root, f.store, f.home], home: f.home, graceMs: 300 });
  assert.equal(result.exitCode, 0, JSON.stringify(result.record.problems));
  return JSON.parse(readFileSync(result.paths.artifact, 'utf8'));
}
test('migrate specs require a fixture and base without a JavaScript subject', () => {
  assert.equal(validateSpec(spec).fixture, 'fixture.sql');
  assert.throws(() => validateSpec({ ...spec, fixture: '../outside.sql' }), /Invalid harness/);
  assert.throws(() => validateSpec({ ...spec, base: '-bad' }), /Invalid harness/);
});
test('migrate runs changed SQL in order and reports row counts through verify information', sandboxed, async (t) => {
  const report = await execute(t, 'DELETE FROM User WHERE id = 1; INSERT INTO User VALUES (3);');
  assert.deepEqual(report.migration.before, [{ table: 'User', rows: 2 }]);
  assert.deepEqual(report.migration.after, [{ table: 'User', rows: 3 }]);
  assert.equal(report.migration.status, 'PASS');
  assert.equal(report.migration.applied.length, 2);
  assert.equal(report.failures.length, 0);
  assert.deepEqual(harnessInformation(JSON.stringify(report)).information.migration, report.migration);
});
test('migrate reports a SQL error and preserves before and after counts', sandboxed, async (t) => {
  const report = await execute(t, 'INSERT INTO Missing VALUES (3);');
  assert.equal(report.migration.status, 'FAIL');
  assert.match(report.migration.error, /Missing/);
  assert.equal(report.migration.failedFile, 'prisma/migrations/001/migration.sql');
  assert.deepEqual(report.migration.after, [{ table: 'User', rows: 2 }]);
  assert.equal(report.failures[0].kind, 'mismatch');
});
test('Postgres migrations remain UNKNOWN with a database reason', sandboxed, async (t) => {
  const report = await execute(t, 'INVALID SQL', 'postgresql');
  assert.equal(report.migration.status, 'UNKNOWN');
  assert.match(report.migration.reason, /sqlite|SQLite/);
  assert.equal(report.failures[0].kind, 'UNKNOWN');
});

test('migrate refuses SQL file operations inside its worker', sandboxed, async (t) => {
  const report = await execute(t, "ATTACH DATABASE 'other.sqlite' AS other;");
  assert.equal(report.migration.status, 'FAIL');
  assert.match(report.migration.error, /file operations/);
});
test('verify refuses malformed migration row counts', () => {
  const report = { reportType: 'code-map-harness', harnessVersion: 1, mode: 'migrate', finite: true, calls: [], failures: [], executed: 0,
    migration: { status: 'PASS', before: [{ table: 'User', rows: -1 }], after: [], applied: [], failedFile: null } };
  assert.match(harnessInformation(JSON.stringify(report)).error, /migration/);
});
