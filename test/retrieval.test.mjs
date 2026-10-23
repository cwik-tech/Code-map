import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInside, quote } from '../lib/inspect.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const many = Array.from({ length: 40 }, (_, i) => `export const spare${i} = ${i};`).join('\n');

/** A committed project with one finding of each structural kind, and 25 tests that reach parse() through hub(). */
function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-retrieval-'));
  const store = mkdtempSync(join(tmpdir(), 'code-map-store-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  put('.code-map.json', JSON.stringify({ rules: ['core -> ui'] }));
  put('src/core/engine.ts', "import { view } from '../ui/view';\nimport { helper } from './missing-helper';\nexport function engine() { return view() + helper; }\n");
  put('src/ui/view.ts', "import { spare0 } from '../lib/spares';\nexport function view() { return 'v' + spare0; }\n");
  put('src/cycle/a.ts', "import { b } from './b';\nexport const a = () => b();\n");
  put('src/cycle/b.ts', "import { a } from './a';\nexport const b = () => 1;\nexport const callA = () => a();\n");
  put('src/lib/parse.ts', "export function parse(x: string) {\n  if (!x) throw new Error('bad');\n  return x;\n}\n");
  put('src/lib/hub.ts', "import { parse } from './parse';\nexport const hub = (x: string) => parse(x);\nexport const unused = 1;\n");
  put('src/lib/spares.ts', many + '\n');
  for (let i = 0; i < 25; i++) {
    put(`test/hub-${String(i).padStart(2, '0')}.test.ts`, `import { test, expect } from 'vitest';\nimport { hub } from '../src/lib/hub';\ntest('hub returns its input ${i}', () => { expect(hub('ok')).toBe('ok'); });\n`);
  }
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'fixture');
  return { root, store, put, git };
}

function run(root, args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 30000, env: { ...process.env, ...env } });
}

/** Splits a printed command the way a POSIX shell does for plain words and single-quoted words. */
function words(command) {
  const out = [];
  for (const match of command.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)) out.push(match[1] !== undefined ? match[1].replaceAll("'\\''", "'") : match[2]);
  return out;
}

/** Runs a follow-up command exactly as the report printed it, and returns its JSON. */
function follow(root, command) {
  const [program, ...args] = words(command);
  assert.equal(program, 'code-map');
  const output = run(root, args);
  assert.equal(output.status, 0, output.stderr);
  return JSON.parse(output.stdout);
}

