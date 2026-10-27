// Regression cases found by review of the committed stream.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseGraphql } from '../lib/contracts/graphql.mjs';
import { parseProto } from '../lib/contracts/proto.mjs';
import { compareContracts } from '../lib/contracts/compare.mjs';
import { protocolInputs } from '../lib/contracts/inputs.mjs';
import { checkExamples } from '../lib/impact/examples.mjs';
import { contractInformation } from '../lib/contracts/report.mjs';
import { sourceReader } from '../lib/git.mjs';
import { analysisId, analysisInputs } from '../lib/inputs.mjs';
import { loadConfig } from '../lib/project.mjs';
import { repository } from './nextjs-fixture.mjs';

test('GraphQL unsupported scalars preserve following types and union directives mark their type UNKNOWN', () => {
  assert.deepEqual(parseGraphql('scalar Date type T { a: Date }').types.map((x) => [x.name, x.state]), [['Date', 'UNKNOWN'], ['T', 'KNOWN']]);
  assert.equal(parseGraphql('union U = A | B @custom').types[0].state, 'UNKNOWN');
});

test('GraphQL malformed headers cannot establish that following types were removed', () => {
  const before = { path: 'api.gql', ...parseGraphql('type T { a: Int }') };
  const after = { path: 'api.gql', ...parseGraphql('type Broken type T { a: Int }') };
  assert.equal(compareContracts([before], [after]).some((x) => x.state === 'BREAKING'), false);
});

test('Proto duplicate wire numbers are breaking and reserved ranges protect removed fields', () => {
  const before = { path: 'api.proto', ...parseProto('message T { string a = 1; }') };
  const duplicate = { path: 'api.proto', ...parseProto('message T { string a = 1; string b = 1; }') };
  assert.ok(compareContracts([before], [duplicate]).some((x) => x.reason === 'reused-field-number' && x.state === 'BREAKING'));
  const reserved = { path: 'api.proto', ...parseProto('message T { reserved 1 to 3; }') };
  assert.ok(compareContracts([before], [reserved]).some((x) => x.reason === 'reserved-field' && x.state === 'COMPATIBLE'));
});

test('checked examples cannot import a subpath-only export from the package root', () => {
  const api = { files: { 'src/index.js': [{ name: 'root' }], 'src/extra.js': [{ name: 'extra' }] }, entryPoints: { files: [{ path: 'src/index.js', package: 'package.json' }, { path: 'src/extra.js', package: 'package.json' }], unresolved: [] } };
  const result = checkExamples(new Map([['README.md', '~~~tsx\nimport { extra } from "pkg";\nconst x = <div/>;\n~~~']]), new Map([['package.json', '{"name":"pkg","exports":{".":"./src/index.js","./extra":"./src/extra.js"}}']]), api);
  assert.deepEqual(result.issues.map((x) => [x.kind, x.name]), [['missing-export', 'extra']]);
});

test('schema readers refuse symlinks and files above the limit', (t) => {
  const f = repository(t, { 'package.json': '{}', 'src/index.js': 'export const x=1;', 'big.proto': ' '.repeat(1024 * 1024 + 1), 'real.gql': 'type T { a: Int }' });
  symlinkSync('real.gql', join(f.root, 'alias.gql'));
  const result = protocolInputs(['big.proto', 'alias.gql'], sourceReader(f.root, null));
  assert.deepEqual(result.map((x) => [x.path, x.reason]), [['alias.gql', 'symlink'], ['big.proto', 'too-large']]);
});

test('schema readers and input identity refuse symlinked ancestor directories', (t) => {
  const f = repository(t, { 'package.json': '{}', 'src/index.js': 'export const x=1;', 'schemas/api.gql': 'type T { a: Int }' });
  const external = mkdtempSync(join(tmpdir(), 'code-map-contract-external-'));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  writeFileSync(join(external, 'api.gql'), 'type PRIVATE { secret: Int }');
  rmSync(join(f.root, 'schemas'), { recursive: true });
  symlinkSync(external, join(f.root, 'schemas'));
  const reader = sourceReader(f.root, null), result = protocolInputs(['schemas/api.gql'], reader);
  assert.equal(result[0].reason, 'symlink');
  const id = () => analysisId(analysisInputs(f.root, loadConfig(f.root), { worktree: true }, null));
  const before = id();
  writeFileSync(join(external, 'api.gql'), 'type CHANGED_PRIVATE { secret: String }');
  assert.equal(id(), before);
});

test('an empty informational contract report remains absent for the v0 baseline fixture', () => {
  const empty = { frameworks: { protocols: { documents: [] }, deployment: { documents: [], missingReads: [], missingTemplates: [], unused: [] } }, examples: { blocks: 0, issues: [], gaps: [] } };
  assert.equal(contractInformation(empty, empty), null);
});
