// The change of a verification run: the changed files that Git reports, the matcher for allowed paths, the origin of each
// new broken import and the test cases that the change removed or weakened. The Git fixtures are in temporary folders, and
// the .git folder of a fixture must not change.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { analyzeProject } from '../lib/analysis.mjs';
import { compareFindings } from '../lib/compare.mjs';
import { deriveFindings } from '../lib/findings.mjs';
import { changedFiles, changedPaths, importOrigins, matchesGlob, testWeakening, withUnsplitIndex } from '../lib/verify-change.mjs';

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-verify-change-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  return { root, put, git, sha: (ref) => git('rev-parse', ref).trim() };
}

/** The time, size and content hash of every file under .git. */
function gitFolder(root) {
  const state = {};
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else { const info = statSync(path); state[relative(root, path)] = `${info.mtimeMs} ${info.size} ${createHash('sha256').update(readFileSync(path)).digest('hex')}`; }
    }
  };
  walk(join(root, '.git'));
  return state;
}

const file = (path, status, from = null) => ({ path, status, from });

test('changedFiles lists the added, modified, deleted, renamed and type-changed files between two commits', (t) => {
  const { root, put, git, sha } = repository(t);
  put('src/keep.ts', 'export const keep = 1;\n');
  put('src/edit.ts', 'export const edit = 1;\n');
  put('src/gone.ts', 'export const gone = 1;\n');
  put('src/old/name.ts', 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
  put('src/link.ts', 'export const link = 1;\n');
  git('add', '.'); git('commit', '-qm', 'base');
  put('src/edit.ts', 'export const edit = 2;\n');
  git('rm', '-q', 'src/gone.ts');
  mkdirSync(join(root, 'src/new'));
  git('mv', 'src/old/name.ts', 'src/new/name.ts');
  rmSync(join(root, 'src/link.ts')); symlinkSync('keep.ts', join(root, 'src/link.ts'));
  put('src/ñ"é.ts', 'export const quoted = 1;\n');
  git('add', '-A'); git('commit', '-qm', 'head');

  const change = changedFiles(root, sha('HEAD~1'), sha('HEAD'));
  assert.deepEqual(change, { files: [file('src/edit.ts', 'M'), file('src/gone.ts', 'D'), file('src/link.ts', 'T'),
    file('src/new/name.ts', 'R', 'src/old/name.ts'), file('src/ñ"é.ts', 'A')], complete: true }, 'a name with non-ASCII letters or a double quote stays as it is');
  assert.deepEqual(changedPaths(change), ['src/edit.ts', 'src/gone.ts', 'src/link.ts', 'src/new/name.ts', 'src/old/name.ts', 'src/ñ"é.ts'], 'a rename gives both names');
});

test('changedFiles of a working-tree head adds the untracked files that Git does not ignore and writes nothing under .git', (t) => {
  const { root, put, git, sha } = repository(t);
  put('.gitignore', 'ignored/\n*.log\n');
  for (const name of ['edit', 'staged-delete', 'staged-move', 'unstaged-move', 'uncached']) put(`src/${name}.ts`, `export const value = '${name}';\n`);
  git('add', '.'); git('commit', '-qm', 'base');
  put('src/edit.ts', 'export const value = 2;\n');
  git('rm', '-q', 'src/staged-delete.ts');
  mkdirSync(join(root, 'src/lib'));
  git('mv', 'src/staged-move.ts', 'src/lib/staged-move.ts');
  renameSync(join(root, 'src/unstaged-move.ts'), join(root, 'src/lib/unstaged-move.ts'));
  git('rm', '-q', '--cached', 'src/uncached.ts');
  put('src/new.ts', 'export const fresh = 1;\n');
  put('ignored/build.ts', 'export const built = 1;\n');
  put('debug.log', 'log\n');
  const old = new Date('2001-02-03T04:05:06Z');
  for (const path of git('ls-files', '-z').split('\0').filter(Boolean)) { try { utimesSync(join(root, path), old, old); } catch { /* moved away */ } }
  const before = gitFolder(root);

  assert.deepEqual(changedFiles(root, sha('HEAD'), null), { files: [file('src/edit.ts', 'M'), file('src/lib/staged-move.ts', 'R', 'src/staged-move.ts'),
    file('src/lib/unstaged-move.ts', 'A'), file('src/new.ts', 'A'), file('src/staged-delete.ts', 'D'), file('src/uncached.ts', 'M'), file('src/unstaged-move.ts', 'D')],
  complete: true }, 'a move that is not staged is a deletion and an untracked file, and a file that left only the index is a modification');
  assert.deepEqual(gitFolder(root), before, 'the diff with the working tree uses a private copy of the index');
});

test('withUnsplitIndex gives the Git reads of a split index a private copy, so the times of the shared index files in .git stay the same', (t) => {
  const { root, put, git, sha } = repository(t);
  put('src/a.ts', 'export const a = 1;\n');
  git('add', '.'); git('commit', '-qm', 'plain');
  assert.equal(withUnsplitIndex(root, () => process.env.GIT_INDEX_FILE), undefined, 'without a split index the reads use the index of the repository');
  git('config', 'core.splitIndex', 'true');
  put('src/b.ts', 'export const b = 1;\n');
  git('add', '.'); git('commit', '-qm', 'base');
  put('src/a.ts', 'export const a = 2;\n'); git('add', 'src/a.ts');
  git('rm', '-q', '--cached', 'src/b.ts');
  put('src/new.ts', 'export const fresh = 1;\n');
  const shared = readdirSync(join(root, '.git')).filter((name) => name.startsWith('sharedindex.')), old = new Date('2001-02-03T04:05:06Z');
  assert.ok(shared.length > 0, 'the fixture has a split index');
  for (const name of shared) utimesSync(join(root, '.git', name), old, old);
  const before = gitFolder(root), expected = { files: [file('src/a.ts', 'M'), file('src/b.ts', 'M'), file('src/new.ts', 'A')], complete: true };
  assert.deepEqual(withUnsplitIndex(root, () => changedFiles(root, sha('HEAD'), null)), expected, 'the copy holds the staged changes of the split index');
  assert.deepEqual(gitFolder(root), before, 'no time of a shared index file changed');
  assert.equal(process.env.GIT_INDEX_FILE, undefined, 'the environment is as before the call');
  assert.throws(() => withUnsplitIndex(root, () => { throw new Error('stop'); }), /stop/);
  assert.equal(process.env.GIT_INDEX_FILE, undefined, 'also after an error');
  assert.deepEqual(changedFiles(root, sha('HEAD'), null), expected);
  assert.notDeepEqual(gitFolder(root), before, 'a read without the copy changes the time of the shared index, as Git does');
});

test('changedFiles says that the list is not complete when Git skips rename detection because of its rename limit', (t) => {
  const { root, put, git, sha } = repository(t);
  for (const i of [1, 2, 3]) put(`src/old/f${i}.ts`, `export const keep${i} = ${i};\nexport const spare${i} = ${i};\nexport const more${i} = ${i};\n`);
  git('add', '.'); git('commit', '-qm', 'base');
  mkdirSync(join(root, 'src/new'));
  for (const i of [1, 2, 3]) { git('mv', `src/old/f${i}.ts`, `src/new/g${i}.ts`); put(`src/new/g${i}.ts`, `${readFileSync(join(root, `src/new/g${i}.ts`), 'utf8')}// moved\n`); }
  git('add', '.'); git('commit', '-qm', 'move');
  const full = changedFiles(root, sha('HEAD~1'), sha('HEAD'));
  assert.deepEqual([full.complete, full.files.map((item) => item.status)], [true, ['R', 'R', 'R']]);
  git('config', 'diff.renameLimit', '1');
  const limited = changedFiles(root, sha('HEAD~1'), sha('HEAD'));
  assert.deepEqual(limited, { files: [1, 2, 3].map((i) => file(`src/new/g${i}.ts`, 'A')).concat([1, 2, 3].map((i) => file(`src/old/f${i}.ts`, 'D'))), complete: false });
  assert.deepEqual(changedPaths(limited), changedPaths(full), 'the changed paths are the same without rename detection');
  git('reset', '-q', '--soft', 'HEAD~1');
  assert.equal(changedFiles(root, sha('HEAD'), null).complete, false, 'also for a working-tree head');
});

test('changedPaths gives every path and every rename source once, sorted', () => {
  assert.deepEqual(changedPaths({ files: [file('src/b.ts', 'M'), file('src/new.ts', 'R', 'src/old.ts'), file('a.ts', 'A'), file('src/old.ts', 'A')], complete: true }),
    ['a.ts', 'src/b.ts', 'src/new.ts', 'src/old.ts']);
  assert.deepEqual(changedPaths({ files: [], complete: true }), []);
});

test('matchesGlob matches the whole path case-sensitively, with "**" for whole segments, "*" and "?" inside one segment', () => {
  const table = [
    ['src/**', 'src/a.ts', true], ['src/**', 'src/a/b/c.ts', true], ['src/**', 'src', true], ['src/**', 'srcx/a.ts', false], ['src/**', 'lib/src/a.ts', false],
    ['**/*.test.ts', 'a.test.ts', true], ['**/*.test.ts', 'test/x/a.test.ts', true], ['**/*.test.ts', 'test/a.test.tsx', false],
    ['src/**/index.ts', 'src/index.ts', true], ['src/**/index.ts', 'src/a/b/index.ts', true], ['src/**/index.ts', 'src/a/xindex.ts', false],
    ['src/**/**/x.ts', 'src/x.ts', true], ['**', 'any/deep/path.ts', true], ['**', '.code-map.json', true],
    ['src/*.ts', 'src/a.ts', true], ['src/*.ts', 'src/a/b.ts', false], ['*', '.code-map.json', true], ['*', 'src/a.ts', false], ['src/*', 'src/a/b.ts', false],
    ['src/?.ts', 'src/a.ts', true], ['src/?.ts', 'src/ab.ts', false], ['src/?.ts', 'src/.ts', false], ['?', 'é', true], ['??', '😀', false], ['?', '😀', true],
    ['src/a.ts', 'src/a.ts', true], ['src/a.ts', 'src/A.ts', false], ['SRC/**', 'src/a.ts', false], ['src/a.ts', 'src/a.tsx', false], ['src/a.ts', 'x/src/a.ts', false],
    ['src/a.ts', 'src/aXts', false], ['src/a+b[1](2){3}^$|.ts', 'src/a+b[1](2){3}^$|.ts', true], ['src/*a', 'src/*xa', true],
    ['src/a**b.ts', 'src/aXYb.ts', true], ['src/a**b.ts', 'src/a/b.ts', false], ['docs/', 'docs/a.md', false],
  ];
  assert.deepEqual(table.map(([pattern, path]) => [pattern, path, matchesGlob(path, pattern)]), table);
});

test('matchesGlob stays fast for patterns with many stars', () => {
  const started = process.hrtime.bigint();
  assert.equal(matchesGlob('a'.repeat(200), 'a*'.repeat(60) + 'b'), false);
  assert.equal(matchesGlob(Array(200).fill('d').join('/'), '**/'.repeat(60) + 'x'), false);
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 200);
});

