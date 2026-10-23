import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareFindings, comparability } from '../lib/compare.mjs';
import { fingerprintOf } from '../lib/findings.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));

/** Base commit: a rule break, an unused export, a file that moves and a file that goes. Head commit: the changes. */
function history(t) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-compare-'));
  const store = mkdtempSync(join(tmpdir(), 'code-map-compare-store-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  put('.code-map.json', JSON.stringify({ rules: ['core -> ui'] }));
  put('src/core/engine.ts', "import { view } from '../ui/view';\nexport function engine() { return view(); }\n");
  put('src/ui/view.ts', "export function view() { return 'v'; }\n");
  put('src/lib/spare.ts', 'export const used = 1;\nexport const spare = 2;\n');
  put('src/lib/user.ts', "import { used } from './spare';\nexport const one = used;\n");
  put('src/old/name.ts', 'export const keep = 1;\nexport const moved = 2;\n');
  put('src/lib/user2.ts', "import { keep } from '../old/name';\nexport const two = keep;\n");
  put('src/gone.ts', 'export const x = 1;\nexport const unusedGone = 2;\n');
  put('src/lib/user3.ts', "import { x } from '../gone';\nexport const three = x;\n");
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'base');
  put('src/core/engine.ts', "export function engine() { return 'e'; }\n");
  put('src/cycle/a.ts', "import { b } from './b';\nexport const a = () => b();\n");
  put('src/cycle/b.ts', "import { a } from './a';\nexport const b = () => 1;\nexport const callA = () => a();\n");
  put('src/lib/spare.ts', 'export const used = 1;\nexport const spare = 2;\nexport const fresh = 3;\n');
  mkdirSync(join(root, 'src/new'), { recursive: true });
  git('mv', 'src/old/name.ts', 'src/new/name.ts');
  put('src/lib/user2.ts', "import { keep } from '../new/name';\nexport const two = keep;\n");
  git('rm', '-q', 'src/gone.ts', 'src/lib/user3.ts');
  git('add', '.'); git('commit', '-qm', 'head');
  return { root, store, put, git };
}

const run = (root, args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 30000 });
function words(command) {
  const out = [];
  for (const match of command.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)) out.push(match[1] !== undefined ? match[1].replaceAll("'\\''", "'") : match[2]);
  return out;
}
function follow(root, command) {
  const [program, ...args] = words(command);
  assert.equal(program, 'code-map');
  const output = run(root, args);
  assert.equal(output.status, 0, output.stderr);
  return JSON.parse(output.stdout);
}
function json(output) {
  assert.equal(output.status, 0, output.stderr);
  return JSON.parse(output.stdout);
}
/** A repository with one commit for each step. A step maps paths to their text; null deletes the file. */
function commits(t, ...steps) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-compare-')), store = mkdtempSync(join(tmpdir(), 'code-map-compare-store-'));
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
  return { root, store, git };
}

