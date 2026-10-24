// Pure failure decisions do not require an unkillable operating-system process.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runProblems } from '../lib/worker/outcome.mjs';

const result = () => ({ stoppedBy: null, error: null, processes: { started: [123], remaining: [] } });

test('a surviving process fails the run even without a sampler error', () => {
  assert.deepEqual(runProblems({ ...result(), processes: { started: [123], remaining: [123] } }, {}),
    ['Processes of the run remain: 123. Code-map refuses artifact collection.']);
});

test('a process check error fails the record and an ordinary nonzero command exit does not', () => {
  assert.deepEqual(runProblems({ ...result(), error: new Error('process check failed') }, {}), ['process check failed']);
  assert.deepEqual(runProblems({ ...result(), exitStatus: 3 }, {}), []);
});

test('a disk stop fails the record and names its sampled budget', () => {
  assert.deepEqual(runProblems({ ...result(), stoppedBy: 'diskMegabytes' }, { diskMegabytes: 2 }),
    ['The disk budget of 2 MB (a sampled limit) stopped the run, so Code-map keeps no artifact.']);
});
