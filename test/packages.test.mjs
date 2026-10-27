// The package import checks (C01): undeclared and development-only imports, packages that are not installed, subpaths that
// the exports field does not export, and the support report when no node_modules folder exists. Fixtures: test/packages-fixture.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { exportsSubpath, installedPackages } from '../lib/packages/installed.mjs';
import { manifestIndex, readManifests } from '../lib/packages/manifests.mjs';
import { analyzed, leadsOf, manifest, repository } from './packages-fixture.mjs';

/** A root package with npm workspaces, one private and one public workspace package, and imports of each kind. */
const files = {
  'package.json': manifest({ name: 'shop', version: '1.0.0', workspaces: ['packages/*'], exports: { '.': './lib/index.ts', './extra': './lib/extra.ts' },
    dependencies: { '@scope/pkg': '1.0.0', 'left-pad': '1.0.0', 'cond-pkg': '1.0.0', 'str-pkg': '1.0.0', 'odd-pkg': '1.0.0', 'not-installed': '1.0.0', events: '3.0.0' },
    devDependencies: { 'dev-tool': '1.0.0', '@types/express': '4.0.0', vitest: '1.0.0' }, peerDependencies: { 'peer-pkg': '1.0.0' } }),
  'lib/index.ts': [
    "import { readFileSync } from 'node:fs';", "import { statSync } from 'fs';", "import { EventEmitter } from 'events';",
    "import { sub } from '@scope/pkg/sub';", "import { feature } from '@scope/pkg/features/a.js';", "import { hidden } from '@scope/pkg/private/x.js';",
    "import { inner } from '@scope/pkg/internal';", "import pad from 'left-pad';", "import deep from 'left-pad/lib/x.js';", "import cond from 'cond-pkg';",
    "import condSub from 'cond-pkg/x';", "import str from 'str-pkg';", "import strSub from 'str-pkg/deep';", "import odd from 'odd-pkg/y';",
    "import gone from 'not-installed';", "import type { Request } from 'express';", "import chalk from 'chalk';", "import tool from 'dev-tool';",
    "import { ui } from '@shop/ui';", "import { extra } from 'shop/extra';", "import peer from 'peer-pkg';", "import alias from '@/missing';",
    "import hash from '#internal';", "import thing from 'virtual:thing';", "import { types } from './types';",
    'export const all = [readFileSync, statSync, EventEmitter, sub, feature, hidden, inner, pad, deep, cond, condSub, str, strSub, odd, gone, chalk, tool, ui, extra, peer, alias, hash, thing, types];',
    'export type Req = Request;', ''].join('\n'),
  'lib/extra.ts': 'export const extra = 1;\n',
  // A type-only import still requires a declared development dependency.
  'lib/types.ts': "import type { Tool } from 'dev-tool';\nexport type T = Tool;\nexport const types = 1;\n",
  'test/index.test.ts': "import { test } from 'vitest';\nimport tool from 'dev-tool';\nimport chalk from 'chalk';\ntest('runs', () => { tool(chalk); });\n",
  'packages/ui/package.json': manifest({ name: '@shop/ui', version: '1.0.0', private: true, main: 'src/index.ts' }),
  // The nearest manifest must declare imports even for a private workspace.
  'packages/ui/src/index.ts': "import pad from 'left-pad';\nexport const ui = pad;\n",
  'packages/kit/package.json': manifest({ name: '@shop/kit', version: '1.0.0', main: 'src/index.ts' }),
  // A public workspace package that a user installs alone does not get the packages of the workspace root.
  'packages/kit/src/index.ts': "import pad from 'left-pad';\nexport const kit = pad;\n",
};

const modules = {
  'node_modules/@scope/pkg': { name: '@scope/pkg', exports: { '.': './index.js', './sub': { import: './sub.mjs', require: './sub.cjs' }, './features/*.js': './features/*.js', './private/*': null } },
  'node_modules/left-pad': { name: 'left-pad', main: 'index.js' },
  'node_modules/cond-pkg': { name: 'cond-pkg', exports: { import: './a.mjs', require: './a.cjs' } },
  'node_modules/str-pkg': { name: 'str-pkg', exports: './index.js' },
  'node_modules/odd-pkg': { name: 'odd-pkg', exports: { '.': './a.js', import: './b.js' } },
  'node_modules/events': { name: 'events' },
  'node_modules/@types/express': { name: '@types/express' },
  'node_modules/dev-tool': { name: 'dev-tool' },
  'node_modules/vitest': { name: 'vitest' },
};

