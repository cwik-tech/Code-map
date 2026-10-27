// The impact section of `code-map inspect --summary --base <ref>`, the documentation section of each summary, and their
// pages (`--impact <list>` and `--undocumented`), run through the command line on small Git repositories.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
const follow = (root, command, more = []) => { const [program, ...args] = words(command); assert.equal(program, 'code-map'); return json(run(root, [...args, ...more])); };
/** A repository with one commit for each step. A step maps paths to their text; null deletes the file. */
function commits(t, ...steps) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-impact-')), store = mkdtempSync(join(tmpdir(), 'code-map-impact-store-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); });
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  const put = (step) => { for (const [path, text] of Object.entries(step)) {
    if (text === null) rmSync(join(root, path)); else { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); }
  } };
  git('init', '-q');
  for (const step of steps) { put(step); git('add', '-A'); git('commit', '-qm', 'step'); }
  const summary = (...more) => json(run(root, ['inspect', '--summary', '--ref', 'HEAD', '--base', 'HEAD~1', '--store', store, ...more]));
  return { root, store, put, summary };
}

const base = {
  'package.json': JSON.stringify({ name: 'pkg', exports: { '.': './src/index.ts' } }),
  'src/index.ts': "export { format } from './lib/format';\nexport { formatDate, keep } from './lib/dates';\n",
  'src/lib/format.ts': '/** Formats a text. */\nexport function format(text: string): string { return text; }\nexport type Fmt = string;\n',
  'src/lib/dates.ts': 'export function formatDate(d: Date): string { return String(d); }\nexport const max = 1;\nexport function keep(): number { return 1; }\n',
  'src/old-helper.ts': 'export const helper = 1;\n',
  'src/app.ts': "import { format } from './lib/format';\nimport { keep } from './lib/dates';\nexport const run = () => format('a') + keep();\n",
  'src/top.ts': "import { run } from './app';\nexport const top = run;\n",
  'src/types.ts': "import type { Fmt } from './lib/format';\nexport type Alias = Fmt;\n",
  'test/app.test.ts': "import { test } from 'node:test';\nimport { run } from '../src/app';\ntest('run', () => { run(); });\n",
  'docs/guide.md': 'Use `formatDate` from src/old-helper.ts.\n',
  'config/settings.json': '{ "formatter": "formatDate" }\n',
};
const head = {
  'src/index.ts': "export { format } from './lib/format';\nexport { keep } from './lib/dates';\n",
  'src/lib/format.ts': '/** Formats a text. */\nexport function format(text: string, width: number): string { return text; }\nexport type Fmt = string;\n',
  'src/lib/dates.ts': 'export function keep(): number { return 1; }\n',
  'src/old-helper.ts': null,
  'src/app.ts': "import { format } from './lib/format';\nimport { keep } from './lib/dates';\nexport const run = () => format('a') + format('a', 2) + keep();\n",
  'test/app.test.ts': "import { test } from 'node:test';\nimport { run } from '../src/app';\nvi.mock('../src/old-helper', () => ({}));\ntest('run', () => { run(); });\n",
};

