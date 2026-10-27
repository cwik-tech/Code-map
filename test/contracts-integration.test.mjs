import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repository } from './nextjs-fixture.mjs';
const json = (result) => { assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); };

test('inspection compares GraphQL and Proto and pages the contract and example evidence', (t) => {
  const f = repository(t, { 'package.json': '{"name":"p","main":"src/index.js"}', 'src/index.js': 'export const yes=1;', 'api.gql': 'type T { a: Int b: Int }', 'api.proto': 'message T { string a = 1; }', 'README.md': '```js\nimport { missing } from "p";\n```', 'Dockerfile': 'ENV TOKEN=value' });
  const base = f.git('rev-parse', 'HEAD');
  f.put('api.gql', 'type T { a: Int }'); f.put('api.proto', 'message T { string a = 1; int32 b = 2; }');
  f.git('add', '.'); f.git('commit', '-qm', 'contracts');
  const summary = json(f.run(['inspect', '--ref', 'HEAD', '--summary', '--base', base, '--store', f.store]));
  assert.ok(summary.frameworks.protocols.changes.items.some((x) => x.reason === 'removed-field' && x.state === 'BREAKING'));
  assert.ok(summary.frameworks.protocols.changes.items.some((x) => x.reason === 'added-field' && x.state === 'COMPATIBLE'));
  const page = json(f.run(['inspect', '--analysis', summary.analysis.id, '--part', 'protocols.documents', '--store', f.store]));
  assert.equal(page.page.items.length, 2);
  const examples = json(f.run(['inspect', '--analysis', summary.analysis.id, '--part', 'examples.issues', '--store', f.store]));
  assert.equal(examples.page.items[0].name, 'missing');
});

test('verify exposes the new evidence as information without new baseline checks', (t) => {
  const f = repository(t, { 'package.json': '{"name":"p","main":"src/index.js"}', 'src/index.js': 'export const yes=1;', 'api.graphql': 'type T { a: Int }' });
  const base = f.git('rev-parse', 'HEAD');
  f.put('api.graphql', 'type T { a: String }'); f.git('add', '.'); f.git('commit', '-qm', 'type');
  f.put('request.json', JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1, base, head: 'HEAD', changeType: 'feature', intent: 'change contract', acceptanceCriteria: [], reportInputs: [], allowedPaths: ['**'], profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } }));
  const result = f.run(['verify', '--request', 'request.json', '--store', f.store]);
  assert.ok(result.stdout.trim(), result.stderr);
  const output = JSON.parse(result.stdout);
  // The result file is the public output of verify.
  return import('node:fs').then(({ readFileSync }) => {
    const report = JSON.parse(readFileSync(output.files.results, 'utf8'));
    assert.ok(report.contractInformation.changes.some((x) => x.reason === 'changed-field-type'));
    assert.equal(report.contractInformation.policy, 'information-only');
    assert.equal(report.obligations.some((x) => x.id.startsWith('protocols.')), false);
  });
});
