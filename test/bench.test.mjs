// Fixed statistics and bounded timing comparisons.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { timingStatistics, compareBench, validateBench, timingOptions, benchInformation } from '../lib/bench-report.mjs';

const machine = { id: 'a'.repeat(64), cpuModel: 'test CPU', cpuCount: 4, platform: 'darwin', architecture: 'arm64', node: '24.0.0' };
const report = (samples, extra = {}) => ({ reportType: 'code-map-bench', schemaVersion: 1, command: ['node', 'test.mjs'],
  warmup: 1, warmupSamples: [1000], samples, statistics: timingStatistics(samples), machine, loadBefore: [1, 1, 1], loadAfter: [1, 1, 1], ...extra });
const compare = (base, head, options) => compareBench({ base: [base], head: [head] }, options);

test('computes median, median absolute deviation and minimum without changing samples', () => {
  const samples = [9, 1, 5, 3];
  assert.deepEqual(timingStatistics(samples), { medianMs: 4, madMs: 2, minimumMs: 1 });
  assert.deepEqual(samples, [9, 1, 5, 3]);
  assert.deepEqual(timingStatistics([Number.MIN_VALUE, Number.MIN_VALUE]), { medianMs: Number.MIN_VALUE, madMs: 0, minimumMs: Number.MIN_VALUE });
  assert.deepEqual(timingStatistics([5]), { medianMs: 5, madMs: 0, minimumMs: 5 });
  assert.throws(() => timingStatistics([]), /samples/);
  assert.throws(() => timingStatistics([NaN]), /samples/);
});

test('retains changes inside combined noise and requires a strict threshold', () => {
  const result = compare(report([80, 100, 120]), report([100, 120, 140]));
  assert.equal(result.state, 'COMPARED');
  assert.equal(result.changePercent, 20);
  assert.equal(result.noiseMs, 120);
  assert.equal(result.outsideNoise, false);
  assert.equal(compare(report([100, 100, 100]), report([110, 110, 110])).outsideNoise, false);
});

test('reports a slower or faster median outside noise and above the configured minimum', () => {
  assert.equal(compare(report([99, 100, 101]), report([129, 130, 131])).outsideNoise, true);
  assert.equal(compare(report([99, 100, 101]), report([69, 70, 71])).changePercent, -30);
  assert.equal(compare(report([100, 100, 100]), report([105, 105, 105])).outsideNoise, false);
  assert.equal(compare(report([100, 100, 100]), report([105, 105, 105]), { minimumChangePercent: 2 }).outsideNoise, true);
});

test('returns UNKNOWN for load drift within or between measurements', () => {
  assert.equal(compare(report([100]), report([130], { loadAfter: [3, 1, 1] })).state, 'UNKNOWN');
  assert.equal(compare(report([100]), report([130], { loadBefore: [3, 1, 1], loadAfter: [3, 1, 1] })).state, 'UNKNOWN');
});

test('requires the same command, machine, sample count, warmup and environment', () => {
  assert.equal(compare(report([100]), report([130], { command: ['other'] })).state, 'UNKNOWN');
  assert.equal(compare(report([100]), report([130], { machine: { ...machine, id: 'b'.repeat(64) } })).state, 'UNKNOWN');
  assert.equal(compare(report([100]), report([130], { machine: { ...machine, node: '22' } })).state, 'UNKNOWN');
  assert.equal(compare(report([100]), report([130, 130])).state, 'UNKNOWN');
  assert.equal(compare(report([100]), report([130], { warmup: 0 })).state, 'UNKNOWN');
  assert.equal(compare(report([0]), report([1])).state, 'UNKNOWN');
  assert.equal(compareBench({ base: [], head: [] }), null);
  assert.equal(compareBench({ base: [], head: [report([1])] }).state, 'UNKNOWN');
  assert.equal(compareBench({ base: [report([1])], head: [report([1]), report([1])] }).state, 'UNKNOWN');
});

test('validates imported reports and recomputes their statistics', () => {
  assert.equal(validateBench(report([1, 2, 3])).ok, true);
  assert.equal(validateBench(report([1], { statistics: { medianMs: 20, madMs: 0, minimumMs: 1 } })).ok, false);
  assert.equal(validateBench(report([1], { samples: [-1] })).ok, false);
  assert.equal(validateBench(report([1], { loadBefore: [1] })).ok, false);
  assert.equal(validateBench(report([1], { warmup: 101 })).ok, false);
  assert.equal(validateBench(report([1], { machine: null })).ok, false);
  assert.equal(validateBench(report([1], { warmupSamples: [] })).ok, false);
  assert.equal(validateBench(report([1], { warmupSamples: [-1] })).ok, false);
});

test('validates timing settings instead of silently ignoring mistakes', () => {
  assert.deepEqual(timingOptions(), { minimumChangePercent: 10, maximumLoadChange: 1 });
  assert.throws(() => timingOptions({ minimumChangePercent: -1 }), /timings/);
  assert.throws(() => timingOptions({ maximumLoadChange: '1' }), /timings/);
  assert.throws(() => timingOptions({ extra: true }), /timings/);
});


test('accepts empty command arguments and rejects an invalid executable', () => {
  assert.equal(validateBench(report([1], { command: ['node', '-e', ''] })).ok, true);
  assert.equal(validateBench(report([1], { command: ['-invalid'] })).ok, false);
});

test('returns UNKNOWN when imported samples overflow the comparison arithmetic', () => {
  assert.equal(compare(report([Number.MIN_VALUE]), report([Number.MAX_VALUE])).state, 'UNKNOWN');
  assert.equal(compare(report([0, Number.MAX_VALUE]), report([0, Number.MAX_VALUE])).state, 'UNKNOWN');
});

test('refuses a report whose command or runtime disagrees with its manifest', () => {
  const value = report([1]), manifest = { command: ['other'], exitStatus: 0, discovery: { filters: [] }, environment: { node: '24.0.0', platform: 'darwin' } };
  assert.equal(benchInformation(JSON.stringify(value), manifest).ok, false);
  assert.equal(benchInformation(JSON.stringify(value), { ...manifest, command: value.command, environment: { node: '22', platform: 'darwin' } }).ok, false);
  assert.equal(benchInformation(JSON.stringify(value), { ...manifest, command: value.command, exitStatus: 1 }).ok, false);
});
