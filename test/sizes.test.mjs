// Hand-written Next.js manifests exercise byte accounting, containment and bound comparisons.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { readSizes } from '../lib/sizes.mjs';
import { renderReport } from '../lib/verify-report.mjs';
import { compareSizes, validateSizes } from '../lib/size-report.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-sizes-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  const json = (path, value) => put(path, JSON.stringify(value));
  put('BUILD_ID', 'fixture-build\n');
  put('static/chunks/shared.js', 'shared'); put('static/chunks/home.js', 'home');
  put('static/chunks/poly.js', 'poly'); put('static/chunks/app.js', 'app');
  put('static/css/main.css', 'body{}'); put('static/media/logo.svg', '<svg/>');
  return { root, put, json };
}
const pages = { pages: { '/_app': ['static/chunks/app.js'], '/home': ['static/chunks/home.js', 'static/chunks/shared.js'] },
  rootMainFiles: ['static/chunks/shared.js'], polyfillFiles: ['static/chunks/poly.js'] };

test('reads Pages Router first loads as a union and totals every static asset', (t) => {
  const { root, json } = fixture(t); json('build-manifest.json', pages);
  const report = readSizes(root);
  assert.equal(report.reportType, 'code-map-sizes'); assert.equal(report.schemaVersion, 1);
  assert.equal(report.buildId, 'fixture-build'); assert.equal(report.nextVersion, null);
  assert.deepEqual(report.routes.map(({ route, bytes }) => [route, bytes]), [['/home', 17]]);
  assert.equal(report.routes[0].gzipBytes, ['shared', 'home', 'poly', 'app'].reduce((n, text) => n + gzipSync(text).length, 0));
  assert.deepEqual(report.totals.chunks, { files: 4, bytes: 17, gzipBytes: 97 });
  assert.equal(report.totals.css.bytes, 6); assert.equal(report.totals.media.bytes, 6);
  assert.equal(validateSizes(report).ok, true);
});

test('reads App Router pages with ancestor layouts, route groups and shared roots', (t) => {
  const { root, json } = fixture(t);
  json('build-manifest.json', { pages: {}, rootMainFiles: ['static/chunks/shared.js'], polyfillFiles: [] });
  json('app-build-manifest.json', { pages: { '/layout': ['static/chunks/app.js'], '/(site)/layout': ['static/chunks/poly.js'],
    '/(site)/home/page': ['static/chunks/home.js', 'static/chunks/shared.js'] } });
  const report = readSizes(root);
  assert.deepEqual(report.routes.map(({ route, bytes }) => [route, bytes]), [['/home', 17]]);
  assert.deepEqual(report.formats, ['build-manifest.json', 'app-build-manifest.json']);
});

test('reads the documented fallback filename and rootMainFilesTree shape', (t) => {
  const { root, json } = fixture(t);
  json('fallback-build-manifest.json', { pages: {}, rootMainFiles: [], polyfillFiles: ['static/chunks/poly.js'],
    rootMainFilesTree: { '/home/page': ['static/chunks/home.js', 'static/chunks/shared.js'] } });
  const report = readSizes(root);
  assert.deepEqual(report.routes.map(({ route, bytes }) => [route, bytes]), [['/home', 14]]);
  assert.deepEqual(report.formats, ['fallback-build-manifest.json']);
});

test('refuses missing and malformed manifests with clear errors', (t) => {
  const { root, json } = fixture(t);
  assert.throws(() => readSizes(root), /No supported Next.js build manifest/);
  json('build-manifest.json', { pages: { '/': 'invalid' } });
  assert.throws(() => readSizes(root), /manifest.*array/i);
});

test('refuses traversal and symlinks outside the build folder', (t) => {
  const { root, json } = fixture(t);
  json('build-manifest.json', { ...pages, pages: { '/': ['../outside.js'] } });
  assert.throws(() => readSizes(root), /outside|static/);
  symlinkSync(tmpdir(), join(root, 'static', 'escape'));
  json('build-manifest.json', pages);
  assert.throws(() => readSizes(root), /outside/);
});

