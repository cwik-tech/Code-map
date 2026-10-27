import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function trace(t, source, status = 'pass') {
  const root = mkdtempSync(join(tmpdir(), 'code-map-trace-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'calibration'));
  copyFileSync(new URL('../scripts/trace-check.mjs', import.meta.url), join(root, 'scripts/trace-check.mjs'));
  writeFileSync(join(root, 'fixture.test.mjs'), source);
  const parts = Array.from({ length: 45 }, (_, index) => ({ id: `C${String(index + 1).padStart(2, '0')}`, part: 'fixture',
    ...(index === 0 ? { status, file: 'fixture.test.mjs', test: 'named case' } : { status: 'out-of-scope', note: 'outside this fixture' }) }));
  writeFileSync(join(root, 'calibration/trace.json'), JSON.stringify(parts));
  return spawnSync(process.execPath, ['scripts/trace-check.mjs'], { cwd: root, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
}

const passing = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('named case', () => assert.equal(2 + 2, 4));\n";

test('trace validation rejects a failed process even after its named test passes', (t) => {
  const result = trace(t, passing + 'process.exitCode = 1;\n');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /process.*exit|exit.*process/i);
  assert.match(result.stdout, /\| C01 \| 1 \| 0 \| 0 \| 0 \| 1 \|/);
});

test('trace validation rejects a late failure after the named test passes', (t) => {
  const result = trace(t, passing + "process.on('beforeExit', () => { throw new Error('late failure'); });\n");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /\| C01 \| 1 \| 0 \| 0 \| 0 \| 1 \|/);
});

test('trace validation accepts a named passing test from a successful process', (t) => {
  const result = trace(t, passing);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /\| C01 \| 1 \| 1 \| 0 \| 0 \| 0 \|/);
});

test('trace validation retains a declared TODO gap from a successful process', (t) => {
  const result = trace(t, "import { test } from 'node:test';\ntest.todo('named case');\n", 'gap');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /\| C01 \| 1 \| 0 \| 1 \| 0 \| 0 \|/);
});
