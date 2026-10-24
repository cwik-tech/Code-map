import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { oracleDigest } from '../lib/oracles.mjs';
import { authorize, budgets, project, sandboxed } from './worker-fixtures.mjs';
import { fileURLToPath } from 'node:url';

function generated(t, invalid = false, typed = null) {
  const f = project(t), file = typed ? 'test/generated.test.ts' : 'test/generated.test.mjs', name = '[AC:edge] accepts edge';
  f.put('src/check.mjs', 'export function check(x) { return x < 2; }\n');
  f.git('add', '.'); f.git('commit', '-qm', 'bug'); f.git('tag', '-f', 'base');
  f.put('src/check.mjs', 'export function check(x) { return x <= 2; }\n');
  const text = invalid ? 'const value: number = "wrong";\n' :
    `import { describe, it } from 'node:test'; import assert from 'node:assert/strict'; import { check } from '../src/check.mjs';\ndescribe('generated', () => it('${name}', () => assert.equal(check(2), true)));\n`;
  if (typed) {
    f.put('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, module: 'NodeNext', types: ['node'] }, include: ['test'] }));
    if (typed !== 'node') {
      f.put('node_modules/tiny/package.json', '{"name":"tiny","type":"module","types":"index.d.ts","main":"index.mjs"}');
      f.put('node_modules/tiny/index.d.ts', 'export function accepts(value: number): unknown;');
      f.put('node_modules/tiny/index.mjs', 'export function accepts(value) { return value; }');
      f.put('node_modules/@types/node/index.d.ts', 'declare module "node:test" { export function describe(name: string, fn: () => void): void; export function it(name: string, fn: () => void): void; } declare module "node:assert/strict" { const assert: { equal(a: unknown, b: unknown): void }; export default assert; }');
    }
  }
  const content = typed && typed !== 'node' ? `import { accepts } from 'tiny';\n${text}\naccepts(${typed === 'wrong' ? "'wrong'" : '1'});\n` : text;
  f.put(file, content);
  f.put('.code-map/oracles.json', JSON.stringify({ oracleVersion: 1, entries: [{ file, suite: 'generated', name, criterion: 'edge',
    digest: oracleDigest(content), method: 'Fixture boundary independently specified.', confirmedBy: 'Fixture reviewer', date: '2026-10-23' }] }));
  f.git('add', '.'); f.git('commit', '-qm', 'head');
  const words = [process.execPath, '--test', '--test-reporter=junit', '--test-reporter-destination=junit.xml'];
  const request = { requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base', head: 'HEAD', intent: 'Accept the edge.',
    acceptanceCriteria: [{ id: 'edge', text: 'Accept 2.' }], allowedPaths: null, changeType: 'fix', profileId: 'evidence-v1',
    ratingRulesVersion: 'ratings-v1', reportInputs: [], generatedTests: [{ file, name, mutationAuthorization: authorize(f, [...words, file]) }],
    execution: { enabled: true, authorization: authorize(f, words), budgets,
      commands: [{ id: 'tests', words, generatedTestWords: [...words, '{testFile}'], kind: 'junit', artifact: 'junit.xml', sides: ['head'] }] } };
  const path = join(f.work, 'request.json'); writeFileSync(path, JSON.stringify(request));
  const output = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url)), 'verify', '--request', path, '--store', f.store],
    { cwd: f.root, encoding: 'utf8', timeout: 60000 });
  assert.ok([0, 1, 2, 3].includes(output.status), output.stderr);
  const summary = JSON.parse(output.stdout);
  return { results: JSON.parse(readFileSync(summary.files.results)), markdown: readFileSync(summary.files.report, 'utf8') };
}

test('a generated case with a current oracle and killed targeted mutant links a passed report obligation', sandboxed, (t) => {
  const { results, markdown } = generated(t), [entry] = results.generatedTestMutations;
  assert.equal(entry.compilation.status, 'passed');
  assert.deepEqual(entry.compilation.diagnostics, []);
  assert.equal(entry.head.status, 'passed', JSON.stringify(entry));
  assert.equal(entry.failureSensitive, true);
  assert.ok(entry.mutants.some((mutant) => mutant.status === 'Killed'));
  assert.deepEqual(entry.supports, ['acceptance.edge']);
  assert.equal(entry.oracle.independent, true);
  const check = results.obligations.find((item) => item.id === 'acceptance.edge');
  assert.equal(check.result, 'PASS');
  assert.equal(check.eligible, true);
  assert.ok(check.evidenceIds.some((id) => id.includes('accepts edge')));
  assert.match(markdown, /acceptance.edge/);
});

test('generated evaluation records compilation failure before execution',
  (t) => {
    const { results, markdown } = generated(t, true);
    assert.equal(results.generatedTestMutations[0].compilation?.status, 'failed');
    assert.equal(results.generatedTestMutations[0].head.status, 'unavailable');
    assert.deepEqual(results.generatedTestMutations[0].mutants, []);
    assert.deepEqual(results.generatedTestMutations[0].head.runs, []);
    assert.ok(results.generatedTestMutations[0].compilation.diagnostics.some((item) => item.code === 8010));
    assert.match(markdown, /Compilation/);
    assert.match(markdown, /failed/);
  });

for (const mode of ['correct', 'wrong', 'node']) {
  test(`generated TypeScript ${mode} runs with an informational type check`, sandboxed, (t) => {
    const { results, markdown } = generated(t, false, mode), [entry] = results.generatedTestMutations;
    assert.equal(entry.compilation.status, 'passed', JSON.stringify(entry));
    assert.equal(entry.typeCheck.status, mode === 'correct' ? 'passed' : mode === 'wrong' ? 'failed' : 'unavailable', JSON.stringify(entry));
    assert.equal(entry.head.status, 'passed', JSON.stringify(entry));
    assert.ok(entry.head.runs.length > 0);
    assert.equal((entry.typeCheck.diagnostics ?? []).some((item) => item.code === 2345), mode === 'wrong');
    assert.match(markdown, /Type check/);
  });
}