test('enforces file, entry and aggregate byte limits before reading assets', (t) => {
  const { root, json } = fixture(t); json('build-manifest.json', pages);
  assert.throws(() => readSizes(root, { files: 2 }), /limit/);
  assert.throws(() => readSizes(root, { bytes: 12 }), /limit|larger/);
  assert.throws(() => readSizes(root, { fileBytes: 3 }), /larger/);
  assert.throws(() => readSizes(root, { entries: 2 }), /limit/);
});

test('rejects invalid imported size reports and duplicate routes', (t) => {
  const { root, json } = fixture(t); json('build-manifest.json', pages);
  const report = readSizes(root);
  assert.equal(validateSizes({ ...report, schemaVersion: 2 }).ok, false);
  assert.equal(validateSizes({ ...report, artifact: 'forged.json' }).ok, false);
  assert.equal(validateSizes({ ...report, routes: [report.routes[0], report.routes[0]] }).ok, false);
  assert.equal(validateSizes({ ...report, routes: [{ ...report.routes[0], bytes: -1 }] }).ok, false);
  assert.equal(validateSizes({ ...report, totals: {} }).ok, false);
});

test('compares growth in descending order and leaves percentages null for a zero base', (t) => {
  const { root, json } = fixture(t); json('build-manifest.json', pages);
  const report = readSizes(root), base = { ...report, routes: [{ route: '/a', files: [], bytes: 0, gzipBytes: 0 }] };
  const head = { ...report, routes: [{ route: '/a', files: [], bytes: 10, gzipBytes: 5 }] };
  assert.deepEqual(compareSizes({ head: [head], base: [base] }).routes[0].change, { bytes: 10, percent: null, gzipBytes: 5, gzipPercent: null });
});

function project(t) {
  const f = fixture(t), root = f.root;
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@local', ...args], { encoding: 'utf8' }).trim();
  f.put('.gitignore', 'reports/\nstatic/\nBUILD_ID\n*manifest.json\n'); f.put('src/main.js', 'export const value = 1;\n');
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  const run = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 30000 });
  const bind = (name, routes) => {
    f.json('build-manifest.json', { pages: routes, rootMainFiles: [], polyfillFiles: [] });
    const size = run(['sizes', '--dir', '.', '--out', `reports/${name}.json`]);
    assert.equal(size.status, 0, size.stderr);
    const manifest = run(['manifest', '--artifact', `reports/${name}.json`, '--kind', 'sizes', '--exit-status', '0',
      '--out', `reports/${name}.manifest.json`, '--', 'npm', 'run', 'build']);
    assert.equal(manifest.status, 0, manifest.stderr);
    return { artifact: `reports/${name}.json`, manifest: `reports/${name}.manifest.json` };
  };
  const work = mkdtempSync(join(tmpdir(), 'code-map-sizes-verify-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const verify = (pairs) => {
    const request = { requestType: 'code-map-verification-request', schemaVersion: 1, base, head: 'worktree', intent: 'Measure assets.',
      acceptanceCriteria: [], allowedPaths: ['src/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: pairs,
      execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 30, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } };
    writeFileSync(join(work, 'request.json'), JSON.stringify(request));
    const result = run(['verify', '--request', join(work, 'request.json'), '--store', join(work, 'store'), '--out-dir', join(work, 'out')]);
    assert.equal(result.status, 3, result.stderr);
    const summary = JSON.parse(result.stdout);
    return { results: JSON.parse(readFileSync(summary.files.results, 'utf8')), markdown: readFileSync(summary.files.report, 'utf8') };
  };
  return { ...f, bind, verify };
}

