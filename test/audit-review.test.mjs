// Self-review regressions cover unsupported evidence and complete SQL wiring.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { responseProblems } from '../lib/harness/route.mjs';
import { collectSchemas, snapshotSchemas } from '../lib/schemas/collect.mjs';
import { inventoryView } from '../lib/schemas/report.mjs';
import { schemaRollout } from '../lib/schemas/rollout.mjs';
import { sourceReader } from '../lib/git.mjs';
import { analyzeModels } from '../lib/models/models.mjs';
import { runHarness, harnessCommand } from '../lib/harness/run.mjs';
import { loadConfig } from '../lib/project.mjs';
import { project, authorize, sandboxed } from './worker-fixtures.mjs';
const inventory = (text) => collectSchemas(['package.json', 'schema.sql'], (paths) => new Map(paths.map((path) => [path, path.endsWith('.sql') ? text : '{}'])));
const response = (field) => ({ method: 'GET', responses: { 200: { content: { 'application/json': { schema: { type: 'object', properties: { absent: field } } } } } } });
test('malformed rules on absent response fields retain UNKNOWN', () => {
  assert.ok(responseProblems(response({ type: 'string', minLength: 'bad' }), 200, {}).some((x) => x.startsWith('UNKNOWN:')));
});
test('SQL snapshots appear in the schema inventory kind totals', () => {
  const schemas = inventory('-- dialect: sqlite\nCREATE TABLE users(id INTEGER);');
  assert.equal(inventoryView(schemas, 'next').kinds.find((x) => x.kind === 'sql')?.files, 1);
});
test('SQL column removals retain rollout consumer witnesses', () => {
  const before = inventory('-- dialect: sqlite\nCREATE TABLE users(id INTEGER, name TEXT);');
  const after = inventory('-- dialect: sqlite\nCREATE TABLE users(id INTEGER);');
  const texts = new Map([['app.mjs', 'export const query = "SELECT name FROM users";']]);
  assert.equal(schemaRollout(before, after, texts, texts).leads[0]?.kind, 'contract-before-expand');
});
test('SQL snapshot symlinks stay unread and never import external definitions', (t) => {
  const f = project(t), target = join(f.work, 'external.sql');
  writeFileSync(target, '-- dialect: sqlite\nCREATE TABLE ExternalSecret(id INTEGER);');
  symlinkSync(target, join(f.root, 'schema.sql'));
  const result = snapshotSchemas(sourceReader(f.root, null), new Map());
  assert.equal(result.entities.some((x) => x.name === 'ExternalSecret'), false);
  assert.ok(result.unread.some((x) => x.path === 'schema.sql'));
});
test('unread JSON Schema boundary files retain an explicit model error', () => {
  const result = analyzeModels({ jsonBoundaries: [{ path: 'age.schema.json', state: 'UNKNOWN', reason: 'symlink' }] });
  assert.equal(result.errors[0]?.reason, 'symlink');
});
test('route failures retain known violations alongside unsupported rules', sandboxed, async (t) => {
  const f = project(t);
  f.put('route.mjs', 'export const GET = () => Response.json({ id: 17 });');
  f.put('openapi.json', JSON.stringify({ openapi: '3.0.3', paths: { '/': { get: { responses: { 200: { content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer', minimum: 18, format: 'unknown' } } } } } } } } } } }));
  f.git('add', '.'); f.git('commit', '-qm', 'mixed response evidence');
  const result = await runHarness(f.root, loadConfig(f.root), { authorization: authorize(f, harnessCommand), store: f.store,
    spec: { harnessVersion: 1, mode: 'route', contract: 'openapi.json', path: '/', subject: { file: 'route.mjs', export: 'GET' } } },
  { protectedFolders: [f.root, f.home, f.store], home: f.home });
  assert.equal(result.exitCode, 0);
  const report = JSON.parse(readFileSync(result.paths.artifact, 'utf8'));
  assert.ok(report.failures.some((x) => x.kind === 'mismatch'));
  assert.ok(report.failures.some((x) => x.kind === 'UNKNOWN'));
});
test('a non-JSON route response cannot satisfy a nullable JSON schema', sandboxed, async (t) => {
  const f = project(t);
  f.put('route.mjs', 'export const GET = () => new Response("invalid json");');
  f.put('openapi.json', JSON.stringify({ openapi: '3.0.3', paths: { '/': { get: { responses: { 200: { content: { 'application/json': { schema: { type: 'null' } } } } } } } } }));
  f.git('add', '.'); f.git('commit', '-qm', 'invalid JSON response');
  const result = await runHarness(f.root, loadConfig(f.root), { authorization: authorize(f, harnessCommand), store: f.store,
    spec: { harnessVersion: 1, mode: 'route', contract: 'openapi.json', path: '/', subject: { file: 'route.mjs', export: 'GET' } } },
  { protectedFolders: [f.root, f.home, f.store], home: f.home });
  assert.equal(result.exitCode, 0);
  const report = JSON.parse(readFileSync(result.paths.artifact, 'utf8'));
  assert.ok(report.failures.some((x) => x.kind === 'mismatch'));
});
