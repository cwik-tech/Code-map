// The Next.js checks over a committed App Router fixture: detection, client and server modules, and a positive and a
// negative case for each rule. The fixture is in test/nextjs-fixture.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFile } from '../lib/analyze.mjs';
import { remapKey } from '../lib/compare.mjs';
import { findingRules } from '../lib/findings.mjs';
import { projectPart } from '../lib/overview.mjs';
import { analyzed, nextFiles, repository } from './nextjs-fixture.mjs';

const nextRules = ['NEXT-CLIENT-API-IN-SERVER', 'NEXT-SERVER-IMPORT-IN-CLIENT', 'NEXT-CLIENT-PRIVATE-ENV', 'NEXT-USE-SERVER-EXPORT'];
const of = (findings, ruleId) => findings.filter((item) => item.ruleId === ruleId);

test('the parser records directives, process.env reads, handlers on DOM elements and non-async exports of a use server file', () => {
  const facts = (path, text) => analyzeFile(path, text, () => null).react;
  const client = facts('a.tsx', "// header\n'use client';\nimport x from 'y';\nexport const A = () => <div onClick={x} onBlur=\"s\"><Button onPress={x} />{process.env.API_KEY}{process.env['TOKEN']}{process.env[x]}</div>;\n");
  assert.deepEqual(client.directives, ['use client']);
  assert.deepEqual(client.env, [{ name: 'API_KEY', line: 4 }, { name: 'TOKEN', line: 4 }]);
  assert.deepEqual(client.handlers, [{ element: 'div', name: 'onClick', line: 4 }], 'a string value and a handler on a component do not count');
  assert.deepEqual(client.serverExports, []);
  const actions = facts('actions.ts', "'use server';\nimport { wrap } from './w';\nexport async function a() {}\nexport function b() {}\nexport const c = 1, d = async () => 1, e = () => 2, f = wrap(a);\n"
    + 'class K {}\nexport { K, c as again };\nexport default 42;\nexport interface I {}\nexport type T = string;\nexport { x } from "./x";\n');
  assert.deepEqual(actions.serverExports.map((item) => [item.name, item.kind]), [['b', 'function'], ['c', 'value'], ['e', 'function'], ['K', 'class'], ['again', 'value'], ['default', 'value']]);
  assert.equal(facts('plain.ts', 'export const x = 1;\n'), null, 'a file without React or Next.js facts records nothing');
  assert.deepEqual(facts('late.ts', "import x from 'y';\n'use client';\nexport const z = x;\n"), null, 'a directive after an import does not count');
});

test('Next.js projects: modules split into client and server code, and the report names what it cannot classify', (t) => {
  const { root } = repository(t);
  const { nextjs } = analyzed(root).analysis.frameworks;
  assert.equal(nextjs.detected, true);
  assert.deepEqual(nextjs.packages, [{ path: 'package.json', field: 'dependencies', version: '15.1.0' }]);
  const side = (name) => nextjs.modules.filter((item) => item.side === name).map((item) => item.path);
  assert.deepEqual(side('client'), ['components/leaky.tsx', 'components/widget.tsx', 'lib/secret.ts', 'lib/tidy.ts']);
  assert.deepEqual(side('server'), ['app/(marketing)/about/page.tsx', 'app/@modal/(.)photo/[id]/page.tsx', 'app/actions.ts', 'app/api/users/route.ts', 'app/blog/[slug]/page.tsx',
    'app/layout.tsx', 'app/page.tsx', 'components/counter.tsx', 'lib/db.ts', 'lib/format.ts', 'lib/loader.ts']);
  const module = (path) => nextjs.modules.find((item) => item.path === path);
  assert.deepEqual(module('lib/format.ts'), { path: 'lib/format.ts', side: 'server', reason: 'imported', via: 'app/page.tsx', entry: 'app/page.tsx' }, 'a module that both kinds reach is a server module');
  assert.deepEqual(module('lib/tidy.ts'), { path: 'lib/tidy.ts', side: 'client', reason: 'imported', via: 'components/widget.tsx', entry: 'components/widget.tsx' });
  assert.deepEqual([module('components/widget.tsx').reason, module('app/actions.ts').reason, module('app/page.tsx').reason], ['use-client', 'use-server', 'route']);
  assert.deepEqual(nextjs.unclassified.map((item) => [item.path, item.reason]), [
    ['app/_parts/page.tsx', 'not-reached'], ['app/docs/[[...slug]]/page.tsx', 'not-read'], ['lib/unused.ts', 'not-reached'], ['middleware.ts', 'outside-roots'], ['pages/api/hello.ts', 'pages-router'], ['pages/legacy.tsx', 'pages-router'], ['lib/loader.ts', 'dynamic-import']]);
  assert.equal(nextjs.routes.length, 10);
  assert.deepEqual(nextjs.routes.find((route) => route.path === 'app/@modal/(.)photo/[id]/page.tsx'),
    { path: 'app/@modal/(.)photo/[id]/page.tsx', root: '.', router: 'app', kind: 'page', url: '/photo/[id]', groups: [], slots: ['@modal'], params: [{ name: 'id', kind: 'dynamic' }], intercepts: { marker: '(.)', from: '/' }, analyzed: true });
});

