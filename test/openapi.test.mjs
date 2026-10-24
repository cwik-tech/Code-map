// API contracts (C20): the OpenAPI documents in JSON, the HTTP methods of the Next.js route handlers, the three OPENAPI-
// rules, a YAML document that Code-map does not read, a Pages Router route with UNKNOWN methods, and a comparison with --base.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { documentOf, matchRoute } from '../lib/contracts/openapi.mjs';
import { analyzed, repository } from './nextjs-fixture.mjs';

const json = (output) => { assert.equal(output.status, 0, output.stderr); return JSON.parse(output.stdout); };
const argsOf = (command) => command.split(' ').slice(1);
const document = {
  openapi: '3.0.3', info: { title: 'Shop', version: '1' }, servers: [{ url: '/api' }, { url: 'https://example.com/other' }],
  paths: {
    '/users': { get: {}, post: {}, put: {} },
    '/users/{userId}': { parameters: [], get: {} },
    '/users/me': { get: {} },
    '/orders': { get: {} },
    '/legacy': { get: {} },
    '/files/{path}': { get: {} },
  },
};
/** A Next.js project with one case for each OPENAPI- rule and each document state. */
const contractFiles = {
  'package.json': JSON.stringify({ name: 'shop', dependencies: { next: '15.1.0' } }),
  'openapi.json': JSON.stringify(document, null, 2),
  // PUT /users has no handler method, and DELETE of [id] is not in the document.
  'app/api/users/route.ts': 'export async function GET() { return Response.json([]); }\nexport async function POST() { return Response.json({}); }\n',
  'app/api/users/[id]/route.ts': 'export async function GET() { return Response.json({}); }\nexport const DELETE = async () => new Response(null);\nexport type Params = { id: string };\n',
  'app/api/files/[...path]/route.ts': 'export function GET() { return new Response(); }\n',
  'app/api/health/route.ts': "export function GET() { return new Response('ok'); }\n",
  // A Pages Router API route handles every method, so its methods are UNKNOWN.
  'pages/api/legacy.ts': 'export default function handler() { return null; }\n',
  'app/page.tsx': 'export default function Page() { return <main />; }\n',
  // An unresolved server base prevents a comparison.
  'lib/payments.openapi.json': JSON.stringify({ openapi: '3.1.0', servers: [{ url: 'v1' }], paths: { '/v1/charges': { post: {} } } }),
  'docs/openapi.yaml': 'openapi: 3.0.0\npaths: {}\n',
  'broken.openapi.json': '{ "openapi": ',
  'config.openapi.json': JSON.stringify({ name: 'not a contract' }),
};

test('a document gives its operations below a relative server path, and a URL pattern matches as Next.js routes it', () => {
  const swagger = documentOf('api/swagger.json', JSON.stringify({ swagger: '2.0', basePath: '/v2/', paths: { '/pets/{petId}': { get: {}, delete: {}, summary: 'x' }, pets: { get: {} } } }));
  assert.deepEqual([swagger.state, swagger.format, swagger.base], ['parsed', 'swagger', '/v2']);
  assert.deepEqual(swagger.operations.map((item) => [item.method, item.path, item.url, item.line]), [['GET', '/pets/{petId}', '/v2/pets/{petId}', 1], ['DELETE', '/pets/{petId}', '/v2/pets/{petId}', 1]]);
  assert.equal(documentOf('openapi.json', JSON.stringify({ openapi: '3.0.0', servers: [{ url: 'https://x.test/api' }], paths: {} })).base, '', 'an absolute server URL gives no base path');
  assert.equal(documentOf('openapi.json', JSON.stringify({ openapi: '3.0.0', servers: [{ url: '/{v}', variables: { v: { default: 'v3' } } }], paths: {} })).base, '/v3');
  assert.equal(documentOf('openapi.json', JSON.stringify({ openapi: '3.0.0', servers: [{ url: 'v1' }], paths: {} })).base, null, 'a relative URL without a leading slash is unresolved');
  assert.deepEqual(['{ x', '[]', '{"info":{}}'].map((text) => documentOf('openapi.json', text)).map((item) => [item.state, item.reason]), [['invalid', 'invalid-json'], ['invalid', 'not-openapi'], ['invalid', 'not-openapi']]);
  assert.deepEqual(documentOf('openapi.json', 'x'.repeat(6 * 1024 * 1024)).reason, 'too-large');
  const routes = [{ path: 'a/[id]', url: '/users/[id]' }, { path: 'a/me', url: '/users/me' }, { path: 'a/all', url: '/users/[...rest]' }, { path: 'a/root', url: '/[[...any]]' }].map((route) => ({ router: 'app', kind: 'route', ...route }));
  const best = (url) => matchRoute(url, routes)?.path ?? null;
  assert.deepEqual(['/users/me', '/users/{id}', '/users/{id}/posts', '/', '/orders/{id}', '/users'].map(best), ['a/me', 'a/[id]', 'a/all', 'a/root', 'a/root', 'a/root']);
  assert.equal(matchRoute('/users', routes.slice(0, 3)), null);
});