test('acceptance: the summary lists findings with exact follow-up commands that read the same stored analysis', (t) => {
  const { root, store, git } = project(t);
  const output = run(root, ['inspect', '--summary', '--ref', 'HEAD', '--store', store]);
  assert.equal(output.status, 0, output.stderr);
  const summary = JSON.parse(output.stdout);
  assert.equal(summary.reportType, 'code-map-summary');
  assert.equal(summary.schemaVersion, 1);
  assert.match(summary.analysis.id, /^A-[0-9a-f]{16}$/);
  assert.equal(summary.analysis.reused, false);
  assert.equal(summary.snapshot.sha, git('rev-parse', 'HEAD').trim());
  assert.equal(summary.verification.state, 'NOT_RUN');
  assert.equal(summary.verification.ratings, null);
  assert.ok(summary.gaps.some((gap) => gap.key === 'execution'), 'the summary says that no project test ran');

  const items = summary.findings.items;
  for (const rule of ['ARCH-RULE', 'IMPORT-UNRESOLVED', 'CYCLE-VALUE', 'TEST-NO-FAILURE-ASSERTION', 'EXPORT-UNREFERENCED']) {
    assert.ok(items.some((item) => item.ruleId === rule), `summary shows a ${rule} finding`);
  }
  for (const item of items) {
    assert.match(item.id, new RegExp(`^${item.ruleId}-[0-9a-f]{10}$`));
    assert.ok(item.evidence.length > 0 && item.evidence.every((place) => typeof place.path === 'string'));
    assert.deepEqual(words(item.next).slice(1, 5), ['inspect', '--analysis', summary.analysis.id, '--finding']);
  }
  assert.equal(summary.findings.total, summary.findings.byRule.reduce((sum, rule) => sum + rule.count, 0));
  const perRule = new Map();
  for (const item of items) perRule.set(item.ruleId, (perRule.get(item.ruleId) ?? 0) + 1);
  assert.ok(items.length <= 20 && [...perRule.values()].every((count) => count <= 5), 'at most 20 findings, 5 for each rule');
  assert.ok(Buffer.byteLength(output.stdout) < 64 * 1024, 'the summary stays small');

  const cycle = items.find((item) => item.ruleId === 'CYCLE-VALUE');
  const detail = follow(root, cycle.next);
  assert.equal(detail.reportType, 'code-map-finding');
  assert.equal(detail.analysis.id, summary.analysis.id);
  assert.equal(detail.finding.id, cycle.id);
  assert.deepEqual(detail.details.files.items, ['src/cycle/a.ts', 'src/cycle/b.ts']);
  assert.deepEqual(detail.details.edges.items.map((edge) => [edge.source, edge.target, edge.line]), [['src/cycle/a.ts', 'src/cycle/b.ts', 1], ['src/cycle/b.ts', 'src/cycle/a.ts', 1]]);

  const rule = items.find((item) => item.ruleId === 'ARCH-RULE');
  assert.deepEqual(follow(root, rule.next).details.violation, { rule: 'core -> ui', from: 'src/core/engine.ts', to: 'src/ui/view.ts', lines: [1] });

  const again = JSON.parse(run(root, ['inspect', '--summary', '--ref', 'HEAD', '--store', store]).stdout);
  assert.equal(again.analysis.id, summary.analysis.id);
  assert.equal(again.analysis.reused, true);
  assert.equal(git('status', '--porcelain'), '', 'inspection writes nothing into the repository');
  const saved = readdirSync(join(store, 'analyses'));
  assert.deepEqual(saved, [`${summary.analysis.id}.json.gz`]);
  if (process.platform !== 'win32') assert.equal(statSync(join(store, 'analyses', saved[0])).mode & 0o077, 0, 'the stored analysis is private');
});

test('follow-ups keep reading the stored snapshot and mark it stale after the code changes', (t) => {
  const { root, store, put } = project(t);
  const summary = JSON.parse(run(root, ['inspect', '--summary', '--worktree', '--store', store]).stdout);
  assert.equal(summary.analysis.freshness.state, 'current');
  const cycle = summary.findings.items.find((item) => item.ruleId === 'CYCLE-VALUE');
  put('src/cycle/b.ts', 'export const b = () => 1;\n');

  const detail = follow(root, cycle.next);
  assert.deepEqual(detail.details.files.items, ['src/cycle/a.ts', 'src/cycle/b.ts'], 'evidence comes from the stored snapshot');
  assert.equal(detail.analysis.freshness.state, 'stale');
  assert.deepEqual(detail.analysis.freshness.changed, ['worktree']);
  assert.match(detail.analysis.freshness.refresh, /^code-map inspect --summary --worktree /);

  const fresh = JSON.parse(run(root, ['inspect', '--summary', '--worktree', '--store', store]).stdout);
  assert.notEqual(fresh.analysis.id, summary.analysis.id);
  assert.equal(fresh.findings.items.some((item) => item.ruleId === 'CYCLE-VALUE'), false);
});