test('each Next.js rule finds its positive case and leaves its negative case alone', (t) => {
  const { root } = repository(t);
  const { findings } = analyzed(root);
  const rows = (ruleId) => of(findings, ruleId).map((item) => [item.location.path, item.location.line, ...item.key.slice(1)]);
  // useState in a shared component that the server page imports, and onClick on a DOM element of the server page.
  // The 'use client' widget with hooks and a handler, and the Pages Router hook give nothing.
  assert.deepEqual(rows('NEXT-CLIENT-API-IN-SERVER').sort(), [['app/page.tsx', 9], ['components/counter.tsx', 3]]);
  assert.deepEqual(of(findings, 'NEXT-CLIENT-API-IN-SERVER').find((item) => item.location.path === 'components/counter.tsx').facts, { hooks: ['useState'], handlers: [], reason: 'imported', entry: 'app/page.tsx' });
  // fs and a server-only module through the boundary give findings. The type-only import of next/server gives nothing.
  assert.deepEqual(rows('NEXT-SERVER-IMPORT-IN-CLIENT').sort(), [['components/leaky.tsx', 2, 'node-builtin', 'fs'], ['components/leaky.tsx', 5, 'imports-server-only', 'lib/db.ts'], ['lib/secret.ts', 1, 'server-only', 'server-only']]);
  // DATABASE_URL in a client file gives a finding. NEXT_PUBLIC_API_URL, NODE_ENV and the server module lib/format.ts give nothing.
  assert.deepEqual(rows('NEXT-CLIENT-PRIVATE-ENV'), [['components/leaky.tsx', 7, 'DATABASE_URL']]);
  // A constant and a plain function in a 'use server' file give findings. The async function and the type give nothing.
  assert.deepEqual(rows('NEXT-USE-SERVER-EXPORT'), [['app/actions.ts', 3, 'limit'], ['app/actions.ts', 4, 'check']]);
  for (const item of findings.filter((entry) => nextRules.includes(entry.ruleId))) {
    assert.match(item.text, /This is a static lead/);
    assert.equal(item.capability, 'C26');
    assert.ok(item.paths.includes(item.location.path) && item.evidence.length > 0 && item.evidence.length <= 3);
  }
});

test('Next.js finding IDs come from paths and names, so they survive line moves', (t) => {
  const { root, put, git } = repository(t);
  const before = analyzed(root).findings.filter((item) => nextRules.includes(item.ruleId));
  for (const path of ['components/counter.tsx', 'components/leaky.tsx', 'lib/secret.ts', 'app/page.tsx']) put(path, `// moved down\n\n${nextFiles[path]}`);
  put('app/actions.ts', nextFiles['app/actions.ts'].replace("'use server';\n", "'use server';\n\n// moved\n"));
  git('commit', '-qam', 'move lines');
  const after = analyzed(root).findings.filter((item) => nextRules.includes(item.ruleId));
  assert.deepEqual(after.map((item) => item.id).sort(), before.map((item) => item.id).sort());
  assert.ok(after.every((item) => item.location.line !== before.find((other) => other.id === item.id).location.line));
});

