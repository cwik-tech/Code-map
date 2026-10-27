// Regression cases found during review against e190759.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateMutants } from '../lib/mutation/generate.mjs';
import { mutationWords, parseStryker, summarizeMutation } from '../lib/mutation/report.mjs';
import { mutationExecution } from '../lib/mutation/verify.mjs';
const item = { status: 'Survived', mutatorName: '<script>[click](https://example.invalid)</script>', location: { start: { line: 1, column: 0 }, end: { line: 2, column: 0 } } };
const text = JSON.stringify({ files: { 'a.ts': { mutants: [item] } } });
test('an exclusive end position does not count a mutant on the next changed line', () => {
  const parsed = parseStryker(text);
  assert.equal(summarizeMutation(parsed.report, new Map([['a.ts', [2]]])).score, null);
});
test('return mutation never generates an identical replacement', () => {
  assert.deepEqual(generateMutants('a.ts', 'function f(): undefined { return undefined; }', [1]), []);
});
test('mutation Markdown escapes untrusted mutator text and limits the section', () => {
  const summary = summarizeMutation(parseStryker(text).report, new Map([['a.ts', [1]]]));
  const words = mutationWords(Array.from({ length: 64 }, () => summary));
  assert.ok(words.length <= 32);
  assert.equal(words.join('\n').includes('<script>'), false);
  assert.equal(words.join('\n').includes('[click]('), false);
});
test('the mutation count limit applies across report inputs', () => {
  const used = { mutants: 0 }, limits = { mutants: 1 };
  const run = { exitStatus: 0, discovery: { scope: 'all' } };
  const first = mutationExecution({ side: 'head', reasons: [] }, text, run, used, limits);
  const second = mutationExecution({ side: 'head', reasons: [] }, text, run, used, limits);
  assert.equal(first.eligible, true);
  assert.notEqual(second.eligible, true);
  assert.equal(second.reasons[0].key, 'parse');
});
test('each comparison and boolean edit has the requested replacement', () => {
  const items = generateMutants('a.ts', 'const a = 1 < 2, b = 1 <= 2, c = 1 === 2, d = 1 !== 2, e = true && false, f = 1 + 2, g = !a;', [1]);
  assert.deepEqual(items.map(({ original, replacement }) => [original, replacement]), [
    ['<', '<='], ['<=', '<'], ['===', '!=='], ['!==', '==='], ['true', 'false'], ['&&', '||'], ['false', 'true'], ['+', '-'], ['!a', 'a'],
  ]);
});

test('a mutant cannot publish a normal test artifact bound to the unchanged head', async (t) => {
  const { project, authorize } = await import('./worker-fixtures.mjs');
  const { runCommand } = await import('../lib/worker/run.mjs');
  const { loadConfig } = await import('../lib/project.mjs');
  const f = project(t), command = [process.execPath, '--test'];
  const authorization = authorize(f, command);
  await assert.rejects(runCommand(f.root, loadConfig(f.root), { authorization, command, store: f.store,
    kind: 'junit', artifact: 'report.xml', mutation: { path: 'src/sum.mjs', start: 0, end: 1, original: 'e', replacement: 'x' } }, { backend: null }), /Mutant runs cannot keep/);
});

test('type-only boolean literals never become runtime mutants', () => {
  assert.deepEqual(generateMutants('a.ts', 'type Flag = true; interface X { flag: false }', [1]), []);
});