test('sizes and manifest feed verify with growth, new routes, removed routes and totals', (t) => {
  const { put, bind, verify } = project(t);
  const base = bind('base', { '/home': ['static/chunks/home.js'], '/removed': ['static/chunks/app.js'] });
  put('src/main.js', 'export const value = 2;\n');
  const head = bind('head', { '/home': ['static/chunks/home.js', 'static/chunks/shared.js'], '/new': ['static/chunks/poly.js'] });
  const { results, markdown } = verify([base, head]);
  assert.deepEqual(results.executions.map(({ kind, binding, side, eligible }) => [kind, binding, side, eligible]),
    [['sizes', 'BOUND', 'base', true], ['sizes', 'BOUND', 'head', true]]);
  assert.equal(results.sizes.routes[0].route, '/home');
  assert.equal(results.sizes.routes[0].change.bytes, 6); assert.equal(results.sizes.routes[0].change.percent, 150);
  assert.deepEqual(results.sizes.added.map((r) => r.route), ['/new']); assert.deepEqual(results.sizes.removed.map((r) => r.route), ['/removed']);
  assert.equal(results.sizes.totals.chunks.change.bytes, 0);
  assert.match(markdown, /First-load JavaScript/); assert.match(markdown, /150%/);
  assert.ok(markdown.split('\n').length <= 200);
  const crowded = renderReport({ ...results,
    obligations: Array.from({ length: 200 }, (_, i) => ({ ...results.obligations[0], id: `check-${i}`, result: i % 2 ? 'FAIL' : 'UNKNOWN', eligible: true })),
    executions: Array.from({ length: 100 }, () => results.executions[0]), limits: Array.from({ length: 100 }, () => 'A limit.'),
    sizes: { ...results.sizes, routes: Array.from({ length: 100 }, () => results.sizes.routes[0]) } });
  assert.ok(crowded.split('\n').length <= 200, `${crowded.split('\n').length} lines`);
  assert.equal(results.obligations.some((item) => item.id.includes('sizes')), false);
});

for (const side of ['head', 'base']) test(`verify shows values without changes for a ${side}-only size report`, (t) => {
  const { put, bind, verify } = project(t);
  if (side === 'head') put('src/main.js', 'export const value = 2;\n');
  const pair = bind(side, { '/home': ['static/chunks/home.js'] });
  if (side === 'base') put('src/main.js', 'export const value = 2;\n');
  const { results, markdown } = verify([pair]);
  assert.equal(results.sizes.state, `${side.toUpperCase()}_ONLY`);
  assert.equal(results.sizes.routes[0][side].bytes, 4); assert.equal(results.sizes.routes[0].change, null);
  assert.match(markdown, /No size change is available/);
});

test('reads the recorded framework version and bounds metadata reads', (t) => {
  const { root, json, put } = fixture(t); json('build-manifest.json', pages);
  json('diagnostics/framework.json', { name: 'Next.js', version: '16.2.4' });
  assert.equal(readSizes(root).nextVersion, '16.2.4');
  put('BUILD_ID', 'x'.repeat(5000));
  assert.throws(() => readSizes(root), /BUILD_ID/);
});

test('includes ancestor templates without counting sibling layouts', (t) => {
  const { root, json } = fixture(t);
  json('app-build-manifest.json', { pages: { '/layout': ['static/chunks/shared.js'], '/template': ['static/chunks/app.js'],
    '/other/layout': ['static/chunks/poly.js'], '/home/page': ['static/chunks/home.js'] } });
  assert.equal(readSizes(root).routes[0].bytes, 13);
});

test('sorts several growing routes and preserves ambiguity instead of choosing a report', (t) => {
  const { root, json } = fixture(t); json('build-manifest.json', pages);
  const report = readSizes(root);
  const base = { ...report, routes: [{ route: '/small', bytes: 10, gzipBytes: 5 }, { route: '/large', bytes: 10, gzipBytes: 5 }] };
  const head = { ...report, routes: [{ route: '/small', bytes: 12, gzipBytes: 6 }, { route: '/large', bytes: 30, gzipBytes: 15 }] };
  assert.deepEqual(compareSizes({ base: [base], head: [head] }).routes.map((r) => r.route), ['/large', '/small']);
  assert.equal(compareSizes({ base: [base], head: [head, head] }).state, 'AMBIGUOUS');
});

