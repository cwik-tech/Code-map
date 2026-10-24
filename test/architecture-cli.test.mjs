// Layers and owners through the CLI: the architecture block of the summary, the owners of the changed files in a comparison,
// the CODEOWNERS file as an input of a working-tree analysis, and the refusal of invalid or overlapping layer settings.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const settings = { layers: [{ name: 'ui', paths: ['src/ui/**'] }, { name: 'core', paths: ['src/core/**'] }], ownership: { forbidCrossOwnerImports: true } };
const codeowners = '* @org/platform\n/src/ui/ @org/web\n/src/core/ @org/core\n/src/util/\n!src/core/x.ts @org/none\n';

/** A committed project: core (the lower layer) imports ui, one file is in no layer, and CODEOWNERS gives three owners. */
function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-architecture-')), store = mkdtempSync(join(tmpdir(), 'code-map-architecture-store-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  put('.code-map.json', JSON.stringify(settings));
  put('.github/CODEOWNERS', codeowners);
  put('README.md', '# Fixture\n');
  put('src/core/engine.ts', "import { view } from '../ui/view';\nexport const engine = () => view();\n");
  put('src/ui/view.ts', "export const view = () => 'v';\n");
  put('src/util/text.ts', "export const text = 'x';\n");
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'base');
  const run = (args) => spawnSync(process.execPath, [cli, ...args, '--store', store], { cwd: root, encoding: 'utf8', timeout: 60000 });
  const json = (args) => { const output = run(args); assert.equal(output.status, 0, output.stderr); return JSON.parse(output.stdout); };
  return { root, store, put, git, run, json };
}

/** Runs a printed command (plain words only) and returns its JSON. */
function follow({ root }, command) {
  const [program, ...args] = command.split(' ');
  assert.equal(program, 'code-map');
  const output = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
  assert.equal(output.status, 0, output.stderr);
  return JSON.parse(output.stdout);
}

test('acceptance: the summary counts the files in no layer and the files without an owner, and the layer and owner breaks are findings', (t) => {
  const fixture = project(t), summary = fixture.json(['inspect', '--summary', '--ref', 'HEAD']);
  assert.deepEqual(summary.architecture.layers, { layers: [{ name: 'ui', files: 1 }, { name: 'core', files: 1 }], exceptions: 0, rules: 1, violations: 1,
    outside: { count: 1, paths: ['src/util/text.ts'] } });
  assert.deepEqual(summary.architecture.ownership, { file: '.github/CODEOWNERS', rules: 4, owners: 2, unowned: 1,
    ignored: { count: 1, items: [{ line: 5, text: '!src/core/x.ts @org/none', reason: 'GitHub does not support a negated pattern ("!").' }] },
    policy: { forbidCrossOwnerImports: true, exceptions: 0 }, violations: 1 });
  const gaps = Object.fromEntries(summary.gaps.map((gap) => [gap.key, gap.count ?? null]));
  assert.deepEqual([gaps.outsideLayers, gaps.unownedFiles, gaps.codeownersIgnored, gaps.architectureRules], [1, 1, 1, undefined], 'the layers count as declared rules');
  const byRule = Object.fromEntries(summary.findings.items.map((item) => [item.ruleId, item]));
  assert.match(byRule['ARCH-RULE'].text, /in the layer "core" imports src\/ui\/view\.ts in the higher layer "ui"/);
  const detail = follow(fixture, byRule['OWNER-CROSS-IMPORT'].next);
  assert.deepEqual(detail.details.violation, { from: 'src/core/engine.ts', to: 'src/ui/view.ts', owners: { from: ['@org/core'], to: ['@org/web'] }, lines: [1] });
  assert.match(detail.details.files.to, /--file src\/ui\/view\.ts/);
  assert.equal(follow(fixture, byRule['ARCH-RULE'].next).details.violation.layers.to, 'ui');
  const report = fixture.json(['inspect', '--analysis', summary.analysis.id, '--file', 'src/core/engine.ts', '--file', 'src/util/text.ts']);
  assert.deepEqual(report.owners, { file: '.github/CODEOWNERS', files: [{ path: 'src/core/engine.ts', owners: ['@org/core'], line: 3 }, { path: 'src/util/text.ts', owners: [], line: 4 }] },
    'a file report gives the owners of each reported file');
});

