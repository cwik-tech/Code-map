// Discovery evidence uses real snapshots and pure aggregation.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { expandPatterns } from '../lib/dynamic-patterns.mjs';
import { compareAreas } from '../lib/complexity-areas.mjs';
import { completenessTable } from '../lib/completeness.mjs';
import { openFileCache } from '../lib/file-cache.mjs';
import { collect, mapData } from '../lib/build.mjs';
import { defaults } from '../lib/project.mjs';
import { summaryReport } from '../lib/overview.mjs';

function fixture(t, entries) {
  const root = mkdtempSync(join(tmpdir(), 'discovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(entries)) {
    mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text);
  }
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@local', 'commit', '-qm', 'fixture']);
  return root;
}

test('template imports reach matching siblings and preserve unmatched and computed targets', () => {
  const paths = ['src/main.ts', 'src/locales/en.json', 'src/locales/fr.json', 'src/locales/de.ts', 'src/locales/nested/en.json'];
  const resolve = createResolver(new Set(paths), { aliases: [], baseUrl: null });
  const parsed = analyzeFile(paths[0], 'import(`./locales/${lang}.json`); import(`./absent/${lang}.json`); import(target);', resolve);
  const facts = expandPatterns(parsed, paths);
  assert.deepEqual(facts.imports, ['src/locales/en.json', 'src/locales/fr.json']);
  assert.deepEqual(facts.edges.slice(0, 2).map((e) => [e.target, e.kind, e.mode]), [
    ['src/locales/en.json', 'dynamic-pattern', 'dynamic'], ['src/locales/fr.json', 'dynamic-pattern', 'dynamic']]);
  assert.deepEqual(facts.edges.slice(2).map((e) => [e.target, e.specifier]), [[null, null], [null, null]]);
  assert.equal(parsed.imports.length, 0, 'cached parse facts remain unchanged');
  assert.equal(expandPatterns(parsed, [...paths, 'src/locales/es.json']).imports.length, 3);
});

test('area complexity includes all functions of changed files and whole containing folders', () => {
  const file = (path, values) => ({ path, declarations: values.map((cognitive, i) => ({ name: `fn${i}`, complexity: { cognitive, cyclomatic: 1, nesting: 0 } })) });
  const base = { files: [file('src/a.ts', [1, 3]), file('src/b.ts', [7]), file('src/gone.ts', [2])] };
  const head = { files: [file('src/a.ts', [2, 4]), file('src/b.ts', [7]), file('src/new.ts', [])] };
  const result = compareAreas(base, head, ['src/a.ts', 'src/gone.ts', 'src/new.ts']);
  assert.deepEqual(result.files.map((r) => [r.path, r.base, r.head]), [
    ['src/a.ts', { sum: 4, max: 3 }, { sum: 6, max: 4 }],
    ['src/gone.ts', { sum: 2, max: 2 }, null], ['src/new.ts', null, { sum: 0, max: 0 }]]);
  assert.deepEqual(result.folders.find((r) => r.path === 'src'), { path: 'src', base: { sum: 13, max: 7 }, head: { sum: 13, max: 7 }, delta: { sum: 0, max: 0 } });
});

test('completeness counts each stack, malformed files, skipped files and unresolved expressions', () => {
  const files = [{ path: 'a.ts', syntax: { errors: 0 }, edges: [{ target: null, specifier: null }] },
    { path: 'a.js', syntax: { errors: 1 }, edges: [] }, { path: 'a.jsx', syntax: { errors: 0 }, edges: [] },
    { path: 'a.tsx', syntax: { errors: 0 }, edges: [] }];
  const table = completenessTable({ paths: ['a.ts', 'a.js', 'a.jsx', 'a.tsx', 'a.json', 'a.css', 'a.py'], files, texts: new Map([['a.json', '{}']]) });
  assert.deepEqual(table.map((r) => [r.stack, r.discovered, r.supported, r.parsed, r.skipped, r.malformed, r.dynamicallyUnresolved]), [
    ['TypeScript', 1, 1, 1, 0, 0, 1], ['JavaScript', 1, 1, 1, 0, 1, 0],
    ['JSX and TSX', 2, 2, 2, 0, 0, 0], ['JSON', 1, 1, 1, 0, 0, 0],
    ['CSS', 1, 0, 0, 1, 0, 0], ['Python', 1, 0, 0, 1, 0, 0], ['other', 0, 0, 0, 0, 0, 0]]);
});

test('summary exposes collector completeness and pattern reachability with configuration plugin use', (t) => {
  const root = fixture(t, { 'package.json': '{"dependencies":{"example-plugin":"1"}}',
    'src/main.ts': 'export const load = lang => import(`./locales/${lang}.js`);',
    'src/locales/en.js': 'export const value = 1;', 'src/view.jsx': 'export const view = <div/>;',
    'src/view.tsx': 'export const view = <div/>;', 'data.json': '{}', 'src/site.css': 'body{}', 'extra.py': 'pass',
    'tool.config.json': '{"plugins":["example-plugin"]}' });
  const facts = collect(root, defaults, { worktree: true });
  const data = mapData(root, defaults, facts, 1, true);
  const stored = { id: 'A-fixture', inputs: {}, findings: [], data };
  const summary = summaryReport(stored, { id: stored.id, command: (args) => args.join(' ') });
  assert.equal(summary.completeness.find((row) => row.stack === 'JSX and TSX').parsed, 2);
  assert.deepEqual(data.files.find((file) => file.path === 'src/main.ts').imports, ['src/locales/en.js']);
  assert.equal(data.analysis.packages.leads.orphaned.some((lead) => lead.path === 'src/locales/en.js'), false);
  assert.deepEqual(data.analysis.packages.leads.unused, []);
});

