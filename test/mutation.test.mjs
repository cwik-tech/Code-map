import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStryker, summarizeMutation } from '../lib/mutation/report.mjs';
import { generateMutants, sampleMutants } from '../lib/mutation/generate.mjs';

const mutant = (status, line = 2) => ({ id: status, status, mutatorName: 'BooleanLiteral', location: { start: { line, column: 0 }, end: { line, column: 4 } } });
test('validates Stryker reports and rejects invalid or oversized input', () => {
  assert.equal(parseStryker(JSON.stringify({ files: { 'src/a.ts': { mutants: [mutant('Killed')] } } })).ok, true);
  assert.equal(parseStryker('{').ok, false);
  assert.equal(parseStryker('{"files":{"../a":{"mutants":[]}}}').ok, false);
  assert.equal(parseStryker(JSON.stringify({ files: { a: { mutants: [mutant('Wrong')] } } })).ok, false);
  assert.equal(parseStryker(' '.repeat(11), { maxBytes: 10 }).ok, false);
});
test('counts only changed mutants and keeps survivors as leads', () => {
  const parsed = parseStryker(JSON.stringify({ files: { 'a.ts': { mutants: [mutant('Killed'), mutant('Survived'), mutant('Timeout'), mutant('NoCoverage'), mutant('CompileError'), mutant('Ignored'), mutant('Killed', 8)] } } }));
  const summary = summarizeMutation(parsed.report, new Map([['a.ts', [2]]]));
  assert.equal(summary.score, 50);
  assert.deepEqual(summary.counts, { killed: 1, survived: 1, timeout: 1, noCoverage: 1, compileError: 1, ignored: 1, error: 0, equivalentCandidate: 0, ordinarySurvived: 1 });
  assert.equal(summary.survivors[0].line, 2);
  assert.match(summary.note, /equivalent/i);
});
test('generates each supported mutation only on changed lines', () => {
  const source = 'const untouched = false;\nfunction f(a: number, b: number): number | undefined { if (a < b && true) return a + b; return !false ? 1 : 2; }\nconst x = 1 <= 2; const y = 1 === 2; const z = 1 !== 2;';
  const items = generateMutants('a.ts', source, [2, 3]);
  assert.deepEqual(new Set(items.map((item) => item.mutatorName)), new Set(['Comparison', 'BooleanLiteral', 'LogicalOperator', 'ArithmeticOperator', 'UnaryNot', 'ReturnUndefined']));
  assert.ok(items.every((item) => item.location.start.line > 1));
  assert.equal(generateMutants('a.ts', 'function f(): number { return 1; }', [1]).some((item) => item.mutatorName === 'ReturnUndefined'), false);
  assert.equal(generateMutants('a.ts', 'const s = "a" + "b";', [1]).length, 0);
  assert.deepEqual(sampleMutants(items, 3, 42), sampleMutants(items, 3, 42));
  assert.equal(sampleMutants(items, 3, 42).length, 3);
});

test('rejects edits through symlinks and changed source bytes', async (t) => {
  const { project } = await import('./worker-fixtures.mjs');
  const { applyMutation } = await import('../lib/mutation/edit.mjs');
  const { symlinkSync } = await import('node:fs');
  const { join } = await import('node:path');
  const f = project(t);
  symlinkSync('src/sum.mjs', join(f.root, 'link.mjs'));
  assert.throws(() => applyMutation(f.root, { path: 'link.mjs', start: 0, end: 1, original: 'e', replacement: 'x' }), /symlink/);
  assert.throws(() => applyMutation(f.root, { path: 'src/sum.mjs', start: 0, end: 1, original: 'z', replacement: 'x' }), /source changed/);
});

test('distinguishes compile errors from failed test commands', async () => {
  const { mutationCompileError } = await import('../lib/mutation/generate.mjs');
  assert.equal(mutationCompileError('a.ts', 'const x: number = 1;', { start: 18, end: 19, replacement: 'false' }), true);
  assert.equal(mutationCompileError('a.ts', 'const x: number = 1;', { start: 18, end: 19, replacement: '2' }), false);
});

test('compiler equivalence removes erased declarations and preserves runtime changes', async () => {
  const { equivalentCandidate } = await import('../lib/mutation/generate.mjs');
  const source = 'declare const unused = true;\nexport const flag = true;\n';
  const edits = generateMutants('a.ts', source, [1, 2]);
  assert.match(equivalentCandidate('a.ts', source, edits[0]).reason, /identical.*TypeScript/i);
  assert.equal(equivalentCandidate('a.d.ts', source, edits[0]), null);
  assert.equal(equivalentCandidate('a.d.mts', source, edits[0]), null);
  assert.equal(equivalentCandidate('a.ts', source, edits[1]), null);
  assert.equal(equivalentCandidate('a.ts', source, { start: 0, end: source.length, replacement: 'const = ;' }), null);
  const literal = 'export const value = "a  b";';
  assert.equal(equivalentCandidate('a.ts', literal, { start: 0, end: literal.length, replacement: 'export const value = "a b";' }), null);
  assert.ok(equivalentCandidate('a.ts', literal, { start: 0, end: literal.length, replacement: '/* comment */ export  const value="a  b";\n' }));
});

test('candidate metadata is validated and never discounts the mutation score', () => {
  const candidate = { ...mutant('Survived'), equivalentCandidate: { reason: 'Identical emitted code.' } };
  const read = (items) => parseStryker(JSON.stringify({ files: { 'a.ts': { mutants: items } } }));
  const summary = summarizeMutation(read([mutant('Killed'), mutant('Timeout'), mutant('Survived'), candidate, mutant('NoCoverage')]).report, new Map([['a.ts', [2]]]));
  assert.equal(summary.score, 40);
  assert.equal(summary.counts.survived, 2);
  assert.equal(summary.counts.ordinarySurvived, 1);
  assert.equal(summary.counts.equivalentCandidate, 1);
  assert.equal(summary.survivors.length, 2);
  assert.equal(summary.equivalentCandidates[0].reason, candidate.equivalentCandidate.reason);
  assert.equal(summarizeMutation(read([candidate]).report, new Map([['a.ts', [3]]])).counts.equivalentCandidate, 0);
  assert.equal(read([{ ...candidate, status: 'Killed' }]).ok, false);
  assert.equal(read([{ ...candidate, equivalentCandidate: null }]).ok, false);
  assert.equal(read([{ ...candidate, equivalentCandidate: { reason: '' } }]).ok, false);
  assert.equal(read([{ ...candidate, equivalentCandidate: { reason: 7 } }]).ok, false);
  assert.equal(read([{ ...candidate, equivalentCandidate: { reason: ' '.repeat(3) } }]).ok, false);
  assert.equal(read([{ ...candidate, equivalentCandidate: { reason: 'x'.repeat(2001) } }]).ok, false);
});
