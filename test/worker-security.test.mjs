// Regression checks for credential binds and artifact collection across the sandbox boundary.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPolicy } from '../lib/worker/backend.mjs';
import { bwrapCommand } from '../lib/worker/bwrap.mjs';
import { collectArtifact, createWorkspace } from '../lib/worker/workspace.mjs';
import { project } from './worker-fixtures.mjs';

test('SEC-W1: bubblewrap refuses a readable folder that contains a protected folder', (t) => {
  const fixture = project(t), workspace = createWorkspace(join(fixture.store, 'workspaces'), 'bind-test');
  const nodePrefix = join(fixture.work, 'node'), protectedFolder = join(nodePrefix, 'credentials');
  mkdirSync(protectedFolder, { recursive: true });
  const policy = buildPolicy({ workspace: workspace.folder, nodePrefix, home: fixture.home, protectedFolders: [protectedFolder] });
  assert.throws(() => bwrapCommand('/usr/bin/bwrap', policy, ['node'], { cwd: workspace.tree }), /contains protected/);
});

test('SEC-W1: bubblewrap refuses protected files under a link source or a system bind', (t) => {
  const fixture = project(t), workspace = createWorkspace(join(fixture.store, 'workspaces'), 'link-test');
  const source = join(fixture.work, 'modules'), secret = join(source, 'secret');
  mkdirSync(source); writeFileSync(secret, 'credential');
  const policy = buildPolicy({ workspace: workspace.folder, nodePrefix: '/opt/node', home: fixture.home,
    links: [{ source, target: join(workspace.tree, 'node_modules') }], protectedFolders: [secret] });
  assert.throws(() => bwrapCommand('/usr/bin/bwrap', policy, ['node'], { cwd: workspace.tree }), /contains protected/);
  assert.throws(() => bwrapCommand('/usr/bin/bwrap', { ...policy, protected: ['/usr/credential'] }, ['node'],
    { cwd: workspace.tree, entry: () => ({ isSymbolicLink: () => false }) }), /contains protected/);
});

test('SEC-W2: artifact collection refuses to read a workspace without a sandbox', (t) => {
  const fixture = project(t), workspace = createWorkspace(join(fixture.store, 'workspaces'), 'artifact-test');
  writeFileSync(join(workspace.tree, 'report.xml'), 'report');
  assert.throws(() => collectArtifact(workspace.tree, 'report.xml', 1024), /sandbox/);
});