test('Code-map does not follow a CODEOWNERS symlink, so a link to a file outside the repository shows nothing of that file', { skip: process.platform === 'win32' && 'needs symlinks' }, (t) => {
  const fixture = project(t), { root, put, git, json } = fixture, secret = mkdtempSync(join(tmpdir(), 'code-map-architecture-secret-'));
  t.after(() => rmSync(secret, { recursive: true, force: true }));
  writeFileSync(join(secret, 'token.txt'), 'TOKEN hunter2-secret\n');
  unlinkSync(join(root, '.github/CODEOWNERS'));
  symlinkSync(join(secret, 'token.txt'), join(root, '.github/CODEOWNERS'));
  const reason = 'The file is a symlink, and Code-map does not follow it. No file gets an owner from it.';
  const check = (summary) => {
    assert.doesNotMatch(JSON.stringify(summary), /hunter2/);
    assert.deepEqual([summary.architecture.ownership.rules, summary.architecture.ownership.ignored.items], [0, [{ line: null, text: '', reason }]]);
  };
  check(json(['inspect', '--summary', '--worktree']));
  put('.code-map.json', JSON.stringify({ layers: settings.layers }));
  git('add', '.'); git('commit', '-qm', 'link');
  check(json(['inspect', '--summary', '--ref', 'HEAD']));
});

test('a comparison with --base gives the owners of the changed files under both CODEOWNERS files, and the number of owners it touches', (t) => {
  const fixture = project(t), { put, git, json } = fixture;
  put('.github/CODEOWNERS', codeowners.replace('/src/ui/ @org/web', '/src/ui/ @org/web @org/design'));
  put('README.md', '# Fixture\n\nMore.\n');
  put('src/ui/view.ts', "export const view = () => 'w';\n");
  put('src/util/more.ts', 'export const more = 1;\n');
  git('add', '.'); git('commit', '-qm', 'head');
  const { comparison } = json(['inspect', '--summary', '--ref', 'HEAD', '--base', 'HEAD~1']);
  assert.equal(comparison.state, 'COMPARABLE');
  assert.deepEqual(comparison.owners, { files: 4, owners: ['@org/design', '@org/platform', '@org/web'], touched: 3, unowned: 1, items: [
    { path: '.github/CODEOWNERS', status: 'M', owners: ['@org/platform'] },
    { path: 'README.md', status: 'M', owners: ['@org/platform'] },
    { path: 'src/ui/view.ts', status: 'M', owners: ['@org/design', '@org/web'] },
    { path: 'src/util/more.ts', status: 'A', owners: [] }] });
  assert.equal(comparison.counts.new, 0, 'the layer and owner findings of the base stay EXISTING');
});

test('an edit of CODEOWNERS or of the layer settings gives a new analysis ID, also for the working tree', (t) => {
  const { put, json } = project(t);
  const first = json(['inspect', '--summary', '--worktree']);
  assert.equal(json(['inspect', '--summary', '--worktree']).analysis.reused, true);
  put('.github/CODEOWNERS', codeowners.replace('/src/util/\n', ''));
  const edited = json(['inspect', '--summary', '--worktree']);
  assert.notEqual(edited.analysis.id, first.analysis.id, 'the content of CODEOWNERS is an input of the working-tree analysis');
  assert.deepEqual([edited.analysis.reused, edited.architecture.ownership.unowned], [false, 0]);
  const commit = json(['inspect', '--summary', '--ref', 'HEAD']);
  put('.code-map.json', JSON.stringify({ ...settings, layerExceptions: [{ from: 'core', to: 'ui' }] }));
  const relaxed = json(['inspect', '--summary', '--ref', 'HEAD']);
  assert.notEqual(relaxed.analysis.id, commit.analysis.id, 'the layer settings change the settings digest');
  assert.deepEqual([relaxed.architecture.layers.rules, relaxed.architecture.layers.violations], [0, 0]);
});

