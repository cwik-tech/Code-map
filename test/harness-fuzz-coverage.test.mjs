// Real subprocess coverage and deterministic corpus feedback.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { retainCoverage } from '../lib/harness/corpus.mjs';
import { coverageBlocks, validBlockCoverage } from '../lib/harness/coverage.mjs';
import { generate, seeded } from '../lib/harness/generator.mjs';
import { mutate } from '../lib/harness/corpus.mjs';
import { harnessInformation } from '../lib/harness/report.mjs';
const schema = { type: 'integer', min: 0, max: 100 };
const empty = () => ({ guidance: 'v8-block-and-outcome', size: 0, classes: [], seeds: [], mutations: 0, blocks: [] });
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'fuzz-coverage-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'helper.mjs'), 'export const helper = x => x + 1;');
  writeFileSync(join(root, 'subject.mjs'), `import { helper } from './helper.mjs';
export function subject(x) { helper(x); if (x === 42) { return 'rare'; } return 'common'; }
export function crash() { throw new TypeError('bad'); }`);
  return root;
}
function call(root, input, name = 'subject') {
  const spec = { mode: 'fuzz', subject: { file: 'subject.mjs', export: name } };
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('../lib/harness/call.mjs', import.meta.url))],
    { cwd: root, input: JSON.stringify({ spec, input }), encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'] });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.output[3]);
}
test('each call measures only executed blocks in the subject file, including thrown calls', (t) => {
  const root = fixture(t), common = call(root, 0), rare = call(root, 42), crash = call(root, 0, 'crash');
  assert.equal(common.status, 'returned');
  assert.ok(common.coverage.blocks.length > 0);
  assert.ok(rare.coverage.blocks.some((block) => !common.coverage.blocks.includes(block)));
  assert.ok(common.coverage.blocks.every((block) => block.startsWith('subject.mjs:')));
  assert.equal(crash.status, 'threw');
  assert.ok(crash.coverage.blocks.length > 0);
  assert.deepEqual(call(root, 0).coverage, common.coverage);
});
test('coverage retains a seed with the same outcome when it adds an executed block', () => {
  const result = blocks => ({ status: 'returned', output: 1, coverage: { blocks } });
  const first = retainCoverage(empty(), 1, result(['subject.mjs:0:10']));
  const second = retainCoverage(first, 2, result(['subject.mjs:0:10', 'subject.mjs:4:8']));
  assert.equal(second.size, 2);
  assert.equal(second.classes.length, 1);
  assert.equal(retainCoverage(second, 3, result(['subject.mjs:4:8'])).size, 2);
  assert.equal(first.size, 1);
  assert.equal(retainCoverage(second, 4, { status: 'threw', error: { name: 'TypeError' }, coverage: { blocks: [] } }).size, 3);
});
test('fixed seed replays coverage guidance and records guided and unguided rare-branch counts', (t) => {
  const root = fixture(t);
  const run = guided => {
    const random = seeded(21), inputs = [], hits = [], blocks = new Set();
    let corpus = empty();
    for (let index = 0; index < 8; index++) {
      const input = guided && corpus.size && index % 2 === 1
        ? mutate(schema, corpus.seeds[Math.floor(random() * corpus.size)].input, random) : generate(schema, random);
      const result = call(root, input);
      inputs.push(input); hits.push(result.output === 'rare');
      result.coverage.blocks.forEach(block => blocks.add(block));
      corpus = retainCoverage(corpus, input, result);
    }
    return { inputs, hits, blocks: [...blocks], seeds: corpus.seeds };
  };
  const guided = run(true), unguided = run(false);
  assert.deepEqual(run(true), guided);
  t.diagnostic(JSON.stringify({ budgetCalls: 8, guidedRare: guided.hits.filter(Boolean).length,
    unguidedRare: unguided.hits.filter(Boolean).length, guidedBlocks: guided.blocks.length, unguidedBlocks: unguided.blocks.length }));
  assert.ok(guided.hits.includes(true));
  assert.equal(unguided.hits.includes(true), false);
  assert.ok(guided.blocks.length > unguided.blocks.length);
});
test('coverage filters unexecuted ranges and rejects malformed or oversized block lists', () => {
  const functions = [{ ranges: [{ startOffset: 0, endOffset: 10, count: 1 }, { startOffset: 3, endOffset: 5, count: 0 }] }];
  assert.deepEqual(coverageBlocks([{ url: 'file:///subject.mjs', functions }], 'file:///subject.mjs', 'subject.mjs'), ['subject.mjs:0:3', 'subject.mjs:5:10']);
  assert.equal(validBlockCoverage({ blocks: ['../subject.mjs:0:10'] }), false);
  assert.equal(validBlockCoverage({ blocks: ['subject.mjs:10:1'] }), false);
  assert.equal(validBlockCoverage({ blocks: Array(10001).fill('subject.mjs:0:1') }), false);
  assert.match(readFileSync(new URL('../docs/harness.md', import.meta.url), 'utf8'), /[Bb]lock coverage is not path coverage/);
});
test('verify exposes coverage progress as information and rejects malformed metadata', () => {
  const corpus = retainCoverage(empty(), 1, { status: 'returned', output: 1, coverage: { blocks: ['subject.mjs:0:10'] } });
  const report = { reportType: 'code-map-harness', harnessVersion: 1, mode: 'fuzz', finite: true, seed: 1, executed: 1,
    calls: [{ side: 'head', input: 1, result: { status: 'returned', output: 1, durationMs: 1, coverage: { blocks: ['subject.mjs:0:10'] } } }], failures: [], corpus,
    coverage: { measure: 'v8-block', coveredBlocks: 1, history: [{ call: 1, elapsedMs: 1, coveredBlocks: 1, corpusSize: 1 }],
      note: 'Block coverage is not path coverage.' } };
  assert.deepEqual(harnessInformation(JSON.stringify(report)).information.coverage, report.coverage);
  report.coverage.history[0].coveredBlocks = -1;
  assert.match(harnessInformation(JSON.stringify(report)).error, /coverage/);
});

