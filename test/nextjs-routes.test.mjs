// Next.js detection and the route inventory: pure functions over package.json texts and file paths.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appRoute, nextPackages, nextRoutes, pagesRoute } from '../lib/frameworks/next-routes.mjs';

const url = (rest) => appRoute(rest)?.url ?? null;

test('App Router URL patterns remove route groups and keep dynamic, catch-all and optional catch-all segments', () => {
  assert.equal(url('page.tsx'), '/');
  assert.equal(url('(marketing)/about/page.tsx'), '/about');
  assert.equal(url('(shop)/(cart)/cart/layout.js'), '/cart');
  assert.equal(url('blog/[slug]/page.tsx'), '/blog/[slug]');
  assert.equal(url('shop/[...path]/page.jsx'), '/shop/[...path]');
  assert.equal(url('docs/[[...slug]]/page.ts'), '/docs/[[...slug]]');
  assert.deepEqual(appRoute('(marketing)/blog/[slug]/page.tsx'), { kind: 'page', url: '/blog/[slug]', groups: ['(marketing)'], slots: [], params: [{ name: 'slug', kind: 'dynamic' }], intercepts: null });
  assert.deepEqual(appRoute('shop/[...path]/[[...rest]]/page.tsx').params, [{ name: 'path', kind: 'catch-all' }, { name: 'rest', kind: 'optional-catch-all' }]);
});

test('App Router URL patterns mark parallel slots and intercepting segments, and count levels in URL segments', () => {
  assert.deepEqual(appRoute('dashboard/@team/settings/page.tsx'), { kind: 'page', url: '/dashboard/settings', groups: [], slots: ['@team'], params: [], intercepts: null });
  assert.deepEqual(appRoute('@modal/(.)photo/[id]/page.tsx').intercepts, { marker: '(.)', from: '/' });
  assert.equal(url('@modal/(.)photo/[id]/page.tsx'), '/photo/[id]');
  assert.equal(url('feed/(.)photo/[id]/page.tsx'), '/feed/photo/[id]');
  assert.deepEqual(appRoute('feed/(..)photo/[id]/page.tsx'), { kind: 'page', url: '/photo/[id]', groups: [], slots: [], params: [{ name: 'id', kind: 'dynamic' }], intercepts: { marker: '(..)', from: '/feed' } });
  assert.equal(url('a/(group)/b/(..)(..)photo/page.tsx'), '/photo', 'a route group is not a level');
  assert.equal(url('a/b/c/(...)photo/page.tsx'), '/photo');
  assert.equal(url('a/(..)(..)(..)photo/page.tsx'), '/photo', 'more levels than the URL has stop at the root');
});

test('App Router files: only the special file names count, private folders do not, and each kind is recorded', () => {
  for (const kind of ['page', 'layout', 'template', 'loading', 'error', 'global-error', 'not-found', 'default', 'route']) assert.equal(appRoute(`x/${kind}.tsx`)?.kind, kind);
  assert.equal(appRoute('api/users/route.ts').url, '/api/users');
  for (const rest of ['components/button.tsx', '_lib/page.tsx', 'blog/_parts/page.tsx', 'page.test.tsx', 'page.d.ts', 'page.mjs', 'page.css']) assert.equal(appRoute(rest), null, rest);
});

test('Pages Router URL patterns drop index files, keep dynamic segments, and mark API routes and special files', () => {
  assert.deepEqual(pagesRoute('index.tsx'), { kind: 'page', url: '/', groups: [], slots: [], params: [], intercepts: null });
  assert.equal(pagesRoute('blog/index.jsx').url, '/blog');
  assert.deepEqual(pagesRoute('blog/[slug].tsx').params, [{ name: 'slug', kind: 'dynamic' }]);
  assert.equal(pagesRoute('docs/[[...slug]].tsx').url, '/docs/[[...slug]]');
  assert.deepEqual([pagesRoute('api/users/[id].ts').kind, pagesRoute('api/users/[id].ts').url], ['api', '/api/users/[id]']);
  assert.deepEqual([pagesRoute('_app.tsx').kind, pagesRoute('_app.tsx').url], ['app', null]);
  assert.deepEqual([pagesRoute('_document.tsx').kind, pagesRoute('_error.js').kind, pagesRoute('404.tsx').url], ['document', 'error', '/404']);
  assert.deepEqual([pagesRoute('api.tsx').kind, pagesRoute('api/index.ts').kind, pagesRoute('api/index.ts').url], ['page', 'api', '/api'], 'only the files in the folder api are API routes');
  for (const rest of ['styles.css', 'index.test.tsx', 'types.d.ts']) assert.equal(pagesRoute(rest), null, rest);
});