test('acceptance: a summary against a base labels new, existing and resolved findings, and its commands read both stored analyses', (t) => {
  const { root, store, git } = history(t);
  const summary = json(run(root, ['inspect', '--summary', '--base', 'HEAD~1', '--ref', 'HEAD', '--store', store]));
  const { comparison } = summary;
  assert.equal(comparison.state, 'COMPARABLE');
  assert.equal(comparison.base.sha, git('rev-parse', 'HEAD~1').trim());
  assert.match(comparison.base.id, /^A-[0-9a-f]{16}$/);
  assert.notEqual(comparison.base.id, summary.analysis.id);
  const find = (rule, symbol) => summary.findings.items.find((item) => item.ruleId === rule && (symbol === undefined || item.location.symbol === symbol));
  assert.deepEqual([find('CYCLE-VALUE').baseline, find('CYCLE-VALUE').matchedBy], ['NEW', null]);
  assert.deepEqual([find('EXPORT-UNREFERENCED', 'spare').baseline, find('EXPORT-UNREFERENCED', 'spare').matchedBy], ['EXISTING', 'fingerprint']);
  assert.deepEqual([find('EXPORT-UNREFERENCED', 'moved').baseline, find('EXPORT-UNREFERENCED', 'moved').matchedBy], ['EXISTING', 'rename']);
  const low = summary.findings.items.filter((item) => item.severity === 'low').map((item) => item.baseline);
  assert.deepEqual(low, [...low].sort((a, b) => ['NEW', 'UNKNOWN', 'EXISTING'].indexOf(a) - ['NEW', 'UNKNOWN', 'EXISTING'].indexOf(b)), 'new findings come first');
  assert.equal(low[0], 'NEW');
  for (const command of [summary.findings.byRule[0].next, summary.commands.findings]) assert.deepEqual(words(command).slice(3, 6), [summary.analysis.id, '--base-analysis', comparison.base.id]);
  assert.ok(follow(root, summary.findings.byRule[0].next).page.items.every((item) => item.baseline), 'a list of one rule keeps the labels');

  const resolved = comparison.resolved.items;
  assert.deepEqual(resolved.map((item) => [item.ruleId, item.matchedBy]).sort(), [['ARCH-RULE', 'absent'], ['EXPORT-UNREFERENCED', 'path-removed']]);
  assert.equal(comparison.counts.resolved, 2);
  assert.equal(comparison.counts.new, summary.findings.items.filter((item) => item.baseline === 'NEW').length);
  for (const item of resolved) assert.equal(words(item.next)[3], comparison.base.id, 'a resolved finding is read from the base analysis');
  const gone = follow(root, resolved.find((item) => item.ruleId === 'ARCH-RULE').next);
  assert.equal(gone.analysis.id, comparison.base.id);
  assert.deepEqual(gone.details.violation, { rule: 'core -> ui', from: 'src/core/engine.ts', to: 'src/ui/view.ts', lines: [1] });

  const fresh = follow(root, comparison.next.new);
  assert.equal(fresh.reportType, 'code-map-findings');
  assert.equal(fresh.comparison.state, 'COMPARABLE');
  assert.ok(fresh.page.items.length >= 2 && fresh.page.items.every((item) => item.baseline === 'NEW'));
  const old = follow(root, comparison.next.resolved);
  assert.deepEqual(old.page.items.map((item) => item.side), ['base', 'base']);
  assert.equal(old.page.total, 2);

  const again = json(run(root, ['inspect', '--summary', '--base', 'HEAD~1', '--ref', 'HEAD', '--store', store]));
  assert.deepEqual([again.analysis.reused, again.comparison.base.reused], [true, true]);
  assert.equal(git('status', '--porcelain'), '');
});

test('a working-tree head compares with its base commit, and without --base the summary has no comparison', (t) => {
  const { root, store, put, git } = history(t);
  git('checkout', '-qb', 'feature'); git('branch', '-f', 'main', 'HEAD~1');
  put('src/lib/spare.ts', 'export const used = 1;\nexport const spare = 2;\nexport const fresh = 3;\nexport const later = 4;\n');
  const summary = json(run(root, ['inspect', '--summary', '--base', 'HEAD', '--worktree', '--store', store]));
  assert.equal(summary.comparison.state, 'COMPARABLE');
  const later = summary.findings.items.find((item) => item.location.symbol === 'later');
  assert.equal(later.baseline, 'NEW');
  assert.equal(summary.findings.items.find((item) => item.location.symbol === 'fresh').baseline, 'EXISTING');
  assert.equal(summary.comparison.counts.resolved, 0);
  git('branch', '-f', 'main', 'HEAD');
  const moved = follow(root, summary.comparison.next.new);
  assert.deepEqual([moved.analysis.freshness.changed, moved.comparison.state, moved.page.total], [['base-branch'], 'COMPARABLE', summary.comparison.counts.new],
    'a moved base branch does not change the working tree or its renames');
  put('src/lib/spare.ts', 'export const used = 1;\n');
  const stale = follow(root, summary.comparison.next.new);
  assert.deepEqual([stale.analysis.freshness.state, stale.comparison.state, stale.comparison.reasons], ['stale', 'NOT_COMPARABLE', ['worktree-changed']],
    'the renames of a changed working tree cannot be read again, so the stored head is not compared');
  const plain = json(run(root, ['inspect', '--summary', '--worktree', '--store', store]));
  assert.equal(plain.comparison, null);
  assert.equal(plain.findings.items.some((item) => 'baseline' in item), false);
});

