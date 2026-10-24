// The workspace of a run: the copy of a commit or of the working tree, node_modules, the artifact and the removal. Nothing
// here starts a run. Each test makes its own Git project in a temporary folder.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectArtifact, copyWorktree, createWorkspace, exportCommit, linkNodeModules, removeWorkspace } from '../lib/worker/workspace.mjs';
import { buildPolicy, cleanEnvironment, findBackend } from '../lib/worker/backend.mjs';
import { dirname } from 'node:path';
import { project, sandboxed, sha256 } from './worker-fixtures.mjs';

const posix = { skip: process.platform === 'win32' && 'needs POSIX modes and symlinks' };
const workspaceOf = (fixture) => createWorkspace(join(fixture.store, 'workspaces'), 'R-20261022T000000Z-00000001');

test('a commit copy holds exactly the committed files, with private modes, its symlinks as links, and no Git folder', posix, (t) => {
  const fixture = project(t);
  fixture.put('bin/tool.sh', '#!/bin/sh\necho tool\n');
  chmodSync(join(fixture.root, 'bin/tool.sh'), 0o755);
  symlinkSync(join(fixture.home, '.ssh'), join(fixture.root, 'keys'));
  fixture.put('.gitattributes', 'src/** export-ignore\n');
  fixture.git('add', '.'); fixture.git('commit', '-qm', 'more');
  fixture.put('src/sum.mjs', 'uncommitted\n');
  const workspace = workspaceOf(fixture), count = exportCommit(fixture.root, fixture.git('rev-parse', 'HEAD'), workspace.tree);
  assert.equal(count, 7);
  assert.equal(readFileSync(join(workspace.tree, 'src/sum.mjs'), 'utf8'), 'export function sum(a, b) { return a + b; }\n', 'the committed content, also for an export-ignore path');
  assert.equal(statSync(join(workspace.tree, 'bin/tool.sh')).mode & 0o777, 0o700);
  assert.equal(statSync(join(workspace.tree, 'src/sum.mjs')).mode & 0o777, 0o600);
  assert.equal(statSync(workspace.folder).mode & 0o777, 0o700);
  assert.equal(readlinkSync(join(workspace.tree, 'keys')), join(fixture.home, '.ssh'), 'a symlink stays a link; the sandbox decides what it can read');
  assert.equal(existsSync(join(workspace.tree, '.git')), false);
});

test('a commit whose symlink differs only in letter case from a folder never writes through the link', posix, (t) => {
  const fixture = project(t), outside = join(fixture.work, 'outside');
  mkdirSync(outside);
  const blob = (text) => execFileSync('git', ['-C', fixture.root, 'hash-object', '-w', '--stdin'], { input: text, encoding: 'utf8' }).trim();
  fixture.git('update-index', '--add', '--cacheinfo', `120000,${blob(outside)},Link`);
  fixture.git('update-index', '--add', '--cacheinfo', `100644,${blob('planted\n')},link/planted.txt`);
  fixture.git('commit', '-qm', 'case');
  const workspace = workspaceOf(fixture), folded = existsSync(join(fixture.root, 'SRC'));
  if (folded) assert.throws(() => exportCommit(fixture.root, fixture.git('rev-parse', 'HEAD'), workspace.tree), /differ only in letter case|already exists/);
  else exportCommit(fixture.root, fixture.git('rev-parse', 'HEAD'), workspace.tree);
  assert.deepEqual(readdirSync(outside), [], 'nothing was written outside the workspace');
});

test('a working-tree copy holds tracked and untracked files that Git does not ignore, and skips deleted and ignored files and a nested repository', posix, (t) => {
  const fixture = project(t);
  fixture.put('notes.txt', 'untracked\n');
  fixture.put('reports/old.xml', 'ignored\n');
  fixture.put('nested/.git/HEAD', 'ref: refs/heads/main\n');
  execFileSync('git', ['init', '-q', join(fixture.root, 'nested')]);
  rmSync(join(fixture.root, 'probe.mjs'));
  const workspace = workspaceOf(fixture);
  copyWorktree(fixture.root, workspace.tree);
  assert.deepEqual(readdirSync(workspace.tree).sort(), ['.gitignore', 'notes.txt', 'src', 'test']);
  assert.equal(readFileSync(join(workspace.tree, 'notes.txt'), 'utf8'), 'untracked\n');
});

test('a working-tree file behind a folder symlink that leads outside the repository is refused', posix, (t) => {
  const fixture = project(t), outside = join(fixture.work, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'sum.mjs'), 'secret\n');
  rmSync(join(fixture.root, 'src'), { recursive: true });
  symlinkSync(outside, join(fixture.root, 'src'));
  assert.throws(() => copyWorktree(fixture.root, workspaceOf(fixture).tree), /src\/sum\.mjs .* outside the repository/);
});