test('paged evidence keeps every test path reachable, and stored file reports match a fresh inspection', (t) => {
  const { root, store } = project(t);
  const summary = JSON.parse(run(root, ['inspect', '--summary', '--ref', 'HEAD', '--store', store]).stdout);
  const gap = summary.findings.items.find((item) => item.ruleId === 'TEST-NO-FAILURE-ASSERTION' && item.location.symbol === 'parse');
  const detail = follow(root, gap.next);
  const first = detail.details.tests.transitive;
  assert.equal(first.total, 25);
  assert.equal(first.items.length, 20);
  const second = follow(root, first.next);
  assert.equal(second.reportType, 'code-map-evidence');
  assert.deepEqual([second.page.offset, second.page.items.length, second.page.next], [20, 5, null]);

  const stored = follow(root, `code-map inspect --analysis ${summary.analysis.id} --file src/lib/parse.ts --store '${store}'`);
  assert.deepEqual([...first.items, ...second.page.items], stored.files[0].tests.transitive, 'pages add up to the complete list');
  const fresh = JSON.parse(run(root, ['inspect', '--ref', 'HEAD', '--file', 'src/lib/parse.ts']).stdout);
  assert.equal(stored.analysis.id, summary.analysis.id);
  for (const report of [stored, fresh]) { delete report.analysis; delete report.snapshot.generatedAt; delete report.tests.coverage.mapped; }
  assert.deepEqual(stored, fresh);

  const rule = summary.findings.byRule.find((item) => item.ruleId === 'EXPORT-UNREFERENCED');
  assert.ok(rule.count >= 40);
  const page = follow(root, rule.next);
  assert.equal(page.reportType, 'code-map-findings');
  assert.equal(page.page.total, rule.count);
  assert.ok(page.page.items.every((item) => item.ruleId === 'EXPORT-UNREFERENCED') && page.page.next);
});

test('retrieval refuses unknown, malformed or damaged analyses and invalid paging without printing a report', (t) => {
  const { root, store } = project(t);
  const summary = JSON.parse(run(root, ['inspect', '--summary', '--ref', 'HEAD', '--store', store]).stdout);
  const id = summary.analysis.id, finding = summary.findings.items[0].id;
  const fails = (args, pattern) => {
    const output = run(root, ['inspect', ...args]);
    assert.notEqual(output.status, 0, `${args.join(' ')} must fail`);
    assert.equal(output.stdout, '');
    assert.match(output.stderr, pattern);
  };
  fails(['--analysis', 'A-0000000000000000', '--finding', finding, '--store', store], /not in the store/);
  fails(['--analysis', '../etc', '--store', store], /analysis ID/);
  fails(['--finding', finding, '--ref', 'HEAD'], /--finding needs --analysis/);
  fails(['--analysis', id, '--ref', 'HEAD', '--store', store], /--analysis already identifies/);
  fails(['--analysis', id, '--finding', 'CYCLE-VALUE-0000000000', '--store', store], /No finding CYCLE-VALUE-0000000000/);
  fails(['--analysis', id, '--finding', finding, '--part', 'nothing', '--store', store], /Unknown part "nothing"/);
  fails(['--analysis', id, '--findings', '--limit', '0', '--store', store], /--limit/);
  fails(['--analysis', id, '--findings', '--offset', '-1', '--store', store], /--offset/);
  const hub = ['--file', 'src/lib/hub.ts'];
  for (const args of [['--summary', '--findings'], ['--summary', '--full'], ['--summary', ...hub, '--part', 'imports'], ['--findings', ...hub, '--part', 'imports'],
    [...hub, '--change', 'latest', '--part', 'imports'], ['--finding', finding, ...hub], ['--finding', finding, '--change', 'latest'], ['--finding', finding, '--summary']]) {
    fails(['--analysis', id, ...args, '--store', store], /not both|remove the other selections/);
  }
  writeFileSync(join(store, 'analyses', `${id}.json.gz`), 'not gzip');
  fails(['--analysis', id, '--store', store], /unreadable/);
});

