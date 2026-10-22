import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { collect } from '../lib/build.mjs';
import { defaults, readAliases } from '../lib/project.mjs';

function resolver(entries) {
  const texts = new Map(Object.entries(entries));
  return createResolver(new Set(texts.keys()), readAliases(texts));
}

const project = {
  'tsconfig.json': '{"compilerOptions":{"strict":true},"include":["server"]}',
  'ui/tsconfig.json': '{"files":[],"references":[{"path":"./tsconfig.app.json"},{"path":"./tsconfig.node.json"}]}',
  'ui/tsconfig.app.json': '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["./src/*"],"@contracts/*":["../contracts/*"]}},"include":["src"]}',
  'ui/tsconfig.node.json': '{"compilerOptions":{"paths":{"@/*":["./config/*"]}},"include":["vite.config.ts"]}',
  'ui/src/chat.tsx': 'import { Button } from "@/button"; import type { Model } from "@contracts/model";',
  'ui/src/button.tsx': 'export const Button = 1;',
  'ui/config/button.ts': 'export const Button = 2;',
  'ui/vite.config.ts': 'import { Button } from "@/button";',
  'contracts/model.ts': 'export interface Model {}',
  'server/main.ts': 'import { Button } from "@/button";',
};

test('nested referenced app and tooling configs resolve their own aliases without leaking to the backend', () => {
  const resolve = resolver(project);
  const facts = analyzeFile('ui/src/chat.tsx', project['ui/src/chat.tsx'], resolve);
  assert.deepEqual(facts.imports, ['contracts/model.ts', 'ui/src/button.tsx']);
  assert.deepEqual(facts.externals, []);
  assert.deepEqual(facts.uses['contracts/model.ts'], ['Model']);
  assert.equal(resolve('ui/vite.config.ts', '@/button'), 'ui/config/button.ts');
  assert.equal(resolve('server/main.ts', '@/button'), null);
});

test('aliases retain inherited target origins and use TypeScript pattern precedence and fallback targets', () => {
  const resolve = resolver({
    'config/base.json': '{// shared config\n"compilerOptions":{"paths":{"@/*":["../shared/*"],"@/special/*":["../missing/*","../special/*"]}}}',
    'app/tsconfig.json': '{"extends":"../config/base.json","include":["src"]}',
    'app/src/main.ts': '', 'shared/button.ts': '', 'shared/special/button.ts': '', 'special/button.ts': '',
  });
  assert.equal(resolve('app/src/main.ts', '@/button'), 'shared/button.ts');
  assert.equal(resolve('app/src/main.ts', '@/special/button'), 'special/button.ts');
});

test('baseUrl is relative to its config and absent baseUrl does not invent repository-root imports', () => {
  const resolve = resolver({
    'tsconfig.json': '{"compilerOptions":{"strict":true}}',
    'ui/jsconfig.json': '{"compilerOptions":{"baseUrl":"./src"}}',
    'ui/src/main.js': '', 'ui/src/button.js': '', 'server/main.ts': '', 'button.ts': '',
  });
  assert.equal(resolve('ui/src/main.js', 'button'), 'ui/src/button.js');
  assert.equal(resolve('server/main.ts', 'button'), null);
  assert.equal(resolve('server/main.ts', '../button.js'), 'button.ts');
});

test('collection uses nested config from the requested Git snapshot for source and test imports', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'code-map-alias-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', folder, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  const put = (path, text) => { mkdirSync(dirname(join(folder, path)), { recursive: true }); writeFileSync(join(folder, path), text); };
  git('init', '-q');
  for (const [path, text] of Object.entries(project)) put(path, text);
  put('ui/src/chat.test.ts', 'import { Button } from "@/button";');
  git('add', '.'); git('commit', '-qm', 'fixture');
  put('ui/tsconfig.app.json', '{"compilerOptions":{"paths":{"@/*":["./config/*"]}},"include":["src"]}');

  const committed = collect(folder, defaults, { ref: 'HEAD' });
  assert.deepEqual(committed.files.find(f => f.path === 'ui/src/chat.tsx').imports, ['contracts/model.ts', 'ui/src/button.tsx']);
  assert.deepEqual(committed.testFacts.find(f => f.path === 'ui/src/chat.test.ts').imports, ['ui/src/button.tsx']);
  const working = collect(folder, defaults, { worktree: true });
  assert.deepEqual(working.files.find(f => f.path === 'ui/src/chat.tsx').imports, ['ui/config/button.ts']);
});

test('root aliases remain available to test files outside the compiler include list', () => {
  const resolve = resolver({
    'tsconfig.json': '{"compilerOptions":{"paths":{"@/*":["./src/*"]}},"include":["src"]}',
    'src/button.ts': '', 'tests/button.test.ts': '',
  });
  assert.equal(resolve('tests/button.test.ts', '@/button'), 'src/button.ts');
});