/** A stored analysis of these files, as `inspect` keeps it: the analysis and its findings. No Git and no store. */
function snapshot(sources, tests = {}) {
  const resolve = createResolver(new Set([...Object.keys(sources), ...Object.keys(tests)]), { aliases: [], baseUrl: null });
  const facts = (entries, options) => Object.entries(entries).map(([path, text]) => analyzeFile(path, text, resolve, options));
  const analysis = analyzeProject({ project: 'fixture', ref: 'fixture', sha: 'fixture', rules: [], files: facts(sources),
    testFiles: facts(tests, { tests: true }).map((item) => ({ ...item, scan: item.testScan })), coChanges: { changes: {} }, changes: { uncommitted: [] } });
  return { data: { analysis }, findings: deriveFindings(analysis) };
}
/** The label of each head finding, from the finding comparison that `inspect --base` uses. */
const labelsOf = (base, head, renames = []) => Object.fromEntries(Object.entries(compareFindings(base, head, { renames, comparability: { state: 'COMPARABLE', reasons: [] } }).statuses)
  .map(([id, item]) => [id, item.baseline]));
const allNew = (head) => Object.fromEntries(head.findings.map((finding) => [finding.id, 'NEW']));
const ordered = (rows) => rows.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
/** Each classified head finding as [rule, ...identity key, origin]. */
function origins(base, head, labels, renames = []) {
  const map = importOrigins(base.data.analysis, head.findings, labels, renames);
  return ordered(head.findings.filter((finding) => map.has(finding.id)).map((finding) => [finding.ruleId, ...finding.key, map.get(finding.id)]));
}

