// Hand-written Next.js 16 client references test safe parsing and complete asset unions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { readSizes } from '../lib/sizes.mjs';
import { validateSizes } from '../lib/size-report.mjs';

const init = 'globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\n';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'sizes-next16-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const json = (path, value) => put(path, JSON.stringify(value));
  const client = (entry, value) => put(`server/app${entry}_client-reference-manifest.js`, `${init}globalThis.__RSC_MANIFEST[${JSON.stringify(entry)}] = ${JSON.stringify(value)};\n`);
  put('BUILD_ID', 'next16-fixture');
  put('static/chunks/root.js', 'root'); put('static/chunks/poly.js', 'poly');
  put('static/chunks/layout.js', 'layout'); put('static/chunks/home.js', 'home'); put('static/chunks/settings.js', 'settings');
  put('static/chunks/style.css', 'body{}');
  json('build-manifest.json', { pages: {}, rootMainFiles: ['static/chunks/root.js'], polyfillFiles: ['static/chunks/poly.js'] });
  json('app-path-routes-manifest.json', { '/page': '/', '/settings/page': '/preferences', '/api/chat/route': '/api/chat' });
  const reference = (page) => ({ moduleLoading: {}, clientModules: {}, entryJSFiles: {
    '[project]/app/layout': ['static/chunks/layout.js', 'static/chunks/root.js'],
    [`[project]/app/${page}`]: [`static/chunks/${page}.js`, 'static/chunks/layout.js'] },
  entryCSSFiles: { '[project]/app/layout': [{ path: 'static/chunks/style.css', inlined: false }, { path: 'static/chunks/style.css', inlined: false }] } });
  client('/page', reference('home')); client('/settings/page', reference('settings'));
  return { root, put, json, client, reference };
}

test('reads Next.js 16 routes, shared first-load unions, CSS and zero-byte handlers', (t) => {
  const { root } = fixture(t), report = readSizes(root);
  assert.deepEqual(report.routes.map((r) => [r.route, r.bytes]), [['/', 18], ['/api/chat', 0], ['/preferences', 22]]);
  assert.deepEqual(report.routes[0].files, ['static/chunks/home.js', 'static/chunks/layout.js', 'static/chunks/poly.js', 'static/chunks/root.js']);
  assert.equal(report.routes[0].gzipBytes, ['home', 'layout', 'poly', 'root'].reduce((n, s) => n + gzipSync(s).length, 0));
  assert.deepEqual(report.routes[0].css, { files: ['static/chunks/style.css'], bytes: 6, gzipBytes: gzipSync('body{}').length });
  assert.deepEqual(report.totals.css, { files: 1, bytes: 6, gzipBytes: gzipSync('body{}').length });
  assert.ok(report.formats.includes('page_client-reference-manifest.js'));
  assert.ok(report.formats.includes('app-path-routes-manifest.json'));
  assert.deepEqual(report.unsupported, []);
  assert.equal(validateSizes(report).ok, true);
});

test('accepts the form that Next.js 16.1 writes: no semicolon and no line break after the object', (t) => {
  const { root, put, reference } = fixture(t);
  put('server/app/page_client-reference-manifest.js', `${init}globalThis.__RSC_MANIFEST["/page"] = ${JSON.stringify(reference('home'))}`);
  assert.deepEqual(readSizes(root).routes.map((r) => [r.route, r.bytes]), [['/', 18], ['/api/chat', 0], ['/preferences', 22]]);
});

for (const text of [
  `${init}globalThis.__RSC_MANIFEST["/page"] = getManifest();`,
  `${init}globalThis.__RSC_MANIFEST["/page"] = {}; globalThis.executed = true;`,
  'globalThis.__RSC_MANIFEST["/page"] = {};',
  `${init}globalThis.__RSC_MANIFEST["/page"] = {"entryJSFiles":call()};`,
]) test(`refuses executable or unexpected client reference syntax: ${text.slice(-45)}`, (t) => {
  const { root, put } = fixture(t);
  put('server/app/page_client-reference-manifest.js', text);
  assert.throws(() => readSizes(root), /client reference.*(JSON|assignment|form)/i);
});

