// The Next.js support report through the CLI: the summary block, the paged project lists, one finding with its evidence,
// and a project without Next.js. The fixture is in test/nextjs-fixture.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextFiles, repository } from './nextjs-fixture.mjs';

/** The JSON output of a command that must succeed. */
const json = (output) => { assert.equal(output.status, 0, output.stderr); return JSON.parse(output.stdout); };
/** The words of a printed command without the program name. Fixture paths need no shell quotes. */
const argsOf = (command) => command.split(' ').slice(1);

test('acceptance: the summary reports the Next.js surfaces, the module counts and what Code-map cannot classify', (t) => {
  const { root, store, run } = repository(t);
  const summary = json(run(['inspect', '--summary', '--ref', 'HEAD', '--store', store]));
  const { nextjs } = summary.frameworks;
  assert.equal(nextjs.detected, true);
  assert.deepEqual(nextjs.packages, [{ path: 'package.json', field: 'dependencies', version: '15.1.0' }]);
  assert.deepEqual([nextjs.routes.total, nextjs.routes.byRouter], [10, { app: 7, middleware: 1, pages: 2 }]);
  assert.deepEqual(nextjs.routes.byKind, { api: 1, layout: 1, middleware: 1, page: 6, route: 1 });
  assert.deepEqual([nextjs.modules.client, nextjs.modules.server], [4, 11]);
  assert.deepEqual(nextjs.unclassified, { total: 7, byReason: { 'dynamic-import': 1, 'not-read': 1, 'not-reached': 2, 'outside-roots': 1, 'pages-router': 2 }, next: nextjs.unclassified.next });
  assert.deepEqual(nextjs.surfaces.map((surface) => [surface.key, surface.state]), [['app-router', 'checked'], ['pages-router', 'partial'], ['middleware', 'partial'],
    ['server-actions', 'checked'], ['environment', 'checked'], ['next-config', 'not-checked']]);
  assert.deepEqual(nextjs.rules, ['NEXT-CLIENT-API-IN-SERVER', 'NEXT-SERVER-IMPORT-IN-CLIENT', 'NEXT-USE-SERVER-EXPORT', 'NEXT-CLIENT-PRIVATE-ENV']);
  assert.match(nextjs.text, /static leads/);
  const count = (ruleId) => summary.findings.byRule.find((rule) => rule.ruleId === ruleId)?.count ?? 0;
  assert.deepEqual(nextjs.rules.map(count), [2, 3, 2, 1]);
  assert.ok(summary.gaps.every((gap) => !/next/i.test(gap.key)), 'the framework report does not change the evidence gaps that verify reads');

  // The routes come in pages. Each next command reads the same stored analysis.
  const first = json(run([...argsOf(nextjs.routes.next), '--limit', '4']));
  assert.deepEqual([first.reportType, first.part, first.target, first.page.total, first.page.items.length], ['code-map-evidence', 'nextjs.routes', { framework: 'nextjs' }, 10, 4]);
  const urls = [...first.page.items];
  for (let page = first.page; page.next; ) { page = json(run(argsOf(page.next))).page; urls.push(...page.items); }
  assert.deepEqual(urls.map((route) => route.url), ['/about', '/photo/[id]', '/api/users', '/blog/[slug]', '/docs/[[...slug]]', '/', '/', null, '/api/hello', '/legacy']);
  const modules = json(run(argsOf(nextjs.modules.next))).page;
  assert.deepEqual([modules.total, modules.items[0]], [15, { path: 'app/(marketing)/about/page.tsx', side: 'server', reason: 'route', via: null, entry: null }]);
  assert.equal(json(run(argsOf(nextjs.unclassified.next))).page.items.at(-1).path, 'lib/loader.ts');

  const fails = (args, pattern) => { const output = run(args); assert.notEqual(output.status, 0); assert.equal(output.stdout, ''); assert.match(output.stderr, pattern); };
  fails(['inspect', '--analysis', summary.analysis.id, '--part', 'nextjs.pages', '--store', store], /Unknown part "nextjs.pages" for the project\. Parts: nextjs\.routes, nextjs\.modules, nextjs\.unclassified/);
  fails(['inspect', '--analysis', summary.analysis.id, '--part', 'nextjs.routes', '--file', 'lib/db.ts', '--file', 'lib/tidy.ts', '--store', store], /--part needs/);
});