test('verify refuses stale and malformed bound size reports', (t) => {
  const { put, root, bind, verify } = project(t);
  put('src/main.js', 'export const value = 2;\n');
  const pair = bind('bad', { '/home': ['static/chunks/home.js'] });
  const value = JSON.parse(readFileSync(join(root, pair.artifact), 'utf8'));
  put(pair.artifact, JSON.stringify({ ...value, schemaVersion: 2 }));
  const stale = verify([pair]).results;
  assert.equal(stale.executions[0].eligible, false); assert.equal(stale.sizes, null);
  const command = spawnSync(process.execPath, [cli, 'manifest', '--artifact', pair.artifact, '--kind', 'sizes', '--exit-status', '0',
    '--out', pair.manifest, '--', 'npm', 'run', 'build'], { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(command.status, 0, command.stderr);
  const malformed = verify([pair]).results;
  assert.equal(malformed.executions[0].reasons[0].key, 'parse'); assert.equal(malformed.sizes, null);
});

test('refuses a manifest symlink outside the build folder and invalid version metadata', (t) => {
  const f = fixture(t), outside = fixture(t);
  outside.json('build-manifest.json', pages);
  symlinkSync(join(outside.root, 'build-manifest.json'), join(f.root, 'build-manifest.json'));
  assert.throws(() => readSizes(f.root), /outside/);
  rmSync(join(f.root, 'build-manifest.json'));
  f.json('build-manifest.json', pages);
  f.json('diagnostics/framework.json', { name: 'Next.js', version: '' });
  assert.throws(() => readSizes(f.root), /metadata/);
});

test('sizes defaults to .next and requires an output file', (t) => {
  const { root, json } = fixture(t); json('build-manifest.json', pages);
  mkdirSync(join(root, '.next'));
  renameSync(join(root, 'static'), join(root, '.next/static'));
  renameSync(join(root, 'BUILD_ID'), join(root, '.next/BUILD_ID'));
  renameSync(join(root, 'build-manifest.json'), join(root, '.next/build-manifest.json'));
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  const run = (...args) => spawnSync(process.execPath, [cli, 'sizes', ...args], { cwd: root, encoding: 'utf8', timeout: 30000 });
  const missing = run(); assert.equal(missing.status, 1); assert.match(missing.stderr, /--out/);
  const output = run('--out', 'report.json'); assert.equal(output.status, 0, output.stderr);
  assert.equal(JSON.parse(readFileSync(join(root, 'report.json'), 'utf8')).buildId, 'fixture-build');
});

test('Pages Router excludes App Router roots and includes low-priority scripts once', (t) => {
  const { root, json, put } = fixture(t);
  put('static/build/_buildManifest.js', 'manifest');
  json('build-manifest.json', { ...pages, rootMainFiles: ['static/chunks/app-only.js'],
    lowPriorityFiles: ['static/build/_buildManifest.js', 'static/chunks/shared.js'] });
  put('static/chunks/app-only.js', 'app-only');
  const report = readSizes(root);
  assert.deepEqual(report.routes[0].files, ['static/build/_buildManifest.js', 'static/chunks/app.js',
    'static/chunks/home.js', 'static/chunks/poly.js', 'static/chunks/shared.js']);
  assert.equal(report.routes[0].bytes, 25);
  assert.equal(validateSizes(report).ok, true);
});

test('rejects a null primary build manifest even when a fallback exists', (t) => {
  const { root, json } = fixture(t);
  json('build-manifest.json', null);
  assert.throws(() => readSizes(root), /Build manifest must be an object/);
  json('fallback-build-manifest.json', pages);
  assert.throws(() => readSizes(root), /Build manifest must be an object/);
});

for (const field of ['rootMainFiles', 'polyfillFiles', 'rootMainFilesTree', 'lowPriorityFiles']) {
  test(`rejects null ${field} instead of treating it as absent`, (t) => {
    const { root, json } = fixture(t);
    json('build-manifest.json', { ...pages, [field]: null });
    assert.throws(() => readSizes(root), /Build manifest/);
  });
}
