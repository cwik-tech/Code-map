import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const run = (root, args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
const json = (output) => { assert.equal(output.status, 0, output.stderr); return JSON.parse(output.stdout); };
function words(command) {
  const out = [];
  for (const match of command.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)) out.push(match[1] !== undefined ? match[1].replaceAll("'\\''", "'") : match[2]);
  return out;
}
function follow(root, command) {
  const [program, ...args] = words(command);
  assert.equal(program, 'code-map');
  return json(run(root, args));
}
/** A repository with one commit for each step. A step maps paths to their text; null deletes the file. */
function commits(t, ...steps) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-api-')), store = mkdtempSync(join(tmpdir(), 'code-map-api-store-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); });
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  git('init', '-q');
  for (const step of steps) {
    for (const [path, text] of Object.entries(step)) {
      if (text === null) rmSync(join(root, path));
      else { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); }
    }
    git('add', '-A'); git('commit', '-qm', 'step');
  }
  const summary = (...more) => json(run(root, ['inspect', '--summary', '--ref', 'HEAD', '--base', 'HEAD~1', '--store', store, ...more]));
  return { root, store, git, summary };
}
const find = (page, name) => page.items.find((item) => item.name === name);
const brief = (item) => [item.status, item.name, item.reasons];

test('a removed export lists the head files that still import it, also files that the change did not touch', (t) => {
  const { root, summary } = commits(t, {
    'src/lib/a.ts': 'export function keep(a: string): string { return a; }\nexport function drop(a: string): string { return a; }\n',
    'src/use.ts': "import { drop } from './lib/a';\nexport const used = drop('x');\n",
    'src/ns.ts': "import * as a from './lib/a';\nexport const viaNamespace = a.keep;\n",
    'src/lib/gone.ts': 'export const gone = 1;\n',
    'src/gone-user.ts': "import { gone } from './lib/gone';\nexport const kept = gone;\n",
    'test/a.test.ts': "import { test } from 'node:test';\nimport { drop } from '../src/lib/a';\ntest('drop', () => { drop('x'); });\n",
  }, { 'src/lib/a.ts': 'export function keep(a: string): string { return a; }\n', 'src/lib/gone.ts': null });
  const { api } = summary();
  assert.equal(api.state, 'COMPARABLE');
  assert.deepEqual(api.module.counts, { removed: 2, changed: 0, unknown: 0, added: 0, unchanged: 4 });
  assert.deepEqual(api.public.counts, { removed: 0, changed: 0, unknown: 0, added: 0, unchanged: 0 });
  assert.deepEqual(api.module.examples.map((item) => [item.path, item.name]), [['src/lib/a.ts', 'drop'], ['src/lib/gone.ts', 'gone']], 'the export with most consumers comes first');
  const removed = follow(root, api.next.removed);
  assert.equal(removed.reportType, 'code-map-api-changes');
  assert.deepEqual(find(removed.page, 'drop').consumers, { total: 3, items: [{ path: 'src/ns.ts', line: 1, via: 'namespace' }, { path: 'src/use.ts', line: 1, via: 'name' },
    { path: 'test/a.test.ts', line: 2, via: 'name' }] });
  assert.deepEqual(find(removed.page, 'drop').base, { kind: 'function', text: 'function drop(a: string): string', digest: find(removed.page, 'drop').base.digest, inferred: false });
  assert.equal(find(removed.page, 'drop').head, null);
  assert.deepEqual(find(removed.page, 'gone').reasons, ['file-removed']);
  assert.deepEqual(find(removed.page, 'gone').consumers.items, [{ path: 'src/gone-user.ts', line: 1, via: 'unresolved' }]);
});