test('a package.json that lists next makes its folder a Next.js root; others do not count', () => {
  const texts = new Map([
    ['package.json', JSON.stringify({ name: 'mono', devDependencies: { typescript: '6.0.3' } })],
    ['apps/web/package.json', JSON.stringify({ dependencies: { next: '^15.1.0', react: '19.0.0', events: '3.3.0' } })],
    ['apps/docs/package.json', JSON.stringify({ devDependencies: { next: '14.2.3' } })],
    ['apps/broken/package.json', '{ not json'],
    ['node_modules/next/package.json', JSON.stringify({ dependencies: { next: '1.0.0' } })],
    ['apps/web/tsconfig.json', '{}'],
  ]);
  const found = nextPackages(texts);
  assert.deepEqual(found.packages, [{ path: 'apps/docs/package.json', field: 'devDependencies', version: '14.2.3' }, { path: 'apps/web/package.json', field: 'dependencies', version: '^15.1.0' }]);
  assert.deepEqual(found.unreadable, ['apps/broken/package.json']);
  assert.ok(found.dependencies.includes('events') && found.dependencies.includes('react'));
  assert.deepEqual(nextPackages(new Map([['package.json', JSON.stringify({ dependencies: { react: '19.0.0' } })]])).packages, []);
});

test('the route inventory reads app, src/app, pages, src/pages and middleware below each Next.js root', () => {
  const paths = ['app/page.tsx', 'app/(shop)/cart/page.tsx', 'app/api/hello/route.ts', 'app/components/nav.tsx', 'middleware.ts', 'lib/util.ts',
    'apps/web/src/app/layout.tsx', 'apps/web/src/pages/legacy.tsx', 'apps/web/src/pages/api/ping.ts', 'apps/web/src/middleware.js', 'apps/web/app.tsx', 'other/app/page.tsx'];
  const routes = nextRoutes(paths, [{ path: 'package.json' }, { path: 'apps/web/package.json' }]);
  assert.deepEqual(routes.map((route) => [route.path, route.root, route.router, route.kind, route.url]), [
    ['app/(shop)/cart/page.tsx', '.', 'app', 'page', '/cart'],
    ['app/api/hello/route.ts', '.', 'app', 'route', '/api/hello'],
    ['app/page.tsx', '.', 'app', 'page', '/'],
    ['apps/web/src/app/layout.tsx', 'apps/web', 'app', 'layout', '/'],
    ['apps/web/src/middleware.js', 'apps/web', 'middleware', 'middleware', null],
    ['apps/web/src/pages/api/ping.ts', 'apps/web', 'pages', 'api', '/api/ping'],
    ['apps/web/src/pages/legacy.tsx', 'apps/web', 'pages', 'page', '/legacy'],
    ['middleware.ts', '.', 'middleware', 'middleware', null],
  ]);
  assert.deepEqual(nextRoutes(paths, []), []);
});

test('a monorepo that lists next only in its top package.json gets the routes of each folder with a next.config file', () => {
  const paths = ['apps/web/next.config.mjs', 'apps/web/app/(shop)/cart/page.tsx', 'apps/admin/next.config.ts', 'apps/admin/src/middleware.ts', 'apps/cli/app/page.tsx',
    'node_modules/x/next.config.js', 'node_modules/x/app/page.js'];
  assert.deepEqual(nextRoutes(paths, [{ path: 'package.json' }]).map((route) => [route.path, route.root, route.url]),
    [['apps/admin/src/middleware.ts', 'apps/admin', null], ['apps/web/app/(shop)/cart/page.tsx', 'apps/web', '/cart']]);
  assert.deepEqual(nextRoutes(paths, []), [], 'a next.config file without a package.json that lists next is no root');
});