test('invalid layer settings and overlapping layers are refused with a clear error', (t) => {
  const { put, run } = project(t);
  put('.code-map.json', JSON.stringify({ layers: 'src/ui' }));
  const invalid = run(['inspect', '--summary', '--ref', 'HEAD']);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Cannot use .*\.code-map\.json: layers: Must be a list of \{ "name", "paths" \} objects/);
  put('.code-map.json', JSON.stringify({ layers: [{ name: 'all', paths: ['src/**'] }, { name: 'ui', paths: ['src/ui/**'] }] }));
  const overlap = run(['inspect', '--summary', '--ref', 'HEAD']);
  assert.equal(overlap.status, 1);
  assert.match(overlap.stderr, /The layers "all" and "ui" in \.code-map\.json both match src\/ui\/view\.ts/);
});


test('top-level allowed layer pairs suppress findings and change the settings digest', (t) => {
  const { put, json, run } = project(t);
  const before = json(['inspect', '--summary', '--ref', 'HEAD']);
  put('.code-map.json', JSON.stringify({ ...settings, allowed: [{ from: 'core', to: 'ui' }] }));
  const after = json(['inspect', '--summary', '--ref', 'HEAD']);
  assert.notEqual(before.analysis.id, after.analysis.id);
  assert.deepEqual([after.architecture.layers.rules, after.architecture.layers.violations], [0, 0]);
  put('.code-map.json', JSON.stringify({ ...settings, allowed: [{ from: 'unknown', to: 'ui' }] }));
  const invalid = run(['inspect', '--summary', '--ref', 'HEAD']);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /allowed\[0\].from: "unknown" is not the name of a layer/);
});

test('a symlinked CODEOWNERS parent cannot read owners outside the repository', { skip: process.platform === 'win32' && 'needs symlinks' }, (t) => {
  const { root, json } = project(t), outside = mkdtempSync(join(tmpdir(), 'code-map-architecture-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'CODEOWNERS'), '* @outside-secret\n');
  rmSync(join(root, '.github'), { recursive: true });
  symlinkSync(outside, join(root, '.github'));
  const summary = json(['inspect', '--summary', '--worktree']);
  assert.doesNotMatch(JSON.stringify(summary), /outside-secret/);
  assert.equal(summary.architecture.ownership.rules, 0);
  assert.match(summary.architecture.ownership.ignored.items[0].reason, /symlink/);
});


test('a classic file report exposes owners through the same public report as stored retrieval', (t) => {
  const { root } = project(t);
  const output = spawnSync(process.execPath, [cli, 'inspect', '--ref', 'HEAD', '--file', 'src/core/engine.ts'], { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(output.status, 0, output.stderr);
  const report = JSON.parse(output.stdout);
  assert.deepEqual(report.owners, { file: '.github/CODEOWNERS', files: [{ path: 'src/core/engine.ts', owners: ['@org/core'], line: 3 }] });
});

test('a summary counts all source files as unowned when CODEOWNERS is absent', (t) => {
  const { root, put, json } = project(t);
  unlinkSync(join(root, '.github/CODEOWNERS'));
  put('.code-map.json', '{}');
  const report = json(['inspect', '--summary', '--worktree']);
  assert.equal(report.architecture.ownership.file, null);
  assert.equal(report.architecture.ownership.unowned, 3);
});

test('a directory in place of CODEOWNERS is reported without reading it as a file', (t) => {
  const { root, json } = project(t);
  unlinkSync(join(root, '.github/CODEOWNERS'));
  mkdirSync(join(root, '.github/CODEOWNERS'));
  const report = json(['inspect', '--summary', '--worktree']);
  assert.equal(report.architecture.ownership.rules, 0);
  assert.match(report.architecture.ownership.ignored.items[0].reason, /regular file/);
});
