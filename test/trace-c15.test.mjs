// Mutation selection uses the same expanded command for the baseline and each mutant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest } from '../lib/adapters/run-manifest.mjs';
import { mutate } from '../lib/mutation/run.mjs';
import { loadConfig } from '../lib/project.mjs';
import { authorize, entries, project, sandboxed, snapshot } from './worker-fixtures.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const template = [process.execPath, '--test', '--test-reporter=tap', '{testFiles}'];
const expanded = [...template.slice(0, -1), 'test/sum.test.mjs'];
function changedProject(t) {
  const f = project(t);
  f.put('src/sum.mjs', 'export function sum(a, b) { const unused = true; return a + b; }\n');
  f.put('test/unrelated.test.mjs', "import { test } from 'node:test'; test('unrelated sentinel', () => {});\n");
  f.git('add', '.'); f.git('commit', '-qm', 'head');
  return f;
}
const request = (f, command = template) => ({ command, base: 'base', max: 1, store: f.store });
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const selection = { policy: 'impact-v1', state: 'KNOWN', reason: 'The static head impact walk defines this selection.',
  sources: ['src/sum.mjs'], files: ['test/sum.test.mjs'], total: 1 };

test('mutation selects only the tests relevant to each changed unit', sandboxed, async (t) => {
  const f = changedProject(t), authorization = authorize(f, expanded);
  const result = await mutate(f.root, loadConfig(f.root), { ...request(f), authorization });
  assert.deepEqual(result.selection, selection);
  const manifest = json(result.files.manifest), report = json(result.files.artifact);
  assert.deepEqual(manifest.discovery.selection, selection);
  assert.deepEqual(manifest.discovery.filters, selection.files);
  assert.equal(validateManifest(manifest).ok, true);
  assert.equal(validateManifest({ ...manifest, discovery: { ...manifest.discovery, selection: { ...selection, total: 0 } } }).ok, false);
  assert.equal(validateManifest({ ...manifest, discovery: { ...manifest.discovery, selection: { ...selection, files: ['../escape'] } } }).ok, false);
  assert.deepEqual(manifest.command, expanded);
  assert.deepEqual(report.selection, selection);
  const baseline = join(f.store, 'runs', report.baseline);
  assert.deepEqual(json(join(baseline, 'run.json')).command, expanded);
  assert.match(readFileSync(join(baseline, 'stdout.log'), 'utf8'), /adds two numbers/);
  assert.doesNotMatch(readFileSync(join(baseline, 'stdout.log'), 'utf8'), /unrelated sentinel/);
  assert.equal(report.runs.length, 1);
  assert.deepEqual(json(join(f.store, 'runs', report.runs[0].runId, 'run.json')).command, expanded);
  const cached = await mutate(f.root, loadConfig(f.root), { ...request(f), authorization });
  assert.equal(cached.cached, true);
  assert.deepEqual(cached.selection, selection);
});

test('--print-selection prints expanded words without authorization, execution or writes', (t) => {
  const f = changedProject(t), before = snapshot(f.root), work = snapshot(f.work);
  const output = execFileSync(process.execPath, [cli, 'mutate', '--base', 'base', '--max', '1', '--store', f.store,
    '--print-selection', '--', ...template], { cwd: f.root, encoding: 'utf8', timeout: 30000 });
  const result = JSON.parse(output);
  assert.deepEqual(result.selection, selection);
  assert.deepEqual(result.command, expanded);
  assert.deepEqual(snapshot(f.root), before);
  assert.deepEqual(snapshot(f.work), work);
});

test('template authorization does not authorize expanded words', async (t) => {
  const f = changedProject(t), authorization = authorize(f, template);
  await assert.rejects(mutate(f.root, loadConfig(f.root), { ...request(f), authorization }), /command|words/i);
  assert.deepEqual(entries(f.store, 'runs'), []);
});

test('empty selection refuses execution before any run', async (t) => {
  const f = changedProject(t);
  f.put('test/sum.test.mjs', "import { test } from 'node:test'; test('no imports', () => {});\n");
  f.git('add', '.'); f.git('commit', '-qm', 'remove import');
  await assert.rejects(mutate(f.root, loadConfig(f.root), request(f)), /selection is empty/i);
  assert.deepEqual(entries(f.store, 'runs'), []);
});

test('mutation refuses embedded or repeated test selectors', async (t) => {
  const f = changedProject(t);
  await assert.rejects(mutate(f.root, loadConfig(f.root), request(f, [...template.slice(0, -1), '--files={testFiles}'])), /one whole-word/);
  await assert.rejects(mutate(f.root, loadConfig(f.root), request(f, [...template, '{testFiles}'])), /one whole-word/);
  assert.deepEqual(entries(f.store, 'runs'), []);
});

test('commands without a selector retain their exact words and output shape', sandboxed, async (t) => {
  const f = changedProject(t), command = expanded, authorization = authorize(f, command);
  const result = await mutate(f.root, loadConfig(f.root), { ...request(f, command), authorization });
  assert.equal(Object.hasOwn(result, 'selection'), false);
  const manifest = json(result.files.manifest);
  assert.deepEqual(manifest.command, command);
  assert.deepEqual(manifest.discovery.filters, []);
  assert.equal(Object.hasOwn(manifest.discovery, 'selection'), false);
});