test('the import check lists each skipped import with its reason and keeps its counts and missing names', () => {
  const { importNames } = snapshot({
    'src/a.ts': "import { x } from './cjs';\nimport { y } from './star';\nimport { z } from './none';\nimport { k, gone } from './b';\nexport const a = [x, y, z, k, gone];",
    'src/cjs.ts': 'module.exports = { x: 1 };', 'src/star.ts': "export * from 'some-package';", 'src/none.ts': 'const local = 1;', 'src/b.ts': 'export const k = 1;',
  }, { 'test/a.test.ts': "import { test } from 'node:test';\nimport { x } from '../src/cjs';\ntest('uses x', () => { x; });" }).data.analysis;
  assert.deepEqual(importNames.skipped, [{ source: 'src/a.ts', target: 'src/cjs.ts', line: 1, reason: 'commonJs' }, { source: 'src/a.ts', target: 'src/star.ts', line: 2, reason: 'exportStar' },
    { source: 'src/a.ts', target: 'src/none.ts', line: 3, reason: 'noExports' }, { source: 'test/a.test.ts', target: 'src/cjs.ts', line: 2, reason: 'commonJs' }]);
  assert.deepEqual(importNames.unchecked, { exportStar: 1, commonJs: 2, bindingPattern: 0, exportAssignment: 0, noExports: 1 });
  assert.deepEqual(importNames.missing.map((item) => [item.source, item.target, item.name]), [['src/a.ts', 'src/b.ts', 'gone']]);
});