test('a Next.js finding shows its lead, the module class and the import chain from its entry', (t) => {
  const { root, store, run } = repository(t);
  const summary = json(run(['inspect', '--summary', '--ref', 'HEAD', '--store', store]));
  const list = json(run(['inspect', '--analysis', summary.analysis.id, '--findings', '--rule', 'NEXT-CLIENT-API-IN-SERVER', '--store', store]));
  const counter = list.page.items.find((item) => item.location.path === 'components/counter.tsx');
  assert.match(counter.text, /^components\/counter\.tsx is a server module: app\/page\.tsx reaches it through imports without a 'use client' boundary\. It calls the React client hook useState\./);
  assert.deepEqual(counter.evidence, [{ path: 'components/counter.tsx', line: 3, text: 'calls useState' }, { path: 'app/page.tsx', line: 1, text: 'imports components/counter.tsx' }]);
  const report = json(run(argsOf(counter.next)));
  assert.equal(report.reportType, 'code-map-finding');
  assert.deepEqual(report.details.lead, { path: 'components/counter.tsx', hooks: [{ name: 'useState', line: 3 }], handlers: [] });
  assert.deepEqual(report.details.module, { path: 'components/counter.tsx', side: 'server', reason: 'imported', via: 'app/page.tsx', entry: 'app/page.tsx' });
  assert.deepEqual(report.details.chain, ['app/page.tsx', 'components/counter.tsx']);
  assert.deepEqual(argsOf(report.details.file).slice(0, 4), ['inspect', '--analysis', summary.analysis.id, '--file']);
  const imports = json(run(['inspect', '--analysis', summary.analysis.id, '--findings', '--rule', 'NEXT-SERVER-IMPORT-IN-CLIENT', '--store', store])).page.items;
  const through = json(run(argsOf(imports.find((item) => /lib\/db\.ts/.test(item.text)).next)));
  assert.deepEqual(through.details.lead, { path: 'components/leaky.tsx', kind: 'imports-server-only', module: 'lib/db.ts', lines: [5] });
  assert.deepEqual(through.details.chain, ['components/leaky.tsx']);
});

test('without Next.js, the summary says that no Next.js rule applied, and the other outputs keep their form', (t) => {
  const files = Object.fromEntries(Object.entries(nextFiles).filter(([path]) => path !== 'package.json'));
  const { store, run } = repository(t, { ...files, 'package.json': JSON.stringify({ name: 'spa', dependencies: { react: '19.0.0' } }) });
  const summary = json(run(['inspect', '--summary', '--ref', 'HEAD', '--store', store]));
  assert.deepEqual(summary.frameworks.nextjs, { detected: false, packages: [], rules: [],
    text: 'No package.json in the snapshot lists next in dependencies or devDependencies, so no Next.js rule applied.' });
  assert.deepEqual(Object.keys(summary.frameworks), ['nextjs', 'env', 'openapi'], 'the environment and contract reports follow the Next.js report');
  assert.deepEqual(Object.keys(summary), ['reportType', 'schemaVersion', 'analysis', 'snapshot', 'scope', 'verification', 'findings', 'comparison', 'completeness', 'gaps', 'tests', 'frameworks', 'architecture', 'models', 'documentation', 'commands', 'limits']);
  assert.ok(summary.findings.byRule.every((rule) => !rule.ruleId.startsWith('NEXT-')));
  assert.equal(summary.architecture.ownership.unowned, summary.scope.sourceFiles);
  const classic = json(run(['inspect', '--ref', 'HEAD']));
  assert.deepEqual(Object.keys(classic), ['schemaVersion', 'snapshot', 'selection', 'summary', 'files', 'cycles', 'sharedTypes', 'hotspots', 'rules', 'testSummary', 'tests', 'limits']);
  const routes = json(run(['inspect', '--analysis', summary.analysis.id, '--part', 'nextjs.routes', '--store', store]));
  assert.deepEqual([routes.page.total, routes.page.next], [0, null]);
});