test('incomplete static impact retains selected tests with an unknown reason', async (t) => {
  const f = changedProject(t);
  f.put('test/dynamic.test.mjs', "const path = process.env.TEST_MODULE; import(path);\n");
  f.git('add', '.'); f.git('commit', '-qm', 'dynamic import');
  const result = await mutate(f.root, loadConfig(f.root), { ...request(f), printSelection: true });
  assert.equal(result.selection.state, 'UNKNOWN');
  assert.match(result.selection.reason, /incomplete/i);
  assert.deepEqual(result.selection.files, ['test/sum.test.mjs']);
});

test('worktree selection sorts all reachable tests and excludes unrelated files', async (t) => {
  const f = changedProject(t);
  f.put('test/another.test.mjs', "import { sum } from '../src/sum.mjs';\n");
  const result = await mutate(f.root, loadConfig(f.root), { ...request(f), worktree: true, printSelection: true });
  assert.deepEqual(result.selection.files, ['test/another.test.mjs', 'test/sum.test.mjs']);
  assert.equal(result.selection.total, 2);
  assert.deepEqual(result.command, [...template.slice(0, -1), 'test/another.test.mjs', 'test/sum.test.mjs']);
  assert.deepEqual(entries(f.store, 'runs'), []);
});

test('mutation cache reuses one revision and misses a new commit with identical source bytes', sandboxed, async (t) => {
  const f = changedProject(t), command = expanded, authorization = authorize(f, command);
  const first = await mutate(f.root, loadConfig(f.root), { ...request(f, command), authorization });
  const cached = await mutate(f.root, loadConfig(f.root), { ...request(f, command), authorization });
  assert.equal(cached.cached, true);
  assert.equal(cached.runId, first.runId);
  f.git('commit', '--allow-empty', '-qm', 'different revision same tree');
  const second = await mutate(f.root, loadConfig(f.root), { ...request(f, command), authorization });
  assert.notEqual(second.runId, first.runId);
  assert.notEqual(json(second.files.artifact).head, json(first.files.artifact).head);
  assert.notEqual(json(second.files.artifact).cacheKey, json(first.files.artifact).cacheKey);
  assert.equal(second.cached, undefined);
});

test('mutation distinguishes equivalent candidates from ordinary survivors', sandboxed, async (t) => {
  const f = project(t);
  f.put('src/flag.ts', 'declare const unused = true;\nexport const flag = true;\n');
  f.put('test/flag.test.mjs', "import '../src/flag.ts'; import { test } from 'node:test'; test('loads flags', () => {});\n");
  f.git('add', '.'); f.git('commit', '-qm', 'head');
  const command = [process.execPath, '--test', '--test-reporter=tap'];
  const options = { command, base: 'base', max: 20, store: f.store, authorization: authorize(f, command) };
  const result = await mutate(f.root, loadConfig(f.root), options);
  const report = json(result.files.artifact), mutants = report.files['src/flag.ts'].mutants;
  assert.deepEqual(mutants.map((item) => item.status), ['Survived', 'Survived']);
  assert.match(mutants[0].equivalentCandidate.reason, /identical.*TypeScript/i);
  assert.equal(Object.hasOwn(mutants[1], 'equivalentCandidate'), false);
  assert.equal(result.counts.survived, 2);
  assert.equal(result.counts.ordinarySurvived, 1);
  assert.equal(result.counts.equivalentCandidate, 1);
  const cached = await mutate(f.root, loadConfig(f.root), options);
  assert.equal(cached.cached, true);
  assert.deepEqual(cached.counts, result.counts);
  const { loadReports } = await import('../lib/verify-reports.mjs');
  const { analysisInputs } = await import('../lib/inputs.mjs');
  const { summarizeMutation, mutationWords } = await import('../lib/mutation/report.mjs');
  const inputs = analysisInputs(f.root, loadConfig(f.root), {}, 'HEAD'), side = { inputs, sha: inputs.sha, analysis: {} };
  const loaded = loadReports(f.root, [{ run: result.runId }], { head: side, base: side }, undefined, f.store);
  assert.equal(loaded.executions[0].eligible, true);
  const summary = summarizeMutation(loaded.executions[0].mutation, new Map([['src/flag.ts', [1, 2]]]));
  assert.deepEqual(summary.counts, result.counts);
  assert.equal(summary.score, 0);
  assert.equal(summary.equivalentCandidates[0].line, 1);
  assert.equal(summary.equivalentCandidates[0].reason, mutants[0].equivalentCandidate.reason);
  const words = mutationWords([summary]).join('\n');
  assert.match(words, /ordinarySurvived: 1/);
  assert.match(words, /equivalentCandidate: 1/);
  assert.match(words, /src\/flag.ts:1.*TypeScript/);
  const { runVerify } = await import('../lib/verify.mjs');
  const requestPath = join(f.work, 'verify.json');
  writeFileSync(requestPath, JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1,
    base: 'base', head: 'HEAD', intent: 'Add flags.', acceptanceCriteria: [], allowedPaths: ['src/**', 'test/**'],
    changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [{ run: result.runId }],
    execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } }));
  const verified = runVerify(f.root, loadConfig(f.root), { request: requestPath, store: f.store, 'out-dir': join(f.work, 'verified') });
  assert.deepEqual(verified.results.mutation[0].counts, result.counts);
  assert.match(readFileSync(verified.paths.markdownPath, 'utf8'), /equivalentCandidate: 1/);
  assert.equal(json(verified.paths.jsonPath).mutation[0].equivalentCandidates[0].reason, mutants[0].equivalentCandidate.reason);
});
