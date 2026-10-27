// Data oracles run against the real in-memory SQLite engine.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrate } from '../lib/harness/migrate.mjs';
import { sandboxed } from './worker-fixtures.mjs';
import { validateSpec } from '../lib/harness/spec.mjs';
test('successful SQL without a transformed-data oracle stays UNKNOWN', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'w7-sql-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'fixture.sql'), "CREATE TABLE users(id INTEGER, name TEXT); INSERT INTO users VALUES (1, 'Alice');");
  writeFileSync(join(root, 'change.sql'), "UPDATE users SET name = 'CORRUPTED';");
  const result = await migrate(root, { fixture: 'fixture.sql' }, { status: 'KNOWN', files: ['change.sql'] });
  assert.equal(result.status, 'UNKNOWN');
  assert.match(result.reason, /oracle/);
});
test('declared query rows detect value corruption and wrong row counts', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'w7-sql-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'fixture.sql'), "CREATE TABLE users(id INTEGER, name TEXT); INSERT INTO users VALUES (1, 'Alice');");
  writeFileSync(join(root, 'change.sql'), "UPDATE users SET name = 'CORRUPTED';");
  const spec = validateSpec({ harnessVersion: 1, mode: 'migrate', base: 'HEAD', fixture: 'fixture.sql', assertions: [{ query: 'SELECT name FROM users ORDER BY id', rows: [{ name: 'Alice' }] }, { query: 'SELECT count(*) AS n FROM users', rows: [{ n: 2 }] }] });
  const result = await migrate(root, spec, { status: 'KNOWN', files: ['change.sql'] });
  assert.equal(result.status, 'FAIL');
  assert.deepEqual(result.checks.map((x) => x.status), ['FAIL', 'FAIL']);
  assert.deepEqual(result.checks[0].actual, [{ name: 'CORRUPTED' }]);
});
test('matching transformed rows pass and write queries are refused', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'w7-sql-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'fixture.sql'), 'CREATE TABLE users(id INTEGER); INSERT INTO users VALUES (1);');
  writeFileSync(join(root, 'change.sql'), 'UPDATE users SET id = 2;');
  const spec = { fixture: 'fixture.sql', assertions: [{ query: 'SELECT id FROM users', rows: [{ id: 2 }] }] };
  assert.equal((await migrate(root, spec, { status: 'KNOWN', files: ['change.sql'] })).status, 'PASS');
  const bad = { ...spec, assertions: [{ query: 'DELETE FROM users RETURNING id', rows: [] }] };
  assert.equal((await migrate(root, bad, { status: 'KNOWN', files: ['change.sql'] })).status, 'FAIL');
});

test('standalone SQLite schemas authorize fixture replay and retain data checks', sandboxed, async (t) => {
  const { project, authorize } = await import('./worker-fixtures.mjs');
  const { runHarness, harnessCommand } = await import('../lib/harness/run.mjs');
  const { loadConfig } = await import('../lib/project.mjs');
  const { readFileSync } = await import('node:fs');
  const f = project(t);
  f.put('schema.sql', '-- dialect: sqlite\nCREATE TABLE users(id INTEGER);');
  f.put('fixture.sql', 'CREATE TABLE users(id INTEGER); INSERT INTO users VALUES (1);');
  f.git('add', '.'); f.git('commit', '-qm', 'schema');
  const base = f.git('rev-parse', 'HEAD');
  f.put('migrations/001.sql', 'UPDATE users SET id = 2;');
  f.git('add', '.'); f.git('commit', '-qm', 'transform');
  const result = await runHarness(f.root, loadConfig(f.root), { authorization: authorize(f, harnessCommand), store: f.store,
    spec: { harnessVersion: 1, mode: 'migrate', base, fixture: 'fixture.sql', assertions: [{ query: 'SELECT id FROM users', rows: [{ id: 2 }] }] } },
  { protectedFolders: [f.root, f.home, f.store], home: f.home });
  assert.equal(result.exitCode, 0);
  const report = JSON.parse(readFileSync(result.paths.artifact, 'utf8'));
  assert.equal(report.migration.status, 'PASS');
  assert.deepEqual(report.migration.checks[0].actual, [{ id: 2 }]);
});
