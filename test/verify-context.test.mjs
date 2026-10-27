// `code-map verify --context <run ID>`: the compact context of a finished run for a language model. It is read-only, it has
// the request, the failed and unknown checks with their evidence IDs and the next actions, and it stays within 256 KiB.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { maxContextBytes, verificationContext } from '../lib/verify-context.mjs';
import { caseText, header, junit, outcome, project } from './oracle-fixtures.mjs';

/** The time, size and content of every entry under the folder. */
function snapshot(root) {
  const state = {};
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name), info = lstatSync(path);
      state[relative(root, path)] = entry.isDirectory() ? 'folder' : `${info.mtimeMs} ${info.size} ${readFileSync(path, 'utf8')}`;
      if (entry.isDirectory()) walk(path);
    }
  };
  walk(root);
  return state;
}

test('the context of a run has the request, the failed and unknown checks with their evidence IDs and the next actions, and writes nothing', (t) => {
  const fixture = project(t, { 'test/login.test.ts': header + caseText('keeps the user') }), { put, commit, request, verify, context, out } = fixture;
  put('test/login.test.ts', `${header}${caseText('keeps the user')}\n// @ac login\n${caseText('signs in', 's')}`);
  const sha = commit('head'), reportInputs = [junit(fixture, 'head', { sha, cases: [{ file: 'test/login.test.ts', name: 'keeps the user', status: 'passed' },
    { file: 'test/login.test.ts', name: 'signs in', status: 'failed' }] })];
  const criteria = [{ id: 'login', text: 'A user can sign in.' }];
  const { summary } = outcome(verify(request({ acceptanceCriteria: criteria, reportInputs })), 2), before = snapshot(out);
  const output = context(summary.runId);
  assert.equal(output.status, 0, output.stderr);
  assert.ok(Buffer.byteLength(output.stdout) <= maxContextBytes);
  const value = JSON.parse(output.stdout);
  assert.deepEqual([value.reportType, value.schemaVersion, value.runId, value.readiness.state, value.readiness.exitCode], ['code-map-verification-context', 1, summary.runId, 'BLOCKED', 2]);
  assert.deepEqual([value.request.intent, value.request.changeType, value.request.acceptanceCriteria, value.request.head.sha], ['Change the login tests.', 'other', criteria, sha]);
  const failed = value.checks.failed.find((item) => item.id === 'behavior.no-new-failures'), open = value.checks.unknown.find((item) => item.id === 'acceptance.login');
  assert.deepEqual(failed.evidenceIds, ['case:reports/head.xml:test/login.test.ts > signs in']);
  assert.ok(failed.nextAction.length > 0 && value.nextActions.includes(failed.nextAction));
  assert.ok(open.evidenceIds.includes('case:reports/head.xml:test/login.test.ts > signs in'));
  assert.ok(value.checks.failed.every((item) => item.result === 'FAIL') && !value.checks.unknown.some((item) => item.result === 'PASS'));
  assert.equal(value.checks.failed[0].blocking, true, 'blocking checks come first');
  assert.deepEqual(value.hypotheses.kinds, ['risk', 'missing-test', 'intent-mismatch', 'other']);
  assert.deepEqual(value.omitted, null);
  assert.deepEqual(snapshot(out), before, 'the context writes nothing');
  const compact = context(summary.runId, ['--out-dir', out, '--compact']);
  assert.deepEqual(JSON.parse(compact.stdout), value);
  assert.ok(!compact.stdout.trim().includes('\n'));
});

test('the context reads the default output folder in the store, and refuses an invalid or unknown run ID and --request', (t) => {
  const { request, verify, context, out } = project(t);
  const { summary } = outcome(verify(request({ head: 'worktree' }), []), 3);
  assert.equal(JSON.parse(context(summary.runId, []).stdout).runId, summary.runId);
  for (const [args, pattern] of [[['../x', '--out-dir', out], /not a valid run ID/], [['V-20261022T180000Z-00000000', []], /No verification run V-20261022T180000Z-00000000/],
    [[summary.runId, '--request', request()], /--request or --context, not both/]]) {
    const [runId, ...rest] = args.flat(), output = context(runId, rest);
    assert.deepEqual([output.status, output.stdout], [4, ''], output.stderr);
    assert.match(output.stderr, pattern);
  }
});

test('a context that would be larger than 256 KiB leaves out checks, criteria and actions, and counts what it left out', () => {
  const long = 'x'.repeat(3000), checks = Array.from({ length: 4000 }, (_, index) => ({ id: `acceptance.c${index}`, category: 'behavioralConfidence', title: `Criterion ${index}`,
    required: true, blocking: false, applicability: 'APPLICABLE', result: 'UNKNOWN', eligible: false, evidenceIds: [`request:acceptanceCriteria.c${index}`], rationale: long, nextAction: `Ask a reviewer about c${index}.` }));
  const results = { reportType: 'code-map-verification', runId: 'V-1', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', intent: 'Large.', changeType: 'feature',
    base: { ref: 'main', sha: 'a' }, head: { ref: 'HEAD', sha: 'b' }, readiness: { state: 'INSUFFICIENT_EVIDENCE', exitCode: 3 }, ratings: {},
    request: { digest: 'd', allowedPaths: null, acceptanceCriteria: checks.map((_, index) => ({ id: `c${index}`, text: long })) }, obligations: checks };
  const value = verificationContext(results), size = Buffer.byteLength(JSON.stringify(value, null, 2));
  assert.ok(size <= maxContextBytes, `${size} bytes`);
  assert.ok(value.omitted.unknownChecks > 0 && value.omitted.acceptanceCriteria > 0, JSON.stringify(value.omitted));
  assert.equal(value.checks.unknown.length + value.omitted.unknownChecks, 4000);
  assert.ok(value.checks.unknown[0].rationale.length <= 2000);
});
