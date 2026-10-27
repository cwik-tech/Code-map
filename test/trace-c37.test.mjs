import assert from 'node:assert/strict';
import { test } from 'node:test';
import { oracleProvenance } from '../lib/provenance.mjs';
import { scanText } from '../lib/assertion-compare.mjs';
import { project, outcome, junit, header, caseText } from './oracle-fixtures.mjs';

function provenance(t) {
  const file = 'test/login.test.ts', name = '[AC:login] signs in';
  const f = project(t);
  f.put(file, header + caseText(name));
  f.put('src/login.ts', 'export function login(name: string) { return name.trim(); }\n');
  const sha = f.commit('trim login');
  const input = junit(f, 'head', { sha, cases: [{ file, name, status: 'passed' }] });
  return outcome(f.verify(f.request({ reportInputs: [input], acceptanceCriteria: [{ id: 'login', text: 'Trim names.' }] })), 3).results.provenance;
}

// Assertions retain unconfirmed trust even when their case names a criterion.
test('assertion provenance links the associated implementation change',
  (t) => {
    const value = provenance(t);
    const [entry] = value.assertions ?? [];
    assert.ok(entry.implementationChanges.includes('src/login.ts'));
    assert.ok(!entry.implementationChanges.includes('test/login.test.ts'));
    assert.equal(entry.author, 'test');
    assert.match(entry.commit, /^[a-f0-9]{40}$/);
    assert.equal(entry.line, 4);
    assert.equal(entry.trust, 'unconfirmed');
  });
test('assertion provenance identifies its originating specification',
  (t) => {
    const value = provenance(t);
    assert.ok((value.assertions ?? []).some((entry) => entry.specification === 'login'));
  });

function direct(f, files, worktree = false) {
  const cases = Object.entries(files).flatMap(([path, text]) => scanText(path, text).map((entry) => ({ ...entry, path })));
  return oracleProvenance(f.root, { request: { acceptanceCriteria: [{ id: 'login', text: 'Trim names.' }] },
    reports: [{ artifact: 'report.xml', cases: cases.map((entry) => ({ file: entry.path, name: entry.name, status: 'passed' })) }],
    head: { sha: f.git('rev-parse', 'HEAD'), worktree, analysis: { tests: { cases } } },
    base: { sha: f.git('rev-parse', 'base'), worktree: false, analysis: { tests: { cases: [] } } },
    change: { files: [], paths: [] } }).section;
}

test('assertion provenance attributes earlier commits and leaves working edits unconfirmed', (t) => {
  const file = 'test/login.test.ts', original = header + caseText('[AC:login] signs in');
  const f = project(t);
  f.put(file, original);
  f.put('src/login.ts', 'export function login(name: string) { return name.trim(); }\n');
  const origin = f.commit('original assertion');
  f.put('src/later.ts', 'export const later = true;\n');
  f.commit('later implementation');
  const [before] = direct(f, { [file]: original }).assertions;
  assert.equal(before.commit, origin);
  assert.deepEqual(before.implementationChanges, ['src/login.ts']);
  const edited = header + caseText('unlinked case', 'b');
  f.put(file, edited);
  const [after] = direct(f, { [file]: edited }, true).assertions;
  assert.equal(after.commit, null);
  assert.equal(after.author, null);
  assert.equal(after.specification, null);
  assert.equal(after.trust, 'unconfirmed');
  assert.deepEqual(after.implementationChanges, []);
  assert.match(after.reason, /uncommitted/);
});

test('assertion provenance discloses assertion and file limits', (t) => {
  const file = 'test/many.test.ts', text = `test('many', () => { ${'expect(1).toBe(1);'.repeat(201)} });`;
  const f = project(t);
  f.put(file, text);
  f.commit('many assertions');
  const count = direct(f, { [file]: text });
  assert.equal(count.assertions.length, 200);
  assert.equal(count.assertionsTruncated, true);
  const files = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`test/case-${index}.test.ts`, caseText('one')]));
  for (const [path, value] of Object.entries(files)) f.put(path, value);
  f.commit('many files');
  const bounded = direct(f, files);
  assert.equal(bounded.assertions.length, 20);
  assert.equal(bounded.assertionsTruncated, true);
  assert.deepEqual(bounded.assertionLimits, { assertions: 200, files: 20, implementationFiles: 50 });
});
