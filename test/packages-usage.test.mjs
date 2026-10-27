// Unused dependencies and orphaned files (C32): what counts as a use of a package, which files are entry points, which
// files stay unknown, and the NEW label of a newly orphaned file in a comparison with a base. Fixtures: test/packages-fixture.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzed, leadsOf, manifest, repository } from './packages-fixture.mjs';

/** A package whose dependencies are used in different ways, and source files that are entry points in different ways. */
const files = {
  'package.json': manifest({ name: 'app', version: '1.0.0', main: 'src/index.ts', bin: { app: 'src/cli.ts' },
    scripts: { gen: 'node src/tools/gen.ts', lint: 'eslint . && cli-only --fix', build: 'tsc -p .' },
    dependencies: { react: '19.0.0', 'used-pkg': '1.0.0', 'type-pkg': '1.0.0', 'cli-only': '1.0.0', 'config-only': '1.0.0', 'eslint-plugin-short': '1.0.0',
      'unused-pkg': '1.0.0', '@types/node': '20.0.0', typescript: '6.0.3' },
    devDependencies: { 'dev-unused': '1.0.0' } }),
  'babel.config.js': "module.exports = { plugins: ['config-only'] };\n",
  '.eslintrc.json': '{ "plugins": ["short"] }\n',
  'vite.config.ts': "export default { build: { rollupOptions: { input: 'src/configured.ts' } } };\n",
  'src/index.ts': "import { used } from 'used-pkg';\nimport type { T } from 'type-pkg';\nimport { View } from './view';\nimport { load } from './plugins/load';\nexport const app: T = [used, View, load];\n",
  'src/view.tsx': 'export const View = () => <p>hi</p>;\n',
  'src/cli.ts': 'export const cli = 1;\n',
  'src/tools/gen.ts': 'export const gen = 1;\n',
  'src/configured.ts': 'export const configured = 1;\n',
  'src/scripts/seed.ts': 'export const seed = 1;\n',
  'src/plugins/load.ts': 'export const load = (name: string) => import(`./${name}.ts`);\n',
  'src/plugins/a.ts': 'export const a = 1;\n',
  'src/only-tested.ts': 'export const tested = 1;\n',
  'src/types.d.ts': 'declare const brand: string;\n',
  'src/orphan.ts': 'export const lost = 1;\n',
  'test/only.test.ts': "import { test } from 'node:test';\nimport { tested } from '../src/only-tested';\ntest('t', () => { tested; });\n",
};

test('a dependency that no code file imports, and no script or config file names, is a low lead', (t) => {
  const { root } = repository(t, files);
  const { findings } = analyzed(root);
  const unused = findings.filter((item) => item.ruleId === 'PACKAGE-UNUSED');
  assert.deepEqual(unused.map((item) => [item.location.path, item.facts.package, item.severity, item.capability]), [['package.json', 'unused-pkg', 'low', 'C32']],
    'imports, type-only imports, scripts, config files, the short name of an ESLint plugin, a JSX runtime and @types are uses or skipped; devDependencies are not checked');
  assert.equal(unused[0].location.line, 20, 'the line of the dependency in package.json');
  assert.match(unused[0].text, /static lead/);
});

test('a source file without an importer is a low lead and a bounded template reaches its plugin files', (t) => {
  const { root } = repository(t, files);
  const { packages, findings } = analyzed(root);
  assert.deepEqual(leadsOf(findings, 'FILE-ORPHANED'), [['src/orphan.ts', null]],
    'the main and bin fields, a script, a config file, a scripts folder, a test importer and a declaration file are not leads');
  const orphan = findings.find((item) => item.ruleId === 'FILE-ORPHANED');
  assert.deepEqual([orphan.severity, orphan.capability, orphan.source], ['low', 'C32', 'graph']);
  assert.match(orphan.text, /static lead/);
  assert.deepEqual(packages.unknown.orphans, []);
});

