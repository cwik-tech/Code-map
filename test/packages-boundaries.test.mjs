// Package boundaries: all declaration fields, type-only subpaths and code outside the configured source roots.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzed, leadsOf, manifest, repository } from './packages-fixture.mjs';

test('optional and type-only imports get install and subpath checks, while declared built-ins stay exempt', (t) => {
  const { root } = repository(t, {
    'package.json': manifest({ name: 'app', dependencies: { fs: '1', typed: '1' }, optionalDependencies: { optional: '1' } }),
    'src/main.ts': "import fs from 'fs';\nimport type { T } from 'typed/hidden';\nimport optional from 'optional';\nexport const main: T = [fs, optional];\n",
  }, { 'node_modules/typed': { exports: { '.': './index.js' } } });
  const { findings } = analyzed(root);
  assert.deepEqual(leadsOf(findings, 'PACKAGE-UNRESOLVED'), [['src/main.ts', 'optional']]);
  assert.deepEqual(leadsOf(findings, 'PACKAGE-SUBPATH-NOT-EXPORTED'), [['src/main.ts', 'typed/hidden']]);
  assert.deepEqual(leadsOf(findings, 'PACKAGE-UNDECLARED'), []);
});

test('package import checks also read code outside the source roots', (t) => {
  const { root } = repository(t, {
    'package.json': manifest({ name: 'app' }),
    'src/main.ts': 'export const main = 1;\n',
    'vite.config.ts': "import missing from 'missing-plugin';\nexport default missing;\n",
  });
  assert.deepEqual(leadsOf(analyzed(root).findings, 'PACKAGE-UNDECLARED'), [['vite.config.ts', 'missing-plugin']]);
});

test('aliases from one TypeScript project do not hide undeclared imports in another project', (t) => {
  const { root } = repository(t, {
    'package.json': manifest({ name: 'root', workspaces: ['packages/*'] }),
    'packages/web/package.json': manifest({ name: 'web' }),
    'packages/api/package.json': manifest({ name: 'api' }),
    'packages/web/tsconfig.json': JSON.stringify({ compilerOptions: { paths: { 'local/*': ['./src/*'] } }, include: ['src'] }),
    'packages/api/tsconfig.json': JSON.stringify({ include: ['src'] }),
    'packages/web/src/main.ts': "import x from 'local/missing';\nexport const main = x;\n",
    'packages/api/src/main.ts': "import x from 'local/missing';\nexport const main = x;\n",
  });
  assert.deepEqual(leadsOf(analyzed(root).findings, 'PACKAGE-UNDECLARED'), [['packages/api/src/main.ts', 'local']]);
});

test('an alias import outside the source roots still prevents an orphan finding', (t) => {
  const { root } = repository(t, {
    'package.json': manifest({ name: 'app' }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { 'local/*': ['./src/*'] } }, include: ['**/*.ts'] }),
    'vite.config.ts': "import { helper } from 'local/helper';\nexport default helper;\n",
    'src/helper.ts': 'export const helper = 1;\n',
  });
  assert.deepEqual(leadsOf(analyzed(root).findings, 'FILE-ORPHANED'), []);
});

test('a computed alias import makes reachable files unknown', (t) => {
  const { root } = repository(t, {
    'package.json': manifest({ name: 'app', main: 'src/main.ts' }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { 'local/*': ['./src/*'] } } }),
    'src/main.ts': 'export const load = (name: string) => import(`local/plugins/${name}.ts`);\n',
    'src/plugins/a.ts': 'export const a = 1;\n',
  });
  const { packages, findings } = analyzed(root);
  assert.deepEqual(leadsOf(findings, 'FILE-ORPHANED'), []);
  assert.equal(packages.unknown.orphans[0]?.reason, 'dynamic-import');
});

