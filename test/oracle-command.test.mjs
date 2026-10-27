// The oracle CLI uses the stored current analysis and a caller-supplied confirmation.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { project } from './worker-fixtures.mjs';
import { recordOracle } from '../lib/oracle-command.mjs';
import { loadConfig } from '../lib/project.mjs';
import { oracleDigest } from '../lib/oracles.mjs';
const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
test('records a stored current case with the injected date, digest and human confirmation', (t) => {
  const f = project(t);
  const inspect = spawnSync(process.execPath, [cli, 'inspect', '--summary', '--worktree', '--store', f.store], { cwd: f.root, encoding: 'utf8' });
  assert.equal(inspect.status, 0, inspect.stderr);
  const options = { case: 'case:0', criterion: 'AC1', method: 'Compared with the specification.', 'confirmed-by': 'Reviewer', store: f.store };
  const result = recordOracle(f.root, loadConfig(f.root), options, { today: '2026-10-23' });
  assert.equal(result.entry.date, '2026-10-23');
  assert.equal(result.entry.confirmedBy, 'Reviewer');
  assert.equal(result.entry.digest, oracleDigest(readFileSync(join(f.root, result.entry.file))));
  assert.equal(JSON.parse(readFileSync(join(f.root, '.code-map/oracles.json'))).entries.length, 1);
  const missing = { ...options, 'confirmed-by': undefined };
  assert.throws(() => recordOracle(f.root, loadConfig(f.root), missing, { today: '2026-10-23' }), /confirmed-by/);
  spawnSync(process.execPath, [cli, 'inspect', '--summary', '--worktree', '--store', f.store], { cwd: f.root });
  assert.throws(() => recordOracle(f.root, loadConfig(f.root), { ...options, case: 'case:999' }, { today: '2026-10-23' }), /case/);
});
test('oracle command rejects missing confirmation and reports errors on stderr', (t) => {
  const f = project(t);
  const output = spawnSync(process.execPath, [cli, 'oracle', '--case', 'case:0', '--criterion', 'AC1', '--method', 'Read specification'], { cwd: f.root, encoding: 'utf8' });
  assert.equal(output.status, 1);
  assert.match(output.stderr, /confirmed-by/);
});

test('oracle digest uses exact test bytes, including non-UTF8 bytes inside a comment', (t) => {
  const f = project(t), file = 'test/sum.test.mjs';
  f.put(file, Buffer.concat([readFileSync(join(f.root, file)), Buffer.from([47, 47, 255, 10])]));
  const output = spawnSync(process.execPath, [cli, 'inspect', '--summary', '--worktree', '--store', f.store], { cwd: f.root, encoding: 'utf8' });
  assert.equal(output.status, 0, output.stderr);
  const recorded = recordOracle(f.root, loadConfig(f.root), { case: 'case:0', criterion: 'AC1', method: 'Fixture only.', 'confirmed-by': 'Fixture reviewer', store: f.store }, { today: '2026-10-23' });
  assert.equal(recorded.entry.digest, oracleDigest(readFileSync(join(f.root, file))));
});

test('the oracle CLI writes a human-confirmed record after stored inspection', (t) => {
  const f = project(t);
  const inspected = spawnSync(process.execPath, [cli, 'inspect', '--summary', '--worktree', '--store', f.store], { cwd: f.root, encoding: 'utf8' });
  assert.equal(inspected.status, 0, inspected.stderr);
  const output = spawnSync(process.execPath, [cli, 'oracle', '--case', 'case:0', '--criterion', 'AC1', '--method', 'Fixture only.', '--confirmed-by', 'Fixture reviewer', '--store', f.store], { cwd: f.root, encoding: 'utf8' });
  assert.equal(output.status, 0, output.stderr);
  assert.equal(JSON.parse(output.stdout).entry.confirmedBy, 'Fixture reviewer');
  assert.equal(JSON.parse(readFileSync(join(f.root, '.code-map/oracles.json'))).entries.length, 1);
});