test('Next.js route files and metadata files are entry points, and next accounts for react and react-dom', (t) => {
  const { root } = repository(t, {
    'package.json': manifest({ name: 'web', private: true, scripts: { dev: 'next dev' }, dependencies: { next: '15.1.0', react: '19.0.0', 'react-dom': '19.0.0' } }),
    'app/layout.tsx': 'export default function Layout({ children }: { children: unknown }) { return <html>{children}</html>; }\n',
    'app/page.tsx': "import { format } from '../lib/format';\nexport default function Page() { return <p>{format(1)}</p>; }\n",
    'app/opengraph-image.tsx': 'export default function Image() { return null; }\n',
    'app/lonely.tsx': 'export const Lonely = () => null;\n',
    'lib/format.ts': 'export const format = (value: number) => String(value);\n',
    'lib/unused.ts': 'export const unused = 1;\n',
  });
  const { findings } = analyzed(root);
  assert.deepEqual(leadsOf(findings, 'FILE-ORPHANED'), [['app/lonely.tsx', null], ['lib/unused.ts', null]]);
  assert.deepEqual(leadsOf(findings, 'PACKAGE-UNUSED'), []);
});

test('an entry point or a script path in build output maps back to its source file; a style target and a TOML config are not unknown', (t) => {
  const { root } = repository(t, {
    'package.json': manifest({ name: 'lib', main: 'dist/index.js', types: 'dist/index.d.ts', exports: { './cli': './build/cli.js', './styles.css': './dist/styles.css' },
      scripts: { start: 'node dist/server.js' } }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { rootDir: 'src', outDir: 'dist' } }),
    'wrangler.toml': 'main = "src/worker.ts"\n',
    'src/index.ts': 'export const a = 1;\n', 'src/cli.ts': 'export const cli = 1;\n', 'src/server.ts': 'export const server = 1;\n', 'src/worker.ts': 'export const worker = 1;\n',
    'src/styles.css': '.a {}\n', 'src/lost.ts': 'export const lost = 1;\n',
  });
  const { packages, findings } = analyzed(root);
  assert.deepEqual(leadsOf(findings, 'FILE-ORPHANED'), [['src/lost.ts', null]]);
  assert.deepEqual(packages.unknown.orphans, []);
});

test('a file that is orphaned only in the head is NEW in a comparison with the base, and a dependency that the head imports is RESOLVED', (t) => {
  const { store, put, git, json } = repository(t, {
    'package.json': manifest({ name: 'app', main: 'src/index.ts', dependencies: { 'used-pkg': '1.0.0', 'later-pkg': '1.0.0' } }),
    'src/index.ts': "import { feature } from './feature';\nimport { used } from 'used-pkg';\nexport const app = [feature, used];\n",
    'src/feature.ts': 'export const feature = 1;\n',
    'src/old.ts': 'export const old = 1;\n',
  });
  put('src/index.ts', "import { later } from 'later-pkg';\nexport const app = [later];\n");
  git('commit', '-qam', 'drop the feature import');
  const summary = json(['inspect', '--summary', '--ref', 'HEAD', '--base', 'HEAD~1', '--store', store]);
  assert.equal(summary.comparison.state, 'COMPARABLE');
  const label = (ruleId, path, name = null) => summary.findings.items.find((item) => item.ruleId === ruleId && item.location.path === path && (name === null || item.location.symbol === name))?.baseline;
  assert.equal(label('FILE-ORPHANED', 'src/feature.ts'), 'NEW', 'the file had an importer in the base');
  assert.equal(label('FILE-ORPHANED', 'src/old.ts'), 'EXISTING');
  assert.equal(label('PACKAGE-UNUSED', 'package.json', 'used-pkg'), 'NEW');
  const resolved = summary.comparison.resolved.items.find((item) => item.ruleId === 'PACKAGE-UNUSED');
  assert.deepEqual([resolved.location.symbol, resolved.matchedBy], ['later-pkg', 'absent'], 'the package.json is still there');
  const report = json(summary.findings.items.find((item) => item.ruleId === 'FILE-ORPHANED' && item.baseline === 'NEW').next.split(' ').slice(1));
  assert.deepEqual([report.details.lead.path, report.details.manifest.path], ['src/feature.ts', 'package.json']);
});


test('a computed target retains unknown orphan leads for its fixed prefix', (t) => {
  const { root } = repository(t, { ...files, 'src/plugins/load.ts': "export const load = name => import('./' + name + '.ts');\n" });
  const { packages } = analyzed(root);
  assert.deepEqual(packages.unknown.orphans, [{ path: 'src/plugins/a.ts', manifest: 'package.json', reason: 'dynamic-import', via: 'src/plugins/load.ts' }]);
});