test('analyses stored under a different configuration are not comparable, so nothing is new or resolved', (t) => {
  const { root, store, put } = history(t);
  const base = json(run(root, ['inspect', '--summary', '--ref', 'HEAD~1', '--store', store]));
  put('.code-map.json', JSON.stringify({ rules: ['lib -> ui'] }));
  const head = json(run(root, ['inspect', '--summary', '--ref', 'HEAD', '--store', store]));
  const page = json(run(root, ['inspect', '--analysis', head.analysis.id, '--base-analysis', base.analysis.id, '--findings', '--store', store]));
  assert.equal(page.comparison.state, 'NOT_COMPARABLE');
  assert.deepEqual(page.comparison.reasons, ['config']);
  assert.ok(page.page.items.length > 0 && page.page.items.every((item) => item.baseline === 'UNKNOWN'));
  const fresh = json(run(root, ['inspect', '--analysis', head.analysis.id, '--base-analysis', base.analysis.id, '--findings', '--baseline', 'new', '--store', store]));
  assert.equal(fresh.page.total, 0);
  const summary = json(run(root, ['inspect', '--analysis', head.analysis.id, '--base-analysis', base.analysis.id, '--summary', '--store', store]));
  assert.deepEqual([summary.comparison.state, summary.comparison.counts.new, summary.comparison.counts.resolved], ['NOT_COMPARABLE', 0, 0]);
});

test('comparison options are checked before any report is printed', (t) => {
  const { root, store } = history(t);
  const head = json(run(root, ['inspect', '--summary', '--ref', 'HEAD', '--store', store]));
  const tree = json(run(root, ['inspect', '--summary', '--worktree', '--store', store]));
  const id = head.analysis.id;
  const fails = (args, pattern) => {
    const output = run(root, ['inspect', ...args]);
    assert.notEqual(output.status, 0, `${args.join(' ')} must fail`);
    assert.equal(output.stdout, '');
    assert.match(output.stderr, pattern);
  };
  fails(['--base', 'HEAD~1', '--ref', 'HEAD'], /--base needs --summary/);
  fails(['--analysis', id, '--base', 'HEAD~1', '--summary', '--store', store], /--base-analysis/);
  fails(['--summary', '--base', 'no-such-ref', '--ref', 'HEAD', '--store', store], /not a commit/);
  fails(['--summary', '--base=-x', '--ref', 'HEAD', '--store', store], /not a commit/);
  fails(['--summary', '--base', 'worktree', '--ref', 'HEAD', '--store', store], /not a commit/);
  fails(['--analysis', id, '--base-analysis', id, '--store', store], /--base-analysis needs --findings or --summary/);
  fails(['--base-analysis', id, '--findings', '--store', store], /--base-analysis needs --analysis/);
  fails(['--analysis', id, '--findings', '--baseline', 'new', '--store', store], /--baseline needs --base-analysis/);
  fails(['--analysis', id, '--base-analysis', id, '--findings', '--baseline', 'maybe', '--store', store], /--baseline must be one of/);
  fails(['--analysis', id, '--base-analysis', tree.analysis.id, '--findings', '--store', store], /base analysis must be of a commit/);
});

