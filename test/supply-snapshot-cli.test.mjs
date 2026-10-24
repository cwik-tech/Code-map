import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
test('CLI exports selected snapshot SBOM and binds OSV information without changing v0 outcomes', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'w5-supply-')), work = mkdtempSync(join(tmpdir(), 'w5-results-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (p, text) => writeFileSync(join(root, p), text);
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@local', ...args], { encoding: 'utf8' });
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 30000 });
  put('.gitignore', 'reports/\nstore/\nout/\nrequest.json\n');
  put('yarn.lock', '# yarn lockfile v1\n\na@^1:\n  version "1.0.0"\n');
  put('index.js', 'export const answer = 1;\n');
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'base');
  put('yarn.lock', '# yarn lockfile v1\n\na@^1:\n  version "1.0.1"\n');
  mkdirSync(join(root, 'reports'));
  assert.equal(run('sbom', '--worktree', '--out', 'reports/head.json').status, 0);
  assert.equal(run('sbom', '--ref', 'HEAD', '--out', 'reports/base.json').status, 0);
  assert.equal(JSON.parse(readFileSync(join(root, 'reports/head.json'))).components[0].version, '1.0.1');
  assert.equal(JSON.parse(readFileSync(join(root, 'reports/base.json'))).components[0].version, '1.0.0');
  put('reports/osv.json', JSON.stringify({ snapshot: { source: 'OSV frozen export', exportedAt: '2020-01-01T00:00:00Z' }, records: [{ id: 'OSV-1', affected: [{ package: { ecosystem: 'npm', name: 'a' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '1.0.1' }] }] }] }] }));
  const manifest = run('manifest', '--artifact', 'reports/osv.json', '--kind', 'osv-snapshot', '--exit-status', '0', '--out', 'reports/osv.manifest.json', '--', 'import-frozen-snapshot');
  assert.equal(manifest.status, 0, manifest.stderr);
  const verify = (reportInputs) => {
    put('request.json', JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1, base: 'HEAD', head: 'worktree', intent: 'Update a dependency.',
      acceptanceCriteria: [], allowedPaths: ['yarn.lock'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs,
      execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 30, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } }));
    const output = run('verify', '--request', 'request.json', '--store', join(work, 'store'), '--out-dir', join(work, 'out'));
    assert.ok([1, 2, 3].includes(output.status), output.stderr);
    const files = JSON.parse(output.stdout).files;
    return { results: JSON.parse(readFileSync(files.results)), markdown: readFileSync(files.report, 'utf8') };
  };
  const without = verify([]), withOsv = verify([{ artifact: 'reports/osv.json', manifest: 'reports/osv.manifest.json' }]);
  const execution = withOsv.results.executions[0];
  assert.equal(execution.binding, 'BOUND');
  assert.equal(execution.osv.use, 'information');
  assert.equal(execution.osv.items.length, 0);
  assert.equal(execution.osv.comparison.removed[0].id, 'OSV-1');
  assert.equal(execution.osv.snapshotDate, '2020-01-01T00:00:00Z');
  assert.equal(execution.osv.provenance.source, 'OSV frozen export');
  assert.equal(execution.osv.executedAt, JSON.parse(readFileSync(join(root, 'reports/osv.manifest.json'))).startedAt);
  assert.deepEqual(withOsv.results.obligations, without.results.obligations);
  assert.deepEqual(withOsv.results.ratings, without.results.ratings);
  assert.deepEqual(withOsv.results.readiness, without.results.readiness);
  assert.match(withOsv.markdown, /OSV.*information|information.*OSV/i);
  put('reports/osv.json', '[]');
  const stale = verify([{ artifact: 'reports/osv.json', manifest: 'reports/osv.manifest.json' }]);
  assert.equal(stale.results.executions[0].binding, 'STALE');
  assert.equal(run('manifest', '--artifact', 'reports/osv.json', '--kind', 'osv-snapshot', '--exit-status', '0', '--out', 'reports/osv.manifest.json', '--', 'import-frozen-snapshot').status, 0);
  const legacy = verify([{ artifact: 'reports/osv.json', manifest: 'reports/osv.manifest.json' }]);
  assert.equal(legacy.results.executions[0].osv.snapshotDate, null);
  assert.match(legacy.markdown, /UNKNOWN.*provenance/);

});
