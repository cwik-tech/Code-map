// The npm-audit report kind: the adapter for `npm audit --json` (npm 7 and later), `code-map manifest --kind npm-audit`, and
// `code-map verify`, which binds the report like a test report and lists its advisories as information. The rule set does not change.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditWords, parseNpmAudit } from '../lib/supply/npm-audit.mjs';
import { auditJson, lockfile, registry } from './supply-fixtures.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const none = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };

test('a valid npm audit report gives its advisories and its vulnerable packages by severity', () => {
  const parsed = parseNpmAudit(JSON.stringify(auditJson()));
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  const { report } = parsed;
  assert.deepEqual(report.advisories.bySeverity, { ...none, critical: 1, high: 1, moderate: 1 }, 'each advisory counts once; a transitive "via" name is not an advisory');
  assert.deepEqual(report.packages.bySeverity, { ...none, critical: 2, moderate: 1 }, 'npm counts vulnerable packages, also the transitive ones');
  assert.deepEqual([report.advisories.total, report.packages.total, report.mismatches], [3, 3, []]);
  assert.deepEqual(report.advisories.items.map((entry) => [entry.severity, entry.package, entry.source]), [['critical', 'lodash', 1096305], ['high', 'lodash', 1094499], ['moderate', 'minimist', 1096466]]);
  assert.equal(report.advisories.items[0].url, 'https://github.com/advisories/GHSA-jf85-cpcp-j695');
  const declared = auditJson();
  declared.metadata.vulnerabilities.high = 4;
  assert.deepEqual(parseNpmAudit(declared).report.mismatches, [{ field: 'metadata.vulnerabilities.high', declared: 4, observed: 0 }]);
  const clean = { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { ...none, total: 0 }, dependencies: { total: 0 } } };
  assert.deepEqual([parseNpmAudit(clean).report.advisories.total, parseNpmAudit(clean).report.packages.total], [0, 0]);
});

test('an invalid npm audit report gives errors with their paths, and a report over the size limit is refused', () => {
  const broken = (change) => { const value = auditJson(); change(value); return value; };
  const cases = [
    ['{"auditReportVersion": 2,', /not valid JSON/],
    [[], /JSON object/],
    [{ actions: [], advisories: {}, metadata: {} }, /npm 7 and later/],
    [{ error: { code: 'ENOLOCK', summary: 'This command requires an existing lockfile.' } }, /npm error \(ENOLOCK\)/],
    [broken((value) => { value.vulnerabilities = []; }), /vulnerabilities: Must be an object/],
    [broken((value) => { value.vulnerabilities.lodash.severity = 'severe'; }), /vulnerabilities\.lodash\.severity/],
    [broken((value) => { value.vulnerabilities.lodash.via = 'lodash'; }), /vulnerabilities\.lodash\.via: Must be an array/],
    [broken((value) => { value.vulnerabilities.lodash.via[0].title = 7; }), /via\[0\]\.title/],
    [broken((value) => { value.vulnerabilities.minimist.via[0] = {}; }), /via\[0\]: Must name the advisory/],
    [broken((value) => { delete value.metadata; }), /metadata: Must be an object/],
    [broken((value) => { value.metadata.vulnerabilities.total = -1; }), /metadata\.vulnerabilities\.total/],
  ];
  for (const [value, message] of cases) {
    const parsed = parseNpmAudit(typeof value === 'string' ? value : value);
    assert.equal(parsed.ok, false, JSON.stringify(value).slice(0, 60));
    assert.match(parsed.errors.map((error) => `${error.path}: ${error.message}`).join(' '), message, JSON.stringify(value).slice(0, 60));
  }
  const text = JSON.stringify(auditJson());
  assert.match(parseNpmAudit(text, { maxBytes: 100 }).errors[0].message, /larger than 100 bytes/);
  assert.match(parseNpmAudit(text, { maxPackages: 2 }).errors[0].message, /more than 2 vulnerable packages/);
});

