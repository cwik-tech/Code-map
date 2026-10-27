// Generated oracle information never changes the accepted rule set.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { oracleDigest } from '../lib/oracles.mjs';
import { project, outcome, header, caseText } from './oracle-fixtures.mjs';
test('each generated test requires a current record for each selected case and a request criterion', (t) => {
  const text = header + caseText('generated'), f = project(t, { 'test/login.test.ts': text });
  const fields = { generatedTests: [{ file: 'test/login.test.ts', name: 'generated' }, { file: 'test/missing.test.ts' }],
    acceptanceCriteria: [{ id: 'login', text: 'Signs in.' }] };
  const verify = () => outcome(f.verify(f.request(fields)), 3).results;
  const missing = verify();
  assert.equal(missing.generatedTestOracles[0].independent, false);
  assert.equal(missing.generatedTestOracles[1].independent, false);
  const entry = { file: 'test/login.test.ts', suite: null, name: 'generated', criterion: 'login', digest: oracleDigest(text),
    method: 'Fixture confirmation only.', confirmedBy: 'Fixture reviewer', date: '2026-10-23' };
  f.put('.code-map/oracles.json', JSON.stringify({ oracleVersion: 1, entries: [entry] }));
  const current = verify();
  assert.equal(current.generatedTestMutations[0].head.status, 'unavailable');
  assert.equal(current.generatedTestMutations[0].oracle.independent, true);
  assert.equal(current.generatedTestMutations[0].failureSensitive, false);
  assert.equal(current.generatedTestOracles[0].independent, true);
  assert.equal(current.generatedTestOracles[0].cases[0].records[0].confirmedBy, 'Fixture reviewer');
  assert.deepEqual(current.ratings, missing.ratings);
  assert.deepEqual(current.readiness, missing.readiness);
  f.put('test/login.test.ts', text + '// changed\n');
  f.commit('change test');
  assert.equal(verify().generatedTestOracles[0].cases[0].state, 'STALE');
  f.put('.code-map/oracles.json', '{}');
  assert.equal(verify().generatedTestOracles[0].state, 'INVALID');
});
test('a file declaration cannot hide a second case without an oracle', (t) => {
  const text = header + caseText('first') + caseText('second'), f = project(t, { 'test/login.test.ts': text });
  f.put('.code-map/oracles.json', JSON.stringify({ oracleVersion: 1, entries: [{ file: 'test/login.test.ts', suite: null,
    name: 'first', criterion: 'login', digest: oracleDigest(text), method: 'Fixture only.', confirmedBy: 'Fixture reviewer', date: '2026-10-23' }] }));
  const fields = { generatedTests: [{ file: 'test/login.test.ts' }], acceptanceCriteria: [{ id: 'login', text: 'Signs in.' }] };
  const current = outcome(f.verify(f.request(fields)), 3);
  assert.equal(current.results.generatedTestOracles[0].independent, false);
  assert.deepEqual(current.results.generatedTestOracles[0].cases.map((x) => x.state), ['CURRENT', 'MISSING']);
  assert.match(current.markdown, /Generated test oracles/);
  const unrelated = outcome(f.verify(f.request({ ...fields, acceptanceCriteria: [] })), 3).results;
  assert.deepEqual(unrelated.generatedTestOracles[0].cases.map((x) => x.state), ['MISSING', 'MISSING']);
});
test('requests without generated tests retain the existing results shape', (t) => {
  const f = project(t), result = outcome(f.verify(f.request()), 3);
  assert.equal(Object.hasOwn(result.results, 'generatedTestOracles'), false);
  assert.equal(Object.hasOwn(result.results, 'generatedTestMutations'), false);
});
test('duplicate case identities never count as independently confirmed', (t) => {
  const text = header + caseText('duplicate') + caseText('duplicate'), f = project(t, { 'test/login.test.ts': text });
  f.put('.code-map/oracles.json', JSON.stringify({ oracleVersion: 1, entries: [{ file: 'test/login.test.ts', suite: null,
    name: 'duplicate', criterion: 'login', digest: oracleDigest(text), method: 'Fixture only.', confirmedBy: 'Fixture reviewer', date: '2026-10-23' }] }));
  const result = outcome(f.verify(f.request({ generatedTests: [{ file: 'test/login.test.ts', name: 'duplicate' }],
    acceptanceCriteria: [{ id: 'login', text: 'Signs in.' }] })), 3);
  assert.equal(result.results.generatedTestOracles[0].independent, false);
  assert.deepEqual(result.results.generatedTestOracles[0].cases.map((x) => x.state), ['AMBIGUOUS', 'AMBIGUOUS']);
});
