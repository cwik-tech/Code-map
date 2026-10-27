import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareComplexity } from '../lib/complexity.mjs';
import { complexityPage } from '../lib/overview.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const fn = (cyclomatic, nesting, functions) => ({ cyclomatic, nesting, ...(functions ? { functions } : {}) });
const nested = (name, cyclomatic, nesting, functions) => ({ name, ...fn(cyclomatic, nesting, functions) });
const analysis = (path, declarations) => ({ files: [{ path, declarations: Object.entries(declarations).map(([name, complexity]) => ({ name, complexity })) }] });
const changes = (result) => Object.fromEntries(['grew', 'new', 'fell', 'unknown'].map((change) => [change, result[change].map((entry) => entry.name)]));

test('compareComplexity matches through a rename, by name path, and gives base, head and delta values', () => {
  const base = analysis('src/old.ts', { run: fn(1, 0, [nested('helper', 1, 0)]), keep: fn(4, 2) });
  const head = analysis('src/new.ts', { run: fn(3, 1, [nested('helper', 2, 0), nested('extra', 1, 0)]), keep: fn(4, 2), added: fn(2, 1) });
  const result = compareComplexity(base, head, [{ from: 'src/old.ts', to: 'src/new.ts', similarity: 80 }]);
  assert.deepEqual(result.counts, { grew: 2, new: 2, fell: 0, unknown: 0 });
  assert.deepEqual(result.grew.map((entry) => [entry.path, entry.name, entry.base, entry.head, entry.delta]), [
    ['src/new.ts', 'run', { cyclomatic: 1, nesting: 0 }, { cyclomatic: 3, nesting: 1 }, { cyclomatic: 2, nesting: 1 }],
    ['src/new.ts', 'run/helper', { cyclomatic: 1, nesting: 0 }, { cyclomatic: 2, nesting: 0 }, { cyclomatic: 1, nesting: 0 }],
  ], 'sorted by the size of the growth');
  assert.deepEqual(result.new.map((entry) => [entry.name, entry.base, entry.head, entry.delta]), [
    ['run/extra', null, { cyclomatic: 1, nesting: 0 }, null], ['added', null, { cyclomatic: 2, nesting: 1 }, null],
  ], 'new functions keep their source order');
});

test('a function grew when one value grew, also when the other value fell, and fell only when no value grew', () => {
  const base = analysis('a.ts', { mixed: fn(2, 3), simpler: fn(5, 2), flatter: fn(3, 2), same: fn(2, 1) });
  const head = analysis('a.ts', { mixed: fn(4, 1), simpler: fn(2, 1), flatter: fn(3, 1), same: fn(2, 1) });
  const result = compareComplexity(base, head);
  assert.deepEqual(changes(result), { grew: ['mixed'], new: [], fell: ['simpler', 'flatter'], unknown: [] }, 'the largest fall comes first');
  assert.deepEqual(result.grew[0].delta, { cyclomatic: 2, nesting: -2 });
});

test('a getter and a setter with one name path match by position only when the counts agree', () => {
  const base = { files: [{ path: 'a.ts', declarations: [{ name: 'Box.size', complexity: fn(1, 0) }, { name: 'Box.size', complexity: fn(3, 1) }] }] };
  const same = compareComplexity(base, structuredClone(base));
  assert.deepEqual(same.counts, { grew: 0, new: 0, fell: 0, unknown: 0 }, 'an unchanged getter and setter give no change');
  const grown = structuredClone(base); grown.files[0].declarations[0].complexity = fn(2, 0);
  assert.deepEqual(changes(compareComplexity(base, grown)), { grew: ['Box.size'], new: [], fell: [], unknown: [] });
  const one = { files: [{ path: 'a.ts', declarations: [{ name: 'Box.size', complexity: fn(1, 0) }] }] };
  assert.deepEqual(changes(compareComplexity(one, base)), { grew: [], new: [], fell: [], unknown: ['Box.size', 'Box.size'] }, 'which one is new is not known');
});