test('acceptance: a comparison gives the affected files, the stale references, the call sites and the documentation leads', (t) => {
  const { root, summary } = commits(t, base, head);
  const { impact, documentation } = summary();
  assert.deepEqual([impact.state, impact.scope], ['COMPARABLE', 'project']);
  assert.deepEqual(impact.changed, { files: 6, sources: 4, tests: 1, other: 0, removed: 1 });
  const { affected, references, calls, docs } = impact;
  assert.deepEqual([affected.total, affected.byDepth, affected.kinds, affected.edges], [2, [{ depth: 1, files: 2, tests: 0 }], { value: 1, type: 1 }, { value: 6, type: 1, unknown: 0 }]);
  assert.deepEqual([affected.truncated, affected.complete, affected.dynamicImports, affected.limits], [null, true, { files: 0, sites: 0 }, { depth: 10, files: 2000 }]);
  assert.deepEqual(affected.examples.map((item) => [item.path, item.depth, item.kind, item.imports]), [['src/top.ts', 1, 'value', 'src/app.ts'], ['src/types.ts', 1, 'type', 'src/lib/format.ts']]);
  assert.deepEqual(affected.tests, { total: 1, items: [{ path: 'test/app.test.ts', depth: 0, kind: 'changed', test: true, imports: null }] });
  assert.deepEqual(references.terms, { exports: 2, paths: 1, skipped: 1 }, 'the exports of a removed file are removed too');
  assert.deepEqual([references.total, references.places, references.truncated], [4, { code: 0, test: 1, config: 0, markdown: 2, json: 1, yaml: 0 }, null]);
  assert.deepEqual(references.examples.map((hit) => [hit.path, hit.line, hit.place, hit.match]), [['config/settings.json', 1, 'json', 'name'], ['docs/guide.md', 1, 'markdown', 'name'],
    ['docs/guide.md', 1, 'markdown', 'path'], ['test/app.test.ts', 3, 'test', 'specifier']]);
  assert.deepEqual([calls.exports, calls.total, calls.likelyBreaks, calls.unread], [1, 2, 1, 0]);
  assert.deepEqual(calls.examples.map((site) => [site.export.name, site.path, site.line, site.use, site.args, site.arity, site.likelyBreak]), [
    ['format', 'src/app.ts', 3, 'call', 1, { min: 2, max: 2 }, true], ['format', 'src/app.ts', 3, 'call', 2, { min: 2, max: 2 }, false]]);
  assert.deepEqual([docs.publicChanges, docs.docsChanged, docs.total], [2, { total: 0, files: [] }, 2]);
  assert.deepEqual(docs.examples.map((lead) => [lead.status, lead.name, lead.declaredIn]), [['REMOVED', 'formatDate', 'src/lib/dates.ts'], ['CHANGED', 'format', 'src/lib/format.ts']]);
  assert.deepEqual([documentation.entryPoints, documentation.exports, documentation.documented, documentation.undocumented, documentation.unknown], [1, 2, 1, 1, 0]);
  assert.deepEqual(documentation.examples, [{ path: 'src/index.ts', name: 'keep', kind: 'function', declaredIn: 'src/lib/dates.ts', line: 1 }]);
  const page = follow(root, references.next);
  assert.equal(page.reportType, 'code-map-impact');
  assert.deepEqual(page.references.terms, { exports: [{ name: 'formatDate', files: ['src/index.ts', 'src/lib/dates.ts'] }, { name: 'helper', files: ['src/old-helper.ts'] }],
    paths: [{ path: 'src/old-helper.ts', to: null }],
    skipped: [{ name: 'max', path: 'src/lib/dates.ts', reason: 'short' }] }, 'a short name is skipped and named, and helper inside old-helper is no hit');
  assert.equal(page.page.items.find((hit) => hit.place === 'test').text, "vi.mock('../src/old-helper', () => ({}));");
});

test('each list pages in the printed page shape, and the options are checked', (t) => {
  const { root, store, summary } = commits(t, base, head);
  const { impact, documentation, analysis, comparison } = summary();
  const after = (command, option) => { const list = words(command); return list.includes(option) ? list[list.indexOf(option) + 1] : undefined; };
  const lists = { affected: impact.affected.next.affected, tests: impact.affected.next.tests, references: impact.references.next, calls: impact.calls.next, docs: impact.docs.next };
  const totals = { affected: 2, tests: 1, references: 4, calls: 2, docs: 2 };
  for (const [list, command] of Object.entries(lists)) {
    assert.equal(after(command, '--impact'), list);
    const first = follow(root, command, ['--limit', '1']);
    assert.deepEqual([first.reportType, first.list, first.comparison.state, first.comparison.base.id], ['code-map-impact', list, 'COMPARABLE', comparison.base.id]);
    assert.deepEqual(Object.keys(first.page), ['total', 'offset', 'limit', 'items', 'next']);
    assert.deepEqual([first.page.total, first.page.items.length], [totals[list], 1], list);
    if (totals[list] > 1) assert.deepEqual([after(first.page.next, '--offset'), after(first.page.next, '--limit')], ['1', '1']);
    else assert.equal(first.page.next, null);
  }
  const calls = follow(root, lists.calls);
  assert.deepEqual(calls.calls.exports, [{ path: 'src/lib/format.ts', name: 'format', kind: 'function', arity: { min: 2, max: 2 }, consumers: 2, sites: 2, likelyBreaks: 1 }]);
  assert.equal(calls.page.items[0].likelyBreak, true, 'a likely break comes first');
  const undocumented = follow(root, documentation.next);
  assert.deepEqual([undocumented.reportType, undocumented.documentation.undocumented, undocumented.page.items.map((item) => item.name)], ['code-map-undocumented', 1, ['keep']]);
  const fails = (args, pattern) => { const output = run(root, [...args, '--store', store]); assert.notEqual(output.status, 0); assert.match(output.stderr, pattern); assert.equal(output.stdout, ''); };
  const both = ['inspect', '--analysis', analysis.id, '--base-analysis', comparison.base.id];
  fails(['inspect', '--analysis', analysis.id, '--impact', 'affected'], /--impact needs --base-analysis/);
  fails([...both, '--impact', 'files'], /--impact must be one of affected, tests, references, calls, docs/);
  fails([...both, '--impact', 'calls', '--api', 'all'], /Use either --impact or --api/);
  fails([...both, '--undocumented'], /Use either --undocumented or --base-analysis/);
  fails(['inspect', '--impact', 'calls'], /--impact needs --analysis/);
  fails(['inspect', '--undocumented'], /--undocumented needs --analysis/);
});

