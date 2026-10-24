// Real CLI selection, v0 equivalence, READY through the restricted worker and self-attested refusal.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runContext, runVerify } from '../lib/verify.mjs';
import { loadConfig } from '../lib/project.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { authorize, budgets, project, run, sandboxed } from './worker-fixtures.mjs';
const root = fileURLToPath(new URL('..', import.meta.url)), cli = join(root, 'bin/code-map.mjs');
const requestOf = (fields = {}) => ({ requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base', head: 'HEAD', intent: 'Simplify addition.',
  acceptanceCriteria: [], allowedPaths: ['src/**'], changeType: 'other', profileId: 'evidence-v1', ratingRulesVersion: 'ratings-v1', reportInputs: [],
  execution: { enabled: false, authorization: null, budgets }, ...fields });
const change = (f) => { f.put('src/sum.mjs', 'export function sum(a, b) { return (a + b); }\n'); f.git('add', '.'); f.git('commit', '-qm', 'head'); };
function verify(f, fields = {}) {
  const request = join(f.work, 'request.json'); writeFileSync(request, JSON.stringify(requestOf(fields)));
  return runVerify(f.root, loadConfig(f.root), { request, store: f.store });
}
test('v1 CLI marks JSON as accepted and leaves v0 the explicit example profile', (t) => {
  const f = project(t); change(f);
  const request = join(f.work, 'request.json'); writeFileSync(request, JSON.stringify(requestOf()));
  const output = spawnSync(process.execPath, [cli, 'verify', '--request', request, '--store', f.store], { cwd: f.root, encoding: 'utf8' });
  assert.equal(output.status, 3, output.stderr);
  const summary = JSON.parse(output.stdout), results = JSON.parse(readFileSync(summary.files.results));
  assert.equal(summary.profileStatus, 'accepted');
  assert.equal(results.profileStatus, 'accepted');
  assert.equal(JSON.parse(readFileSync(summary.files.manifest)).profileStatus, 'accepted');
  assert.equal(runContext(f.root, { context: summary.runId, store: f.store }).profileStatus, 'accepted');
  assert.doesNotMatch(readFileSync(summary.files.report, 'utf8'), /proposed|not approved/i);
});
test('evidence-v1 report keeps its v1-only text and v0 omits it and profileStatus', async (t) => {
  const f = project(t); change(f);
  const v1 = await verify(f);
  const v1Text = readFileSync(v1.paths.markdownPath, 'utf8');
  assert.equal(v1.results.profileStatus, 'accepted');
  assert.match(v1Text, /READY requires every required check to pass, four ratings of at least 3, and isolated test reports\./);
  assert.match(v1Text, /Code-map ran the command in the restricted worker\. READY requires isolated test reports\./);
  assert.match(v1Text, /Code-map used stored analyses, bound reports, comparisons and current human oracle records\./);
  const v0 = await verify(f, { profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0' });
  const v0Text = readFileSync(v0.paths.markdownPath, 'utf8');
  assert.equal(v0.results.profileStatus, undefined);
  assert.doesNotMatch(v0Text, /READY requires every required check to pass, four ratings of at least 3, and isolated test reports\./);
  assert.doesNotMatch(v0Text, /READY requires isolated test reports\./);
  assert.doesNotMatch(v0Text, /Code-map used stored analyses, bound reports, comparisons and current human oracle records\./);
});
test('v0 fixture results retain baseline behavior with new informational fields', (t) => {
  const f = project(t); change(f);
  const old = join(f.work, 'baseline'); mkdirSync(old);
  const archive = execFileSync('git', ['archive', '--format=tar', '446cc65'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', old], { input: archive });
  symlinkSync(join(root, 'node_modules'), join(old, 'node_modules'));
  const request = join(f.work, 'request.json'); writeFileSync(request, JSON.stringify(requestOf({ profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0' })));
  const execute = (binary, name) => {
    const output = spawnSync(process.execPath, [binary, 'verify', '--request', request, '--store', join(f.work, name)], { cwd: f.root, encoding: 'utf8', timeout: 60000 });
    assert.equal(output.status, 3, output.stderr);
    return JSON.parse(readFileSync(JSON.parse(output.stdout).files.results));
  };
  const before = execute(join(old, 'bin/code-map.mjs'), 'old-store'), after = execute(cli, 'new-store');
  const normalize = (value) => {
    let json = JSON.stringify(value);
    for (const id of [value.base.analysisId, value.head.analysisId]) json = json.replaceAll(id, id === value.base.analysisId ? 'BASE' : 'HEAD');
    const result = JSON.parse(json); delete result.createdAt; delete result.runId;
    // The stream adds information after rating evaluation. Its fields have separate acceptance tests.
    delete result.bundle; delete result.complexity; delete result.completeness;
    // Dependency context and per-stack warnings add information without changing a v0 decision.
    delete result.graph;
    result.gaps = result.gaps.filter((gap) => !gap.key.startsWith('completeness:'));
    // The added coverage view and corrected limit text are information. Every pre-existing result still compares exactly.
    delete result.coverageEvidence;
    // Rubric metadata has separate acceptance tests. Every existing v0 field still compares exactly.
    delete result.rubric; delete result.ratingScope;
    // Weakening reviews add one information section. All pre-existing v0 fields still compare exactly.
    delete result.tests.reviews;
    // Environment comparison metadata has its own regression tests. Legacy rating fields remain exact.
    delete result.tests.comparisons;
    // Case outcome comparisons add information only. Every pre-existing v0 field still compares exactly.
    delete result.tests.outcomes;
    // Runtime links add information only. Every pre-existing v0 field still compares exactly.
    delete result.tests.runtimeLinks;
    // Assertion origins add information only. Keep every pre-existing provenance field in the comparison.
    delete result.provenance.assertions; delete result.provenance.assertionLimits; delete result.provenance.assertionsTruncated;
    result.limits = result.limits.map((text) => text.replace('Base coverage comparison is information only.', 'Code-map does not compare the coverage with the base.'));
    return result;
  };
  assert.deepEqual(after.tests.reviews, { path: '.code-map/reviews.json', error: null, total: 0, unreviewed: 0, entries: [], incomplete: false });
  assert.deepEqual(after.tests.comparisons, { total: 0, entries: [] });
  assert.equal(after.tests.runtimeLinks.state, 'UNKNOWN');
  assert.match(after.tests.runtimeLinks.reason, /No bound head coverage report/);
  assert.equal(after.tests.outcomes.state, 'UNKNOWN');
  assert.match(after.tests.outcomes.reason, /same run identity/);
  assert.deepEqual(after.provenance.assertions, []);
  assert.deepEqual(after.provenance.assertionLimits, { assertions: 200, files: 20, implementationFiles: 50 });
  assert.equal(after.provenance.assertionsTruncated, false);
  assert.equal(after.coverageEvidence, null);
  assert.equal(after.policy.informationOnly, true);
  assert.equal(after.publicInterfaces.informationOnly, true);
  assert.equal(after.migrations.informationOnly, true);
  assert.equal(after.compiler.informationOnly, true);
  const { policy, publicInterfaces, migrations, compiler, ...legacy } = after;
  assert.deepEqual(normalize(legacy), normalize(before));
});
test('isolated real test and coverage runs can reach READY', sandboxed, async (t) => {
  const f = project(t); change(f);
  const words = [process.execPath, '--test', '--experimental-test-coverage', '--test-reporter=junit', '--test-reporter-destination=junit.xml',
    '--test-reporter=lcov', '--test-reporter-destination=coverage.lcov'];
  const base = await run(f, words, { head: 'base', kind: 'junit', artifact: 'junit.xml' });
  const head = await run(f, words, { kind: 'junit', artifact: 'junit.xml' });
  const coverage = await run(f, words, { kind: 'lcov', artifact: 'coverage.lcov' });
  assert.equal(base.exitCode, 0); assert.equal(head.exitCode, 0); assert.equal(coverage.exitCode, 0);
  const result = await verify(f, { reportInputs: [base, head, coverage].map((x) => ({ run: x.record.runId })) });
  assert.equal(result.results.readiness.state, 'READY', JSON.stringify({ ratings: result.results.ratings, checks: result.results.obligations }));
  assert.equal(result.exitCode, 0);
  assert.equal(result.results.profileStatus, 'accepted');
});
test('a self-attested head report cannot reach READY', async (t) => {
  const f = project(t); change(f);
  const words = [process.execPath, '--test', '--test-reporter=junit', '--test-reporter-destination=reports/junit.xml'];
  mkdirSync(join(f.root, 'reports'));
  const output = spawnSync(words[0], words.slice(1), { cwd: f.root, encoding: 'utf8', timeout: 10000, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
  assert.equal(output.status, 0, output.stderr);
  const manifest = buildManifest(f.root, loadConfig(f.root), { artifact: 'reports/junit.xml', kind: 'junit', exitStatus: '0', command: words, filters: [] });
  writeFileSync(join(f.root, 'reports/manifest.json'), JSON.stringify(manifest));
  const result = await verify(f, { reportInputs: [{ artifact: 'reports/junit.xml', manifest: 'reports/manifest.json' }] });
  assert.equal(result.results.executions[0].attestation, 'self-attested');
  assert.equal(result.results.readiness.state, 'INSUFFICIENT_EVIDENCE');
  assert.equal(result.results.ratings.behavioralConfidence.state, 'UNASSESSED');
});

test('a stale static import of a moved path fails the stale-reference check', async (t) => {
  const f = project(t);
  f.put('src/consumer.mjs', "import { sum } from './sum.mjs';\nexport function total() { return sum(1, 2); }\n");
  f.git('add', '.'); f.git('commit', '-qm', 'consumer'); f.git('tag', '-f', 'base');
  f.git('mv', 'src/sum.mjs', 'src/add.mjs'); f.git('commit', '-qm', 'move');
  const result = await verify(f);
  assert.equal(result.results.obligations.find((x) => x.id === 'completeness.no-stale-references').result, 'FAIL');
});

test('a declared supply policy without a lockfile keeps its required check unknown', async (t) => {
  const f = project(t);
  f.put('.code-map.json', JSON.stringify({ supplyChain: { forbidInstallScripts: true } }));
  f.git('add', '.'); f.git('commit', '-qm', 'policy'); f.git('tag', '-f', 'base'); change(f);
  const result = await verify(f);
  assert.equal(result.results.obligations.find((x) => x.id === 'completeness.dependency-policy').result, 'UNKNOWN');
});

test('copied named regression evidence closes fix checks through real authorized execution', sandboxed, async (t) => {
  const f = project(t);
  f.put('src/sum.mjs', 'export function sum(a, b) { return a === 10 ? 0 : a + b; }\n');
  f.git('add', '.'); f.git('commit', '-qm', 'bug'); f.git('tag', '-f', 'base');
  f.put('src/sum.mjs', 'export function sum(a, b) { return a + b; }\n');
  f.put('test/new.test.mjs', "import { describe, it } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from '../src/sum.mjs';\ndescribe('regression', () => { it('fixed', () => assert.equal(sum(10, 1), 11)); });\n");
  f.git('add', '.'); f.git('commit', '-qm', 'fix');
  const words = [process.execPath, '--test', '--test-reporter=junit', '--test-reporter-destination=junit.xml'];
  const authorization = authorize(f, words);
  const result = await verify(f, { changeType: 'fix', allowedPaths: ['src/**', 'test/**'], regressionTests: [{ file: 'test/new.test.mjs', name: 'fixed' }],
    execution: { enabled: true, authorization, budgets, commands: [{ id: 'tests', words, kind: 'junit', artifact: 'junit.xml', sides: ['base', 'head'] }] } });
  assert.equal(result.results.testValidation[0].confirmed, true);
  assert.equal(result.results.obligations.find((x) => x.id === 'fix.reproduced').result, 'PASS');
  assert.equal(result.results.obligations.find((x) => x.id === 'fix.regression-check').result, 'PASS');
});