test('the words for the verification report give the counts, the database time and the information-only use', () => {
  const [counts, note] = auditWords({ databaseTime: '2026-10-22T18:00:00.000Z', advisories: { total: 3, bySeverity: { ...none, critical: 1, high: 2 } }, packages: { total: 2, bySeverity: none } });
  assert.equal(counts, '3 advisories (1 critical, 2 high) in 2 vulnerable packages');
  assert.match(note, /2026-10-22T18:00:00\.000Z/);
  assert.match(note, /information only/);
  assert.equal(auditWords({ databaseTime: null, advisories: { total: 0, bySeverity: none }, packages: { total: 0, bySeverity: none } })[0], 'No advisory');
});

test('verify binds an npm audit report through its manifest and lists its advisories, and the rule set gives the same results without it', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'code-map-audit-')), work = mkdtempSync(join(tmpdir(), 'code-map-audit-work-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  const run = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
  put('.gitignore', 'reports/\n'); put('package-lock.json', lockfile({ 'node_modules/lodash': registry('lodash', '4.17.11') }));
  put('src/core/engine.ts', 'export function engine() { return 1; }\n');
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'base'); git('tag', 'base');
  put('src/core/engine.ts', 'export function engine() { return 2; }\n');
  put('reports/npm-audit.json', JSON.stringify(auditJson(), null, 2));
  put('reports/broken.json', JSON.stringify({ error: { code: 'EAUDITNOLOCK', summary: 'No lockfile.' } }));
  for (const name of ['npm-audit', 'broken']) {
    const written = run(['manifest', '--artifact', `reports/${name}.json`, '--kind', 'npm-audit', '--exit-status', '1', '--out', `reports/${name}.manifest.json`, '--', 'npm', 'audit', '--json']);
    assert.equal(written.status, 0, written.stderr);
  }
  const manifest = JSON.parse(readFileSync(join(root, 'reports/npm-audit.manifest.json'), 'utf8'));
  assert.equal(manifest.artifacts[0].kind, 'npm-audit');
  assert.equal(manifest.lockfile.path, 'package-lock.json', 'the manifest binds the lockfile that the audit read');

  const verify = (reportInputs) => {
    const request = join(work, `request-${reportInputs.length}.json`);
    writeFileSync(request, JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base', head: 'worktree', intent: 'Change the engine.',
      acceptanceCriteria: [], allowedPaths: ['src/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs,
      execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } }));
    const output = run(['verify', '--request', request, '--store', join(work, 'store'), '--out-dir', join(work, 'out')]);
    assert.ok([1, 2, 3].includes(output.status), output.stderr);
    const files = JSON.parse(output.stdout).files;
    return { status: output.status, results: JSON.parse(readFileSync(files.results, 'utf8')), markdown: readFileSync(files.report, 'utf8') };
  };
  const without = verify([]), withAudit = verify(['npm-audit', 'broken'].map((name) => ({ artifact: `reports/${name}.json`, manifest: `reports/${name}.manifest.json` })));
  const [audit, broken] = withAudit.results.executions;
  assert.deepEqual([audit.kind, audit.binding, audit.side, audit.eligible, audit.attestation, audit.cases], ['npm-audit', 'BOUND', 'head', true, 'self-attested', null]);
  assert.deepEqual(audit.audit.advisories.bySeverity, { ...none, critical: 1, high: 1, moderate: 1 });
  assert.deepEqual([audit.audit.packages.total, audit.audit.databaseTime, audit.audit.use], [3, manifest.startedAt, 'information']);
  assert.deepEqual([broken.binding, broken.eligible, broken.reasons[0].key], ['BOUND', false, 'parse']);
  assert.match(broken.reasons[0].message, /EAUDITNOLOCK/);
  const outcome = ({ status, results }) => ({ status, readiness: results.readiness, ratings: results.ratings, obligations: results.obligations });
  assert.deepEqual(outcome(withAudit), outcome(without), 'the advisories are information: the rule set static-baseline-v0 gives the same results');
  assert.match(withAudit.markdown, /Information only/);
  assert.match(withAudit.markdown, /3 advisories \(1 critical, 1 high, 1 moderate\) in 3 vulnerable packages/);
  assert.equal(git('status', '--porcelain'), ' M src/core/engine.ts\n');
});
