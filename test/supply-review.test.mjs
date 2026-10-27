// Regression probes from the stream self-review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSupply } from '../lib/supply/lockfile.mjs';
import { buildSbom } from '../lib/supply/sbom.mjs';
import { supplyGaps } from '../lib/supply/summary.mjs';
import { compareSupply } from '../lib/supply/compare.mjs';
import { matchOsv, parseOsv, osvExecution } from '../lib/supply/osv.mjs';
const read = (path, text) => readSupply([path], new Map([[path, text]]));
const advisory = () => ({ id: 'OSV-1', affected: [{ package: { ecosystem: 'npm', name: 'a' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }] }] }] });
const inventory = () => ({ lockfile: 'yarn.lock', packages: [{ name: 'a', version: '1.0.0', kind: 'unknown' }] });

test('withdrawn OSV records do not report an active vulnerability', () => {
  const value = { ...advisory(), withdrawn: '2026-10-23T00:00:00Z' };
  const parsed = parseOsv(JSON.stringify([value]));
  assert.equal(parsed.ok, true);
  assert.equal(matchOsv(parsed.records, inventory(), 'date').items.length, 0);
});

test('OSV retains database-specific severity when no CVSS severity exists', () => {
  const parsed = parseOsv(JSON.stringify([{ ...advisory(), database_specific: { severity: 'HIGH' } }]));
  assert.deepEqual(matchOsv(parsed.records, inventory(), 'date').items[0].severity, [{ type: 'database_specific', score: 'HIGH' }]);
});

test('a new lockfile reports added advisories while unreadable lockfiles refuse comparison', () => {
  const text = JSON.stringify([advisory()]), run = { startedAt: 'date' };
  const added = osvExecution({ reasons: [], eligible: false }, text, run, { base: { analysis: {} }, head: { analysis: { supply: inventory() } } });
  assert.equal(added.osv.comparison.added[0].id, 'OSV-1');
  const unreadable = osvExecution({ reasons: [], eligible: false }, text, run,
    { base: { analysis: { supply: { lockfile: null, lockfiles: [{ state: 'invalid' }] } } }, head: { analysis: { supply: inventory() } } });
  assert.equal(unreadable.eligible, false);
  assert.equal(unreadable.reasons[0].key, 'inventory');
});

test('malformed pnpm dependency and snapshot maps refuse the inventory', () => {
  assert.equal(read('pnpm-lock.yaml', 'lockfileVersion: 9.0\npackages:\n  a@1.0.0:\n    dependencies: broken\n').lockfiles[0].state, 'invalid');
  assert.equal(read('pnpm-lock.yaml', 'lockfileVersion: 9.0\npackages:\n  a@1.0.0: {}\nsnapshots: broken\n').lockfiles[0].state, 'invalid');
});

test('pnpm YAML refuses duplicate inline keys and aliases in scalar arrays', () => {
  assert.equal(read('pnpm-lock.yaml', 'lockfileVersion: 9.0\npackages:\n  a@1.0.0:\n    resolution: {integrity: first, integrity: second}\n').lockfiles[0].state, 'invalid');
  assert.equal(read('pnpm-lock.yaml', 'lockfileVersion: 9.0\nsettings:\n  list: [*missing]\npackages: {}\n').lockfiles[0].state, 'invalid');
});

test('Bun optional dependency edges are retained', () => {
  const supply = read('bun.lock', JSON.stringify({ lockfileVersion: 1, packages: {
    a: ['a@1.0.0', '', { optionalDependencies: { b: '2.0.0' } }, ''], b: ['b@2.0.0', '', {}, ''] } }));
  assert.deepEqual(buildSbom(supply).dependencies[0].dependsOn, ['b']);
});

test('credential-bearing extra lockfile identities are refused without printing secrets', () => {
  const supply = read('yarn.lock', '# yarn lockfile v1\na@^1:\n  version "https://user:SECRET@example.com/a.tgz"\n');
  assert.equal(supply.lockfiles[0].state, 'invalid');
  assert.equal(JSON.stringify(supply).includes('SECRET'), false);
});

test('Yarn npm aliases use the real package identity for advisory matching', () => {
  const supply = read('yarn.lock', '# yarn lockfile v1\n"alias@npm:a@^1":\n  version "1.0.0"\n');
  assert.equal(supply.packages[0].name, 'a');
  assert.equal(matchOsv(parseOsv(JSON.stringify([advisory()])).records, supply, 'date').items.length, 1);
});

test('SBOM refuses duplicate component references caused by truncated install paths', () => {
  const prefix = 'node_modules/' + 'a'.repeat(4096);
  const supply = read('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: {
    [`${prefix}x`]: { version: '1.0.0' }, [`${prefix}y`]: { version: '2.0.0' } } }));
  assert.throws(() => buildSbom(supply), /duplicate|unique/i);
});

test('Bun version 1 has no misleading npm version 1 metadata gap', () => {
  const supply = read('bun.lock', JSON.stringify({ lockfileVersion: 1, packages: { a: ['a@1.0.0', '', { license: 'MIT' }, ''] } }));
  assert.equal(supplyGaps(supply).some((gap) => gap.key === 'lockfileVersion1'), false);
  assert.deepEqual(compareSupply(supply, supply).reasons, []);
});

test('Bun declared ranges resolve through nested lockfile paths', () => {
  const supply = read('bun.lock', JSON.stringify({ lockfileVersion: 1, packages: {
    a: ['a@1.0.0', '', { dependencies: { b: '^2.0.0' } }, ''],
    'a/b': ['b@2.0.0', '', {}, ''], b: ['b@3.0.0', '', {}, ''] } }));
  assert.deepEqual(buildSbom(supply).dependencies[0].dependsOn, ['a/b']);
});

test('npm recorded peer relationships resolve to installed lockfile paths', () => {
  const supply = read('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: {
    'node_modules/a': { version: '1.0.0', peerDependencies: { b: '^2' } }, 'node_modules/b': { version: '2.0.0' } } }));
  assert.deepEqual(buildSbom(supply).dependencies[0].dependsOn, ['node_modules/b']);
});