test('importOrigins tells a consumer that lost its import target from a new import that does not resolve', () => {
  const stale = "import { s } from './stale-target';\nexport const st = s;";
  const base = snapshot({ 'src/a.ts': 'export const kept = 1;\nexport const gone = 2;', 'src/b.ts': 'export const b = 1;', 'src/stale.ts': stale,
    'src/user.ts': "import { kept, gone } from './a';\nimport { b } from './b';\nexport const u = [kept, gone, b];" },
  { 'test/a.test.ts': "import { test } from 'node:test';\nimport { gone } from '../src/a';\ntest('uses gone', () => { gone; });" });
  const head = snapshot({ 'src/a.ts': 'export const kept = 1;', 'src/stale.ts': stale,
    'src/user.ts': "import { kept, gone, never } from './a';\nimport { b } from './b';\nimport { c } from './nowhere';\nexport const u = [kept, gone, never, b, c];",
    'src/fresh.ts': "import { nope } from './a';\nimport { q } from './missing';\nexport const f = [nope, q];" },
  { 'test/a.test.ts': "import { test } from 'node:test';\nimport { gone, added } from '../src/a';\ntest('uses gone', () => { gone; added; });",
    'test/new.test.ts': "import { test } from 'node:test';\nimport { absent } from '../src/a';\ntest('new', () => { absent; });" });
  assert.deepEqual(origins(base, head, labelsOf(base, head)), [
    ['IMPORT-NAME-MISSING', 'src/fresh.ts', 'src/a.ts', 'nope', 'new-import'],
    ['IMPORT-NAME-MISSING', 'src/user.ts', 'src/a.ts', 'gone', 'lost-consumer'],
    ['IMPORT-NAME-MISSING', 'src/user.ts', 'src/a.ts', 'never', 'new-import'],
    ['IMPORT-NAME-MISSING', 'test/a.test.ts', 'src/a.ts', 'added', 'undecided'],
    ['IMPORT-NAME-MISSING', 'test/a.test.ts', 'src/a.ts', 'gone', 'lost-consumer'],
    ['IMPORT-NAME-MISSING', 'test/new.test.ts', 'src/a.ts', 'absent', 'new-import'],
    ['IMPORT-UNRESOLVED', 'src/fresh.ts', './missing', 'new-import'],
    ['IMPORT-UNRESOLVED', 'src/user.ts', './b', 'lost-consumer'],
    ['IMPORT-UNRESOLVED', 'src/user.ts', './nowhere', 'new-import'],
  ], 'an EXISTING broken import gets no origin, and the base keeps no import list for a test file');
});

