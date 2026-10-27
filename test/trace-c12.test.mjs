import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lcovCoverage } from '../lib/changed-coverage.mjs';
test('LCOV retains every branch identity and its individual execution count', () => {
  const report = lcovCoverage('SF:src/a.ts\nBRDA:3,7,0,9\nBRDA:3,7,1,2\nBRDA:4,8,0,-\nend_of_record\n', { repository: '/repo' });
  assert.deepEqual([...report.files.get('src/a.ts').branches], [
    ['3:7:0', { line: 3, taken: 9 }], ['3:7:1', { line: 3, taken: 2 }], ['4:8:0', { line: 4, taken: 0 }],
  ]);
});