test('a scoped summary keeps findings that touch the selection, and its commands keep the same scope', (t) => {
  const { root, store, put } = project(t);
  put('src/cycle/a.ts', "import { b } from './b';\nexport const a = () => b() + 1;\n");
  const summary = JSON.parse(run(root, ['inspect', '--summary', '--worktree', '--change', 'uncommitted', '--store', store]).stdout);
  assert.deepEqual(summary.scope.selection.files, ['src/cycle/a.ts']);
  assert.deepEqual([...new Set(summary.findings.items.map((item) => item.ruleId))], ['CYCLE-VALUE']);
  assert.deepEqual(words(summary.findings.byRule[0].next).slice(-4), ['--change', 'uncommitted', '--store', store]);
  const whole = JSON.parse(run(root, ['inspect', '--analysis', summary.analysis.id, '--store', store]).stdout);
  assert.ok(whole.findings.total > summary.findings.total, 'the stored analysis still covers the whole project');
});

test('the store and the suggested full-report path stay outside the repository, and refresh keeps a custom labels file', (t) => {
  const { root, store, put, git } = project(t);
  // A folder name that starts with two dots is inside, and a case-insensitive file system ignores letter case.
  assert.deepEqual([['/r', '/r/..cache', 'linux'], ['/r', '/r/../x', 'linux'], ['/r', '/rx', 'linux'], ['/r', '/R/x', 'linux'], ['/r', '/R/x', 'darwin'], ['/r', '/R/x', 'win32']]
    .map((args) => isInside(...args)), [true, false, false, false, true, true]);
  const upper = join(dirname(root), basename(root).toUpperCase());
  for (const folder of [join(root, '.cache'), join(root, '..cache'), ...(existsSync(upper) ? [join(upper, '.cache')] : [])]) {
    const inside = run(root, ['inspect', '--summary', '--ref', 'HEAD', '--store', folder]);
    assert.notEqual(inside.status, 0, folder);
    assert.equal(inside.stdout, '');
    assert.match(inside.stderr, /outside the repository/);
  }
  assert.equal(git('status', '--porcelain', '--untracked-files=all'), '');
  put('labels.json', JSON.stringify({ files: {} }));
  git('add', '.'); git('commit', '-qm', 'labels');
  const summary = JSON.parse(run(root, ['inspect', '--summary', '--ref', 'HEAD', '--labels', 'labels.json', '--store', store]).stdout);
  assert.ok(!words(summary.commands.full).includes(root) && !words(summary.commands.full).some((word) => word.startsWith(root + '/')), 'the full-report path is not inside the repository');
  const out = words(summary.commands.full).at(-3);
  assert.equal(dirname(out), join(store, 'exports'), 'the full report goes to a private folder of the store, not to the shared temporary folder');
  assert.equal(run(root, words(summary.commands.full).slice(1)).status, 0);
  if (process.platform !== 'win32') assert.deepEqual([statSync(out).mode & 0o077, statSync(dirname(out)).mode & 0o077], [0, 0], 'the full report is private, as the store is');
  put('src/extra.ts', 'export const extra = 1;\n');
  git('add', '.'); git('commit', '-qm', 'more');
  const detail = follow(root, summary.findings.items[0].next);
  assert.equal(detail.analysis.freshness.state, 'stale');
  assert.deepEqual(words(detail.analysis.freshness.refresh).slice(1, 7), ['inspect', '--summary', '--ref', 'HEAD', '--labels', 'labels.json']);
});

test('a renamed export with a stale consumer is a NEW broken-import finding against the base', (t) => {
  const { root, store, put, git } = project(t);
  put('src/lib/hub.ts', "import { parse } from './parse';\nexport const hubRenamed = (x: string) => parse(x);\nexport const unused = 1;\n");
  git('add', '.'); git('commit', '-qm', 'rename hub');
  const summary = JSON.parse(run(root, ['inspect', '--summary', '--ref', 'HEAD', '--base', 'HEAD~1', '--store', store]).stdout);
  const broken = summary.findings.items.filter((item) => item.ruleId === 'IMPORT-NAME-MISSING');
  assert.ok(broken.length > 0, 'the stale test imports of hub are findings');
  assert.ok(broken.every((item) => item.baseline === 'NEW' && item.severity === 'high'));
  const detail = follow(root, broken[0].next);
  assert.equal(detail.details.import.name, 'hub');
  assert.ok(detail.details.exports.items.includes('hubRenamed'), 'the details list what the target exports now');
});

