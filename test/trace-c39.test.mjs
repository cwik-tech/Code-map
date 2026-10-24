import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { project } from './oracle-fixtures.mjs';
import { fileURLToPath } from 'node:url';

// Malicious fixture code is never imported by this test. Collection must only parse it.
test('default collection neither evaluates project modules nor runs scripts nor changes tracked files', (t) => {
  const f = project(t);
  f.put('package.json', JSON.stringify({ type: 'module', scripts: { pretest: 'touch script-ran', test: 'touch script-ran' } }));
  f.put('src/effect.mjs', "import { writeFileSync } from 'node:fs'; writeFileSync('module-ran', 'bad'); export const x = 1;\n");
  f.commit('collection fixture');
  const before = f.git('diff', 'HEAD'), source = readFileSync(join(f.root, 'src/effect.mjs'), 'utf8');
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url)),
    'inspect', '--summary', '--worktree', '--store', f.store], { cwd: f.root, encoding: 'utf8', timeout: 30000 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).reportType, 'code-map-summary');
  assert.equal(existsSync(join(f.root, 'module-ran')), false);
  assert.equal(existsSync(join(f.root, 'script-ran')), false);
  assert.equal(f.git('diff', 'HEAD'), before);
  assert.equal(readFileSync(join(f.root, 'src/effect.mjs'), 'utf8'), source);
});
