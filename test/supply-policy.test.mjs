// The supply-chain policy of .code-map.json and its findings (C34): denied licenses, a license outside the allowed list,
// a host outside the allowed hosts, and a downloaded package without integrity. Without a policy, only the integrity rule applies.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveFindings, findingRules } from '../lib/findings.mjs';
import { loadConfig } from '../lib/project.mjs';
import { supplyPolicy } from '../lib/supply/policy.mjs';
import { supplyGaps } from '../lib/supply/summary.mjs';
import { item, supplyOf } from './supply-fixtures.mjs';

const findingsOf = (supply) => deriveFindings({ files: [], cycles: { all: [], value: [] }, sharedTypes: [], tests: null, supply });
/** The package names of the findings of one rule. Findings of one lockfile without lines sort by ID, so the names are sorted here. */
const named = (findings, ruleId) => findings.filter((finding) => finding.ruleId === ruleId).map((finding) => finding.facts.name).sort();
const withPolicy = (packages, policy) => supplyOf(packages, { policy: supplyPolicy(policy) });

test('the three supply-chain rules are in the registry with capability C34 and the evidence kind inventory', () => {
  assert.deepEqual(['DEPENDENCY-LICENSE', 'DEPENDENCY-HOST', 'DEPENDENCY-NO-INTEGRITY'].map((id) => [findingRules[id].severity, findingRules[id].source, findingRules[id].capability]),
    [['high', 'inventory', 'C34'], ['high', 'inventory', 'C34'], ['medium', 'inventory', 'C34']]);
});

test('.code-map.json accepts a valid supplyChain policy and refuses an invalid one, so a policy is never ignored in silence', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'code-map-supply-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const load = (supplyChain) => { writeFileSync(join(root, '.code-map.json'), JSON.stringify({ supplyChain })); return loadConfig(root); };
  assert.deepEqual(load({ deniedLicenses: ['GPL-3.0-only'], allowedHosts: ['Registry.npmjs.org'] }).supplyChain, { deniedLicenses: ['GPL-3.0-only'], allowedHosts: ['Registry.npmjs.org'] });
  assert.deepEqual(supplyPolicy({ allowedHosts: [' Registry.npmjs.org '], deniedLicenses: [] }), { deniedLicenses: [], allowedLicenses: null, allowedHosts: ['registry.npmjs.org'] });
  assert.equal(supplyPolicy(undefined), null);
  assert.throws(() => supplyPolicy({ allowedHosts: [] }), /allowedHosts is empty, so it allows nothing/);
  for (const [value, message] of [['MIT', /supplyChain must be an object/], [{ allowedLicences: ['MIT'] }, /supplyChain\.allowedLicences is not a known field/],
    [{ deniedLicenses: 'GPL-3.0' }, /supplyChain\.deniedLicenses must be an array/], [{ allowedHosts: ['ok', 7] }, /supplyChain\.allowedHosts must be an array/],
    [{ allowedLicenses: [] }, /allowedLicenses is empty/], [{ deniedLicenses: ['x'.repeat(300)] }, /at most 256 characters/]]) {
    assert.throws(() => load(value), message, JSON.stringify(value));
  }
});

test('a denied license gives a finding only when each choice of its expression is denied', () => {
  const packages = [item('plain', '1.0.0', { license: 'GPL-3.0-only' }), item('either', '1.0.0', { license: '(MIT OR GPL-3.0-only)' }),
    item('both', '1.0.0', { license: 'MIT AND gpl-3.0-only' }), item('excepted', '1.0.0', { license: 'GPL-3.0-only WITH Classpath-exception-2.0' }),
    item('nested', '1.0.0', { license: '(GPL-3.0-only OR AGPL-3.0-only) AND MIT' }), item('fine', '1.0.0', { license: 'MIT' }),
    item('unknown', '1.0.0', { license: null }), item('workspace', '1.0.0', { kind: 'local', path: 'packages/workspace', license: 'GPL-3.0-only', host: null })];
  const findings = findingsOf(withPolicy(packages, { deniedLicenses: ['GPL-3.0-only', 'AGPL-3.0-only'] }));
  assert.deepEqual(named(findings, 'DEPENDENCY-LICENSE'), ['both', 'excepted', 'nested', 'plain'],
    'AND needs every part, OR needs one part, an exception keeps its license, letter case does not count, and local packages are not checked');
  const finding = findings.find((entry) => entry.facts.name === 'plain');
  assert.equal(finding.location.path, 'package-lock.json');
  assert.equal(finding.facts.verdict, 'denied');
  assert.match(finding.text, /plain@1\.0\.0 .*GPL-3\.0-only.*denies/);
  assert.deepEqual(finding.paths, ['package-lock.json']);
});