test('the summary names files in languages that the analysis does not read', (t) => {
  const { root, store, put, git } = project(t);
  put('scripts/tool.py', 'print(1)\n'); put('src/ui/widget.vue', '<template><p/></template>\n'); put('src/ui/other.vue', '<template><p/></template>\n');
  put('node_modules/pkg/index.py', 'ignored = True\n');
  git('add', '-f', '.'); git('commit', '-qm', 'other languages');
  const summary = JSON.parse(run(root, ['inspect', '--summary', '--ref', 'HEAD', '--store', store]).stdout);
  const gap = summary.gaps.find((item) => item.key === 'unsupportedFiles');
  assert.equal(gap?.count, 3);
  assert.match(gap.text, /2 \.vue, 1 \.py/);
});

test('the summary and a findings page show at most 20 selected files, with the totals and a command for the complete list', (t) => {
  const { root, store, put, git } = project(t);
  for (let i = 0; i < 25; i++) put(`src/many/m${String(i).padStart(2, '0')}.ts`, `export const m${i} = ${i};\n`);
  git('add', '.'); git('commit', '-qm', 'many');
  const summary = JSON.parse(run(root, ['inspect', '--summary', '--ref', 'HEAD', '--change', 'latest', '--store', store]).stdout);
  const shown = (selection) => [selection.files.length, selection.totals.files, selection.missing.length, selection.totals.missing];
  assert.deepEqual(shown(summary.scope.selection), [20, 25, 0, 0]);
  const page = JSON.parse(run(root, ['inspect', '--analysis', summary.analysis.id, '--findings', '--change', 'latest', '--limit', '1', '--store', store]).stdout);
  assert.deepEqual(shown(page.filter.selection), [20, 25, 0, 0]);
  assert.equal(follow(root, summary.scope.selection.report).selection.files.length, 25, 'the file report keeps the complete list');
});