test('reports every page without route assets, including partially supported builds', (t) => {
  const { root } = fixture(t);
  rmSync(join(root, 'server/app/settings/page_client-reference-manifest.js'));
  assert.deepEqual(readSizes(root).unsupported.map((r) => r.route), ['/preferences']);
  rmSync(join(root, 'server/app/page_client-reference-manifest.js'));
  const report = readSizes(root);
  assert.deepEqual(report.unsupported.map((r) => r.route), ['/', '/preferences']);
  assert.match(report.unsupported[0].reason, /client reference/);
  assert.equal(validateSizes(report).ok, true);
});

test('client reference reads count toward file and byte limits', (t) => {
  const { root } = fixture(t);
  assert.throws(() => readSizes(root, { files: 3 }), /limit/);
  assert.throws(() => readSizes(root, { fileBytes: 400 }), /limit/);
});

for (const value of [null, { entryJSFiles: null, entryCSSFiles: {} },
  { entryJSFiles: {}, entryCSSFiles: { layout: [{ path: '../escape.css', inlined: false }] } },
  { entryJSFiles: { page: ['static/chunks/missing.js'] }, entryCSSFiles: {} },
]) test(`refuses malformed or missing reference assets: ${JSON.stringify(value)}`, (t) => {
  const { root, client } = fixture(t); client('/page', value);
  assert.throws(() => readSizes(root), /client reference|static|missing/i);
});

test('rejects forged CSS accounting and malformed unsupported notes on import', (t) => {
  const { root } = fixture(t), report = readSizes(root);
  assert.equal(validateSizes({ ...report, unsupported: ['untyped'] }).ok, false);
  assert.equal(validateSizes({ ...report, routes: [{ ...report.routes[0], css: { files: [], bytes: 6, gzipBytes: 26 } }] }).ok, false);
});

for (const legacy of ['app-build-manifest.json', 'rootMainFilesTree']) test(`uses mapped URLs for ${legacy} without duplicate routes`, (t) => {
  const { root, json } = fixture(t);
  const entries = { '/settings/page': ['static/chunks/settings.js'] };
  if (legacy === 'app-build-manifest.json') json(legacy, { pages: entries });
  else json('build-manifest.json', { pages: {}, rootMainFilesTree: entries });
  rmSync(join(root, 'server/app/settings/page_client-reference-manifest.js'));
  const report = readSizes(root);
  assert.deepEqual(report.routes.map((r) => r.route), ['/', '/api/chat', '/preferences']);
  assert.deepEqual(report.unsupported, []);
});


test('rejects a client reference whose assignment key belongs to another page', (t) => {
  const { root, put, reference } = fixture(t);
  put('server/app/page_client-reference-manifest.js', `${init}globalThis.__RSC_MANIFEST["/other/page"] = ${JSON.stringify(reference('home'))};`);
  assert.throws(() => readSizes(root), /client reference entry/);
});

for (const paths of [null, { '/page': 42 }, { '/../page': '/' }]) test(`rejects invalid App Router mappings: ${JSON.stringify(paths)}`, (t) => {
  const { root, json } = fixture(t); json('app-path-routes-manifest.json', paths);
  assert.throws(() => readSizes(root), /App path route/);
});

test('rejects a client reference symlink that leaves the build folder', (t) => {
  const target = fixture(t), outside = fixture(t);
  rmSync(join(target.root, 'server/app/page_client-reference-manifest.js'));
  symlinkSync(join(outside.root, 'server/app/page_client-reference-manifest.js'), join(target.root, 'server/app/page_client-reference-manifest.js'));
  assert.throws(() => readSizes(target.root), /outside/);
});

test('charges client reference bytes against the aggregate input limit', (t) => {
  const { root } = fixture(t);
  const before = statSync(join(root, 'build-manifest.json')).size + statSync(join(root, 'app-path-routes-manifest.json')).size;
  const reference = statSync(join(root, 'server/app/page_client-reference-manifest.js')).size;
  assert.throws(() => readSizes(root, { bytes: before + reference - 1 }), /size limit/);
});

test('includes shared roots for a page with empty client asset maps', (t) => {
  const { root, client } = fixture(t); client('/page', { entryJSFiles: {}, entryCSSFiles: {} });
  const report = readSizes(root);
  assert.deepEqual(report.routes[0].files, ['static/chunks/poly.js', 'static/chunks/root.js']);
  assert.deepEqual(report.routes[0].css, { files: [], bytes: 0, gzipBytes: 0 });
});