test('the route inventory gives the exported HTTP methods, and the methods of a Pages Router API route are UNKNOWN', (t) => {
  // An `export *` and a destructured export have no plain export names, so their methods are UNKNOWN.
  const { root } = repository(t, { ...contractFiles, 'app/api/again/route.ts': "export * from '../health/route';\n",
    'app/api/auth/[...nextauth]/route.ts': 'const handlers = { GET() { return 1; }, POST() { return 2; } };\nexport const { GET, POST } = handlers;\n',
    'app/api/typed/route.ts': 'export type GET = string;\nexport interface POST { id: string }\nexport function DELETE() { return new Response(); }\n' });
  const { routes } = analyzed(root).analysis.frameworks.nextjs;
  const of = (path) => routes.find((route) => route.path === path);
  assert.deepEqual([of('app/api/users/route.ts').methods, of('app/api/users/route.ts').methodState], [['GET', 'POST'], 'KNOWN']);
  assert.deepEqual([of('app/api/users/[id]/route.ts').methods, of('app/api/users/[id]/route.ts').methodState], [['GET', 'DELETE'], 'KNOWN']);
  assert.deepEqual([of('app/api/typed/route.ts').methods, of('app/api/typed/route.ts').methodState], [['DELETE'], 'KNOWN'], 'a type export is not a method');
  assert.equal(of('app/api/again/route.ts').methodState, 'UNKNOWN', 'an export * can export any method');
  assert.equal(of('app/api/auth/[...nextauth]/route.ts').methodState, 'UNKNOWN', 'a destructured export has no plain export names');
  assert.deepEqual([of('pages/api/legacy.ts').methods, of('pages/api/legacy.ts').methodState], [null, 'UNKNOWN']);
  assert.equal(Object.hasOwn(of('app/page.tsx'), 'methods'), false, 'a page has no methods');
});

test('acceptance: each OPENAPI- rule finds its case, and the summary reports the documents that Code-map did not read', (t) => {
  const { store, run } = repository(t, contractFiles);
  const summary = json(run(['inspect', '--summary', '--ref', 'HEAD', '--store', store]));
  const { openapi } = summary.frameworks;
  assert.equal(openapi.detected, true);
  assert.deepEqual([openapi.documents.total, openapi.documents.byState], [5, { compared: 1, invalid: 2, 'not-compared': 1, 'not-read': 1 }]);
  assert.deepEqual([openapi.operations.total, openapi.operations.byState], [9, { handled: 5, 'no-method': 1, 'no-route': 1, 'not-compared': 1, unknown: 1 }]);
  assert.deepEqual(openapi.handlers.byState, { documented: 4, undocumented: 2, unknown: 1 });
  assert.deepEqual(openapi.rules, ['OPENAPI-NO-HANDLER', 'OPENAPI-PARAM-NAME', 'OPENAPI-UNDOCUMENTED-METHOD']);
  assert.equal(Object.hasOwn(openapi, 'removed'), false, 'a summary without a base has no removed operations');
  const documents = json(run(argsOf(openapi.documents.next))).page.items;
  assert.deepEqual(documents.map((item) => [item.path, item.state, item.reason]), [['broken.openapi.json', 'invalid', 'invalid-json'], ['config.openapi.json', 'invalid', 'not-openapi'],
    ['docs/openapi.yaml', 'not-read', 'yaml'], ['lib/payments.openapi.json', 'not-compared', 'base-unresolved'], ['openapi.json', 'compared', null]]);

  const list = (ruleId) => json(run(['inspect', '--analysis', summary.analysis.id, '--findings', '--rule', ruleId, '--store', store])).page.items;
  const missing = list('OPENAPI-NO-HANDLER');
  const lineOf = (key) => contractFiles['openapi.json'].split('\n').findIndex((line) => line.includes(`"${key}": {`)) + 1;
  assert.deepEqual(missing.map((item) => [item.location.path, item.location.symbol, item.location.line]), [['openapi.json', 'PUT /users', lineOf('/users')], ['openapi.json', 'GET /orders', lineOf('/orders')]]);
  assert.match(missing.find((item) => item.location.symbol === 'PUT /users').text, /app\/api\/users\/route\.ts handles \/api\/users, but it does not export PUT/);
  assert.match(missing.find((item) => item.location.symbol === 'GET /orders').text, /no route handler of the Next\.js root \. matches \/api\/orders/);
  const undocumented = list('OPENAPI-UNDOCUMENTED-METHOD');
  assert.deepEqual(undocumented.map((item) => [item.location.path, item.location.symbol, item.location.line]), [['app/api/health/route.ts', 'GET', 1], ['app/api/users/[id]/route.ts', 'DELETE', 2]]);
  const renamed = list('OPENAPI-PARAM-NAME');
  assert.deepEqual(renamed.map((item) => [item.location.path, item.location.symbol, item.evidence.map((entry) => entry.path)]), [['openapi.json', '/users/{userId}', ['openapi.json', 'app/api/users/[id]/route.ts']]]);
  assert.match(renamed[0].text, /\{userId\} in the document and \[id\] in the route/);
  for (const item of [...missing, ...undocumented, ...renamed]) { assert.match(item.text, /This is a static lead/); assert.equal(item.capability, 'C20'); }
  const report = json(run(argsOf(renamed[0].next)));
  assert.deepEqual([report.details.lead.pairs, report.finding.paths], [[{ document: 'userId', route: 'id' }], ['openapi.json', 'app/api/users/[id]/route.ts']]);
  assert.deepEqual(report.details.operations.map((item) => `${item.method} ${item.path}`), ['GET /users/{userId}', 'GET /users/me']);

  const operations = json(run([...argsOf(openapi.operations.next), '--limit', '50'])).page.items;
  const state = (method, path) => operations.find((item) => item.method === method && item.path === path && item.document === 'openapi.json');
  assert.deepEqual([state('GET', '/legacy').state, state('GET', '/legacy').route], ['unknown', 'pages/api/legacy.ts']);
  assert.deepEqual([state('GET', '/users/me').route, state('GET', '/files/{path}').route], ['app/api/users/[id]/route.ts', 'app/api/files/[...path]/route.ts']);
});

