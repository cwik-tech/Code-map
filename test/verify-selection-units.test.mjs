// Selection boundaries refuse option-like paths and preserve unknown missing outcomes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectedOutcomes, selectedWords } from '../lib/verify-selection.mjs';

const command = { words: ['node', '--test', '{testFiles}'] };
test('derived impact paths cannot become command options', () => {
  assert.throws(() => selectedWords(command, { files: ['--require=evil.test.mjs'] }), /safe relative test path/);
});
test('empty and excessive selections never expand into a runnable command', () => {
  assert.throws(() => selectedWords(command, { files: [] }), /empty/);
  assert.throws(() => selectedWords(command, { files: Array.from({ length: 256 }, (_, index) => `test/${index}.test.mjs`) }), /256 words/);
});
test('missing selected outcomes stay unknown and skipped attempts remain distinct', () => {
  const result = selectedOutcomes({ files: ['test/missing.mjs', 'test/ran.mjs'] }, [{ cases: [
    { file: 'test/ran.mjs', status: 'failed' }, { file: 'test/ran.mjs', status: 'passed' }, { file: 'test/ran.mjs', status: 'skipped' },
  ] }]);
  assert.equal(result.state, 'UNKNOWN');
  assert.deepEqual(result.missing, ['test/missing.mjs']);
  assert.deepEqual(result.files[1], { file: 'test/ran.mjs', cases: 3, passed: 1, failed: 1, skipped: 1 });
});