test('root-level patterns keep literal import names and exclude nested or outside paths', () => {
  const paths = ['main.ts', 'one.js', 'nested/two.js'];
  const resolver = createResolver(new Set(paths), { aliases: [], baseUrl: null });
  const parsed = analyzeFile('main.ts', 'import { one } from "./one.js"; import(`./${name}.js`); import(`../${name}.js`);', resolver);
  const expanded = expandPatterns(parsed, paths);
  assert.equal(expanded.edges.filter((edge) => edge.kind === 'dynamic-pattern').length, 1);
  assert.deepEqual(expanded.uses['one.js'], ['one', '*']);
  assert.equal(expanded.edges.at(-1).target, null);
});

test('multiple template interpolations retain literal separators and cannot overlap prefix and suffix', () => {
  const paths = ['main.ts', 'locale-en-US.json', 'locale-fr-FR.json', 'locale.json', 'foo.js'];
  const resolver = createResolver(new Set(paths), { aliases: [], baseUrl: null });
  const file = analyzeFile('main.ts', 'import(`./locale-${lang}-${region}.json`); import(`./foo${name}foo.js`);', resolver);
  assert.deepEqual(expandPatterns(file, paths).imports, ['locale-en-US.json', 'locale-fr-FR.json']);
  assert.equal(expandPatterns(file, paths).edges.at(-1).target, null);
});

test('completeness counts two unresolved imports on the same line separately', () => {
  const file = analyzeFile('main.ts', 'import(first); import(second);', () => null);
  assert.equal(completenessTable({ paths: ['main.ts'], files: [file], texts: new Map() })[0].dynamicallyUnresolved, 2);
});

test('matched patterns do not hide unmatched siblings from orphan checks or mark Next.js wiring unknown', (t) => {
  const root = fixture(t, { 'package.json': '{"dependencies":{"next":"1"}}',
    'src/app/page.ts': 'export const load = lang => import(`./locales/${lang}.json`);',
    'src/app/locales/en.json': '{}', 'src/app/locales/unrelated.ts': 'export const unused = 1;' });
  const facts = collect(root, defaults, { worktree: true });
  const data = mapData(root, defaults, facts, 1, true);
  assert.equal(data.analysis.packages.leads.orphaned.some((lead) => lead.path === 'src/app/locales/unrelated.ts'), true);
  assert.equal(data.analysis.frameworks.nextjs.unclassified.some((lead) => lead.reason === 'dynamic-import'), false);
});

test('area comparisons omit non-source changes and preserve uncertain moves as separate files', () => {
  const file = (path) => ({ path, declarations: [] });
  const base = { files: [file('old.ts')] }, head = { files: [file('new.ts')] };
  const result = compareAreas(base, head, ['old.ts', 'new.ts', 'README.md'], [{ from: 'old.ts', to: 'new.ts', similarity: 0 }]);
  assert.deepEqual(result.files.map((row) => row.path), ['new.ts', 'old.ts']);
  assert.equal(result.files[0].base, null);
  assert.equal(result.files[1].head, null);
});


test('a cache hit expands against newly discovered pattern targets', (t) => {
  const root = fixture(t, { 'src/main.ts': 'export const load = name => import(`./locales/${name}.json`);', 'src/locales/en.json': '{}' });
  const store = mkdtempSync(join(tmpdir(), 'discovery-cache-'));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  const initial = openFileCache(store);
  assert.deepEqual(collect(root, defaults, { worktree: true }, initial).files[0].imports, ['src/locales/en.json']);
  initial.finish();
  writeFileSync(join(root, 'src/locales/fr.json'), '{}');
  const reused = openFileCache(store);
  assert.deepEqual(collect(root, defaults, { worktree: true }, reused).files[0].imports, ['src/locales/en.json', 'src/locales/fr.json']);
  assert.equal(reused.finish().hits, 1);
});

test('cognitive totals count nested functions once and retain unknown historical values', () => {
  const file = { path: 'src/main.ts', declarations: [{ name: 'outer', complexity: { cyclomatic: 1, nesting: 0, cognitive: 2,
    functions: [{ name: 'inner', cyclomatic: 1, nesting: 0, cognitive: 3 }] } }] };
  const area = compareAreas({ files: [] }, { files: [file] }, [file.path]);
  assert.deepEqual(area.files[0].head, { sum: 5, max: 3 });
  const legacy = { ...file, declarations: [{ name: 'legacy', complexity: { cyclomatic: 1, nesting: 0 } }] };
  assert.equal(compareAreas({ files: [legacy] }, { files: [file] }, [file.path]).files[0].base, null);
});
