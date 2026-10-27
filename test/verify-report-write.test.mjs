import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderReport, writeRun } from '../lib/verify-report.mjs';
import { comparisonReasons, terms } from '../lib/verify-words.mjs';

const posix = { skip: process.platform === 'win32' && 'needs POSIX modes and symlinks' };
const permissions = { skip: process.platform === 'win32' ? 'needs POSIX modes' : process.getuid?.() === 0 ? 'root ignores folder permissions' : false };

/** An open check. Each test overrides only the fields that it is about. */
const check = (id, fields = {}) => ({ id, category: 'structuralIntegrity', required: true, blocking: false, severity: 'medium', applicability: 'APPLICABLE',
  result: 'UNKNOWN', eligible: false, review: 'none', evidenceIds: [], title: `Check ${id}`, rationale: `The evidence for ${id} is not available.`, nextAction: null, ...fields });
const completeness = (completed, total, optional = [0, 0]) => ({ required: { completed, total }, optional: { completed: optional[0], total: optional[1] }, unknown: total - completed, skipped: 0 });
const rating = (fields = {}) => ({ state: 'UNASSESSED', value: null, label: 'Unassessed', reason: 'The minimum assessment evidence for this category is not available.',
  predicates: { met: [], unmet: [], unknown: [] }, failures: [], missingEvidence: [], minimumEvidenceMet: false, rubricConfigured: true, rejectedDisposition: null,
  evidenceCompleteness: completeness(0, 1), ...fields });
const exitCodes = { READY: 0, REVIEW: 1, BLOCKED: 2, INSUFFICIENT_EVIDENCE: 3 };
const state = (name) => ({ state: name, blocking: name === 'BLOCKED' ? ['si.arch-rule'] : [], insufficient: name === 'INSUFFICIENT_EVIDENCE' ? ['vc.head-run'] : [],
  review: name === 'REVIEW' ? ['cc.settings'] : [], unassessedCategories: [], unsupportedCategories: [], failedCategories: [], reason: 'From the obligations.', exitCode: exitCodes[name] });

/** The results of a typical run of the static rule set: one blocking failure, one other failure, open checks and limits. */
function results(fields = {}) {
  return { reportType: 'code-map-verification', schemaVersion: 1, runId: 'V-0123456789abcdef', createdAt: '2026-10-22T18:00:00.000Z', profileId: 'static-baseline-v0',
    ratingRulesVersion: 'ratings-v0', changeType: 'refactor', intent: 'Move the parser into its own module', request: { digest: 'c'.repeat(64) },
    base: { ref: 'main', sha: 'a'.repeat(40), analysisId: 'A-1111111111111111' },
    head: { ref: 'worktree', sha: 'b'.repeat(40), analysisId: 'A-2222222222222222', worktreeDigest: 'd'.repeat(64) },
    comparison: { state: 'COMPARABLE', reasons: [] },
    readiness: { ...state('BLOCKED'), insufficient: ['vc.head-run'], unassessedCategories: ['verificationCoverage', 'behavioralConfidence'], failedCategories: ['structuralIntegrity'] },
    ratings: {
      structuralIntegrity: rating({ state: 'RATED', value: 1, label: 'Failing', reason: 'A verified fundamental failure under the category rubric: si.new-architecture-break.',
        failures: ['si.new-architecture-break'], evidenceCompleteness: completeness(2, 3) }),
      verificationCoverage: rating({ missingEvidence: ['a bound head test report', 'a bound line-coverage report'] }),
      behavioralConfidence: rating({ evidenceCompleteness: completeness(0, 1, [0, 1]) }),
      changeCompleteness: rating({ state: 'RATED', value: 2, label: 'Weak', reason: 'Material problems or gaps prevent the level-3 conditions.', minimumEvidenceMet: true,
        predicates: { met: [], unmet: ['obligation:cc.settings'], unknown: [] }, evidenceCompleteness: completeness(1, 1) }) },
    obligations: [
      check('cc.settings', { category: 'changeCompleteness', title: 'Code-map settings unchanged', result: 'FAIL', eligible: true, evidenceIds: ['.code-map.json'],
        rationale: 'The change edits .code-map.json.', nextAction: 'Undo the edit of .code-map.json, or ask a person to review it.' }),
      check('si.arch-rule', { title: 'No new architecture-rule break', blocking: true, severity: 'high', result: 'FAIL', eligible: true, evidenceIds: ['ARCH-RULE-0123456789'],
        rationale: 'The head has a NEW ARCH-RULE finding.', nextAction: 'code-map inspect --analysis A-2222222222222222 --base-analysis A-1111111111111111 --findings --baseline new --rule ARCH-RULE' }),
      check('vc.head-run', { category: 'verificationCoverage', title: 'A bound test run of the head exists', rationale: 'There is no bound head report.',
        nextAction: 'Add a JUnit report and its run manifest to reportInputs in the request.' }),
      check('bc.earlier', { category: 'behavioralConfidence', required: false, title: 'Earlier failures', result: 'PASS', eligible: false }),
      check('cc.docs', { category: 'changeCompleteness', required: false, title: 'Migrations and documentation', result: 'SKIPPED' }),
      check('si.imports', { title: 'New imports resolve', result: 'PASS', eligible: true }),
      check('si.types', { title: 'Types are compatible', applicability: 'NOT_APPLICABLE', applicabilityReason: 'The project has no TypeScript sources.', result: 'NOT_APPLICABLE' }),
    ],
    change: { total: 3, paths: ['src/a.ts', 'src/b.ts', 'src/parser/index.ts'] },
    executions: [{ artifact: 'reports/junit.xml', kind: 'junit', side: 'head', binding: 'STALE', eligible: false,
      reasons: [{ key: 'sha', message: 'The report ran on commit 0123456789, but the analysis is of bbbbbbbbbb.' }], cases: 12, failed: 0 }],
    gaps: [{ key: 'execution', source: 'inventory', text: 'Code-map ran no project test or command.' },
      { key: 'dynamicImports', source: 'graph', count: 2, text: 'Dynamic imports with a computed target are not resolved.' }],
    limits: ['Verification Coverage needs a bound line-coverage report, and Code-map cannot import one yet.'],
    llmHypotheses: [], ...fields };
}