test('node_modules is a copy-on-write clone on APFS, or a read-only link that the record names', posix, (t) => {
  const fixture = project(t);
  fixture.put('node_modules/pkg/index.js', 'module.exports = 1;\n');
  const workspace = workspaceOf(fixture), clone = linkNodeModules(fixture.root, workspace.tree, { platform: 'darwin' });
  if (clone.mode === 'clone') assert.equal(readFileSync(join(workspace.tree, 'node_modules/pkg/index.js'), 'utf8'), 'module.exports = 1;\n');
  else assert.equal(clone.mode, 'read-only-link');
  const other = createWorkspace(join(fixture.store, 'workspaces'), 'R-20261022T000000Z-00000002');
  const link = linkNodeModules(fixture.root, other.tree, { platform: 'darwin', clone: () => false });
  assert.deepEqual([link.mode, link.source], ['read-only-link', join(realpathSync(fixture.root), 'node_modules')]);
  assert.equal(lstatSync(join(other.tree, 'node_modules')).isSymbolicLink(), true);
  const linux = createWorkspace(join(fixture.store, 'workspaces'), 'R-20261022T000000Z-00000003');
  const bound = linkNodeModules(fixture.root, linux.tree, { platform: 'linux' });
  assert.deepEqual([bound.mode, lstatSync(join(linux.tree, 'node_modules')).isDirectory()], ['read-only-link', true], 'bwrap mounts the folder there');
  rmSync(join(fixture.root, 'node_modules'), { recursive: true });
  assert.equal(linkNodeModules(fixture.root, createWorkspace(join(fixture.store, 'workspaces'), 'R-20261022T000000Z-00000004').tree, { platform: 'darwin' }).mode, 'none');
});

test('the sandbox copies only a bounded regular artifact and refuses symlinks in each path component', sandboxed, (t) => {
  const fixture = project(t), workspace = workspaceOf(fixture);
  const options = { backend: findBackend(), policy: buildPolicy({ workspace: workspace.folder, nodePrefix: dirname(dirname(process.execPath)),
    protectedFolders: [fixture.home, fixture.store], home: fixture.home }), environment: cleanEnvironment({ workspace: workspace.folder, nodeDirectory: dirname(process.execPath) }) };
  const collect = (path, max = 1024) => collectArtifact(workspace.tree, path, max, options);
  mkdirSync(join(workspace.tree, 'reports'));
  writeFileSync(join(workspace.tree, 'reports/junit.xml'), '<testsuites/>\n');
  assert.deepEqual(collect('reports/junit.xml').digest, sha256('<testsuites/>\n'));
  assert.throws(() => collect('reports/junit.xml', 4), /larger than 4 bytes/);
  assert.throws(() => collect('reports/missing.xml'), /does not exist/);
  symlinkSync(join(fixture.home, '.ssh'), join(workspace.tree, 'keys'));
  assert.throws(() => collect('keys/id_rsa'), /symlink|not permitted/);
  symlinkSync('junit.xml', join(workspace.tree, 'reports/link.xml'));
  assert.throws(() => collect('reports/link.xml'), /symlink/);
  symlinkSync('reports', join(workspace.tree, 'linked-reports'));
  assert.throws(() => collect('linked-reports/junit.xml'), /symlink/);
  assert.throws(() => collect('reports'), /not a regular file/);
  rmSync(workspace.tree, { recursive: true });
  symlinkSync(join(fixture.home, '.ssh'), workspace.tree);
  assert.throws(() => collect('id_rsa'), /symlink|not permitted/);
});

test('the workspace is removed also when the run locked a folder, without following a symlink', posix, (t) => {
  const fixture = project(t), workspace = workspaceOf(fixture);
  mkdirSync(join(workspace.tree, 'reports'));
  symlinkSync(join(fixture.home, '.ssh'), join(workspace.tree, 'keys'));
  chmodSync(join(workspace.tree, 'reports'), 0o000);
  assert.equal(removeWorkspace(workspace.folder), true);
  assert.equal(existsSync(workspace.folder), false);
  assert.equal(existsSync(join(fixture.home, '.ssh', 'id_rsa')), true, 'the removal did not follow the link');
});

test('a node_modules symlink supplies its real directory as a read-only link', posix, (t) => {
  const fixture = project(t), modules = join(fixture.work, 'dependencies');
  mkdirSync(modules); writeFileSync(join(modules, 'index.js'), 'module.exports = 1;');
  symlinkSync(modules, join(fixture.root, 'node_modules'));
  const workspace = workspaceOf(fixture);
  assert.deepEqual(linkNodeModules(fixture.root, workspace.tree, { platform: 'darwin', clone: () => false }),
    { mode: 'read-only-link', source: modules });
  assert.equal(readlinkSync(join(workspace.tree, 'node_modules')), modules);
});

test('an APFS clone has private directory and file modes and keeps executable files executable', sandboxed, (t) => {
  const fixture = project(t);
  fixture.put('node_modules/pkg/index.js', 'module.exports = 1;');
  fixture.put('node_modules/pkg/tool', '#!/bin/sh\nexit 0\n');
  chmodSync(join(fixture.root, 'node_modules/pkg'), 0o755);
  chmodSync(join(fixture.root, 'node_modules/pkg/index.js'), 0o644);
  chmodSync(join(fixture.root, 'node_modules/pkg/tool'), 0o755);
  const workspace = workspaceOf(fixture), result = linkNodeModules(fixture.root, workspace.tree);
  assert.equal(result.mode, 'clone', 'this check needs the APFS clone on the test volume');
  assert.equal(statSync(join(workspace.tree, 'node_modules/pkg')).mode & 0o777, 0o700);
  assert.equal(statSync(join(workspace.tree, 'node_modules/pkg/index.js')).mode & 0o777, 0o600);
  assert.equal(statSync(join(workspace.tree, 'node_modules/pkg/tool')).mode & 0o777, 0o700);
  assert.equal(statSync(join(fixture.root, 'node_modules/pkg/index.js')).mode & 0o777, 0o644);
});
