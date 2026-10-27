import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { collect, mapData } from '../lib/build.mjs';
import { loadConfig } from '../lib/project.mjs';

test('Git versions of the architecture configuration reproduce their declared edge policy', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'trace-c06-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@local', ...args], { encoding: 'utf8', timeout: 10000 }).trim();
  put('src/core/a.ts', "import { b } from '../ui/b'; export const a = b;"); put('src/ui/b.ts', 'export const b = 1;');
  put('.code-map.json', '{"rules":["core -> ui"]}');
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'policy base'); const base = git('rev-parse', 'HEAD');
  put('.code-map.json', '{"rules":[]}'); git('add', '.'); git('commit', '-qm', 'policy head');
  const head = git('rev-parse', 'HEAD');
  put('.code-map.json', git('show', `${base}:.code-map.json`));
  assert.deepEqual(mapData(root, loadConfig(root), collect(root, loadConfig(root), { ref: base }), 2).analysis.rules.violations, [{ rule: 'core -> ui', from: 'src/core/a.ts', to: 'src/ui/b.ts', lines: [1] }]);
  put('.code-map.json', git('show', `${head}:.code-map.json`));
  assert.deepEqual(mapData(root, loadConfig(root), collect(root, loadConfig(root), { ref: head }), 2).analysis.rules.violations, []);
});