test('importOrigins maps paths through renames and gives undecided when the base cannot show that the import resolved', () => {
  const base = snapshot({ 'src/lib/m.ts': 'export const m1 = 1;\nexport const m2 = 2;', 'src/lib/c.ts': "import { m2 } from './m';\nexport const c = m2;",
    'src/barrel.ts': "export * from './impl';", 'src/impl.ts': 'export const deep = 1;\nexport const other = 2;', 'src/use.ts': "import { deep } from './barrel';\nexport const u = deep;",
    'src/cjs.ts': 'module.exports = { q: 1 };', 'src/use2.ts': "import { q } from './cjs';\nexport const u2 = q;",
    'src/u.ts': "import { z } from './later';\nexport const uu = z;", 'src/w1.ts': 'export const w = 1;', 'src/v.ts': "import { w } from './w1';\nexport const vv = w;" });
  const head = snapshot({ 'src/lib/n.ts': 'export const m1 = 1;', 'src/app/c.ts': "import { m2 } from '../lib/n';\nexport const c = m2;",
    'src/barrel.ts': "export * from './impl';", 'src/impl.ts': 'export const other = 2;', 'src/use.ts': "import { deep } from './barrel';\nexport const u = deep;",
    'src/cjs.ts': 'export const r = 1;', 'src/use2.ts': "import { q } from './cjs';\nexport const u2 = q;",
    'src/u.ts': "import { z } from './later';\nexport const uu = z;", 'src/later.ts': 'export const notz = 1;',
    'src/w1.ts': 'export const w = 1;', 'src/w2.ts': 'export const other2 = 1;', 'src/v.ts': "import { w } from './w2';\nexport const vv = w;" });
  const renames = [{ from: 'src/lib/m.ts', to: 'src/lib/n.ts', similarity: 80 }, { from: 'src/lib/c.ts', to: 'src/app/c.ts', similarity: 70 }];
  const expected = [
    ['IMPORT-NAME-MISSING', 'src/app/c.ts', 'src/lib/n.ts', 'm2', 'lost-consumer'],
    ['IMPORT-NAME-MISSING', 'src/u.ts', 'src/later.ts', 'z', 'undecided'],
    ['IMPORT-NAME-MISSING', 'src/use.ts', 'src/barrel.ts', 'deep', 'lost-consumer'],
    ['IMPORT-NAME-MISSING', 'src/use2.ts', 'src/cjs.ts', 'q', 'undecided'],
    ['IMPORT-NAME-MISSING', 'src/v.ts', 'src/w2.ts', 'w', 'new-import'],
  ];
  assert.deepEqual(origins(base, head, allNew(head), renames), expected, 'a skipped base import or a base import that did not resolve is undecided');
  const fromChange = [file('src/lib/n.ts', 'R', 'src/lib/m.ts'), file('src/app/c.ts', 'R', 'src/lib/c.ts'), file('src/v.ts', 'M')];
  assert.deepEqual(origins(base, head, allNew(head), fromChange), expected, 'the renames can also be the files of changedFiles');
  assert.deepEqual(origins(base, head, allNew(head)).slice(0, 1), [['IMPORT-NAME-MISSING', 'src/app/c.ts', 'src/lib/n.ts', 'm2', 'new-import']], 'without the renames the consumer is new');
  const before = snapshot({ 'src/gone.ts': 'export const g = 1;' }, { 'src/helper.test.ts': "import { g } from './gone';\nexport const h = g;" });
  const after = snapshot({ 'src/helper.ts': "import { g } from './gone';\nexport const h = g;" });
  assert.deepEqual(origins(before, after, allNew(after), [{ from: 'src/helper.test.ts', to: 'src/helper.ts', similarity: 100 }]),
    [['IMPORT-UNRESOLVED', 'src/helper.ts', './gone', 'undecided']], 'the base keeps no import edges for a file that was a test file');
  delete base.data.analysis.importNames.skipped;
  assert.deepEqual(origins(base, head, allNew(head), renames).find((row) => row[3] === 'deep'), ['IMPORT-NAME-MISSING', 'src/use.ts', 'src/barrel.ts', 'deep', 'undecided'],
    'an older base without the list of skipped imports cannot show that an export-star import resolved');
});