test('nested installs and changed exports invalidate stored package findings without a lockfile update', (t) => {
  const { store, put, json } = repository(t, {
    'package.json': manifest({ name: 'root', workspaces: ['packages/*'] }),
    'packages/web/package.json': manifest({ name: 'web', dependencies: { dep: '1' } }),
    'packages/web/src/main.ts': "import x from 'dep/sub';\nexport const main = x;\n",
  });
  const args = ['inspect', '--summary', '--worktree', '--store', store];
  const before = json(args);
  put('packages/web/node_modules/dep/package.json', manifest({ exports: { '.': './index.js' } }));
  const installed = json(args);
  assert.notEqual(installed.analysis.id, before.analysis.id);
  assert.ok(installed.findings.items.some((item) => item.ruleId === 'PACKAGE-SUBPATH-NOT-EXPORTED'));
  put('packages/web/node_modules/dep/package.json', manifest({ exports: { './sub': './sub.js' } }));
  const changed = json(args);
  assert.notEqual(changed.analysis.id, installed.analysis.id);
  assert.equal(changed.findings.items.some((item) => item.ruleId === 'PACKAGE-SUBPATH-NOT-EXPORTED'), false);
  const stale = json(['inspect', '--analysis', installed.analysis.id, '--store', store]);
  assert.ok(stale.analysis.freshness.changed.includes('installed'));
});

test('a named package outside workspace patterns does not exempt an undeclared import', (t) => {
  const { root } = repository(t, {
    'package.json': manifest({ name: 'root', workspaces: { packages: ['packages/*'] } }),
    'src/main.ts': "import active from '@app/active';\nimport fixture from 'fixture-only';\nexport const main = [active, fixture];\n",
    'packages/active/package.json': manifest({ name: '@app/active' }),
    'fixtures/demo/package.json': manifest({ name: 'fixture-only' }),
  });
  assert.deepEqual(leadsOf(analyzed(root).findings, 'PACKAGE-UNDECLARED'), [['src/main.ts', 'fixture-only']]);
});

test('an unreadable nearest manifest is a support gap instead of borrowing declarations from its parent', (t) => {
  const { json, store } = repository(t, {
    'package.json': manifest({ name: 'root' }),
    'packages/broken/package.json': '{ invalid json',
    'packages/broken/src/main.ts': "import missing from 'missing';\nexport const main = missing;\n",
  });
  const summary = json(['inspect', '--summary', '--ref', 'HEAD', '--store', store]);
  assert.equal(summary.findings.items.some((item) => item.ruleId === 'PACKAGE-UNDECLARED'), false);
  assert.equal(summary.gaps.find((gap) => gap.key === 'packageManifestsUnreadable')?.count, 1);
});


test('computed package loads expose candidate and site uncertainty without unused findings', (t) => {
  const { root, json, store } = repository(t, {
    'package.json': manifest({ name: 'app', dependencies: { 'dynamic-plugin': '1' } }),
    'src/main.ts': "const name = process.env.PLUGIN || 'dynamic-plugin';\nexport const load = () => import(name);\n",
  });
  const { packages, findings } = analyzed(root);
  assert.deepEqual(leadsOf(findings, 'PACKAGE-UNUSED'), []);
  assert.deepEqual(packages.unknown.unused.map(x => [x.package, x.sites[0].path, x.sites[0].line, x.state]),
    [['dynamic-plugin', 'src/main.ts', 2, 'UNKNOWN']]);
  const summary = json(['inspect', '--worktree', '--summary', '--store', store]);
  assert.match(summary.gaps.find(x => x.key === 'dependenciesUnknown').text, /dynamic-plugin.*src\/main.ts:2/);
});

test('relative computed loading does not hide an unrelated unused dependency', (t) => {
  const { root } = repository(t, {
    'package.json': manifest({ name: 'app', dependencies: { unused: '1' } }),
    'src/main.ts': 'export const load = name => import(`./plugins/${name}.js`);\n',
  });
  assert.deepEqual(leadsOf(analyzed(root).findings, 'PACKAGE-UNUSED'), [['package.json', 'unused']]);
});


test('multiline relative loaders retain unrelated unused dependencies', (t) => {
  const { root } = repository(t, {
    'package.json': manifest({ name: 'app', dependencies: { unused: '1' } }),
    'src/main.ts': 'export const load = name => import(\n `./plugins/${name}.js`\n);\n',
  });
  assert.deepEqual(leadsOf(analyzed(root).findings, 'PACKAGE-UNUSED'), [['package.json', 'unused']]);
});


test('parenthesized relative loaders retain unrelated unused dependencies', (t) => {
  const { root } = repository(t, {
    'package.json': manifest({ name: 'app', dependencies: { unused: '1' } }),
    'src/main.ts': 'export const load = name => import((`./plugins/${name}.js`));\n',
  });
  assert.deepEqual(leadsOf(analyzed(root).findings, 'PACKAGE-UNUSED'), [['package.json', 'unused']]);
});
