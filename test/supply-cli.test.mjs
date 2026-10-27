// Acceptance tests of the supply-chain evidence through the CLI: the summary counts, the policy findings, the comparison with
// a base commit, the paged --dependencies list, and a project without a lockfile, whose outputs do not change.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lockfile, registry } from './supply-fixtures.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const policy = JSON.stringify({ supplyChain: { deniedLicenses: ['GPL-3.0-only'], allowedHosts: ['registry.npmjs.org'] } });
const baseLock = lockfile({ 'node_modules/left-pad': registry('left-pad', '1.0.0'), 'node_modules/lodash': registry('lodash', '4.17.20'),
  'node_modules/old': registry('old', '1.0.0', { integrity: undefined }), 'node_modules/gpl': registry('gpl', '1.0.0', { license: 'GPL-3.0-only' }) });
const headLock = lockfile({ 'node_modules/left-pad': registry('left-pad', '1.3.0'), 'node_modules/lodash': registry('lodash', '4.17.19'),
  'node_modules/new-dep': registry('new-dep', '1.0.0', { hasInstallScript: true }), 'node_modules/gpl': registry('gpl', '1.0.0', { license: 'GPL-3.0-only' }),
  'node_modules/mirror': { version: '1.0.0', resolved: 'https://npm.example.com/mirror/-/mirror-1.0.0.tgz', license: 'MIT' } });

/** A Git repository in a temporary folder with one commit for each map of files, and a private store. */
function repository(t, ...commits) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-supply-')), store = mkdtempSync(join(tmpdir(), 'code-map-supply-store-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); });
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  git('init', '-q');
  commits.forEach((files, index) => { for (const [path, text] of Object.entries(files)) put(path, text); git('add', '.'); git('commit', '-qm', `commit ${index}`); });
  return { root, store, git, put };
}
const run = (root, args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
function json(root, args) {
  const output = run(root, args);
  assert.equal(output.status, 0, output.stderr);
  return JSON.parse(output.stdout);
}
const words = (command) => [...command.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)].map((match) => match[1] !== undefined ? match[1].replaceAll("'\\''", "'") : match[2]);
function follow(root, command) {
  const [program, ...args] = words(command);
  assert.equal(program, 'code-map');
  return json(root, args);
}
const supplyKeys = ['lockfilesNotRead', 'lockfileUnreadable', 'lockfileVersion1', 'licensesUnknown', 'hostsUnknown', 'advisories'];

test('the summary counts the packages of the lockfile, the policy gives findings, and --base shows the dependency change', (t) => {
  const repo = repository(t, { '.code-map.json': policy, 'package-lock.json': baseLock, 'src/index.ts': 'export const a = 1;\n' }, { 'package-lock.json': headLock });
  const summary = json(repo.root, ['inspect', '--summary', '--ref', 'HEAD', '--base', 'HEAD~1', '--store', repo.store]);
  const { supply } = summary;
  assert.deepEqual([supply.lockfile, supply.lockfileVersion], ['package-lock.json', 3]);
  assert.deepEqual(supply.counts, { packages: 5, local: 0, dev: 0, optional: 0, peer: 0, installScripts: 1, withoutIntegrity: 1, otherHosts: 1, unknownHost: 0 });
  assert.deepEqual(supply.licenses, { total: 2, items: [{ license: 'MIT', count: 4 }, { license: 'GPL-3.0-only', count: 1 }] });
  assert.deepEqual(supply.policy, { deniedLicenses: ['GPL-3.0-only'], allowedLicenses: null, allowedHosts: ['registry.npmjs.org'] });
  const labels = Object.fromEntries(summary.findings.items.filter((item) => item.ruleId.startsWith('DEPENDENCY-')).map((item) => [`${item.ruleId} ${item.location.symbol}`, item.baseline]));
  assert.deepEqual(labels, { 'DEPENDENCY-LICENSE gpl': 'EXISTING', 'DEPENDENCY-HOST mirror': 'NEW', 'DEPENDENCY-NO-INTEGRITY mirror': 'NEW' });
  assert.equal(summary.comparison.resolved.items.find((item) => item.ruleId === 'DEPENDENCY-NO-INTEGRITY').matchedBy, 'absent', 'the lockfile is still there, only the package is gone');
  assert.ok(summary.gaps.some((gap) => gap.key === 'advisories'));
  const host = follow(repo.root, summary.findings.items.find((item) => item.ruleId === 'DEPENDENCY-HOST').next);
  assert.deepEqual([host.reportType, host.finding.facts.host, host.finding.location.line > 0], ['code-map-finding', 'npm.example.com', true]);

  const change = summary.comparison.supply;
  assert.equal(change.state, 'compared');
  assert.deepEqual(change.counts, { added: 2, removed: 1, upgraded: 1, downgraded: 1, changed: 0, installScript: 1, hostChanged: 0, licenseChanged: 0 });
  assert.deepEqual(change.examples.map(({ change: kind, name }) => [kind, name]), [['installScript', 'new-dep'], ['added', 'mirror'], ['added', 'new-dep'], ['downgraded', 'lodash'], ['upgraded', 'left-pad']]);
  const changes = follow(repo.root, change.next);
  assert.equal(changes.reportType, 'code-map-dependencies');
  assert.equal(changes.comparison.state, 'COMPARABLE');
  assert.deepEqual(Object.keys(changes.page), ['total', 'offset', 'limit', 'items', 'next'], 'the page shape of the other pages');
  assert.deepEqual(changes.page.items.map((item) => [item.change, item.name, item.from, item.to]).slice(-2), [['upgraded', 'left-pad', '1.0.0', '1.3.0'], ['removed', 'old', '1.0.0', null]]);
  assert.equal(changes.page.total, 6);

  const first = follow(repo.root, `${supply.next} --limit 2`);
  assert.deepEqual([first.page.total, first.page.items.map((item) => item.name)], [5, ['gpl', 'left-pad']]);
  assert.match(first.page.next, /--dependencies --offset 2 --limit 2/);
  const last = follow(repo.root, follow(repo.root, first.page.next).page.next);
  assert.deepEqual([last.page.items.map((item) => item.name), last.page.next], [['new-dep'], null]);
  assert.equal(repo.git('status', '--porcelain'), '', 'nothing in the repository changed');
});