test('a renamed file keeps its exports; parameter, overload, inferred, type and added changes get their own status', (t) => {
  const filler = Array.from({ length: 30 }, (_, index) => `// Line ${index} of a header that keeps the move similar.`).join('\n');
  const before = [filler, 'export function f(a: string): string { return a; }', 'export function o(a: string): string;', 'export function o(a: number): number;',
    'export function o(a: any) { return a; }', 'export function g(a: number) { return a; }', 'export function h(a: number) { return a; }', 'export type Id = string;', ''].join('\n');
  const after = [filler, 'export function f(a: string, b: number): string { return a; }', 'export function o(a: string): string;', 'export function o(a: number): number;',
    'export function o(a: boolean): boolean;', 'export function o(a: any) { return a; }', 'export function g(a: number) { return String(a); }', 'export function h(a: number) { return a; }',
    'export type Id = number;', 'export const added = 2;', ''].join('\n');
  const user = (folder) => `import { f, o, g, h } from './${folder}/name';\nimport type { Id } from './${folder}/name';\nexport const all = [f, o, g, h];\nexport type Key = Id;\n`;
  const { root, summary } = commits(t, { 'src/old/name.ts': before, 'src/user.ts': user('old') }, { 'src/old/name.ts': null, 'src/new/name.ts': after, 'src/user.ts': user('new') });
  const { api } = summary();
  assert.deepEqual(api.module.counts, { removed: 0, changed: 3, unknown: 1, added: 1, unchanged: 3 });
  const page = follow(root, api.next.all);
  assert.deepEqual(page.page.items.map(brief), [['CHANGED', 'f', ['signature']], ['CHANGED', 'Id', ['signature']], ['CHANGED', 'o', ['overloads']],
    ['UNKNOWN', 'g', ['inferred']], ['ADDED', 'added', []]], 'inside one status, by the number of consumers and then by path and name');
  for (const item of page.page.items) assert.deepEqual([item.path, item.basePath], ['src/new/name.ts', 'src/old/name.ts']);
  const f = find(page.page, 'f');
  assert.deepEqual([f.base.text, f.head.text], ['function f(a: string): string', 'function f(a: string, b: number): string']);
  assert.deepEqual(f.consumers.items, [{ path: 'src/user.ts', line: 1, via: 'name' }]);
  assert.deepEqual([find(page.page, 'o').base.overloads, find(page.page, 'o').head.overloads], [2, 3]);
  assert.deepEqual([find(page.page, 'Id').base.text, find(page.page, 'Id').head.text], ['type Id = string', 'type Id = number']);
  assert.deepEqual([find(page.page, 'g').base.inferred, find(page.page, 'g').head.inferred], [true, true]);
  assert.equal(find(page.page, 'added').consumers, null, 'an added export has no consumer list');
});

test('the exports of a package entry point are public API, with re-exports followed to the declaring file', (t) => {
  const { root, summary } = commits(t, {
    'package.json': JSON.stringify({ name: 'pkg', exports: { '.': './src/index.ts' } }),
    'src/index.ts': "export { f } from './lib/f';\nexport * from './lib/g';\nexport const local = 1;\n",
    'src/lib/f.ts': 'export function f(a: string): string { return a; }\n',
    'src/lib/g.ts': 'export function g(): void {}\n',
  }, { 'src/lib/f.ts': 'export function f(a: string, b?: number): string { return a; }\n', 'src/lib/g.ts': 'export function g2(): void {}\n' });
  const { api } = summary();
  assert.deepEqual(api.entryPoints.head, { total: 1, files: [{ path: 'src/index.ts', package: 'package.json', fields: ['exports'] }] });
  assert.deepEqual(api.public.counts, { removed: 0, changed: 1, unknown: 0, added: 0, unchanged: 1, renamed: 1 });
  assert.deepEqual(api.module.counts, { removed: 0, changed: 1, unknown: 0, added: 0, unchanged: 0, renamed: 1 });
  const publicPage = follow(root, api.next.all.replace('--api all', '--api all --api-group public'));
  assert.deepEqual(publicPage.filter, { status: 'all', group: 'public' });
  assert.deepEqual(publicPage.page.items.map((item) => [item.group, item.path, item.name, item.status]),
    [['public', 'src/index.ts', 'f', 'CHANGED'], ['public', 'src/index.ts', 'g', 'RENAMED']]);
  assert.deepEqual(find(publicPage.page, 'g').pair, { from: 'g', to: 'g2' });
  const f = find(publicPage.page, 'f');
  assert.deepEqual([f.base.declaredIn, f.head.declaredIn, f.head.text], ['src/lib/f.ts', 'src/lib/f.ts', 'function f(a: string, b?: number): string']);
  const modulePage = follow(root, api.next.all.replace('--api all', '--api all --api-group module'));
  assert.ok(modulePage.page.items.every((item) => item.group === 'module' && item.path.startsWith('src/lib/')));
});

