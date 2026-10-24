// The adapter for the test inventory that a runner discovers without a run (C10): `vitest list --json` (kind vitest-list)
// and `jest --listTests --json` (kind jest-list). The input is untrusted: a wrong shape or a large input never throws.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTestList, supportedProducers } from '../lib/adapters/test-list.mjs';

const repository = '/work/app';
const vitest = (entries, options = {}) => parseTestList(JSON.stringify(entries), { format: 'vitest-list', repository, ...options });
const jest = (entries, options = {}) => parseTestList(JSON.stringify(entries), { format: 'jest-list', repository, ...options });

test('a vitest list gives the discovered test files and cases, with absolute paths or paths relative to the working directory', () => {
  const parsed = vitest([{ name: 'sum > adds', file: '/work/app/test/sum.test.ts', projectName: 'unit' }, { name: 'sum > adds', file: '/work/app/test/sum.test.ts', projectName: 'unit' },
    { name: 'parses', file: 'b.test.ts', location: { line: 3, column: 1 } }, { name: 'elsewhere', file: '/other/x.test.ts' }], { workingDirectory: 'packages/web' });
  assert.equal(parsed.ok, true, parsed.error);
  assert.deepEqual(parsed.report, { format: 'vitest-list', files: ['packages/web/b.test.ts', 'test/sum.test.ts'], outside: 1,
    cases: [{ file: 'test/sum.test.ts', name: 'sum > adds' }, { file: 'test/sum.test.ts', name: 'sum > adds' }, { file: 'packages/web/b.test.ts', name: 'parses' }] });
  const linked = parseTestList(JSON.stringify([{ name: 'adds', file: '/real/app/test/sum.test.ts' }]), { format: 'vitest-list', repository, real: (path) => path.replace('/real/', '/work/') });
  assert.deepEqual(linked.report.files, ['test/sum.test.ts'], 'an absolute path counts after its links resolve');
  const seen = [], failing = parseTestList(JSON.stringify(['/elsewhere/a.test.js', `/x${'/a'.repeat(20000)}`]), { format: 'jest-list', repository,
    real: (path) => { seen.push(path.length); throw new Error('no such file'); } });
  assert.deepEqual([failing.ok, failing.report.outside, seen], [true, 2, [20]], 'an error of real keeps the path, and real never sees a path longer than 4096 characters');
  const filesOnly = vitest([{ file: '/work/app/test/sum.test.ts' }, { file: '/work/app/test/a.test.ts', projectName: 'unit' }]);
  assert.deepEqual(filesOnly.report, { format: 'vitest-list', files: ['test/a.test.ts', 'test/sum.test.ts'], cases: null, outside: 0 }, 'vitest list --filesOnly gives no cases');
  assert.deepEqual(vitest([]).report, { format: 'vitest-list', files: [], cases: [], outside: 0 });
});

test('the adapter declares its producers', () => {
  assert.deepEqual(supportedProducers.map((item) => item.name), ['vitest list --json', 'jest --listTests --json', 'playwright test --list --reporter=json', 'mocha --dry-run --reporter json']);
});

test('a jest list gives the discovered test files', () => {
  const parsed = jest(['/work/app/src/a.test.js', '/work/app/src/a.test.js', 'test/b.test.js', '/tmp/c.test.js'], { workingDirectory: '.' });
  assert.deepEqual(parsed, { ok: true, report: { format: 'jest-list', files: ['src/a.test.js', 'test/b.test.js'], cases: null, outside: 1 } });
  assert.deepEqual(parseTestList('﻿["/work/app/x.test.js"]\n', { format: 'jest-list', repository }).report.files, ['x.test.js'], 'a byte order mark and a line break are allowed');
});

test('an invalid list is refused with a reason', () => {
  const refused = [
    [parseTestList('PASS test/a.test.ts', { format: 'vitest-list', repository }), /not valid JSON/],
    [vitest({ files: [] }), /must be a JSON array/],
    [vitest([{ name: 'a' }]), /\[0\]\.file: Must be a non-empty string/],
    [vitest([{ name: 7, file: 'a.test.ts' }]), /\[0\]\.name: Must be a string/],
    [vitest([{ file: 'a.test.ts', projectName: 1 }]), /\[0\]\.projectName: Must be a string/],
    [vitest(['a.test.ts']), /\[0\]: Must be an object/],
    [vitest([{ name: 'a', file: 'a.test.ts' }, { file: 'b.test.ts' }]), /Either every entry or no entry has a name/],
    [vitest([{ name: 'a', file: 'a\0.test.ts' }]), /\[0\]\.file: Must be a non-empty string/],
    [jest([{ file: 'a.test.js' }]), /\[0\]: Must be a non-empty string/],
    [parseTestList('[]', { format: 'unknown-list', repository }), /format must be vitest-list/],
    [parseTestList('[]', { format: 'jest-list', repository: 'relative' }), /repository must be an absolute path/],
    [parseTestList(7, { format: 'jest-list', repository }), /must be text/],
  ];
  for (const [parsed, pattern] of refused) {
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, pattern);
  }
});

test('a list that is too large is refused', () => {
  const big = JSON.stringify(Array.from({ length: 50 }, (_, index) => `/work/app/test/${index}.test.js`));
  assert.match(parseTestList(big, { format: 'jest-list', repository, maxBytes: 100 }).error, /larger than 100 bytes/);
  assert.match(parseTestList(big, { format: 'jest-list', repository, maxEntries: 10 }).error, /more than 10 entries/);
  assert.equal(parseTestList(big, { format: 'jest-list', repository, maxEntries: 50 }).report.files.length, 50);
  assert.match(vitest(Array.from({ length: 11 }, (_, index) => ({ name: `t${index}`, file: 'a.test.ts' })), { maxEntries: 10 }).error, /more than 10 entries/);
});
