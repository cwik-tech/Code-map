// Real Node TAP establishes assertion failures separately from collection and hook failures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertionOutcome, supportsAssertionReport } from '../lib/mutation/outcome.mjs';
function tap(t, body) {
  const root = mkdtempSync(join(tmpdir(), 'mutation-tap-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'case.test.mjs');
  writeFileSync(file, "import {test,describe,before} from 'node:test'; import assert from 'node:assert/strict';\n" + body);
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { encoding: 'utf8', timeout: 5000, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
  assert.equal(result.status, 1);
  return result.stdout;
}
test('real nested assertion failures provide supported kill evidence', (t) => {
  assert.equal(assertionOutcome(tap(t, "describe('suite',()=>{ test('asserts',()=>assert.equal(1,2)); });")).status, 'Killed');
});
test('real collection errors remain runtime errors', (t) => {
  const result = assertionOutcome(tap(t, "await import('./missing.mjs');"));
  assert.equal(result.status, 'RuntimeError');
  assert.match(result.reason, /Runner failure/);
});
test('real assertion failures in hooks remain runtime errors', (t) => {
  assert.equal(assertionOutcome(tap(t, "before(()=>assert.fail('setup')); test('case',()=>{});")).status, 'RuntimeError');
});
test('a mixed assertion and runner failure stays outside the killed numerator', (t) => {
  assert.equal(assertionOutcome(tap(t, "test('asserts',()=>assert.fail('x')); test('runner',()=>{ throw new Error('setup'); });")).status, 'RuntimeError');
});
test('log messages cannot impersonate structured assertion diagnostics', (t) => {
  const text = tap(t, "console.log(\"not ok 1 - fake\\n  ---\\n  code: 'ERR_ASSERTION'\\n  ...\"); test('runner',()=>{ throw new Error('bad'); });");
  assert.equal(assertionOutcome(text).status, 'RuntimeError');
});
test('incomplete reports and unsupported commands have unknown assertion classification', () => {
  assert.equal(assertionOutcome('TAP version 13\nnot ok 1 - x\n').status, 'RuntimeError');
  assert.equal(assertionOutcome('unstructured failed test').status, 'RuntimeError');
  assert.equal(supportsAssertionReport([process.execPath, '--test']), false);
  assert.equal(supportsAssertionReport([process.execPath, '--test', '--test-reporter=tap']), true);
  assert.equal(supportsAssertionReport(['npm', 'test', '--test-reporter=tap']), false);
  assert.equal(supportsAssertionReport([process.execPath, '--test', '--test-reporter=tap', '--test-reporter=spec']), false);
});