test('a working-tree summary reads the lockfile as it is now', (t) => {
  const repo = repository(t, { 'package-lock.json': baseLock, 'src/index.ts': 'export const a = 1;\n' });
  repo.put('package-lock.json', headLock);
  const summary = json(repo.root, ['inspect', '--summary', '--worktree', '--store', repo.store]);
  assert.equal(summary.supply.counts.packages, 5);
  assert.equal(summary.supply.policy, null);
  assert.deepEqual(summary.findings.byRule.map((rule) => rule.ruleId).filter((id) => id.startsWith('DEPENDENCY-')), ['DEPENDENCY-NO-INTEGRITY'], 'without a policy, no license or host finding');
});

test('a project without a lockfile keeps its outputs: no supply part, no supply gap, no supply finding and an empty package list', (t) => {
  const repo = repository(t, { 'src/index.ts': 'export const a = 1;\n', 'package.json': '{"name":"plain"}\n' }, { 'src/index.ts': 'export const a = 2;\n' });
  const summary = json(repo.root, ['inspect', '--summary', '--ref', 'HEAD', '--base', 'HEAD~1', '--store', repo.store]);
  assert.ok(!Object.hasOwn(summary, 'supply'));
  assert.ok(!Object.hasOwn(summary.comparison, 'supply'));
  assert.deepEqual(summary.gaps.filter((gap) => supplyKeys.includes(gap.key)), []);
  assert.ok(!summary.findings.byRule.some((rule) => rule.ruleId.startsWith('DEPENDENCY-')));
  assert.ok(!Object.hasOwn(json(repo.root, ['inspect', '--ref', 'HEAD']), 'supply'), 'the classic report has no supply part');
  const page = json(repo.root, ['inspect', '--analysis', summary.analysis.id, '--dependencies', '--store', repo.store]);
  assert.deepEqual([page.supply, page.page.total, page.page.next], [null, 0, null]);
});

test('an invalid supplyChain policy stops the command, and --dependencies needs a stored analysis and no other view', (t) => {
  const repo = repository(t, { '.code-map.json': JSON.stringify({ supplyChain: { allowedHosts: 'registry.npmjs.org' } }), 'src/index.ts': 'export const a = 1;\n' });
  const refused = run(repo.root, ['inspect', '--summary', '--ref', 'HEAD', '--store', repo.store]);
  assert.equal(refused.status, 1);
  assert.equal(refused.stdout, '');
  assert.match(refused.stderr, /supplyChain\.allowedHosts must be an array/);
  repo.put('.code-map.json', '{}');
  const id = json(repo.root, ['inspect', '--summary', '--worktree', '--store', repo.store]).analysis.id;
  for (const [args, message] of [[['--dependencies', '--ref', 'HEAD'], /--dependencies needs --analysis/], [['--analysis', id, '--dependencies', '--findings'], /Use either --dependencies or --findings/],
    [['--analysis', id, '--dependencies', '--summary'], /Use either --dependencies or --summary/]]) {
    const output = run(repo.root, ['inspect', ...args, '--store', repo.store]);
    assert.equal(output.status, 1, args.join(' '));
    assert.match(output.stderr, message);
  }
});
