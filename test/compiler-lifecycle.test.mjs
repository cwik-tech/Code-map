import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compilerLifecycle } from '../lib/compiler-lifecycle.mjs';

const diagnostic = (fields = {}) => ({ file: 'src/a.ts', line: 1, column: 2, category: 'error', code: 2322,
  message: "Type 'Old' is not assignable to type 'Target' at line 1, column 2.", ...fields });
const report = (diagnostics, fields = {}) => ({ artifact: 'tsc.txt', diagnostics, errors: diagnostics.length, outside: 0,
  exitStatus: diagnostics.length ? 1 : 0, filtered: false,
  run: { command: ['tsc', '--noEmit', '--pretty', 'false'], workingDirectory: '.', tools: [{ name: 'tsc', version: '6.0.3' }], environment: { policy: 'local' } }, ...fields });
const compare = (base, head, options = {}) => compilerLifecycle({ base, head }, { comparable: true, complete: true, ...options });

test('compiler diagnostics retain fingerprints through renames and normalized type names and coordinates', () => {
  const base = diagnostic(), head = diagnostic({ file: 'src/moved.ts', line: 80, column: 9,
    message: "Type 'New' is not assignable to type 'Other' at line 80, column 9." });
  const result = compare([report([base])], [report([head])], { renames: [{ from: 'src/a.ts', to: 'src/moved.ts', similarity: 100 }] });
  assert.deepEqual(result.counts, { new: 0, existing: 1, resolved: 0, unknown: 0 });
  assert.equal(result.entries[0].baseline, 'EXISTING');
  assert.match(result.entries[0].fingerprint, /^[a-f0-9]{16}$/);
  assert.equal(result.entries[0].fingerprint, compare([report([base])], [report([base])]).entries[0].fingerprint);
  assert.equal(result.entries[0].matchedBy, 'rename');
  assert.equal(result.entries[0].diagnostic.line, 80);
});

test('compiler lifecycle distinguishes new, existing and resolved diagnostic codes', () => {
  const result = compare([report([diagnostic(), diagnostic({ code: 2304 })])], [report([diagnostic(), diagnostic({ code: 2345 })])]);
  assert.deepEqual(result.counts, { new: 1, existing: 1, resolved: 1, unknown: 0 });
  assert.deepEqual(result.entries.map((entry) => [entry.diagnostic.code, entry.baseline]), [[2322, 'EXISTING'], [2345, 'NEW'], [2304, 'RESOLVED']]);
});

for (const [name, base, head, options] of [
  ['head only', [], [report([diagnostic()])], {}],
  ['base only', [report([diagnostic()])], [], {}],
  ['filtered base', [report([], { filtered: true })], [report([diagnostic()])], {}],
  ['different compiler command', [report([], { run: { command: ['other'] } })], [report([diagnostic()])], {}],
  ['incomparable analyses', [report([])], [report([diagnostic()])], { comparable: false }],
  ['incomplete renames', [report([])], [report([diagnostic()])], { complete: false }],
  ['edited move', [report([])], [report([diagnostic()])], { renames: [{ from: 'old.ts', to: 'src/a.ts', similarity: 60 }] }],
  ['outside diagnostics', [report([], { outside: 1 })], [report([diagnostic()])], {}],
]) test(`${name} leaves unmatched diagnostics UNKNOWN`, () => {
  const result = compare(base, head, options);
  assert.deepEqual(result.counts, { new: 0, existing: 0, resolved: 0, unknown: 1 });
  assert.equal(result.entries[0].baseline, 'UNKNOWN');
});

test('duplicate normalized diagnostics remain UNKNOWN instead of inventing individual matches', () => {
  const result = compare([report([diagnostic(), diagnostic({ line: 20 })])], [report([diagnostic()])]);
  assert.deepEqual(result.counts, { new: 0, existing: 0, resolved: 0, unknown: 3 });
});

test('normalization preserves unresolved symbol names and meaningful numeric values', () => {
  const result = compare([report([diagnostic({ code: 2304, message: "Cannot find name 'before'." }),
    diagnostic({ code: 2554, message: 'Expected 1 arguments, but got 2.' })])],
  [report([diagnostic({ code: 2304, message: "Cannot find name 'after'." }),
    diagnostic({ code: 2554, message: 'Expected 1 arguments, but got 3.' })])]);
  assert.deepEqual(result.counts, { new: 2, existing: 0, resolved: 2, unknown: 0 });
});

test('a bound clean head resolves a base diagnostic, while a clean base identifies a new diagnostic', () => {
  assert.deepEqual(compare([report([diagnostic()])], [report([])]).counts, { new: 0, existing: 0, resolved: 1, unknown: 0 });
  assert.deepEqual(compare([report([])], [report([diagnostic()])]).counts, { new: 1, existing: 0, resolved: 0, unknown: 0 });
});

test('equivalent run records ignore JSON object key order', () => {
  const base = report([diagnostic()]), head = report([diagnostic()], { run: {
    environment: { policy: 'local' }, tools: [{ version: '6.0.3', name: 'tsc' }], workingDirectory: '.', command: base.run.command } });
  assert.deepEqual(compare([base], [head]).counts, { new: 0, existing: 1, resolved: 0, unknown: 0 });
});

test('multiline quoted types normalize across compiler continuation lines', () => {
  const result = compare([report([diagnostic({ message: "Type '{\n  before: string;\n}' is not assignable to type 'Target'." })])],
    [report([diagnostic({ message: "Type '{\n  after: number;\n}' is not assignable to type 'Other'." })])]);
  assert.deepEqual(result.counts, { new: 0, existing: 1, resolved: 0, unknown: 0 });
});

test('conflicting rename pairs retain UNKNOWN diagnostic identities', () => {
  const result = compare([report([diagnostic()])], [report([diagnostic({ file: 'moved.ts' })])], {
    renames: [{ from: 'src/a.ts', to: 'moved.ts', similarity: 100 }, { from: 'other.ts', to: 'moved.ts', similarity: 100 }] });
  assert.deepEqual(result.counts, { new: 0, existing: 0, resolved: 0, unknown: 2 });
});