test('an import of a package that the nearest package.json does not declare is a lead; built-ins, workspace packages and self-references are not', (t) => {
  const { root } = repository(t, files, modules);
  const { packages, findings } = analyzed(root);
  assert.deepEqual(leadsOf(findings, 'PACKAGE-UNDECLARED'), [['lib/index.ts', 'chalk'], ['lib/index.ts', 'express'], ['packages/kit/src/index.ts', 'left-pad'], ['packages/ui/src/index.ts', 'left-pad'], ['test/index.test.ts', 'chalk']]);
  const kit = findings.find((item) => item.ruleId === 'PACKAGE-UNDECLARED' && item.location.path === 'packages/kit/src/index.ts');
  assert.deepEqual([kit.facts.manifest, kit.facts.declaredBy, kit.location.line], ['packages/kit/package.json', 'package.json', 1]);
  assert.match(kit.text, /packages\/kit\/package\.json does not declare left-pad/);
  assert.equal(findings.find((item) => item.location.path === 'test/index.test.ts' && item.ruleId === 'PACKAGE-UNDECLARED').facts.test, true);
  for (const item of findings.filter((entry) => entry.ruleId.startsWith('PACKAGE-'))) {
    assert.match(item.text, /static lead/, `${item.ruleId} says that it is a static lead`);
    assert.equal(item.source, 'graph');
  }
  assert.deepEqual(packages.skipped, { absolute: 0, loader: 0, 'subpath-import': 1, scheme: 1, 'invalid-name': 1, alias: 0, 'no-package': 0 });
  assert.deepEqual(packages.manifests.map((item) => [item.path, item.name, item.installed]),
    [['package.json', 'shop', true], ['packages/kit/package.json', '@shop/kit', true], ['packages/ui/package.json', '@shop/ui', true]]);
});

test('production value imports of development dependencies are low leads, but type and test imports are allowed', (t) => {
  const { root } = repository(t, files, modules);
  const { findings } = analyzed(root);
  const dev = findings.filter((item) => item.ruleId === 'PACKAGE-DEV-ONLY');
  assert.deepEqual(dev.map((item) => [item.location.path, item.facts.package, item.severity, item.capability]), [['lib/index.ts', 'dev-tool', 'low', 'C01']]);
  assert.match(dev[0].text, /only in devDependencies/);
});

test('declared packages without folders are leads, including peer dependencies', (t) => {
  const { root } = repository(t, files, modules);
  const { findings } = analyzed(root);
  assert.deepEqual(leadsOf(findings, 'PACKAGE-UNRESOLVED'), [['lib/index.ts', 'not-installed'], ['lib/index.ts', 'peer-pkg']]);
  const lead = findings.find((item) => item.ruleId === 'PACKAGE-UNRESOLVED');
  assert.deepEqual([lead.severity, lead.capability, lead.location.line], ['medium', 'C01', 15]);
});

test('subpaths that the exports field does not export are leads, and a form that Code-map cannot evaluate is unknown', (t) => {
  const { root } = repository(t, files, modules);
  const { packages, findings } = analyzed(root);
  assert.deepEqual(leadsOf(findings, 'PACKAGE-SUBPATH-NOT-EXPORTED'), [['lib/index.ts', '@scope/pkg/internal'], ['lib/index.ts', '@scope/pkg/private/x.js'],
    ['lib/index.ts', 'cond-pkg/x'], ['lib/index.ts', 'str-pkg/deep']]);
  const blocked = findings.find((item) => item.facts.specifier === '@scope/pkg/private/x.js');
  assert.deepEqual([blocked.facts.subpath, blocked.facts.folder], ['./private/x.js', 'node_modules/@scope/pkg']);
  assert.deepEqual(packages.unknown.exports.map((item) => [item.path, item.specifier, item.reason]), [['lib/index.ts', 'odd-pkg/y', 'mixed-keys']]);
});

test('the exports field: string, array, subpath, conditional and pattern forms, null targets and forms that Code-map cannot evaluate', () => {
  const state = (exports, subpath) => { const result = exportsSubpath(exports, subpath); return result.reason ? `${result.state}:${result.reason}` : result.state; };
  assert.equal(state('./index.js', '.'), 'exported');
  assert.equal(state('./index.js', './x'), 'not-exported');
  assert.equal(state(['./a.js', './b.js'], '.'), 'exported');
  assert.equal(state({ import: './a.mjs', default: './a.js' }, '.'), 'exported');
  assert.equal(state({ import: './a.mjs' }, './a'), 'not-exported');
  const map = { '.': './index.js', './sub': { node: { import: './s.mjs' }, default: null }, './gone': null, './lib/*': './lib/*.js', './lib/secret/*': null, './x/*.js': { types: './x/*.d.ts' } };
  assert.deepEqual(['.', './sub', './gone', './lib/a', './lib/secret/b', './x/y.js', './other'].map((subpath) => state(map, subpath)),
    ['exported', 'exported', 'not-exported', 'exported', 'not-exported', 'exported', 'not-exported'], 'the pattern with the longest prefix wins');
  assert.equal(state({ './sub': { default: null } }, './sub'), 'not-exported', 'a target whose conditions are all null exports nothing');
  assert.equal(state({ '.': './a.js', import: './b.js' }, '.'), 'unknown:mixed-keys');
  assert.equal(state({ './folder/': './folder/' }, './folder/a.js'), 'unknown:folder-mapping');
  assert.equal(state({ './a': 3 }, './a'), 'unknown:invalid-target');
  assert.equal(state({ './a': { './b': './c.js' } }, './a'), 'unknown:invalid-target');
  let deep = './a.js';
  for (let level = 0; level < 40; level++) deep = { default: deep };
  assert.equal(state(deep, '.'), 'unknown:too-deep');
});

