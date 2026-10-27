// Declared safeguards use syntax evidence. They do not certify runtime behavior.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanDeclaredPatterns } from '../lib/patterns.mjs';
import { settingsProblems } from '../lib/project.mjs';
import { deriveFindings } from '../lib/findings.mjs';
import { repository, analyzed, manifest } from './packages-fixture.mjs';
const policy = { path: 'src/api.ts', symbol: 'load', retry: { callee: 'retry', maxAttempts: 3 }, logging: { callee: 'logger.error' } };
const scan = (source) => scanDeclaredPatterns(new Map([[policy.path, source]]), [policy]);

test('declared retry calls report missing and excessive attempt limits', () => {
  const rows = scan('export function load() { return retry(task, {}); }');
  assert.equal(rows[0].state, 'FAIL');
  assert.equal(rows[0].kind, 'retry-policy');
  assert.match(rows[0].reason, /maxAttempts/);
  assert.equal(scan('export function load() { return retry(task, { maxAttempts: 9 }); }')[0].state, 'FAIL');
});

test('declared retry and logging syntax observations never certify execution', () => {
  const rows = scan('export function load() { try { return retry(task, { maxAttempts: 3 }); } catch (error) { logger.error(error); throw error; } }');
  assert.deepEqual(rows.map(x => [x.kind, x.state]), [['retry-policy', 'OBSERVED'], ['logging-policy', 'OBSERVED']]);
});

test('unsupported retry options and conditional logging stay unknown', () => {
  const rows = scan('export function load() { try { return retry(task, options); } catch (error) { if (verbose) logger.error(error); } }');
  assert.deepEqual(rows.map(x => x.state), ['UNKNOWN', 'UNKNOWN']);
  assert.ok(rows.every(x => x.reason.length > 0));
  assert.equal(scan('export const other = 1;')[0].state, 'UNKNOWN');
});

test('declared logging reports an unlogged catch and ignores nested functions', () => {
  const rows = scan('export function load() { try { work(); } catch (error) { recover(); const later = () => logger.error(error); } }');
  assert.equal(rows.find(x => x.kind === 'logging-policy').state, 'FAIL');
});

test('safeguard policies validate selectors and finite bounds', () => {
  assert.deepEqual(settingsProblems({ safeguards: [policy] }), []);
  assert.ok(settingsProblems({ safeguards: [{ ...policy, path: '../escape.ts' }] }).length);
  assert.ok(settingsProblems({ safeguards: [{ ...policy, retry: { callee: 'retry', maxAttempts: 0 } }] }).length);
  assert.ok(settingsProblems({ safeguards: [{ ...policy, logging: { callee: 'logger[method]' } }] }).length);
});

test('snapshot analysis exposes declared failures and support gaps through the public findings interface', (t) => {
  const { root, json, store } = repository(t, {
    'package.json': manifest({ name: 'app' }),
    '.code-map.json': JSON.stringify({ safeguards: [policy] }),
    'src/api.ts': 'export function load() { try { return retry(task, {}); } catch (e) { recover(); } }',
  });
  const { findings, analysis } = analyzed(root);
  assert.deepEqual(findings.filter(x => ['RETRY-POLICY', 'LOGGING-POLICY'].includes(x.ruleId)).map(x => x.ruleId).sort(), ['LOGGING-POLICY', 'RETRY-POLICY']);
  const summary = json(['inspect', '--worktree', '--summary', '--store', store]);
  assert.equal(summary.safeguards.items[0].state, 'FAIL');
  assert.equal(deriveFindings({ ...analysis, safeguards: { items: [{ ...policy, kind: 'retry-policy', state: 'UNKNOWN', reason: 'not supported', line: null }] } })
    .some(x => x.ruleId === 'RETRY-POLICY'), false);
});


test('declared test-file safeguards remain unknown and emit no source findings', (t) => {
  const testPolicy = { ...policy, path: 'test/api.test.ts' };
  const { root } = repository(t, {
    'package.json': manifest({ name: 'app' }),
    '.code-map.json': JSON.stringify({ safeguards: [testPolicy] }),
    'src/main.ts': 'export const main = 1;',
    'test/api.test.ts': 'export function load() { return retry(task, {}); }',
  });
  const { analysis, findings } = analyzed(root);
  assert.ok(analysis.safeguards.items.every(x => x.state === 'UNKNOWN'));
  assert.equal(findings.some(x => x.ruleId === 'RETRY-POLICY'), false);
});
