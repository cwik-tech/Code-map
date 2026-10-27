import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSemver, parseOsv, matchOsv, compareAdvisories, osvExecution } from '../lib/supply/osv.mjs';
const record = (events) => ({ id: 'GHSA-example', severity: [{ type: 'CVSS_V3', score: '9.8' }], affected: [{ package: { ecosystem: 'npm', name: 'a' }, ranges: [{ type: 'SEMVER', events }] }] });
const supply = (version) => ({ lockfile: 'package-lock.json', packages: [{ name: 'a', version, kind: 'remote' }] });
test('semantic versions sort prerelease identifiers numerically and releases last', () => {
  assert.equal(compareSemver('1.0.0-alpha.2', '1.0.0-alpha.10'), -1);
  assert.equal(compareSemver('1.0.0-rc.1', '1.0.0'), -1);
  assert.equal(compareSemver('1.0.0+build', '1.0.0'), 0);
  assert.equal(compareSemver('1.0', '1.0.0'), null);
  assert.equal(compareSemver('1.0.0-01', '1.0.0'), null);
});
test('OSV matches introduced and fixed prereleases, inclusive last_affected and explicit versions', () => {
  const parsed = parseOsv(JSON.stringify([record([{ introduced: '0' }, { fixed: '1.0.0-rc.2' }, { introduced: '2.0.0' }, { last_affected: '2.0.1' }])]));
  assert.equal(parsed.ok, true);
  const match = (version) => matchOsv(parsed.records, supply(version), '2026-10-23T00:00:00Z').items;
  assert.equal(match('1.0.0-rc.1').length, 1);
  assert.equal(match('1.0.0-rc.2').length, 0);
  assert.equal(match('2.0.1').length, 1);
  assert.equal(match('2.0.2').length, 0);
  assert.deepEqual(match('2.0.1')[0], { id: 'GHSA-example', severity: [{ type: 'CVSS_V3', score: '9.8' }], package: 'a', version: '2.0.1', snapshotDate: '2026-10-23T00:00:00Z' });
  assert.equal(compareAdvisories(match('2.0.1'), match('2.0.2')).removed.length, 1);
  assert.equal(compareAdvisories(match('2.0.2'), match('2.0.1')).added.length, 1);
  const explicit = record([]); explicit.affected[0] = { package: { ecosystem: 'npm', name: 'a' }, versions: ['3.0.0'] };
  assert.equal(matchOsv(parseOsv(JSON.stringify([explicit])).records, supply('3.0.0'), 'date').items.length, 1);
});
test('malformed OSV records and unsupported ranges are refused', () => {
  assert.equal(parseOsv('[{}]').ok, false);
  assert.equal(parseOsv(JSON.stringify([record([{ fixed: 'bad' }])])).ok, false);
  const unsupported = record([]); unsupported.affected[0].ranges[0].type = 'GIT';
  assert.equal(parseOsv(JSON.stringify([unsupported])).ok, false);
});


test('legacy advisory arrays keep missing database provenance unknown at later execution', () => {
  const side = { analysis: { supply: { ...supply('1.0.0'), lockfiles: [{ path: 'package-lock.json' }] } } };
  const result = osvExecution({ reasons: [] }, JSON.stringify([record([{ introduced: '0' }])]),
    { startedAt: '2026-10-23T00:00:00Z' }, { base: side, head: side });
  assert.equal(result.osv.snapshotDate, null);
  assert.equal(result.osv.provenance.state, 'UNKNOWN');
  assert.match(result.osv.provenance.reason, /provenance/);
  assert.equal(result.osv.executedAt, '2026-10-23T00:00:00Z');
  assert.equal(result.osv.items[0].snapshotDate, null);
});

test('invalid frozen database provenance refuses the artifact', () => {
  assert.equal(parseOsv(JSON.stringify({ snapshot: { source: 'osv', exportedAt: 'yesterday' }, records: [] })).ok, false);
  assert.equal(parseOsv(JSON.stringify({ snapshot: { exportedAt: '2020-01-01T00:00:00Z' }, records: [] })).ok, false);
});


test('frozen database timestamps reject nonexistent calendar dates', () => {
  assert.equal(parseOsv(JSON.stringify({ snapshot: { source: 'OSV', exportedAt: '2020-02-31T00:00:00Z' }, records: [] })).ok, false);
});
