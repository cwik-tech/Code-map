// A cached mutation result cannot replace the current authorization's stricter policy.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { mutate } from '../lib/mutation/run.mjs';
import { loadConfig } from '../lib/project.mjs';
import { newAuthorization, saveAuthorization } from '../lib/worker/authorize.mjs';
import { project, authorize, budgets, sandboxed } from './worker-fixtures.mjs';

test('mutation cache separates authorization trust policies and retains matching-policy hits', sandboxed, async (t) => {
  const f = project(t), command = [process.execPath, '-e', 'process.exitCode = 0'];
  f.put('src/sum.mjs', 'export const flag = false; export function sum(a,b) { return a+b; }\n');
  f.git('add', '.'); f.git('commit', '-qm', 'head');
  const request = { command, base: 'base', max: 1, store: f.store }, config = loadConfig(f.root);
  const first = await mutate(f.root, config, { ...request, authorization: authorize(f, command) });
  const trust = { [process.execPath]: 'trusted-signed' };
  const record = newAuthorization({ repository: f.root, command, budgets, trust });
  saveAuthorization(f.store, record);
  const second = await mutate(f.root, config, { ...request, authorization: record.id });
  assert.notEqual(second.runId, first.runId, 'a stricter policy must not reuse an earlier authorization record');
  const stored = JSON.parse(readFileSync(second.files.artifact.replace(/report.json$/, 'run.json'), 'utf8'));
  assert.deepEqual(stored.trust, trust);
  const repeated = await mutate(f.root, config, { ...request, authorization: record.id });
  assert.equal(repeated.runId, second.runId);
  assert.equal(repeated.cached, true);
});