test('without Next.js, no Next.js rule applies, also to use client files with hooks and private variables', (t) => {
  const files = Object.fromEntries(Object.entries(nextFiles).filter(([path]) => path !== 'package.json'));
  const { root } = repository(t, { ...files, 'package.json': JSON.stringify({ name: 'spa', dependencies: { react: '19.0.0' } }) });
  const { analysis, findings } = analyzed(root);
  assert.equal(analysis.frameworks.nextjs.detected, false);
  assert.deepEqual([analysis.frameworks.nextjs.routes, analysis.frameworks.nextjs.modules, analysis.frameworks.nextjs.unclassified], [[], [], []]);
  assert.deepEqual(findings.filter((item) => item.ruleId.startsWith('NEXT-')), []);
  assert.deepEqual(nextRules.map((ruleId) => findingRules[ruleId].capability), ['C26', 'C26', 'C26', 'C26']);
});

test('the report lists the code files that classified modules import but that Code-map did not read', (t) => {
  // Code-map leaves out a top folder named config from the source roots, and it ignores folders named generated.
  const { root } = repository(t, { 'package.json': nextFiles['package.json'],
    'app/page.tsx': "import { site } from '../config/site';\nimport { db } from './generated/db';\nimport type { Row } from '../config/types';\nimport './globals.css';\n"
      + 'export default function Page(row: Row) { return <p>{site}{String(db)}{String(row)}</p>; }\n',
    'config/site.ts': "export const site = 'shop';\n", 'config/types.ts': 'export type Row = { id: string };\n',
    'app/generated/db.ts': "import 'server-only';\nexport const db = 1;\n", 'app/globals.css': 'body {}\n' });
  const { nextjs } = analyzed(root).analysis.frameworks;
  assert.deepEqual(nextjs.unclassified.map((item) => [item.path, item.reason]), [['app/generated/db.ts', 'not-read'], ['config/site.ts', 'outside-roots']],
    'a type-only import and a style sheet do not count');
});

test('a rename moves both paths of a NEXT-SERVER-IMPORT-IN-CLIENT key, and a package name stays', () => {
  const rename = (path) => ({ 'components/leaky.tsx': 'components/leak.tsx', 'lib/db.ts': 'lib/database.ts' })[path] ?? path;
  assert.deepEqual(remapKey('NEXT-SERVER-IMPORT-IN-CLIENT', ['components/leaky.tsx', 'imports-server-only', 'lib/db.ts'], rename), ['components/leak.tsx', 'imports-server-only', 'lib/database.ts']);
  assert.deepEqual(remapKey('NEXT-SERVER-IMPORT-IN-CLIENT', ['components/leaky.tsx', 'node-builtin', 'fs'], rename), ['components/leak.tsx', 'node-builtin', 'fs']);
  assert.deepEqual(remapKey('NEXT-CLIENT-PRIVATE-ENV', ['components/leaky.tsx', 'DATABASE_URL'], rename), ['components/leak.tsx', 'DATABASE_URL']);
});

test('a project part of a stored analysis without a framework report fails and names the fix', () => {
  const context = { id: 'A-0123456789abcdef', freshness: { state: 'current' }, command: (args) => args.join(' ') }, old = { id: context.id, createdAt: null, data: { analysis: {} } };
  assert.throws(() => projectPart(old, context, 'nextjs.routes'), /A-0123456789abcdef has no framework report.*Run code-map inspect --summary again/);
  assert.throws(() => projectPart(old, context, 'nextjs.pages'), /Unknown part "nextjs.pages" for the project/);
});