test('an allowed-license list gives a finding for each license outside it, and a package without a license is a gap, not a finding', () => {
  const packages = [item('mit', '1.0.0'), item('choice', '1.0.0', { license: '(GPL-3.0-only OR Apache-2.0)' }), item('custom', '1.0.0', { license: 'SEE LICENSE IN LICENSE.md' }),
    item('and', '1.0.0', { license: 'MIT AND BSD-3-Clause' }), item('bare', '1.0.0', { license: null }), item('broken', '1.0.0', { license: '(MIT OR' })];
  const supply = withPolicy(packages, { allowedLicenses: ['MIT', 'apache-2.0'] }), findings = findingsOf(supply);
  assert.deepEqual(named(findings, 'DEPENDENCY-LICENSE'), ['and', 'broken', 'custom']);
  assert.equal(findings.find((entry) => entry.facts.name === 'custom').facts.verdict, 'not-allowed');
  const gap = supplyGaps(supply).find((entry) => entry.key === 'licensesUnknown');
  assert.deepEqual([gap.count, gap.source], [1, 'inventory']);
});

test('an allowed-host list gives a finding for each package from another host, and a host entry without a port allows each port', () => {
  const packages = [item('npm', '1.0.0'), item('mirror', '1.0.0', { host: 'npm.example.com:8443' }), item('other', '1.0.0', { host: 'evil.example' }),
    item('fork', '1.0.0', { kind: 'git', host: 'github.com', integrity: false }), item('hidden', '1.0.0', { kind: 'unknown', host: null })];
  const supply = withPolicy(packages, { allowedHosts: ['registry.npmjs.org', 'NPM.example.com'] }), findings = findingsOf(supply);
  assert.deepEqual(named(findings, 'DEPENDENCY-HOST'), ['fork', 'other']);
  assert.equal(findings.find((entry) => entry.ruleId === 'DEPENDENCY-HOST' && entry.facts.name === 'other').facts.host, 'evil.example');
  assert.equal(supplyGaps(supply).find((entry) => entry.key === 'hostsUnknown').count, 1, 'a package without a resolved URL has no host to check');
});

test('without a policy, only downloaded packages without integrity give findings, and the IDs come from the lockfile and the package path', () => {
  const packages = [item('ok', '1.0.0'), item('bare', '1.0.0', { integrity: false, license: 'GPL-3.0-only', host: 'evil.example' }),
    item('nohost', '2.0.0', { kind: 'unknown', host: null, integrity: false }), item('fork', '1.0.0', { kind: 'git', host: 'github.com', integrity: false }),
    item('packed', '1.0.0', { kind: 'bundled', host: null, integrity: false }), item('mine', '1.0.0', { kind: 'local', path: 'packages/mine', host: null, integrity: false })];
  const findings = findingsOf(supplyOf(packages));
  assert.deepEqual(findings.map((finding) => finding.ruleId), ['DEPENDENCY-NO-INTEGRITY', 'DEPENDENCY-NO-INTEGRITY']);
  assert.deepEqual(named(findings, 'DEPENDENCY-NO-INTEGRITY'), ['bare', 'nohost'], 'Git, bundled and local packages need no integrity value');
  const moved = findingsOf(supplyOf([item('bare', '1.0.1', { integrity: false, line: 40 })]));
  assert.equal(moved[0].id, findings.find((finding) => finding.facts.name === 'bare').id, 'a new version or line of the same package keeps the ID');
  assert.equal(findingsOf(null).length, 0);
  assert.equal(findingsOf(supplyOf([], { lockfile: null })).length, 0);
});

test('the supply gaps name unread lockfiles, version 1 limits, and the advisories that Code-map does not check', () => {
  const supply = supplyOf([item('a', '1.0.0')], { lockfileVersion: 1, lockfiles: [{ path: 'package-lock.json', manager: 'npm', state: 'read', lockfileVersion: 1, packages: 1 },
    { path: 'yarn.lock', manager: 'yarn', state: 'not-read' }], nested: { count: 2, paths: ['a/package-lock.json', 'b/yarn.lock'] } });
  const gaps = Object.fromEntries(supplyGaps(supply).map((gap) => [gap.key, gap]));
  assert.deepEqual(Object.keys(gaps), ['lockfilesNotRead', 'lockfileVersion1', 'advisories']);
  assert.equal(gaps.lockfilesNotRead.count, 3);
  assert.match(gaps.lockfilesNotRead.text, /yarn\.lock/);
  assert.match(gaps.advisories.text, /npm-audit|npm audit/);
  const broken = supplyGaps(supplyOf([], { lockfile: null, lockfileVersion: null, lockfiles: [{ path: 'package-lock.json', manager: 'npm', state: 'invalid', error: 'The file is not valid JSON.' }] }));
  assert.deepEqual(broken.map((gap) => gap.key), ['lockfileUnreadable', 'advisories']);
  assert.match(broken[0].text, /not valid JSON/);
});