test('a comparison with --base reports the operations that the change removed from the document and from the handlers', (t) => {
  const { store, put, git, run } = repository(t, contractFiles);
  const { post, ...users } = document.paths['/users'];
  put('openapi.json', JSON.stringify({ ...document, paths: { ...document.paths, '/users': users } }, null, 2));
  put('app/api/users/[id]/route.ts', 'export async function GET() { return Response.json({}); }\n');
  git('rm', '-q', 'app/api/health/route.ts');
  git('commit', '-qam', 'remove operations');
  const summary = json(run(['inspect', '--summary', '--ref', 'HEAD', '--base', 'HEAD~1', '--store', store]));
  const { removed } = summary.frameworks.openapi;
  assert.equal(removed.state, 'COMPARABLE');
  assert.deepEqual(removed.documented, { total: 1, items: [{ method: 'POST', url: '/api/users', path: '/users', document: 'openapi.json' }] });
  assert.deepEqual(removed.handlers, { total: 2, items: [{ method: 'GET', url: '/api/health', path: 'app/api/health/route.ts' }, { method: 'DELETE', url: '/api/users/[id]', path: 'app/api/users/[id]/route.ts' }] });
  const findings = json(run(['inspect', '--analysis', summary.analysis.id, '--base-analysis', summary.comparison.base.id, '--findings', '--rule', 'OPENAPI-UNDOCUMENTED-METHOD', '--store', store])).page.items;
  assert.deepEqual(findings.map((item) => [item.baseline, item.location.path, item.location.symbol]),
    [['NEW', 'app/api/users/route.ts', 'POST'], ['RESOLVED', 'app/api/health/route.ts', 'GET'], ['RESOLVED', 'app/api/users/[id]/route.ts', 'DELETE']]);
});

test('without an OpenAPI document, no contract rule applies, and the summary says so', (t) => {
  const files = Object.fromEntries(Object.entries(contractFiles).filter(([path]) => !/openapi|swagger/.test(path)));
  const { store, run } = repository(t, files);
  const summary = json(run(['inspect', '--summary', '--ref', 'HEAD', '--store', store]));
  assert.deepEqual(summary.frameworks.openapi, { detected: false, rules: [],
    text: 'No file in the snapshot is named openapi.json, swagger.json or *.openapi.json, or the same names with .yaml or .yml, so no contract rule applied.' });
  assert.ok(summary.findings.byRule.every((rule) => !rule.ruleId.startsWith('OPENAPI-')));
});
