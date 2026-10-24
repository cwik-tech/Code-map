import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type, release, arch } from 'node:os';
import ts from 'typescript';
import { runManifest } from '../lib/worker/runs.mjs';

test('a run manifest records the actual OS release and installed toolchain', () => {
  const value = runManifest({ inputs: { sha: 'a'.repeat(40), config: 'b'.repeat(64), lockfile: null },
    command: ['node', '--test'], startedAt: '2026-10-23T00:00:00Z', finishedAt: '2026-10-23T00:00:01Z', exitStatus: 0,
    artifact: { path: 'report.xml', kind: 'junit', digest: 'c'.repeat(64) }, backend: 'seatbelt', filters: [] });
  assert.deepEqual(value.environment, { policy: 'isolated', node: process.versions.node, platform: process.platform,
    backend: 'seatbelt', os: type(), osVersion: release(), architecture: arch(), typescript: ts.version });
  assert.deepEqual(value.tools, [{ name: 'node', version: process.versions.node }]);
});