test('an anonymous function is unknown, not new, when its position is not reliable, and so are the functions inside it', () => {
  const base = analysis('a.ts', { run: fn(1, 0, [nested('<anonymous 1>', 2, 0)]) });
  const same = analysis('a.ts', { run: fn(1, 0, [nested('<anonymous 1>', 3, 1)]) });
  assert.deepEqual(changes(compareComplexity(base, same)), { grew: ['run/<anonymous 1>'], new: [], fell: [], unknown: [] }, 'one anonymous function on each side matches');
  const more = analysis('a.ts', { run: fn(1, 0, [nested('<anonymous 1>', 1, 0, [nested('inner', 1, 0)]), nested('<anonymous 2>', 2, 0)]) });
  assert.deepEqual(changes(compareComplexity(base, more)), { grew: [], new: [], fell: [], unknown: ['run/<anonymous 1>', 'run/<anonymous 1>/inner', 'run/<anonymous 2>'] });
  const fresh = analysis('a.ts', { other: fn(1, 0, [nested('<anonymous 1>', 1, 0), nested('named', 1, 0)]) });
  assert.deepEqual(changes(compareComplexity(base, fresh)), { grew: [], new: ['other', 'other/named'], fell: [], unknown: ['other/<anonymous 1>'] });
});

test('a named function is unknown, not new, when Git can have missed the rename of its file', () => {
  const base = analysis('src/old.ts', { run: fn(1, 0) });
  const head = analysis('src/moved.ts', { run: fn(1, 0), more: fn(1, 0) });
  assert.deepEqual(changes(compareComplexity(base, head, [], true)), { grew: [], new: ['run', 'more'], fell: [], unknown: [] });
  assert.deepEqual(changes(compareComplexity(base, head, [], false)), { grew: [], new: [], fell: [], unknown: ['run', 'more'] }, 'the rename list is incomplete');
  const guessed = [{ from: 'src/old.ts', to: 'src/moved.ts', similarity: 0 }];
  assert.deepEqual(changes(compareComplexity(base, head, guessed)), { grew: [], new: [], fell: [], unknown: ['more'] }, 'a pair by file name only is not sure');
});

test('the complexity page of a comparison that is not comparable has no counts and no items', () => {
  const stored = { id: 'A-0000000000000001', createdAt: 'now', data: { analysis: analysis('a.ts', { run: fn(2, 0) }) } };
  const base = { id: 'A-0000000000000002', data: { sha: 'b', ref: 'main', analysis: analysis('a.ts', { run: fn(1, 0) }) }, inputs: { selector: { worktree: false } } };
  const context = { id: stored.id, freshness: { state: 'current' }, command: (args) => args.join(' '),
    comparison: { base, renames: [], complete: true, result: { state: 'NOT_COMPARABLE', reasons: ['analyzer'] } } };
  const report = complexityPage(stored, context);
  assert.equal(report.complexity, null);
  assert.deepEqual([report.page.total, report.page.items, report.page.next], [0, [], null]);
  context.comparison.result = { state: 'COMPARABLE', reasons: [] };
  assert.deepEqual(complexityPage(stored, context).complexity.counts, { grew: 1, new: 0, fell: 0, unknown: 0 });
});

/** A Git repository in a temporary folder with one commit for each map of files, and a private store. */
function repository(t, ...commits) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-complexity-')), store = mkdtempSync(join(tmpdir(), 'code-map-complexity-store-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); });
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  git('init', '-q');
  commits.forEach((files, index) => {
    for (const [path, text] of Object.entries(files)) {
      if (text === null) { git('rm', '-q', path); continue; }
      mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text);
    }
    git('add', '.'); git('commit', '-qm', `commit ${index}`);
  });
  return { root, store, git };
}
const run = (root, args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 30000 });
function json(root, args) {
  const output = run(root, args);
  assert.equal(output.status, 0, output.stderr);
  return JSON.parse(output.stdout);
}
const words = (command) => [...command.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)].map((match) => match[1] !== undefined ? match[1].replaceAll("'\\''", "'") : match[2]);
function follow(root, command) {
  const [program, ...args] = words(command);
  assert.equal(program, 'code-map');
  return json(root, args);
}
const summaryOf = ({ root, store }) => json(root, ['inspect', '--summary', '--ref', 'HEAD', '--base', 'HEAD~1', '--store', store]);

const math = (body) => `export function sum(x: number) {\n${body}}\nexport function diff(a: number, b: number) { return a - b; }\n`
  + `export function product(a: number, b: number) { return a * b; }\nexport function quotient(a: number, b: number) { return a / b; }\n`;
