import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { ignored, selectSources } from '../lib/project.mjs';
import { nextRoutes } from '../lib/frameworks/next-routes.mjs';
import { frameworkSummary } from '../lib/frameworks/next-report.mjs';
import { findingDetails } from '../lib/finding-details.mjs';
import { compareRunnerFile } from '../lib/runner-config.mjs';
import { parseJUnit } from '../lib/adapters/junit.mjs';
import { analyzed, repository } from './nextjs-fixture.mjs';

const pkg = JSON.stringify({ dependencies: { next: '16.0.0' } });
const polyfills = 'assert buffer constants crypto domain events http https os path process punycode querystring stream string_decoder sys timers tty util vm zlib'.split(' ');

test('proxy files have their own route kind and reach server imports', (t) => {
  const paths = ['proxy.ts', 'src/proxy.js', 'apps/web/proxy.tsx', 'apps/web/src/proxy.jsx', 'app/proxy.ts', 'lib/proxy.ts', 'proxy.mjs', 'src/proxy.d.ts'];
  assert.deepEqual(nextRoutes(paths, [{ path: 'package.json' }, { path: 'apps/web/package.json' }]).map((r) => [r.path, r.kind, r.router, r.url]),
    [['apps/web/proxy.tsx', 'proxy', 'proxy', null], ['apps/web/src/proxy.jsx', 'proxy', 'proxy', null], ['proxy.ts', 'proxy', 'proxy', null], ['src/proxy.js', 'proxy', 'proxy', null]]);
  const { root } = repository(t, { 'package.json': pkg, 'src/proxy.ts': "import { value } from './helper'; export function proxy() { return value; }",
    'src/helper.ts': 'export const value = 1;' });
  const { analysis } = analyzed(root);
  assert.deepEqual(analysis.frameworks.nextjs.modules.map((m) => [m.path, m.side]), [['src/helper.ts', 'server'], ['src/proxy.ts', 'server']]);
  assert.equal(frameworkSummary(analysis, String).nextjs.surfaces.find((s) => s.key === 'proxy').state, 'partial');
});

test('docs routes are read while ordinary documentation folders stay ignored', (t) => {
  const routes = ['app/docs/page.tsx', 'pages/docs/index.tsx', 'src/app/docs/page.tsx', 'src/pages/docs/index.tsx', 'apps/web/src/app/docs/nested/docs/page.tsx'];
  assert.deepEqual(selectSources(routes, ['.']), routes);
  assert.deepEqual(['docs/example.ts', 'lib/docs/example.ts', 'docs/app/docs/page.tsx', 'app/docs/node_modules/x.ts', 'app/docs/.cache/x.ts'].map(ignored), [true, true, true, true, true]);
  const { root } = repository(t, { 'package.json': pkg, 'app/docs/page.tsx': 'export default function Docs() { return null; }', 'docs/example.ts': 'export const x = 1;' });
  const { analysis } = analyzed(root);
  assert.equal(analysis.frameworks.nextjs.routes[0].analyzed, true);
  assert.deepEqual(analysis.files.map((f) => f.path), ['app/docs/page.tsx']);
});

test('bare browser polyfills give low findings while node prefixes and other builtins stay high', (t) => {
  const names = [...polyfills, ...polyfills.map((name) => `node:${name}`), 'fs', 'fs/promises', 'stream/web'];
  const { root } = repository(t, { 'package.json': pkg, 'src/client.ts': "'use client';\n" + names.map((name) => `import '${name}';`).join('\n') });
  const { analysis, findings } = analyzed(root);
  const low = findings.filter((f) => f.ruleId === 'NEXT-POLYFILLED-BUILTIN-IN-CLIENT');
  assert.deepEqual(low.map((f) => f.facts.module).sort(), [...polyfills].sort());
  assert.ok(low.every((f) => f.severity === 'low' && /bundle size/.test(f.text) && /differ from Node.js/.test(f.text)));
  const high = findings.filter((f) => f.ruleId === 'NEXT-SERVER-IMPORT-IN-CLIENT');
  assert.deepEqual(high.map((f) => f.facts.module).sort(), names.slice(polyfills.length).sort());
  assert.ok(high.every((f) => f.severity === 'high'));
  assert.equal(findingDetails(analysis, low[0], String, String).details.lead.module, low[0].facts.module);
});

for (const path of ['jest.config.js', 'vitest.config.ts']) {
  const config = (value) => path.startsWith('jest') ? `module.exports = { ${value} };` : `export default { test: { ${value} } };`;
  for (const [base, head, state] of [
    ['', 'bail: true', 'WEAKER'], ['bail: 0', 'bail: 2', 'WEAKER'], ['bail: 5', 'bail: 2', 'WEAKER'],
    ['bail: 2', 'bail: true', 'WEAKER'], ['bail: 1', 'bail: 2', 'NOT_WEAKER'], ['bail: 1', '', 'NOT_WEAKER'],
    ['bail: 1', 'bail: 0', 'NOT_WEAKER'], ['bail: true', 'bail: 1', 'NOT_WEAKER'], ['bail: false', '', 'NOT_WEAKER'],
    ['bail: limit', 'bail: 1', 'UNKNOWN'],
  ]) test(`${path}: bail ${base || 'absent'} to ${head || 'absent'} is ${state}`, () => {
    assert.equal(compareRunnerFile({ path, baseText: config(base), headText: config(head) }).state, state);
  });
}

test('Node.js reporter top-level cases have no suite and retain totals', () => {
  // Captured from Node.js 24.21.0 with node --test --test-reporter=junit in a temporary folder.
  const xml = readFileSync(new URL('./node-junit-fixture.xml', import.meta.url), 'utf8');
  const result = parseJUnit(xml);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.report.cases.map((c) => [c.name, c.suite, c.status]), [['accepts a value', null, 'passed'], ['later', null, 'skipped']]);
  assert.deepEqual(result.report.totals, { tests: 2, passed: 1, failed: 0, errored: 0, skipped: 1, todo: 0 });
  assert.deepEqual(result.report.suites, []);
  assert.deepEqual(result.report.mismatches, []);
  assert.equal(parseJUnit('<testsuites name="root" tests="2"><testcase name="one"/></testsuites>').report.cases[0].suite, null);
  assert.deepEqual(parseJUnit('<testsuites tests="2"><testcase name="one"/></testsuites>').report.mismatches,
    [{ suite: null, field: 'tests', declared: 2, observed: 1 }]);
});