test('a documentation change clears the leads; a summary without a base has no impact section', (t) => {
  const { root, store, summary } = commits(t, { 'package.json': JSON.stringify({ name: 'pkg', main: 'src/index.ts' }), 'src/index.ts': 'export function f(a: string) { return a; }\n' },
    { 'src/index.ts': 'export function f(a: string, b?: string) { return a; }\n', 'README.md': 'f takes an optional second text.\n' });
  const { impact } = summary();
  assert.deepEqual([impact.docs.publicChanges, impact.docs.docsChanged, impact.docs.total, impact.docs.examples], [1, { total: 1, files: ['README.md'] }, 0, []]);
  const alone = json(run(root, ['inspect', '--summary', '--ref', 'HEAD', '--store', store]));
  assert.equal(alone.impact, undefined);
  assert.deepEqual([alone.documentation.exports, alone.documentation.undocumented, alone.documentation.examples.map((item) => item.name)], [1, 1, ['f']]);
});

test('the walk stops at the fixed depth limit, and a computed dynamic import makes it incomplete', (t) => {
  const chain = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`src/c${index + 1}.ts`, `import { c${index} } from './c${index}';\nexport const c${index + 1} = c${index};\n`]));
  const { summary } = commits(t, { ...chain, 'src/c0.ts': 'export const c0 = 0;\n', 'src/loader.ts': 'export const load = (name: string) => import(name);\n' }, { 'src/c0.ts': 'export const c0 = 1;\n' });
  const { affected } = summary().impact;
  assert.deepEqual([affected.total, affected.truncated, affected.complete, affected.dynamicImports], [10, { limit: 'depth', value: 10 }, false, { files: 1, sites: 1 }]);
  assert.equal(affected.byDepth.length, 10);
});