/** A base and a head with a renamed and changed file and a new file. */
const renamed = (t) => repository(t, { '.code-map.json': '{}', 'src/math.ts': math('  if (x > 0) return x;\n  return 0;\n') },
  { 'src/math.ts': null, 'src/lib/math.ts': math('  if (x > 0) {\n    if (x > 10) return 10;\n    return x;\n  }\n  return 0;\n'),
    'src/fresh.ts': 'export function fresh(x: number) {\n  return x ? 1 : 2;\n}\n' });

test('the summary shows complexity counts and examples, and the paged option gives the full list', (t) => {
  const repo = renamed(t), summary = summaryOf(repo);
  assert.equal(summary.comparison.state, 'COMPARABLE');
  const complexity = summary.comparison.complexity;
  assert.deepEqual(complexity.counts, { grew: 1, new: 1, fell: 0, unknown: 0 }, 'sum grew through the rename, and fresh is new');
  assert.deepEqual([complexity.grew[0].path, complexity.grew[0].name], ['src/lib/math.ts', 'sum']);
  assert.deepEqual([complexity.grew[0].base, complexity.grew[0].head, complexity.grew[0].delta], [{ lines: 4, cyclomatic: 2, nesting: 1, cognitive: 1 }, { lines: 7, cyclomatic: 3, nesting: 2, cognitive: 3 }, { lines: 3, cyclomatic: 1, nesting: 1, cognitive: 2 }]);
  assert.deepEqual([complexity.new[0].path, complexity.new[0].name], ['src/fresh.ts', 'fresh']);
  const page = follow(repo.root, complexity.next);
  assert.equal(page.reportType, 'code-map-complexity');
  assert.equal(page.comparison.state, 'COMPARABLE');
  assert.deepEqual(Object.keys(page.page), ['total', 'offset', 'limit', 'items', 'next'], 'the page shape of the other pages');
  assert.deepEqual(page.page.items.map((item) => [item.change, item.name]), [['grew', 'sum'], ['new', 'fresh']]);
  assert.equal(page.page.next, null);
  assert.equal(repo.git('status', '--porcelain'), '');
});

test('the summary shows at most five functions in all, grew first, and counts the unknown and fell functions', (t) => {
  const grow = (name) => `export function ${name}(x: number) {\n  if (x) {\n    if (x > 1) return 2;\n  }\n  return 0;\n}\n`;
  const plain = (name) => `export function ${name}(x: number) {\n  return x;\n}\n`;
  const names = ['a', 'b', 'c', 'd'];
  const repo = repository(t, { 'src/simple.ts': grow('simple'), 'src/run.ts': plain('run'), ...Object.fromEntries(names.map((name) => [`src/${name}.ts`, plain(name)])) },
    { 'src/simple.ts': plain('simple'), 'src/run.ts': 'export function run() {\n  return [1].map(() => 1);\n}\n',
      'src/new.ts': `${plain('n1')}${plain('n2')}`, ...Object.fromEntries(names.map((name) => [`src/${name}.ts`, grow(name)])) });
  const complexity = summaryOf(repo).comparison.complexity;
  assert.deepEqual(complexity.counts, { grew: 4, new: 3, fell: 1, unknown: 0 });
  assert.deepEqual([...complexity.grew, ...complexity.new].map((entry) => entry.name), ['a', 'b', 'c', 'd', 'n1']);
  const page = follow(repo.root, complexity.next);
  assert.deepEqual(page.page.items.map((item) => [item.change, item.name]), [['grew', 'a'], ['grew', 'b'], ['grew', 'c'], ['grew', 'd'],
    ['new', 'n1'], ['new', 'n2'], ['new', 'run/map#1'], ['fell', 'simple']]);
});