test('a new module base or new source roots never turn an unchanged finding into RESOLVED', (t) => {
  const summary = ({ root, store }) => json(run(root, ['inspect', '--summary', '--base', 'HEAD~1', '--ref', 'HEAD', '--store', store])).comparison;
  const rules = commits(t, { '.code-map.json': JSON.stringify({ rules: ['core -> ui'] }), 'src/app/core/engine.ts': "import { view } from '../ui/view';\nexport const engine = () => view();\n",
    'src/app/ui/view.ts': "export const view = () => 'v';\n" }, { 'src/main.ts': 'export const main = 1;\n' });
  const moved = summary(rules);
  assert.equal(moved.counts.resolved, 0);
  const unknown = follow(rules.root, moved.next.unknown).page.items.filter((item) => item.ruleId === 'ARCH-RULE');
  assert.deepEqual(unknown.map((item) => [item.side, item.matchedBy]), [['base', 'rule-base-changed']]);
  const roots = commits(t, { 'lib/a.ts': 'export const used = 1;\nexport const spare = 2;\n', 'lib/b.ts': "import { used } from './a';\nexport const b = used;\n" }, { 'src/index.ts': 'export const index = 1;\n' });
  const other = summary(roots);
  assert.deepEqual([other.state, other.reasons, other.counts.resolved], ['NOT_COMPARABLE', ['roots'], 0], 'the base maps lib, and the head maps only src');
});

test('a scoped comparison keeps the base test-case findings whose cases reach the selection', (t) => {
  const top = "import { test, expect } from 'vitest';\nimport { add } from '../src/add';\n";
  const { root, store } = commits(t, { 'src/add.ts': 'export function add(a: number, b: number) { return a + b; }\n',
    'test/add.test.ts': top + "test('adds', async () => { await new Promise((done) => setTimeout(done, 5)); expect(add(1, 2)).toBe(3); });\ntest('calls add', () => { add(1, 1); });\n" },
  { 'test/add.test.ts': top + "test('adds', () => { expect(add(1, 2)).toBe(3); });\ntest('calls the add', () => { add(1, 1); });\n" });
  const summary = (scope) => json(run(root, ['inspect', '--summary', '--base', 'HEAD~1', '--ref', 'HEAD', ...scope, '--store', store])).comparison;
  const whole = summary([]), scoped = summary(['--file', 'src/add.ts']), view = (comparison) => [comparison.resolved.items.map((item) => item.ruleId).sort(), comparison.counts.new, comparison.counts.resolved];
  assert.deepEqual(view(whole), [['TEST-FIXED-WAIT', 'TEST-NO-ASSERTIONS'], 1, 2]);
  assert.deepEqual(view(scoped), view(whole), 'a renamed or fixed test case is RESOLVED in the scoped view too');
  assert.equal(follow(root, scoped.next.resolved).page.total, 2);
});

// Unit level: matching rules on small stored analyses.
const stored = (findings, { files = [], coverage = 'none', inputs = {}, roots = ['src'], ruleBase = 'src' } = {}) => ({ id: 'A-0000000000000000',
  inputs: { repository: '/r', config: 'c', analyzer: { version: '1', source: 's', typescript: 't', node: 'n' }, ...inputs },
  data: { roots, analysis: { files: files.map((path) => ({ path })), rules: { base: ruleBase }, tests: { coverage: { state: coverage }, testFiles: [], unreadable: [] } } }, findings });
const finding = (ruleId, key, paths = [key[0]], source = 'graph') => {
  const fingerprint = fingerprintOf(ruleId, key);
  return { id: `${ruleId}-${fingerprint.slice(0, 10)}`, ruleId, fingerprint, key, paths, source, severity: 'low', location: { path: paths[0] } };
};
const comparable = { state: 'COMPARABLE', reasons: [] };

