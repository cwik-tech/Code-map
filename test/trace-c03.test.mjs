import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { collect, mapData } from '../lib/build.mjs';
import { defaults } from '../lib/project.mjs';

test('base and head materialize their own package entrypoints and export signatures', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'trace-c03-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@local', ...args], { encoding: 'utf8', timeout: 10000 }).trim();
  put('package.json', '{"exports":"./src/before.ts"}');
  put('src/before.ts', 'export function before(value: string): string { return value; }');
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  put('package.json', '{"exports":"./src/after.ts"}');
  put('src/after.ts', 'export function after(value: number): number { return value; }');
  git('add', '.'); git('commit', '-qm', 'head');
  const before = mapData(root, defaults, collect(root, defaults, { ref: base }), 2).analysis.api;
  const after = mapData(root, defaults, collect(root, defaults, { ref: 'HEAD' }), 2).analysis.api;
  assert.deepEqual(before.entryPoints, { files: [{ path: 'src/before.ts', package: 'package.json', fields: ['exports'] }], unresolved: [] });
  assert.deepEqual(after.entryPoints, { files: [{ path: 'src/after.ts', package: 'package.json', fields: ['exports'] }], unresolved: [] });
  assert.deepEqual(before.files['src/before.ts'].map(({ name, text }) => [name, text]), [['before', 'function before(value: string): string']]);
  assert.deepEqual(after.files['src/after.ts'].map(({ name, text }) => [name, text]), [['after', 'function after(value: number): number']]);
  assert.equal(before.files['src/after.ts'], undefined);
});
