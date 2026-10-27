import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { routeCases, responseProblems } from '../lib/harness/route.mjs';
import { validateSpec } from '../lib/harness/spec.mjs';
import { runHarness, harnessCommand } from '../lib/harness/run.mjs';
import { harnessInformation } from '../lib/harness/report.mjs';
import { loadConfig } from '../lib/project.mjs';
import { authorize, project, sandboxed } from './worker-fixtures.mjs';
const document = { openapi: '3.0.3', paths: { '/items/{id}': { parameters: [{ in: 'path', name: 'id', required: true, example: 'abc' }],
  get: { responses: { 200: { content: { 'application/json': { schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } }, additionalProperties: false } } } } } },
  post: { requestBody: { content: { 'application/json': { example: { id: 'sent' } } } }, responses: { 201: { content: { 'application/json': { schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } } } } } } } } };
const spec = { harnessVersion: 1, mode: 'route', subject: { file: 'app/items/[id]/route.mjs', export: 'GET' }, contract: 'openapi.json', path: '/items/{id}', callTimeoutMs: 3000 };

test('route specs and requests use explicit OpenAPI examples', () => {
  assert.equal(validateSpec(spec).mode, 'route');
  assert.throws(() => validateSpec({ ...spec, contract: '../openapi.json' }), /contract/);
  const cases = routeCases(document, spec.path, ['GET', 'POST', 'DELETE']);
  assert.equal(cases[0].url, 'http://code-map.invalid/items/abc');
  assert.deepEqual(cases[0].params, { id: 'abc' });
  assert.equal(cases[1].body, '{"id":"sent"}');
  assert.equal(cases[2].state, 'UNKNOWN');
  assert.deepEqual(responseProblems(cases[0], 200, { id: 'abc' }), []);
  assert.ok(responseProblems(cases[0], 404, {}).includes('undocumented-status'));
  assert.ok(responseProblems(cases[0], 200, {}).includes('missing-field:id'));
  assert.ok(responseProblems(cases[0], 200, { id: 1 }).includes('field-type:id'));
});

test('route cases refuse missing examples and unsupported schema references', () => {
  const noExample = structuredClone(document); delete noExample.paths[spec.path].parameters[0].example;
  assert.equal(routeCases(noExample, spec.path, ['GET'])[0].state, 'UNKNOWN');
  const reference = structuredClone(document); reference.paths[spec.path].get.responses[200].content['application/json'].schema = { $ref: '#/components/schemas/Item' };
  assert.ok(responseProblems(routeCases(reference, spec.path, ['GET'])[0], 200, {}).includes('UNKNOWN:unsupported-response-schema'));
});

test('route handlers run inside the sandbox and retain contract mismatches as information', sandboxed, async (t) => {
  const f = project(t);
  f.put(spec.subject.file, 'export async function GET(request, context) { const { id } = await context.params; return Response.json({ id }); }\nexport async function POST(request) { const data = await request.json(); return Response.json({ wrong: data.id }, { status: 201 }); }');
  f.put('openapi.json', JSON.stringify(document)); f.git('add', '.'); f.git('commit', '-qm', 'route');
  const result = await runHarness(f.root, loadConfig(f.root), { authorization: authorize(f, harnessCommand), spec, store: f.store }, { protectedFolders: [f.root, f.home, f.store], home: f.home, graceMs: 300 });
  assert.equal(result.exitCode, 0, JSON.stringify(result.record.problems));
  const report = JSON.parse(readFileSync(result.paths.artifact, 'utf8'));
  assert.equal(report.calls[0].result.output.checks.length, 2);
  assert.deepEqual(report.calls[0].result.output.checks[0].problems, []);
  assert.ok(report.calls[0].result.output.checks[1].problems.includes('missing-field:id'));
  assert.equal(harnessInformation(JSON.stringify(report)).information.failures, 1);
});

test('route request URLs include explicit server paths and query examples', () => {
  const value = structuredClone(document);
  value.servers = [{ url: '/v1' }];
  value.paths[spec.path].get.parameters = [{ in: 'query', name: 'search', example: 'a b' }];
  assert.equal(routeCases(value, spec.path, ['GET'])[0].url, 'http://code-map.invalid/v1/items/abc?search=a+b');
});

test('a thrown route method does not prevent the other exported methods from being checked', sandboxed, async (t) => {
  const f = project(t);
  f.put(spec.subject.file, 'export function GET() { throw new Error("broken"); }\nexport function POST() { return Response.json({ id: "ok" }, { status: 201 }); }');
  f.put('openapi.json', JSON.stringify(document)); f.git('add', '.'); f.git('commit', '-qm', 'throwing route');
  const result = await runHarness(f.root, loadConfig(f.root), { authorization: authorize(f, harnessCommand), spec, store: f.store }, { protectedFolders: [f.root, f.home, f.store], home: f.home, graceMs: 300 });
  assert.equal(result.exitCode, 0);
  const report = JSON.parse(readFileSync(result.paths.artifact, 'utf8'));
  assert.equal(report.calls[0].result.status, 'returned');
  assert.equal(report.calls[0].result.output.checks.length, 2);
  assert.deepEqual(report.calls[0].result.output.checks[1].problems, []);
});
