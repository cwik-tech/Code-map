// Real Git fixtures for migration findings, public scope and revision policy information.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRequest } from '../lib/verify-request.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const request = { requestType: 'code-map-verification-request', schemaVersion: 1, base: 'HEAD', head: 'worktree', intent: 'Migrate API',
  acceptanceCriteria: [], allowedPaths: null, changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
  execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } };
const migrations = [{ from: 'legacy', to: 'modern', note: 'Use the new API.' }, { from: 'old-lib', to: 'new-lib', note: 'Use the new package.' }];
const layers = [{ name: 'ui', paths: ['src/ui/**'] }, { name: 'core', paths: ['src/core/**'] }];
function fixture(t, config = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'code-map-policy-')), root = join(folder, 'repo'), store = join(folder, 'store');
  mkdirSync(root);
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@local', ...args], { encoding: 'utf8' }).trim();
  const settings = (value) => put('.code-map.json', JSON.stringify({ roots: ['src'], ...value }));
  settings(config);
  put('package.json', JSON.stringify({ name: 'fixture', main: './src/index.ts' }));
  put('src/index.ts', 'export function legacy(n: number): number { return n; }\n');
  put('src/ui/view.ts', 'export const view = 1;\n');
  put('src/core/use.ts', "import { view } from '../ui/view';\nexport const use = view;\n");
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'base');
  const run = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args, '--store', store], { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.ok([0, 2, 3].includes(result.status), result.stderr);
    return JSON.parse(result.stdout);
  };
  const inspect = () => run('inspect', '--summary', '--worktree', '--base', 'HEAD');
  const verify = (fields = {}) => {
    const path = join(folder, 'request.json'); writeFileSync(path, JSON.stringify({ ...request, ...fields }));
    return JSON.parse(readFileSync(run('verify', '--request', path).files.results, 'utf8'));
  };
  return { folder, root, settings, put, git, run, inspect, verify };
}

test('migration path imports, named imports and calls have replacement evidence and lifecycle labels', (t) => {
  const p = fixture(t, { migrations });
  p.put('src/uses.ts', "import { legacy as alias } from './index';\nimport x from 'old-lib';\nlegacy(1);\nalias(2);\n");
  p.git('add', '.'); p.git('commit', '-qm', 'old uses');
  p.put('src/uses.ts', "import { legacy as alias } from './index';\nlegacy(1);\nlegacy(2);\n");
  const summary = p.inspect();
  const page = p.run('inspect', '--analysis', summary.analysis.id, '--base-analysis', summary.comparison.base.id, '--findings', '--rule', 'MIGRATION-USE');
  const items = page.page.items;
  assert.ok(items.some((item) => item.baseline === 'EXISTING'));
  assert.ok(items.some((item) => item.baseline === 'NEW'));
  assert.ok(items.some((item) => item.baseline === 'RESOLVED'));
  const results = p.verify();
  assert.ok(results.migrations.items.some((item) => item.facts.to === 'modern' && item.facts.note === 'Use the new API.'));
  assert.deepEqual(new Set(results.migrations.items.map((item) => item.facts.kind)), new Set(['import-name', 'import-path', 'call']));
  assert.equal(results.obligations.find((item) => item.id === 'completeness.migrations-docs').result, 'UNKNOWN');
});

test('public export additions, removals and changes report explicit permission, null and omitted scope', (t) => {
  const p = fixture(t);
  p.put('src/index.ts', 'export function legacy(n: string): string { return n; }\nexport const added: number = 2;\n');
  const scoped = p.verify({ allowedPublicChanges: ['legacy'] });
  assert.deepEqual(scoped.publicInterfaces.items.map(({ name, status, allowed }) => ({ name, status, allowed })), [
    { name: 'legacy', status: 'CHANGED', allowed: true }, { name: 'added', status: 'ADDED', allowed: false }]);
  const unscoped = p.verify();
  assert.ok(unscoped.publicInterfaces.items.every((item) => item.allowed === null));
  assert.deepEqual(p.verify({ allowedPublicChanges: null }).publicInterfaces, unscoped.publicInterfaces);
  assert.deepEqual(scoped.obligations, unscoped.obligations);
  p.put('src/index.ts', 'export const added: number = 2;\n');
  assert.ok(p.verify({ allowedPublicChanges: [] }).publicInterfaces.items.some((item) => item.status === 'REMOVED' && item.allowed === false));
});

test('request validation accepts optional public names and rejects invalid scope entries', () => {
  assert.equal(validateRequest({ ...request, allowedPublicChanges: ['default', 'name'] }).ok, true);
  assert.equal(validateRequest({ ...request, allowedPublicChanges: null }).ok, true);
  assert.equal(validateRequest({ ...request, allowedPublicChanges: [''] }).ok, false);
  assert.equal(validateRequest({ ...request, allowedPublicChanges: [4] }).ok, false);
  assert.equal(validateRequest({ ...request, allowedPublicChanges: 'name' }).ok, false);
});

test('base policy still detects forbidden imports after a rule relaxation and layer removal', (t) => {
  const p = fixture(t, { rules: ['core -> ui'], layers });
  p.settings({ rules: ['core -> absent'], layers: [layers[0]] });
  const summary = p.inspect(), policy = summary.comparison.policy;
  assert.equal(policy.state, 'CHANGED');
  assert.deepEqual(policy.rules.removed, ['core -> ui']);
  assert.deepEqual(policy.rules.added, ['core -> absent']);
  assert.deepEqual(policy.layers.removed, ['core']);
  assert.ok(policy.relaxed.some((item) => item.from === 'src/core/use.ts' && item.to === 'src/ui/view.ts'));
  assert.equal(policy.evaluations.basePolicy.head.violations.length, 2);
  assert.equal(policy.evaluations.headPolicy.head.violations.length, 0);
  assert.deepEqual(p.verify().policy, policy);
});

test('unchanged policy has no policy deltas', (t) => {
  const p = fixture(t, { rules: ['core -> ui'], layers });
  const policy = p.inspect().comparison.policy;
  assert.equal(policy.state, 'UNCHANGED');
  assert.deepEqual(policy.rules.added, []);
  assert.deepEqual(policy.layers.removed, []);
  assert.deepEqual(policy.relaxed, []);
});
