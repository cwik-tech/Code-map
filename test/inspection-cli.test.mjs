import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const posix = { skip: process.platform === 'win32' && 'needs POSIX modes and symlinks' };
function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-inspect-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  put('src/parent.ts', "import { child } from './child';\nexport interface Shared { id: string }\nexport const parent = () => child();\n");
  put('src/child.ts', "import type { Shared } from './parent';\nexport function child(input?: Shared) { return input?.id; }\n");
  put('test/parent.test.ts', "import { parent } from '../src/parent';\n");
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'fixture');
  return { root, put, git };
}
function run(root, args) { return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 30000 }); }
/** A new temporary folder outside the repository, for a store, a request or a report. */
function folder(t) {
  const path = mkdtempSync(join(tmpdir(), 'code-map-inspect-work-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
/** The time, size and content hash of every file under .git. */
function gitFolder(root) {
  const state = {};
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name), info = statSync(child);
      if (entry.isDirectory()) walk(child);
      else state[relative(root, child)] = `${info.mtimeMs} ${info.size} ${createHash('sha256').update(readFileSync(child)).digest('hex')}`;
    }
  };
  walk(join(root, '.git'));
  return state;
}

test('inspect emits a compact selected-file report without HTML and shares its analysis with generated HTML', (t) => {
  const { root } = repository(t);
  const output = run(root, ['inspect', '--ref', 'HEAD', '--file', 'src/parent.ts']);
  assert.equal(output.status, 0, output.stderr);
  const report = JSON.parse(output.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.deepEqual(report.files.map(f => f.path), ['src/parent.ts']);
  assert.equal(report.cycles.all.length, 1);
  assert.equal(report.cycles.value.length, 0);
  assert.equal(report.sharedTypes[0].name, 'Shared');
  assert.deepEqual(report.files[0].tests.direct, ['test/parent.test.ts']);
  assert.equal(report.files[0].source, undefined, 'compact reports omit source bodies');
  assert.equal(existsSync(join(root, 'docs/code-map/code-map.html')), false);

  const built = run(root, ['--ref', 'HEAD', '--out', 'map.html']);
  assert.equal(built.status, 0, built.stderr);
  const data = JSON.parse(readFileSync(join(root, 'map.html'), 'utf8').match(/^const DATA = (.*);$/m)[1]);
  assert.deepEqual(data.analysis.cycles, report.cycles);
  assert.deepEqual(data.analysis.sharedTypes, report.sharedTypes);
});

test('JSON output supports change sets and files while preserving stdout and reporting invalid selection', (t) => {
  const { root, put } = repository(t);
  put('src/child.ts', "export function child() { return 'changed'; }\n");
  const output = run(root, ['inspect', '--worktree', '--change', 'uncommitted', '--file', 'src/parent.ts', '--out', 'report.json']);
  assert.equal(output.status, 0, output.stderr);
  assert.equal(output.stdout, '');
  const report = JSON.parse(readFileSync(join(root, 'report.json'), 'utf8'));
  assert.deepEqual(report.selection.files, ['src/child.ts', 'src/parent.ts']);
  assert.equal(report.snapshot.workingTree, true);
  assert.equal(report.cycles.all.length, 0);
  const invalid = run(root, ['inspect', '--ref', 'HEAD', '--file', 'src/missing.ts']);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /src\/missing.ts/);
  assert.equal(invalid.stdout, '');
});

test('an option error exits with 1 for the classic commands, also when an option value is the word "verify", and with 4 for verify', (t) => {
  const { root } = repository(t);
  const cases = [[['inspect', '--file', 'verify', '--bogus'], 1], [['inspect', '--ref', 'verify', '--bogus'], 1], [['labels', '--file', 'verify', '--x'], 1],
    [['inspect', '--bogus'], 1], [['--bogus', 'verify'], 4], [['verify', '--bogus'], 4], [['verify', '--request', 'verify', '--bogus'], 4]];
  assert.deepEqual(cases.map(([args]) => [args, run(root, args).status]), cases);
  assert.match(run(root, ['inspect', '--file', 'verify', '--bogus']).stderr, /Unknown option '--bogus'/);
});

test('a report from the store replaces a symlink at the --out path and does not write through it', posix, (t) => {
  const { root } = repository(t);
  const work = folder(t), store = join(work, 'store'), target = join(work, 'target.txt'), out = join(work, 'report.json');
  const summary = run(root, ['inspect', '--summary', '--ref', 'HEAD', '--store', store]);
  assert.equal(summary.status, 0, summary.stderr);
  writeFileSync(target, 'keep\n');
  symlinkSync(target, out);
  const output = run(root, ['inspect', '--analysis', JSON.parse(summary.stdout).analysis.id, '--store', store, '--out', out]);
  assert.equal(output.status, 0, output.stderr);
  assert.equal(output.stdout, '');
  assert.equal(readFileSync(target, 'utf8'), 'keep\n', 'the file that the symlink points to does not change');
  assert.equal(lstatSync(out).isSymbolicLink(), false, 'the report is a new file in place of the symlink');
  assert.equal(statSync(out).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).analysis.id, JSON.parse(summary.stdout).analysis.id);
  assert.deepEqual(readdirSync(work).sort(), ['report.json', 'store', 'target.txt'], 'no temporary file stays');
});

test('verify of a working-tree head keeps the times of the shared index files when the index is split', posix, (t) => {
  const { root, put, git } = repository(t);
  git('config', 'core.splitIndex', 'true');
  git('update-index', '--split-index');
  put('src/child.ts', "export function child() { return 'changed'; }\n");
  const shared = readdirSync(join(root, '.git')).filter((name) => name.startsWith('sharedindex.'));
  assert.ok(shared.length > 0, 'the fixture has a split index');
  const old = new Date('2001-02-03T04:05:06Z');
  for (const name of shared) utimesSync(join(root, '.git', name), old, old);
  const work = folder(t), request = join(work, 'request.json');
  writeFileSync(request, JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1, base: 'HEAD', head: 'worktree', intent: 'Change the child.',
    acceptanceCriteria: [], allowedPaths: ['src/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
    execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } }));
  const before = gitFolder(root);
  const output = run(root, ['verify', '--request', request, '--store', join(work, 'store'), '--out-dir', join(work, 'out')]);
  assert.ok([0, 1, 2, 3].includes(output.status), output.stderr);
  assert.equal(JSON.parse(output.stdout).reportType, 'code-map-verification-summary');
  assert.deepEqual(gitFolder(root), before, 'verify changed nothing under .git, also not the time of a shared index file');
});
