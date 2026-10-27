// Review regressions exercise real worker SQL and changed migration discovery.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runVerify } from '../lib/verify.mjs';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../lib/project.mjs';
import { runHarness, harnessCommand } from '../lib/harness/run.mjs';
import { authorize, project, sandboxed } from './worker-fixtures.mjs';
function fixture(t) {
  const f = project(t);
  f.put('schema.ts', "export const users = sqliteTable('User', { id: integer('id') }); throw new Error('Never execute schema code');");
  f.put('fixture.sql', 'CREATE TABLE User(id INTEGER); INSERT INTO User VALUES (1), (2);');
  f.git('add', '.'); f.git('commit', '-qm', 'schema');
  return f;
}
async function execute(f, base) {
  f.git('add', '.'); f.git('commit', '-qm', 'change');
  const result = await runHarness(f.root, loadConfig(f.root), { authorization: authorize(f, harnessCommand), store: f.store,
    spec: { harnessVersion: 1, mode: 'migrate', base, fixture: 'fixture.sql', assertions: [{ query: 'SELECT id FROM User ORDER BY id', rows: [{ id: 1 }, { id: 2 }] }] } },
  { protectedFolders: [f.root, f.store, f.home], home: f.home, graceMs: 300 });
  assert.equal(result.exitCode, 0, JSON.stringify(result.record.problems));
  return { ...JSON.parse(readFileSync(result.paths.artifact, 'utf8')), runId: result.record.runId };
}
test('Drizzle SQLite migrations run in path order without executing schema modules', sandboxed, async (t) => {
  const f = fixture(t), base = f.git('rev-parse', 'HEAD');
  f.put('drizzle/002.sql', 'INSERT INTO NewTable VALUES (3);');
  f.put('drizzle/001.sql', 'CREATE TABLE NewTable(id INTEGER);');
  const report = await execute(f, base);
  assert.equal(report.migration.status, 'PASS');
  assert.deepEqual(report.migration.applied, ['drizzle/001.sql', 'drizzle/002.sql']);
  assert.deepEqual(report.migration.after, [{ table: 'NewTable', rows: 1 }, { table: 'User', rows: 2 }]);
});
test('edited SQL files run and preserve partial row counts on failure', sandboxed, async (t) => {
  const f = fixture(t);
  f.put('drizzle/001.sql', 'SELECT 1;'); f.git('add', '.'); f.git('commit', '-qm', 'old migration');
  const base = f.git('rev-parse', 'HEAD');
  f.put('drizzle/001.sql', 'DELETE FROM User; INSERT INTO Missing VALUES (1);');
  const report = await execute(f, base);
  assert.equal(report.migration.status, 'FAIL');
  assert.deepEqual(report.migration.after, [{ table: 'User', rows: 0 }]);
  assert.equal(report.migration.failedFile, 'drizzle/001.sql');
});
test('a removed historical migration makes the selected change UNKNOWN', sandboxed, async (t) => {
  const f = fixture(t);
  f.put('drizzle/001.sql', 'SELECT 1;'); f.git('add', '.'); f.git('commit', '-qm', 'old migration');
  const base = f.git('rev-parse', 'HEAD'); f.git('rm', 'drizzle/001.sql');
  f.put('drizzle/002.sql', 'DELETE FROM User;');
  const report = await execute(f, base);
  assert.equal(report.migration.status, 'UNKNOWN');
  assert.match(report.migration.reason, /removed/);
});

test('row counts include user tables with sqlite-like prefixes and quoted names', sandboxed, async (t) => {
  const f = fixture(t), base = f.git('rev-parse', 'HEAD');
  f.put('drizzle/001.sql', 'CREATE TABLE sqliteXrows(id INTEGER); INSERT INTO sqliteXrows VALUES (1); CREATE TABLE "odd""table"(id INTEGER); INSERT INTO "odd""table" VALUES (1);');
  const report = await execute(f, base);
  assert.equal(report.migration.status, 'PASS');
  assert.deepEqual(report.migration.after, [{ table: 'User', rows: 2 }, { table: 'odd"table', rows: 1 }, { table: 'sqliteXrows', rows: 1 }]);
});
test('fixture SQL errors identify the fixture and retain its partial database', sandboxed, async (t) => {
  const f = fixture(t), base = f.git('rev-parse', 'HEAD');
  f.put('fixture.sql', 'CREATE TABLE User(id INTEGER); INSERT INTO Missing VALUES (1);');
  f.put('drizzle/001.sql', 'DELETE FROM User;');
  const report = await execute(f, base);
  assert.equal(report.migration.status, 'FAIL');
  assert.equal(report.migration.failedFile, 'fixture.sql');
  assert.deepEqual(report.migration.applied, []);
  assert.deepEqual(report.migration.after, [{ table: 'User', rows: 0 }]);
});


test('failed migration evidence remains visible without affecting evidence-v1 ratings', sandboxed, async (t) => {
  const f = fixture(t), base = f.git('rev-parse', 'HEAD');
  f.put('drizzle/001.sql', 'INSERT INTO Missing VALUES (1);');
  const report = await execute(f, base), path = join(f.work, 'request.json');
  const request = { requestType: 'code-map-verification-request', schemaVersion: 1, base, head: 'HEAD', intent: 'Apply a migration.',
    acceptanceCriteria: [], allowedPaths: ['**'], changeType: 'other', profileId: 'evidence-v1', ratingRulesVersion: 'ratings-v1', reportInputs: [],
    execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } };
  writeFileSync(path, JSON.stringify(request));
  const before = runVerify(f.root, loadConfig(f.root), { request: path, store: f.store }).results;
  writeFileSync(path, JSON.stringify({ ...request, reportInputs: [{ run: report.runId }] }));
  const after = runVerify(f.root, loadConfig(f.root), { request: path, store: f.store }).results;
  assert.equal(after.executions[0].harness.migration.status, 'FAIL');
  assert.equal(after.obligations.find((item) => item.id === 'behavior.harness-holds').result, 'NOT_APPLICABLE');
  assert.deepEqual(after.ratings, before.ratings);
  assert.deepEqual(after.readiness, before.readiness);
});

test('computed migration folders give UNKNOWN instead of replaying a guessed folder', sandboxed, async (t) => {
  const f = fixture(t), base = f.git('rev-parse', 'HEAD');
  f.put('drizzle.config.ts', 'export default defineConfig({ out: process.env.MIGRATIONS });');
  f.put('drizzle/001.sql', 'DELETE FROM User;');
  const report = await execute(f, base);
  assert.equal(report.migration.status, 'UNKNOWN');
  assert.match(report.migration.reason, /schema|configuration|folder/);
});