test('the API changes page in the printed page shape, and its options are checked', (t) => {
  const many = Array.from({ length: 25 }, (_, index) => `export const n${index} = ${index};`).join('\n');
  const { root, store, summary } = commits(t, { 'src/a.ts': 'export const a = 1;\n' }, { 'src/a.ts': `export const a = 1;\n${many}\n` });
  const { api, analysis, comparison } = summary();
  assert.equal(api.module.counts.added, 25);
  assert.deepEqual(api.module.examples, [], 'the summary shows no added export inline');
  const first = follow(root, api.next.added);
  assert.deepEqual(Object.keys(first.page), ['total', 'offset', 'limit', 'items', 'next']);
  assert.deepEqual([first.page.total, first.page.offset, first.page.limit, first.page.items.length], [25, 0, 20, 20]);
  const after = (command, option) => { const list = words(command); return list.includes(option) ? list[list.indexOf(option) + 1] : undefined; };
  assert.equal(after(first.page.next, '--offset'), '20');
  assert.equal(after(first.page.next, '--limit'), undefined, 'the default page size is not repeated');
  const second = follow(root, first.page.next);
  assert.deepEqual([second.page.items.length, second.page.next], [5, null]);
  const small = json(run(root, ['inspect', '--analysis', analysis.id, '--base-analysis', comparison.base.id, '--api', 'all', '--limit', '5', '--store', store]));
  assert.deepEqual([after(small.page.next, '--offset'), after(small.page.next, '--limit')], ['5', '5']);
  const fails = (args, pattern) => { const output = run(root, [...args, '--store', store]); assert.notEqual(output.status, 0); assert.match(output.stderr, pattern); assert.equal(output.stdout, ''); };
  fails(['inspect', '--analysis', analysis.id, '--api', 'added'], /--api needs --base-analysis/);
  fails(['inspect', '--analysis', analysis.id, '--base-analysis', comparison.base.id, '--api', 'gone'], /--api must be one of all, removed, changed, unknown, added/);
  fails(['inspect', '--analysis', analysis.id, '--base-analysis', comparison.base.id, '--api', 'all', '--api-group', 'other'], /--api-group must be public or module/);
  fails(['inspect', '--analysis', analysis.id, '--base-analysis', comparison.base.id, '--api', 'all', '--findings'], /Use either --api or --findings/);
  fails(['inspect', '--analysis', analysis.id, '--api-group', 'public'], /--api-group needs --api/);
  fails(['inspect', '--api', 'all'], /--api needs --analysis/);
});

test('when the API did not change, the comparison preserves its fields and adds API, impact and policy information', (t) => {
  const { root, store, summary } = commits(t,
    { 'src/a.ts': 'export function f(a: string): string { return a; }\n', 'src/b.ts': "import { f } from './a';\nexport const b = f('x');\n" },
    { 'src/a.ts': 'export function f(a: string): string { return a + a; }\n' });
  const compared = summary();
  const counts = { removed: 0, changed: 0, unknown: 0, added: 0 };
  assert.deepEqual([compared.api.public.counts, compared.api.module.counts], [{ ...counts, unchanged: 0 }, { ...counts, unchanged: 2 }]);
  assert.deepEqual([compared.api.public.examples, compared.api.module.examples], [[], []]);
  const fields = ['reportType', 'schemaVersion', 'hotspotWindow', 'analysis', 'snapshot', 'scope', 'verification', 'findings', 'comparison', 'completeness', 'gaps', 'tests', 'frameworks', 'architecture', 'models', 'documentation', 'commands', 'limits'];
  assert.deepEqual(Object.keys(compared), [...fields.slice(0, 9), 'api', 'impact', ...fields.slice(9)]);
  assert.deepEqual(Object.keys(compared.comparison), ['base', 'state', 'reasons', 'policy', 'counts', 'complexity', 'resolved', 'next']);
  assert.equal(compared.comparison.policy.state, 'UNCHANGED');
  const alone = json(run(root, ['inspect', '--summary', '--ref', 'HEAD', '--store', store]));
  assert.deepEqual(Object.keys(alone), fields, 'a summary without a base has no api and no impact section');
  assert.equal(alone.comparison, null);
  assert.deepEqual([alone.architecture.layers, alone.architecture.ownership.file, alone.architecture.ownership.unowned], [null, null, 2]);
  const findings = follow(root, compared.commands.findings);
  assert.equal(findings.api, undefined);
  const classic = json(run(root, ['inspect', '--ref', 'HEAD']));
  assert.equal(classic.api, undefined);
  assert.deepEqual(Object.keys(classic.files.find((file) => file.path === 'src/a.ts').exports[0]), ['name', 'category', 'localName', 'typeOnly', 'line', 'localReferences', 'consumers', 'usage']);
});

test('analyses that are not comparable give no export changes', (t) => {
  const { summary } = commits(t, { 'lib/a.ts': 'export const a = 1;\n' }, { 'app/b.ts': 'export const b = 1;\n' });
  const { comparison, api } = summary();
  assert.deepEqual([comparison.state, comparison.reasons], ['NOT_COMPARABLE', ['roots']]);
  assert.deepEqual(api, { state: 'NOT_COMPARABLE', reasons: ['roots'], scope: 'project', renamesComplete: null, entryPoints: null, public: null, module: null, next: null, text: api.text });
});

test('typed CLI comparison detects accessible named return shapes at both snapshots', (t) => {
  const { root, summary } = commits(t, {
    'package.json': '{"main":"src/api.ts"}', 'tsconfig.json': '{"compilerOptions":{"strict":true}}',
    'src/api.ts': "interface Result { value: string } export function read(): Result { return { value: 'ok' }; }",
  }, { 'src/api.ts': 'interface Result { value: number } export function read(): Result { return { value: 1 }; }' });
  const report = summary('--types');
  const page = follow(root, report.api.next.all);
  assert.equal(find(page.page, 'read').status, 'CHANGED');
  assert.deepEqual(find(page.page, 'read').reasons, ['checker-type']);
});