test('a follow-up works from a folder with a damaged .code-map.json, and other commands report the damage without a stack trace', (t) => {
  const { root, store } = project(t);
  const summary = JSON.parse(run(root, ['inspect', '--summary', '--ref', 'HEAD', '--store', store]).stdout);
  const other = mkdtempSync(join(tmpdir(), 'code-map-other-'));
  t.after(() => rmSync(other, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', other]);
  writeFileSync(join(other, '.code-map.json'), '{bad');
  assert.equal(follow(other, summary.findings.items[0].next).finding.id, summary.findings.items[0].id);
  for (const args of [['inspect', '--summary', '--ref', 'HEAD', '--store', store], ['todo'], []]) {
    const output = run(other, args);
    assert.deepEqual([output.status, output.stdout], [1, ''], args.join(' '));
    assert.match(output.stderr, /^code-map: .*\.code-map\.json/);
    assert.doesNotMatch(output.stderr, /\n\s+at /, 'no stack trace');
  }
});

test('printed commands quote words that a shell expands, and join an option to a value that starts with a dash', (t) => {
  assert.deepEqual(['=b.ts', '~c.ts', 'a=b', 'src/a.ts'].map(quote), ["'=b.ts'", "'~c.ts'", 'a=b', 'src/a.ts']);
  const root = mkdtempSync(join(tmpdir(), 'code-map-names-')), store = mkdtempSync(join(tmpdir(), 'code-map-store-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); });
  const names = ['-a.ts', '=b.ts', '~c.ts'];
  for (const name of names) writeFileSync(join(root, name), "import { gone } from './gone';\nexport const x = gone;\n");
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'odd names');
  const summary = JSON.parse(run(root, ['inspect', '--summary', '--ref', 'HEAD', '--store', store]).stdout);
  const commands = summary.findings.items.filter((item) => item.ruleId === 'IMPORT-UNRESOLVED').map((item) => follow(root, item.next).details.file).sort();
  for (const fragment of [' --file=-a.ts ', " --file '=b.ts' ", " --file '~c.ts' "]) assert.ok(commands.some((command) => command.includes(fragment)), fragment);
  assert.deepEqual(commands.map((command) => follow(root, command).files[0].path).sort(), [...names].sort());
});

test('a summary refuses a labels file outside the repository before it collects, and accepts a ref with spaces', (t) => {
  const { root, store } = project(t);
  const outside = run(root, ['inspect', '--summary', '--ref', 'HEAD', '--labels', '../labels.json', '--store', store]);
  assert.notEqual(outside.status, 0);
  assert.equal(outside.stdout, '');
  assert.match(outside.stderr, /outside the repository/);
  const spaced = run(root, ['inspect', '--summary', '--ref', 'HEAD@{0 seconds ago}', '--store', store]);
  assert.equal(spaced.status, 0, spaced.stderr);
  const summary = JSON.parse(spaced.stdout);
  assert.equal(JSON.parse(run(root, ['inspect', '--analysis', summary.analysis.id, '--store', store]).stdout).analysis.id, summary.analysis.id);
});

test('the store guard compares whole path segments, and folds letter case and Unicode form on macOS and Windows', () => {
  assert.equal(isInside('/T/café', '/T/CAFE\u0301/.s', 'darwin'), true);
  assert.equal(isInside('/T/café', '/T/CAFE\u0301/.s', 'linux'), false);
  assert.equal(isInside('/T/repo', '/T/repo/..cache', 'linux'), true);
  assert.equal(isInside('/T/repo', '/T/repo..x', 'darwin'), false);
});

test('the summary shows the current content digest that run manifests bind to, also when an unread file changes and the analysis is reused', (t) => {
  const { root, store, put, git } = project(t);
  put('README.md', '# notes\n'); git('add', '.'); git('commit', '-qm', 'readme');
  const first = JSON.parse(run(root, ['inspect', '--summary', '--worktree', '--store', store]).stdout);
  assert.equal(first.snapshot.worktreeDigest, null, 'a clean working tree has no digest');
  put('README.md', '# edited notes\n');
  const second = JSON.parse(run(root, ['inspect', '--summary', '--worktree', '--store', store]).stdout);
  assert.equal(second.analysis.id, first.analysis.id, 'a new README does not change what the analysis reads');
  assert.equal(second.analysis.reused, true);
  assert.match(second.snapshot.worktreeDigest, /^[0-9a-f]{64}$/, 'but it changes the files that a test run can see');
  assert.equal(JSON.parse(run(root, ['inspect', '--analysis', first.analysis.id, '--store', store]).stdout).snapshot.worktreeDigest, second.snapshot.worktreeDigest);
});

test('a findings page of a comparison lists NEW findings before EXISTING ones of the same severity', (t) => {
  const { root, store, put, git } = project(t);
  put('src/lib/spares.ts', many + '\n' + Array.from({ length: 5 }, (_, i) => `export const zzz${i} = ${i};`).join('\n') + '\n');
  git('add', '.'); git('commit', '-qm', 'more spares');
  const summary = JSON.parse(run(root, ['inspect', '--summary', '--ref', 'HEAD', '--base', 'HEAD~1', '--store', store]).stdout);
  const rule = summary.findings.byRule.find((item) => item.ruleId === 'EXPORT-UNREFERENCED');
  const page = follow(root, rule.next);
  assert.deepEqual(page.page.items.slice(0, 5).map((item) => item.baseline), Array(5).fill('NEW'));
  assert.ok(page.page.items.slice(5).every((item) => item.baseline !== 'NEW'));
});