test('--complexity needs --base-analysis and --analysis, and respects paging limits', (t) => {
  const repo = renamed(t), summary = summaryOf(repo), { root, store } = repo;
  const id = summary.analysis.id, base = summary.comparison.base.id;
  const fails = (args, pattern) => {
    const output = run(root, ['inspect', ...args]);
    assert.notEqual(output.status, 0, `${args.join(' ')} must fail`);
    assert.equal(output.stdout, '');
    assert.match(output.stderr, pattern);
  };
  fails(['--complexity', '--ref', 'HEAD'], /--complexity needs --analysis/);
  fails(['--analysis', id, '--complexity', '--store', store], /--complexity needs --base-analysis/);
  fails(['--analysis', id, '--base-analysis', base, '--complexity', '--findings', '--store', store], /not both/);
  fails(['--analysis', id, '--base-analysis', base, '--complexity', '--file', 'src/fresh.ts', '--store', store], /not both/);
  fails(['--analysis', id, '--base-analysis', base, '--complexity', '--limit', '0', '--store', store], /--limit/);
  const first = json(root, ['inspect', '--analysis', id, '--base-analysis', base, '--complexity', '--limit', '1', '--store', store]);
  assert.deepEqual([first.page.total, first.page.items.length, first.page.offset, first.page.limit], [2, 1, 0, 1]);
  assert.match(first.page.next, /--offset 1 --limit 1/);
  const second = follow(root, first.page.next);
  assert.deepEqual([second.page.offset, second.page.items.length, second.page.next], [1, 1, null]);
});

test('adding an effect preserves the matches of existing hook callbacks across two commits', (t) => {
  const hook = (effect, decision) => `export function useChat(list) {
    ${effect}
    const send = useCallback(() => ${decision});
    const items = useMemo(() => list.map((item) => ${decision}));
    return { send, items };
  }`;
  const repo = repository(t, { 'src/hook.ts': hook('', '1') },
    { 'src/hook.ts': hook('useEffect(() => {});', 'item ? 1 : 2') });
  const complexity = summaryOf(repo).comparison.complexity;
  assert.deepEqual(complexity.counts, { grew: 2, new: 1, fell: 0, unknown: 0 });
  assert.deepEqual(complexity.grew.map((item) => item.name), ['useChat/items/map#1', 'useChat/send']);
  assert.deepEqual(complexity.grew.map((item) => item.delta.cognitive), [3, 2]);
  assert.deepEqual(complexity.new.map((item) => item.name), ['useChat/useEffect#1']);
});

test('--base and --complexity report growth when only cognitive complexity increases', (t) => {
  const source = (operator) => `export function f(x, y, z) { return x && y ${operator} z; }\n`;
  const repo = repository(t, { 'src/a.ts': source('&&') }, { 'src/a.ts': source('||') });
  const summary = summaryOf(repo), result = summary.comparison.complexity;
  assert.deepEqual(result.counts, { grew: 1, new: 0, fell: 0, unknown: 0 });
  assert.deepEqual(result.grew[0], { path: 'src/a.ts', name: 'f',
    base: { lines: 1, cyclomatic: 3, nesting: 0, cognitive: 1 }, head: { lines: 1, cyclomatic: 3, nesting: 0, cognitive: 2 },
    delta: { lines: 0, cyclomatic: 0, nesting: 0, cognitive: 1 } });
  const page = follow(repo.root, result.next);
  assert.deepEqual(page.page.items, [{ change: 'grew', ...result.grew[0] }]);
});


test('size-only growth survives summary and paging with file and folder deltas', (t) => {
  const repo = repository(t, { 'src/a.ts': 'export function stable() {\n return 1;\n}\n' },
    { 'src/a.ts': 'export function stable() {\n const a = 1;\n const b = 2;\n return a + b;\n}\n' });
  const result = summaryOf(repo).comparison.complexity;
  assert.equal(result.counts.grew, 1);
  assert.deepEqual([result.grew[0].base.lines, result.grew[0].head.lines, result.grew[0].delta.lines], [3, 5, 2]);
  assert.equal(result.areas.files[0].delta.lines, 2);
  assert.equal(result.areas.folders.find(x => x.path === 'src').delta.lines, 2);
  assert.equal(follow(repo.root, result.next).page.items[0].delta.lines, 2);
});


test('non-function declarations expose size deltas without a complexity threshold', (t) => {
  const repo = repository(t, { 'src/a.ts': 'export const settings = { a: 1 };\n' },
    { 'src/a.ts': 'export const settings = {\n a: 1,\n b: 2\n};\n' });
  const result = summaryOf(repo).comparison.complexity;
  assert.deepEqual(result.areas.symbols.map(x => [x.name, x.base, x.head, x.delta]), [['settings', 1, 4, 3]]);
});
