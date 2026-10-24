// Regressions for style uses and runtime-provided development packages.
import assert from 'node:assert/strict';
import { rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { sourceReader } from '../lib/git.mjs';
import { readStyles } from '../lib/packages/styles.mjs';
import { test } from 'node:test';
import { analyzed, leadsOf, manifest, repository } from './packages-fixture.mjs';

test('style directives use packages across style extensions and preserve unused leads', (t) => {
  const repo = repository(t, {
    'package.json': manifest({ dependencies: { 'tw-animate-css': '*', '@scope/theme': '*', sass: '*', plugin: '*', config: '*', extra: '*', unused: '*', ignored: '*' } }),
    'app/page.ts': 'export const page = 1;',
    'app/globals.css': "/* @import 'unused'; */\n@import 'tw-animate-css';\n@import url(~@scope/theme/base.css);",
    'app/theme.scss': '@use "~sass/theme";',
    'app/theme.sass': '@forward "extra/base"',
    'app/theme.less': '@plugin url("plugin");',
    'app/theme.pcss': '@config "config/theme";',
    'dist/generated.css': '@import "ignored";',
    'node_modules/generated.css': '@import "ignored";',
  });
  assert.deepEqual(leadsOf(analyzed(repo.root).findings, 'PACKAGE-UNUSED'), [['package.json', 'ignored'], ['package.json', 'unused']]);
});

test('Electron and type-only imports do not give dev-only leads, but runtime imports still do', (t) => {
  const repo = repository(t, {
    'package.json': manifest({ devDependencies: { electron: '*', types: '*', runtime: '*' } }),
    'src/main.ts': "import { app } from 'electron'; import { ipcRenderer } from 'electron/renderer'; import type { T } from 'types'; import { type U } from 'types/sub'; import { run } from 'runtime'; export { app, ipcRenderer, run };",
  });
  assert.deepEqual(leadsOf(analyzed(repo.root).findings, 'PACKAGE-DEV-ONLY'), [['src/main.ts', 'runtime']]);
});

test('style reads skip oversized files and stop at the total byte budget', (t) => {
  const repo = repository(t, {
    'package.json': manifest({ dependencies: { large: '*', overflow: '*', used: '*' } }),
    'src/index.ts': 'export const value = 1;',
  });
  const directive = '@import "used";';
  const full = directive + ' '.repeat(1024 * 1024 - directive.length);
  Array.from({ length: 16 }, (_, index) => repo.put(`styles/a${String(index).padStart(2, '0')}.css`, full));
  repo.put('styles/b-large.css', '@import "large";' + ' '.repeat(1024 * 1024));
  repo.put('styles/z-overflow.css', '@import "overflow";');
  repo.git('add', 'styles');
  repo.git('commit', '-qm', 'style byte limits');
  assert.deepEqual(leadsOf(analyzed(repo.root).findings, 'PACKAGE-UNUSED'), [['package.json', 'large'], ['package.json', 'overflow']]);
});

test('editing a style import changes the working-tree analysis identity', (t) => {
  const repo = repository(t, {
    'package.json': manifest({ dependencies: { theme: '*' } }),
    'src/index.ts': 'export const value = 1;',
    'src/theme.css': '@import "theme";',
  });
  const before = repo.json(['inspect', '--worktree', '--summary', '--store', repo.store]);
  repo.put('src/theme.css', 'body {}');
  const after = repo.json(['inspect', '--worktree', '--summary', '--store', repo.store]);
  assert.notEqual(after.analysis.id, before.analysis.id);
});

test('style import lists count each target while comments and string contents do not count', (t) => {
  const repo = repository(t, {
    'package.json': manifest({ dependencies: { first: '*', second: '*', third: '*', commented: '*', quoted: '*' } }),
    'src/index.ts': 'export const value = 1;',
    'styles/theme.scss': [
      '// @use "commented";',
      '.x { content: \'@import "quoted";\'; }',
      '@import "first", url("~second/base.css"), "third";',
    ].join('\n'),
  });
  assert.deepEqual(leadsOf(analyzed(repo.root).findings, 'PACKAGE-UNUSED'), [['package.json', 'commented'], ['package.json', 'quoted']]);
});


test('style reads do not follow a symlink in a parent directory', (t) => {
  const repo = repository(t, {
    'package.json': manifest({ dependencies: { theme: '*' } }),
    'styles/theme.css': '@import "theme";',
    'target/theme.css': '@import "theme";',
  });
  rmSync(join(repo.root, 'styles'), { recursive: true });
  symlinkSync(join(repo.root, 'target'), join(repo.root, 'styles'));
  const reader = sourceReader(repo.root, null);
  assert.deepEqual([...readStyles(['package.json', 'styles/theme.css'], reader)], []);
});
