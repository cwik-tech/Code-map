import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { collect, mapData } from '../lib/build.mjs';
import { gaps } from '../lib/overview-gaps.mjs';
import { defaults, detectRoots, outsideRoots } from '../lib/project.mjs';

function fixture(t, manifest, roots, ref = null) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-roots-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = { 'package.json': JSON.stringify(manifest), 'src/app.ts': 'export const app = 1;',
    'electron/main.ts': "import { app } from '../src/app'; export const main = app;", 'scripts/build.ts': 'export const build = 1;' };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@local', ...args]);
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'fixture');
  const config = { ...defaults, ...(roots === undefined ? {} : { roots }) };
  const facts = collect(root, config, ref === null ? { worktree: true } : { ref });
  const data = mapData(root, config, facts, 1, ref === null);
  return { facts, data, gap: gaps({ data }).find((item) => item.key === 'outsideRoots') };
}

test('Electron devDependency maps the main process and reports scripts outside roots', (t) => {
  const { facts, data, gap } = fixture(t, { devDependencies: { electron: '1.0.0' } });
  assert.deepEqual(facts.roots, ['src', 'electron']);
  assert.ok(data.analysis.files.some((file) => file.path === 'electron/main.ts'));
  assert.equal(gap?.count, 1);
  assert.match(gap?.text ?? '', /scripts \(1\)/);
  assert.match(gap.text, /Add the folders to "roots" in \.code-map\.json/);
});

test('a project without Electron keeps src and reports electron and scripts outside roots', (t) => {
  const { facts, gap } = fixture(t, {});
  assert.deepEqual(facts.roots, ['src']);
  assert.equal(facts.files.some((file) => file.path === 'electron/main.ts'), false);
  assert.equal(gap?.count, 2);
  assert.match(gap?.text ?? '', /electron \(1\), scripts \(1\)/);
});

test('configured roots override the Electron default', (t) => {
  const { facts, gap } = fixture(t, { devDependencies: { electron: '1.0.0' } }, ['src', 'scripts']);
  assert.deepEqual(facts.roots, ['src', 'scripts']);
  assert.equal(facts.files.some((file) => file.path === 'electron/main.ts'), false);
  assert.equal(gap?.count, 1);
  assert.match(gap?.text ?? '', /electron \(1\)/);
});

test('a committed snapshot with an Electron dependency maps the main process', (t) => {
  const { facts } = fixture(t, { dependencies: { electron: '1.0.0' } }, undefined, 'HEAD');
  assert.deepEqual(facts.roots, ['src', 'electron']);
});

test('mapping all configured folders leaves no outside-roots gap', (t) => {
  const { gap } = fixture(t, {}, ['src', 'electron', 'scripts']);
  assert.equal(gap, undefined);
});

test('outside-root folder counts include all files beyond the path sample', () => {
  const paths = [...Array.from({ length: 60 }, (_, i) => `scripts/file${i}.ts`),
    ...Array.from({ length: 12 }, (_, i) => `folder${i}/file.ts`), 'tool.ts',
    'tests/extra.ts', 'electron/main.test.ts', 'dist/generated.ts', 'types.d.ts'];
  const outside = outsideRoots(paths, ['src']);
  assert.equal(outside.count, 73);
  assert.equal(outside.paths.length, 50);
  assert.deepEqual(outside.folders[0], { folder: 'scripts', count: 60 });
  assert.ok(outside.folders.some((item) => item.folder === '.' && item.count === 1));
  assert.equal(outside.folders.length, 14);
  const [gap] = gaps({ data: { analysis: { files: [], outsideRoots: outside } } }).filter((item) => item.key === 'outsideRoots');
  assert.equal(gap.count, 72);
  assert.match(gap.text, /^72 code files outside the source roots are not mapped: scripts \(60\)/);
  assert.match(gap.text, /3 other folders/);
  assert.doesNotMatch(gap.text, /(^|\s)\. \(/);
  assert.equal((gap.text.match(/\(\d+\)/g) ?? []).length, 10);
});

test('top-level files give no outside-roots gap, and one file reads in the singular', () => {
  const only = outsideRoots(['src/a.ts', 'vite.config.ts', 'eslint.config.js'], ['src']);
  assert.equal(only.count, 2);
  assert.equal(gaps({ data: { analysis: { files: [], outsideRoots: only } } }).some((item) => item.key === 'outsideRoots'), false);
  const one = outsideRoots(['src/a.ts', 'scripts/build.ts'], ['src']);
  const [gap] = gaps({ data: { analysis: { files: [], outsideRoots: one } } }).filter((item) => item.key === 'outsideRoots');
  assert.match(gap.text, /^1 code file outside the source roots is not mapped: scripts \(1\)\./);
});

for (const manifest of ['null', '{', '{"dependencies":null}', '{"electron":"1"}', '{"devDependencies":{"electron":42}}']) {
  test(`invalid or unrelated Electron metadata keeps src: ${manifest}`, () => {
    assert.deepEqual(detectRoots(['src/app.ts', 'electron/main.ts'], {}, manifest), ['src']);
  });
}

test('Electron requires non-test code in the top-level electron folder', () => {
  assert.deepEqual(detectRoots(['src/app.ts', 'electron/main.test.ts', 'electron/main.d.ts', 'packages/electron/main.ts'], {},
    '{"devDependencies":{"electron":"1"}}'), ['src']);
});
