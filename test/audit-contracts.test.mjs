// Regression cases for the bounded contract and deployment adapters.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';
import { routeCases, responseProblems } from '../lib/harness/route.mjs';
import { deploymentEntries, compareDeployment } from '../lib/frameworks/deployment.mjs';
import { collectSchemas } from '../lib/schemas/collect.mjs';
import { compareSchemas } from '../lib/schemas/compare.mjs';
import { sourceModels } from '../lib/models/models.mjs';
const response = (schema) => ({ method: 'GET', responses: { 200: { content: { 'application/json': { schema } } } } });
test('response constraints reject enum and range violations and retain unsupported rules', () => {
  assert.ok(responseProblems(response({ type: 'object', properties: { age: { type: 'integer', minimum: 18, enum: [18, 19] } } }), 200, { age: 17 }).length);
  assert.ok(responseProblems(response({ type: 'object', properties: { tag: { type: 'string', pattern: '^ok$' } } }), 200, { tag: 'bad' }).some((x) => x.startsWith('UNKNOWN:')));
});
test('request examples are checked against parameter and body schemas', () => {
  const operation = { parameters: [{ in: 'query', name: 'age', example: 17, schema: { type: 'integer', minimum: 18 } }], responses: {} };
  const document = { openapi: '3.0.3', paths: { '/': { post: operation } } };
  assert.equal(routeCases(document, '/', ['POST'])[0].state, 'UNKNOWN');
  operation.parameters = [];
  operation.requestBody = { required: true, content: { 'application/json': { example: { id: 1 }, schema: { type: 'object', properties: { id: { type: 'string' } } } } } };
  assert.equal(routeCases(document, '/', ['POST'])[0].state, 'UNKNOWN');
});
const inventory = (text) => collectSchemas(['package.json', 'schema.sql'], (paths) => new Map(paths.map((path) => [path, path === 'schema.sql' ? text : '{}'])));
test('explicit SQLite schema snapshots compare columns and retain unsupported dialects', () => {
  const before = inventory('-- dialect: sqlite\nCREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);');
  const after = inventory('-- dialect: sqlite\nCREATE TABLE users (id INTEGER PRIMARY KEY);');
  assert.ok(before.entities.some((x) => x.kind === 'sql'));
  assert.ok(compareSchemas(before, after).changes.some((x) => x.member === 'name' && x.class === 'breaking'));
  assert.ok(inventory('-- dialect: postgres\nCREATE TABLE users (id UUID);').unread.length);
});
test('JSON Schema and explicit range annotations generate adjacent integer cases', () => {
  const json = sourceModels(ts.createSourceFile('age.schema.json', '{"type":"integer","minimum":18,"exclusiveMaximum":21}', ts.ScriptTarget.Latest, true));
  assert.deepEqual(json?.schemas[0].fields[0].values.map((x) => [x.value, x.expected]), [[17, 'invalid'], [18, 'valid'], [19, 'valid'], [20, 'valid'], [21, 'invalid'], [22, 'invalid']]);
  const annotated = sourceModels(ts.createSourceFile('age.ts', '/** @minimum 18 @maximum 65 */\nexport const age = (x: number) => x;', ts.ScriptTarget.Latest, true));
  assert.equal(annotated?.schemas[0].fields[0].values[0].value, 17);
});
test('build arguments and discarded stages do not satisfy runtime reads', () => {
  const doc = { path: 'Dockerfile', ...deploymentEntries('Dockerfile', 'FROM node AS build\nARG TOKEN=x\nENV ONLY_BUILD=x\nFROM node\nENV LIVE=x\n') };
  const result = compareDeployment(['package.json'], [doc], { reads: [{ path: 'app.js', name: 'TOKEN' }, { path: 'app.js', name: 'ONLY_BUILD' }, { path: 'app.js', name: 'LIVE' }], templates: [] });
  assert.deepEqual(result.missingReads.map((x) => x.name), ['TOKEN', 'ONLY_BUILD']);
  assert.equal(doc.names.find((x) => x.name === 'TOKEN').kind, 'ARG');
  assert.equal(doc.names.find((x) => x.name === 'ONLY_BUILD').stage, 0);
});
test('a resulting image inherits ENV from a named parent stage', () => {
  const doc = { path: 'Dockerfile', ...deploymentEntries('Dockerfile', 'FROM node AS base\nENV LIVE=x\nFROM base AS final\nARG TOKEN=x\n') };
  const result = compareDeployment(['package.json'], [doc], { reads: [{ path: 'app.js', name: 'LIVE' }], templates: [] });
  assert.deepEqual(result.missingReads, []);
});
test('unsupported constraints on absent optional fields still retain UNKNOWN', () => {
  assert.ok(responseProblems(response({ type: 'object', properties: { tag: { type: 'string', format: 'email' } } }), 200, {}).some((x) => x.startsWith('UNKNOWN:')));
});
