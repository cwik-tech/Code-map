import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareBench, timingStatistics } from '../lib/bench-report.mjs';

test('controlled timing comparisons refuse different tools or sandbox environments', () => {
  const report = (run) => ({ command: ['node', 'probe.mjs'], samples: [100, 101, 99], warmup: 1,
    statistics: timingStatistics([100, 101, 99]), machine: { id: 'same', node: '24' },
    loadBefore: [1, 1, 1], loadAfter: [1, 1, 1], run });
  const baseline = report({ tools: [{ name: 'node', version: '24' }], environment: { policy: 'isolated' } });
  const compare = (head) => compareBench({ base: [baseline], head: [head] });
  assert.equal(compare(structuredClone(baseline)).state, 'COMPARED');
  const changedTool = report({ tools: [{ name: 'node', version: '22' }], environment: { policy: 'isolated' } });
  assert.deepEqual(compare(changedTool), { state: 'UNKNOWN', reason: 'Benchmark tools or sandbox environments differ.' });
  const changedEnvironment = report({ tools: [{ name: 'node', version: '24' }], environment: { policy: 'local' } });
  assert.deepEqual(compare(changedEnvironment), { state: 'UNKNOWN', reason: 'Benchmark tools or sandbox environments differ.' });
});
