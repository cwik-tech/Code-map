import assert from 'node:assert/strict';
import { test } from 'node:test';
import { osvExecution } from '../lib/supply/osv.mjs';
import { readSupply } from '../lib/supply/lockfile.mjs';

test('frozen advisories retain their database timestamp on matched packages and changed risk', () => {
  const inventory = (version) => readSupply(['package-lock.json'], new Map([['package-lock.json', JSON.stringify({ lockfileVersion: 3,
    packages: { 'node_modules/a': { version, resolved: `https://registry.npmjs.org/a/-/a-${version}.tgz` } } })]]));
  const snapshotDate = '2020-01-01T00:00:00Z';
  const snapshot = JSON.stringify({ snapshot: { source: 'OSV frozen export', exportedAt: snapshotDate }, records: [
    { id: 'OSV-trace', severity: [{ type: 'CVSS_V3', score: '9.8' }], affected: [{ package: { ecosystem: 'npm', name: 'a' },
      ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '2.0.0' }] }] }] },
  ] });
  const result = osvExecution({ reasons: [] }, snapshot, { startedAt: '2026-10-23T00:00:00Z' }, {
    base: { analysis: { supply: inventory('2.0.0') } }, head: { analysis: { supply: inventory('1.0.0') } },
  });
  const expected = { id: 'OSV-trace', severity: [{ type: 'CVSS_V3', score: '9.8' }], package: 'a', version: '1.0.0', snapshotDate };
  assert.equal(result.eligible, true);
  assert.deepEqual(result.osv.items, [expected]);
  assert.deepEqual(result.osv.provenance, { state: 'KNOWN', source: 'OSV frozen export', snapshotDate });
  assert.equal(result.osv.executedAt, '2026-10-23T00:00:00Z');
  assert.deepEqual(result.osv.comparison, { added: [expected], removed: [] });
});