test('testWeakening finds removed active cases and NEW findings that weaken a base case, but never a case that the change added', () => {
  const header = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n";
  const moved = `${header}test('moves', () => { assert.ok(true); });`;
  const base = snapshot({}, { 'test/old.test.ts': moved, 'test/a.test.ts': header + ['keeps', 'drops', 'parks', 'empties', 'swallows'].map((name) => `test('${name}', () => { assert.ok(true); });`).join('\n')
    + "\ntest('dup', () => { assert.ok(1); });\ntest('dup', () => { assert.ok(2); });\ntest.only('focus', () => { assert.ok(true); });\ntest.skip('was parked', () => { assert.ok(true); });" });
  const head = snapshot({}, { 'test/new.test.ts': moved, 'test/a.test.ts': `${header}test('keeps', () => { assert.ok(true); });\ntest.skip('parks', () => { assert.ok(true); });
test('empties', () => { run(); });\ntest('swallows', () => { try { assert.ok(true); } catch {} });\ntest('dup', () => { assert.ok(1); });
test.skip('fresh', () => { assert.ok(true); });\ntest('fresh empty', () => { run(); });` });
  const renames = [{ from: 'test/old.test.ts', to: 'test/new.test.ts', similarity: 100 }], labels = labelsOf(base, head, renames);
  const result = testWeakening(base.data.analysis, head.data.analysis, renames, labels, head.findings);
  assert.deepEqual(result.removed, [{ path: 'test/a.test.ts', suite: '', name: 'drops', line: 4 }, { path: 'test/a.test.ts', suite: '', name: 'dup', line: 9 },
    { path: 'test/a.test.ts', suite: '', name: 'focus', line: 10 }], 'a skipped case that is gone is not listed, and a second case with the same name counts');
  assert.deepEqual(ordered(result.weakened.map((item) => [item.ruleId, item.path, item.name])),
    [['TEST-NO-ASSERTIONS', 'test/a.test.ts', 'empties'], ['TEST-PARKED', 'test/a.test.ts', 'parks'], ['TEST-SWALLOWED-ERROR', 'test/a.test.ts', 'swallows']]);
  for (const item of result.weakened) assert.equal(head.findings.find((finding) => finding.id === item.findingId)?.ruleId, item.ruleId);
  const parks = result.weakened.find((item) => item.name === 'parks').findingId;
  assert.deepEqual(testWeakening(base.data.analysis, head.data.analysis, renames, { ...labels, [parks]: 'UNKNOWN' }, head.findings).weakened.map((item) => item.name).sort(), ['empties', 'swallows']);
  assert.deepEqual(testWeakening(base.data.analysis, head.data.analysis, [], labels, head.findings).removed.map((item) => [item.path, item.name])[0], ['test/old.test.ts', 'moves'],
    'without the renames a moved test file loses its cases');
});