test('matching uses the fingerprint, then Git renames; a changed move or several matches stay unknown', () => {
  const kept = finding('EXPORT-UNREFERENCED', ['src/a.ts', 'x', 'value']), moved = finding('EXPORT-UNREFERENCED', ['src/old.ts', 'y', 'value']);
  const edited = finding('EXPORT-UNREFERENCED', ['src/edit.ts', 'z', 'value']), gone = finding('EXPORT-UNREFERENCED', ['src/gone.ts', 'g', 'value']);
  const absent = finding('EXPORT-UNREFERENCED', ['src/a.ts', 'w', 'value']);
  const head = stored([kept, finding('EXPORT-UNREFERENCED', ['src/new.ts', 'y', 'value']), finding('EXPORT-UNREFERENCED', ['src/edited.ts', 'q', 'value']), finding('CYCLE-VALUE', ['src/a.ts', 'src/new.ts'], ['src/a.ts', 'src/new.ts'])],
    { files: ['src/a.ts', 'src/new.ts', 'src/edited.ts'] });
  const base = stored([kept, moved, edited, gone, absent, finding('CYCLE-VALUE', ['src/a.ts', 'src/old.ts'], ['src/a.ts', 'src/old.ts'])], { files: ['src/a.ts', 'src/old.ts', 'src/edit.ts', 'src/gone.ts'] });
  const result = compareFindings(base, head, { renames: [{ from: 'src/old.ts', to: 'src/new.ts', similarity: 100 }, { from: 'src/edit.ts', to: 'src/edited.ts', similarity: 70 }], comparability: comparable });
  const status = (item) => [result.statuses[item.id].baseline, result.statuses[item.id].matchedBy];
  assert.deepEqual(status(head.findings[0]), ['EXISTING', 'fingerprint']);
  assert.deepEqual(status(head.findings[1]), ['EXISTING', 'rename']);
  assert.deepEqual(status(head.findings[2]), ['UNKNOWN', 'changed-in-move']);
  assert.deepEqual(status(head.findings[3]), ['EXISTING', 'rename'], 'cycle members are mapped and sorted again');
  assert.deepEqual(result.resolved.map((item) => [item.finding.id, item.matchedBy]).sort(), [[absent.id, 'absent'], [gone.id, 'path-removed']].sort());
  assert.deepEqual(result.baseUnknown.map((item) => [item.finding.id, item.matchedBy]), [[edited.id, 'changed-in-move']]);
  assert.deepEqual(result.counts, { new: 0, existing: 3, resolved: 2, unknown: 2 });

  const twin = finding('EXPORT-UNREFERENCED', ['src/new.ts', 'y', 'value']);
  const ambiguous = compareFindings(stored([moved, twin], { files: ['src/old.ts', 'src/new.ts'] }), stored([twin], { files: ['src/new.ts'] }),
    { renames: [{ from: 'src/old.ts', to: 'src/new.ts', similarity: 100 }], comparability: comparable });
  assert.deepEqual([ambiguous.statuses[twin.id].baseline, ambiguous.statuses[twin.id].matchedBy], ['UNKNOWN', 'ambiguous']);
  assert.deepEqual(ambiguous.baseUnknown.map((item) => item.matchedBy), ['ambiguous', 'ambiguous']);
});

