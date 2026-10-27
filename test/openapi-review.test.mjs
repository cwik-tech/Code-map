// Regression cases from the C20 review: unmatched documents, catch-all parameters and bounded file reads.
import assert from 'node:assert/strict';
import { chmodSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { collect, mapData } from '../lib/build.mjs';
import { loadConfig } from '../lib/project.mjs';
import { repository } from './nextjs-fixture.mjs';

const files = {
  'package.json': JSON.stringify({ name: 'api', dependencies: { next: '15' } }),
  'app/api/health/route.ts': 'export function GET() { return new Response(); }\n',
  'openapi.json': JSON.stringify({ openapi: '3.0.0', paths: { '/api/missing': { get: {} } } }),
};
const report = (root, options = { ref: 'HEAD' }) => {
  const config = loadConfig(root), facts = collect(root, config, options);
  return { facts, api: mapData(root, config, facts, 2, options.worktree === true).analysis.frameworks.openapi };
};

test('a document with no matching route still reports its missing operation and undocumented handler', (t) => {
  const { root } = repository(t, files);
  const { api } = report(root);
  assert.equal(api.documents[0].state, 'compared');
  assert.deepEqual(api.leads.noHandler.map(({ method, url }) => [method, url]), [['GET', '/api/missing']]);
  assert.deepEqual(api.leads.undocumented.map(({ method, url }) => [method, url]), [['GET', '/api/health']]);
});

test('an empty document still reports undocumented handler methods', (t) => {
  const { root } = repository(t, { ...files, 'openapi.json': '{"openapi":"3.0.0","paths":{}}' });
  assert.equal(report(root).api.leads.undocumented.length, 1);
});

test('catch-all and optional catch-all parameters report different names', (t) => {
  const { root } = repository(t, { ...files,
    'app/api/files/[...slug]/route.ts': 'export function GET() {}\n',
    'app/api/docs/[[...parts]]/route.ts': 'export function GET() {}\n',
    'openapi.json': JSON.stringify({ openapi: '3.0.0', paths: { '/api/files/{path}': { get: {} }, '/api/docs/{name}': { get: {} } } }),
  });
  assert.deepEqual(report(root).api.leads.paramName.map(({ pairs }) => pairs),
    [[{ document: 'path', route: 'slug' }], [{ document: 'name', route: 'parts' }]]);
});

test('large contracts are excluded from collected texts before parsing, in a commit and the working tree', (t) => {
  const { root } = repository(t, { ...files, 'openapi.json': ' '.repeat(5 * 1024 * 1024 + 1) });
  const committed = report(root), working = report(root, { worktree: true });
  assert.equal(committed.facts.texts.has('openapi.json'), false);
  assert.equal(working.facts.texts.has('openapi.json'), false);
  assert.equal(committed.api.documents[0].reason, 'too-large');
  assert.equal(working.api.documents[0].reason, 'too-large');
});

test('a contract symlink is not followed into a secret file', (t) => {
  const { root, git } = repository(t, { ...files, '.env': 'SECRET=value\n' });
  symlinkSync('.env', join(root, 'private.openapi.json'));
  git('add', 'private.openapi.json'); git('commit', '-qm', 'linked contract');
  const committed = report(root), working = report(root, { worktree: true });
  assert.equal(committed.facts.texts.has('private.openapi.json'), false);
  assert.equal(working.facts.texts.has('private.openapi.json'), false);
  assert.equal(committed.api.documents.find(({ path }) => path === 'private.openapi.json').reason, 'symlink');
  assert.equal(working.api.documents.find(({ path }) => path === 'private.openapi.json').reason, 'symlink');
});


test('working-tree hashing does not open a secret target of a contract symlink', (t) => {
  const { root, store, put, git, run } = repository(t, files);
  put('.env.local', 'PRIVATE_TOKEN=unreadable-secret\n');
  chmodSync(join(root, '.env.local'), 0o000);
  symlinkSync('.env.local', join(root, 'private.openapi.json'));
  git('add', 'private.openapi.json'); git('commit', '-qm', 'linked private contract');
  const output = run(['inspect', '--summary', '--worktree', '--store', store]);
  assert.equal(output.status, 0, output.stderr);
});