test('without a node_modules folder the install checks do not run, and the summary records it as a gap', (t) => {
  const { store, json } = repository(t, files);
  const summary = json(['inspect', '--summary', '--ref', 'HEAD', '--store', store]);
  const count = (ruleId) => summary.findings.byRule.find((rule) => rule.ruleId === ruleId)?.count ?? 0;
  assert.deepEqual(['PACKAGE-UNDECLARED', 'PACKAGE-DEV-ONLY', 'PACKAGE-UNRESOLVED', 'PACKAGE-SUBPATH-NOT-EXPORTED'].map(count), [5, 1, 0, 0]);
  const gap = summary.gaps.find((item) => item.key === 'packagesNotInstalled');
  assert.equal(gap.count, 3, 'the root and both workspace packages');
  assert.match(gap.text, /package\.json/);
  assert.match(gap.text, /did not check/);
  const skipped = summary.gaps.find((item) => item.key === 'packageImportsUnchecked');
  assert.equal(skipped.count, 3);
  const item = summary.findings.items.find((entry) => entry.ruleId === 'PACKAGE-UNDECLARED' && entry.location.path === 'lib/index.ts' && entry.location.symbol === 'chalk');
  const report = json(item.next.split(' ').slice(1));
  assert.equal(report.finding.ruleId, 'PACKAGE-UNDECLARED');
  assert.deepEqual([report.details.lead.package, report.details.lead.lines, report.details.manifest.path, report.details.manifest.installed], ['chalk', [17], 'package.json', false]);
  assert.match(report.details.file, /--file lib\/index\.ts/);
  const inTest = summary.findings.items.find((entry) => entry.ruleId === 'PACKAGE-UNDECLARED' && entry.location.path === 'test/index.test.ts');
  assert.equal(json(inTest.next.split(' ').slice(1)).details.file, null, 'a test file is not a mapped source file');
});

test('an install after an analysis changes the analysis inputs, so the next summary analyzes again', (t) => {
  const { root, store, json } = repository(t, { 'package.json': manifest({ name: 'app', dependencies: { gone: '1.0.0' } }), 'src/index.ts': "import gone from 'gone';\nexport const a = gone;\n" });
  const before = json(['inspect', '--summary', '--worktree', '--store', store]);
  assert.ok(before.gaps.some((gap) => gap.key === 'packagesNotInstalled'));
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'node_modules', '.package-lock.json'), '{}\n');
  const after = json(['inspect', '--summary', '--worktree', '--store', store]);
  assert.notEqual(after.analysis.id, before.analysis.id);
  assert.equal(after.analysis.reused, false);
  assert.ok(after.findings.items.some((item) => item.ruleId === 'PACKAGE-UNRESOLVED'));
  const stale = json(['inspect', '--analysis', before.analysis.id, '--store', store]);
  assert.equal(stale.analysis.freshness.state, 'stale');
  assert.ok(stale.analysis.freshness.changed.includes('installed'));
});

test('package.json files: invalid JSON is listed, a file with only "type" still owns its folder, and the ignored folders are left out', () => {
  const { manifests, unreadable } = readManifests(new Map([['package.json', manifest({ name: 'root', dependencies: { a: '1' } })], ['src/esm/package.json', '{ "type": "module" }'],
    ['broken/package.json', '{ not json'], ['docs/example/package.json', manifest({ name: 'example' })], ['node_modules/x/package.json', manifest({ name: 'x' })]]));
  assert.deepEqual(unreadable, ['broken/package.json']);
  assert.deepEqual(manifests.map((item) => [item.path, item.owner]), [['package.json', true], ['src/esm/package.json', true]]);
  assert.equal(manifestIndex(manifests).nearest('src/esm/a.ts').path, 'src/esm/package.json', 'every manifest owns its folder');
});

test('installed packages: Node.js finds a package in a node_modules folder above the file, and an invalid package.json has unknown exports', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'code-map-installed-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  put('node_modules/a/package.json', manifest({ name: 'a', exports: './a.js' }));
  put('node_modules/b/package.json', '{ not json');
  put('packages/web/node_modules/c/package.json', manifest({ name: 'c' }));
  const view = installedPackages(root);
  assert.deepEqual([view.find('packages/web/src', 'a'), view.find('packages/web/src', 'c'), view.find('src', 'c'), view.find('src', 'missing')],
    ['node_modules/a', 'packages/web/node_modules/c', null, null]);
  assert.deepEqual([view.exportsOf('node_modules/a'), view.exportsOf('node_modules/b').state, view.exportsOf('packages/web/node_modules/c').state],
    [{ state: 'read', exports: './a.js' }, 'unreadable', 'none']);
  assert.equal(installedPackages(join(root, 'packages')).installed('.'), false, 'a folder without node_modules on its path is not installed');
});