test('legacy reports keep their output shape and strict outcome corpus validation', () => {
  const report = { reportType: 'code-map-harness', harnessVersion: 1, mode: 'fuzz', finite: true,
    seed: 1, executed: 0, calls: [], failures: [] };
  assert.equal(Object.hasOwn(harnessInformation(JSON.stringify(report)).information, 'coverage'), false);
  const corpus = { guidance: 'outcome', size: 2, classes: ['one'], seeds: [{ input: 1, outcome: 'one' }, { input: 2, outcome: 'one' }], mutations: 0 };
  assert.match(harnessInformation(JSON.stringify({ ...report, corpus })).error, /corpus/);
  corpus.classes = ['one', 'two'];
  assert.match(harnessInformation(JSON.stringify({ ...report, corpus })).error, /corpus/);
});
test('coverage guidance requires progress backed by measured call blocks', () => {
  const corpus = retainCoverage(empty(), 1, { status: 'returned', output: 1, coverage: { blocks: ['subject.mjs:0:10'] } });
  const report = { reportType: 'code-map-harness', harnessVersion: 1, mode: 'fuzz', finite: true, seed: 1, executed: 1,
    calls: [{ side: 'head', input: 1, result: { status: 'returned', output: 1, durationMs: 1 } }], failures: [], corpus };
  assert.match(harnessInformation(JSON.stringify(report)).error, /coverage/);
  report.coverage = { measure: 'v8-block', coveredBlocks: 1,
    history: [{ call: 1, elapsedMs: 1, coveredBlocks: 1, corpusSize: 1 }], note: 'Block coverage is not path coverage.' };
  assert.match(harnessInformation(JSON.stringify(report)).error, /coverage/);
  report.calls[0].result.coverage = { blocks: ['other.mjs:0:10'] };
  assert.match(harnessInformation(JSON.stringify(report)).error, /coverage/);
});