test('measured findings need coverage on both sides, and incomparable inputs label nothing new or resolved', () => {
  const exit = finding('TEST-EXIT-NOT-RUN', ['src/a.ts#parse'], ['src/a.ts'], 'measured'), other = finding('TEST-EXIT-NOT-RUN', ['src/a.ts#load'], ['src/a.ts'], 'measured');
  const half = compareFindings(stored([other], { files: ['src/a.ts'], coverage: 'not-applicable' }), stored([exit], { files: ['src/a.ts'], coverage: 'measured' }), { renames: [], comparability: comparable });
  assert.deepEqual([half.statuses[exit.id].baseline, half.statuses[exit.id].matchedBy], ['UNKNOWN', 'not-measured']);
  assert.deepEqual(half.resolved, []);
  const both = compareFindings(stored([other], { files: ['src/a.ts'], coverage: 'measured' }), stored([exit], { files: ['src/a.ts'], coverage: 'measured' }), { renames: [], comparability: comparable });
  assert.deepEqual([both.statuses[exit.id].baseline, both.resolved.length], ['NEW', 1]);

  const base = stored([], { inputs: { config: 'other' } }), head = stored([exit], { files: ['src/a.ts'] });
  const verdict = comparability(base, head);
  assert.deepEqual(verdict, { state: 'NOT_COMPARABLE', reasons: ['config'] });
  assert.deepEqual(comparability(stored([], { roots: ['lib'] }), head).reasons, ['roots'], 'other source roots map other files');
  assert.deepEqual(comparability(stored([], { roots: null }), head).reasons, ['roots'], 'unknown roots are not comparable');
  const none = compareFindings(base, head, { renames: [], comparability: verdict });
  assert.deepEqual([none.state, none.reasons, none.counts], ['NOT_COMPARABLE', ['config'], { new: 0, existing: 0, resolved: 0, unknown: 1 }]);
  assert.deepEqual(none.statuses[exit.id], { baseline: 'UNKNOWN', matchedBy: 'not-comparable', base: null });
});

test('a fix commit out of the window, a new rule module base and an incomplete rename list give UNKNOWN, not RESOLVED or NEW', () => {
  const labels = (result, head) => [head.map((item) => Object.values(result.statuses[item.id]).slice(0, 2)), result.baseUnknown.map((item) => item.matchedBy), result.resolved.length];
  const fix = finding('FIX-WITHOUT-TEST', ['0123456789abcdef'], ['src/a.ts']);
  assert.deepEqual(labels(compareFindings(stored([fix], { files: ['src/a.ts'] }), stored([], { files: ['src/a.ts'] }), { renames: [], comparability: comparable }), []),
    [[], ['outside-window'], 0], 'a commit and its file list never change, so the commit only left the history window');
  const older = finding('FIX-WITHOUT-TEST', ['0123456789'], ['src/a.ts']);
  assert.deepEqual(labels(compareFindings(stored([], { files: ['src/a.ts'] }), stored([older], { files: ['src/a.ts'] }), { renames: [], olderFixCommits: new Set(['0123456789']), comparability: comparable }), [older]),
    [[['UNKNOWN', 'outside-window']], [], 0], 'a fix commit that the base history already holds is not NEW, even when the base window did not reach it');
  assert.deepEqual(labels(compareFindings(stored([], { files: ['src/a.ts'] }), stored([older], { files: ['src/a.ts'] }), { renames: [], comparability: comparable }), [older]),
    [[['NEW', null]], [], 0], 'a fix commit after the base is NEW');
  const rule = (from) => finding('ARCH-RULE', ['core -> ui', from, 'src/app/ui/view.ts'], [from, 'src/app/ui/view.ts']);
  const [before, after] = [rule('src/app/core/engine.ts'), rule('src/app/core/other.ts')], files = ['src/app/core/engine.ts', 'src/app/core/other.ts', 'src/app/ui/view.ts'];
  assert.deepEqual(labels(compareFindings(stored([before], { files, ruleBase: 'src/app' }), stored([after], { files, ruleBase: 'src' }), { renames: [], comparability: comparable }), [after]),
    [[['UNKNOWN', 'rule-base-changed']], ['rule-base-changed'], 0]);
  assert.deepEqual(labels(compareFindings(stored([before], { files }), stored([after], { files }), { renames: [], complete: false, comparability: comparable }), [after]),
    [[['UNKNOWN', 'renames-incomplete']], ['renames-incomplete'], 0]);
  const removed = compareFindings(stored([before], { files }), stored([], { files: ['src/app/ui/view.ts'] }), { renames: [], comparability: comparable });
  assert.deepEqual(removed.resolved.map((item) => item.matchedBy), ['path-removed'], 'the importing file is gone, although the import target stays');
});