function folder(t) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-verify-'));
  t.after(() => { try { chmodSync(root, 0o700); } catch { /* already gone */ } rmSync(root, { recursive: true, force: true }); });
  return root;
}
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const run = (runId, readiness = state('INSUFFICIENT_EVIDENCE')) => { const value = results({ runId, readiness }); return { runId, results: value, markdown: renderReport(value) }; };

test('a run publishes both files in its own folder and then the completion manifest with their digests', posix, (t) => {
  const root = join(folder(t), 'out'), paths = writeRun(root, run('V-1'));
  assert.deepEqual(paths, { dir: join(root, 'runs', 'V-1'), jsonPath: join(root, 'runs', 'V-1', 'verification-results.json'),
    markdownPath: join(root, 'runs', 'V-1', 'verification-report.md'), manifestPath: join(root, 'latest.json') });
  assert.deepEqual(JSON.parse(readFileSync(paths.jsonPath, 'utf8')), results({ runId: 'V-1', readiness: state('INSUFFICIENT_EVIDENCE') }));
  assert.match(readFileSync(paths.markdownPath, 'utf8'), /^# Verification report: /);
  assert.deepEqual(JSON.parse(readFileSync(paths.manifestPath, 'utf8')), { manifestType: 'code-map-verification-manifest', schemaVersion: 1, runId: 'V-1',
    createdAt: '2026-10-22T18:00:00.000Z', readiness: 'INSUFFICIENT_EVIDENCE', exitCode: 3,
    results: { path: 'runs/V-1/verification-results.json', sha256: sha256(paths.jsonPath) }, report: { path: 'runs/V-1/verification-report.md', sha256: sha256(paths.markdownPath) } });
  for (const path of [root, join(root, 'runs'), paths.dir]) assert.equal(statSync(path).mode & 0o777, 0o700, path);
  for (const path of [paths.jsonPath, paths.markdownPath, paths.manifestPath]) assert.equal(statSync(path).mode & 0o777, 0o600, path);
  assert.deepEqual([readdirSync(join(root, 'runs')), readdirSync(root).sort()], [['V-1'], ['latest.json', 'runs']]);
});

test('a second run replaces the completion manifest and keeps the earlier run folder', (t) => {
  const root = folder(t);
  writeRun(root, run('V-1')); writeRun(root, run('V-2', state('BLOCKED')));
  const { runId, exitCode } = JSON.parse(readFileSync(join(root, 'latest.json'), 'utf8'));
  assert.deepEqual({ runId, exitCode }, { runId: 'V-2', exitCode: 2 });
  assert.deepEqual(readdirSync(join(root, 'runs')).sort(), ['V-1', 'V-2']);
});

test('a failure after the files are staged removes the staging folder and leaves the earlier run and the manifest unchanged', (t) => {
  const root = folder(t), files = () => [join(root, 'latest.json'), join(root, 'runs', 'V-1', 'verification-report.md')].map((path) => readFileSync(path));
  writeRun(root, run('V-1'));
  const before = files();
  assert.throws(() => writeRun(root, run('V-1', state('BLOCKED'))), /A verification run with the ID V-1 already exists/);
  assert.deepEqual(readdirSync(join(root, 'runs')), ['V-1']);
  assert.deepEqual(files(), before);
});

test('a failure after the run folder is in place removes that folder, so no partial run remains and the manifest is unchanged', permissions, (t) => {
  const root = folder(t);
  writeRun(root, run('V-1'));
  const manifest = readFileSync(join(root, 'latest.json'));
  chmodSync(root, 0o500); // the run folder can still move inside runs/, but the new manifest cannot be written next to latest.json
  assert.throws(() => writeRun(root, run('V-2')), /EACCES/);
  chmodSync(root, 0o700);
  assert.deepEqual([readdirSync(join(root, 'runs')), readdirSync(root).sort()], [['V-1'], ['latest.json', 'runs']]);
  assert.deepEqual(readFileSync(join(root, 'latest.json')), manifest);
});

test('an unsafe run ID or invalid content is refused before Code-map writes anything', (t) => {
  const root = join(folder(t), 'out');
  for (const runId of ['', '../V-1', 'a/b', '.hidden', 'x'.repeat(200), 7]) assert.throws(() => writeRun(root, { ...run('V-1'), runId }), /run ID/, String(runId));
  assert.throws(() => writeRun(root, { ...run('V-1'), markdown: null }), /Markdown/);
  assert.throws(() => writeRun(root, { ...run('V-1'), results: { ...results({ runId: 'V-1' }), size: 1n } }), /BigInt/);
  assert.throws(() => writeRun(root, { ...run('V-1'), results: results({ runId: 'V-9' }) }), /belong to run V-9/);
  assert.equal(existsSync(root), false);
});

test('a runs folder that is a symlink or that other users can change is refused, and nothing is written there', posix, (t) => {
  const base = folder(t), elsewhere = join(base, 'elsewhere'), linked = join(base, 'linked'), open = join(base, 'open');
  mkdirSync(elsewhere); mkdirSync(linked); symlinkSync(elsewhere, join(linked, 'runs'));
  assert.throws(() => writeRun(linked, run('V-1')), /runs is not a private folder that you own: it is a symlink/);
  assert.deepEqual(readdirSync(elsewhere), []);
  mkdirSync(join(open, 'runs'), { recursive: true }); chmodSync(join(open, 'runs'), 0o777);
  assert.throws(() => writeRun(open, run('V-1')), /runs is not a private folder that you own: other users can change it/);
  assert.deepEqual(readdirSync(join(open, 'runs')), []);
  writeFileSync(join(base, 'file'), ''); assert.throws(() => writeRun(join(base, 'file'), run('V-1')), /not a folder|ENOTDIR|EEXIST/);
});

test('the output folder follows the store root rule, and Code-map refuses it before it creates anything in it', posix, (t) => {
  const base = folder(t), shared = join(base, 'shared'), sticky = join(base, 'sticky');
  for (const [path, mode] of [[shared, 0o775], [sticky, 0o1777]]) { mkdirSync(path); chmodSync(path, mode); }
  assert.throws(() => writeRun(shared, run('V-1')), /The output folder .*shared is not safe: other users can change it, and it has no sticky bit\. Choose another one/);
  assert.deepEqual(readdirSync(shared), []);
  assert.equal(writeRun(sticky, run('V-1')).dir, join(sticky, 'runs', 'V-1'), 'a shared folder with the sticky bit, as /tmp, is accepted');
});

test('no folder that a run writes into can be the repository or inside it, also when the repository is the runs folder', posix, (t) => {
  const base = folder(t), repository = join(base, 'runs');
  mkdirSync(repository);
  assert.throws(() => writeRun(base, { ...run('V-1'), repository }), /The folder .*runs, where Code-map writes the run, is the repository or a folder inside it\. A run there changes the working tree that verify describes\./);
  assert.throws(() => writeRun(join(repository, 'out'), { ...run('V-1'), repository }), /is the repository or a folder inside it/);
  assert.deepEqual([readdirSync(base), readdirSync(repository)], [['runs'], []]);
});