test('a working-tree head is read from disk: an untracked note counts, and a symlink is skipped', (t) => {
  const { root, store, put } = commits(t, { 'src/a.ts': 'export function oldName() {}\nexport const keep = 1;\n', 'src/b.ts': "import { keep } from './a';\nexport const b = keep;\n" });
  put({ 'src/a.ts': 'export const keep = 1;\n', 'notes/plan.md': 'Remove oldName later.\n' });
  const outside = mkdtempSync(join(tmpdir(), 'code-map-impact-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'secret.md'), 'oldName is here too.\n');
  symlinkSync(join(outside, 'secret.md'), join(root, 'linked.md'));
  const { impact } = json(run(root, ['inspect', '--summary', '--worktree', '--base', 'HEAD', '--store', store]));
  assert.deepEqual(impact.references.examples.map((hit) => [hit.path, hit.line, hit.place]), [['notes/plan.md', 1, 'markdown']]);
  assert.deepEqual([impact.affected.total, impact.affected.examples[0].path], [1, 'src/b.ts']);
});

test('analyses that are not comparable give no impact parts', (t) => {
  const { summary } = commits(t, { 'lib/a.ts': 'export const a = 1;\n' }, { 'app/b.ts': 'export const b = 1;\n' });
  const { impact } = summary();
  assert.deepEqual(impact, { state: 'NOT_COMPARABLE', reasons: ['roots'], scope: 'project', changed: null, affected: null, references: null, calls: null, docs: null, text: impact.text });
});

test('a deleted source file still affects its unchanged importers and their tests', (t) => {
  const { root, summary } = commits(t, { 'src/old.ts': 'export const oldName = 1;',
    'src/use.ts': "import { oldName } from './old';\nexport const use = oldName;",
    'src/top.ts': "import { use } from './use';\nexport const top = use;",
    'test/use.test.ts': "import { top } from '../src/top';\ntest('top', () => top);" }, { 'src/old.ts': null });
  const { affected } = summary().impact;
  assert.deepEqual(affected.examples.map(({ path, depth }) => [path, depth]), [['src/use.ts', 1], ['src/top.ts', 2], ['test/use.test.ts', 3]]);
  assert.deepEqual(follow(root, affected.next.tests).page.items.map(({ path }) => path), ['test/use.test.ts']);
});

test('redirecting a public re-export reports its consumer call and the new argument range', (t) => {
  const { root, summary } = commits(t, { 'package.json': JSON.stringify({ name: 'pkg', exports: './src/index.ts' }),
    'src/index.ts': "export { format } from './old';",
    'src/old.ts': 'export function format(a: string): string { return a; }',
    'src/new.ts': 'export function format(a: string, b: string): string { return a + b; }',
    'src/use.ts': "import { format } from './index';\nformat('one');" }, { 'src/index.ts': "export { format } from './new';" });
  const { calls } = summary().impact;
  assert.deepEqual([calls.exports, calls.total, calls.likelyBreaks], [1, 1, 1]);
  const page = follow(root, calls.next);
  assert.deepEqual(page.page.items.map(({ path, args, arity, likelyBreak }) => ({ path, args, arity, likelyBreak })),
    [{ path: 'src/use.ts', args: 1, arity: { min: 2, max: 2 }, likelyBreak: true }]);
});


test('tracked generated consumers remain searchable with bounded text reads', (t) => {
  const { root, summary } = commits(t, {
    'src/api.ts': 'export const legacySymbol = () => 1;\n',
    'dist/generated.js': 'api.legacySymbol(1);\n',
    'build/consumer.js': 'api.legacySymbol(2);\n',
    '.next/consumer.js': 'api.legacySymbol(3);\n',
    'out/large.js': 'legacySymbol'.repeat(100000),
  }, { 'src/api.ts': 'export const currentSymbol = () => 1;\n' });
  const refs = summary().impact.references;
  assert.deepEqual(follow(root, refs.next).page.items.map(x => [x.path, x.place]),
    [['.next/consumer.js', 'generated'], ['build/consumer.js', 'generated'], ['dist/generated.js', 'generated']]);
  assert.equal(refs.skippedFiles, 1);
});


test('computed loader candidates reach the summary and affected page without selecting tests', (t) => {
  const { root, summary } = commits(t, {
    'src/api.ts': 'export const value = 1;',
    'src/loader.ts': 'export const load = (name: string) => import(name);',
    'test/load.test.ts': "import { load } from '../src/loader'; test('load', () => load('api'));",
  }, { 'src/api.ts': 'export const value = 2;' });
  const affected = summary().impact.affected;
  assert.equal(affected.complete, false);
  assert.equal(affected.total, 0);
  assert.deepEqual(affected.tests.items, []);
  assert.equal(affected.candidates.total, 2);
  assert.deepEqual(affected.candidates.items.map(({ path, reason }) => [path, reason]), [
    ['src/loader.ts', 'unresolved-computed-loader'], ['test/load.test.ts', 'unresolved-computed-loader'],
  ]);
  const page = follow(root, affected.next.affected);
  assert.deepEqual(page.affected.candidates, affected.candidates.items);
  assert.equal(page.affected.candidateTotal, 2);
  assert.deepEqual(page.page.items, []);
});
