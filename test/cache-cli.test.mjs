import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));

/** Mixed source kinds, framework facts, import aliases, tests and a syntax error. */
const files = {
  'package.json': JSON.stringify({ name: 'mixed', dependencies: { next: '15.1.0', react: '19.0.0' } }),
  'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./*'] }, jsx: 'preserve' } }),
  'app/layout.tsx': 'export default function RootLayout({ children }: { children: unknown }) { return <html><body>{children}</body></html>; }\n',
  'app/page.tsx': "import { Counter } from '@/components/counter';\nimport { total } from '../lib/math';\nexport default function Page() { return <main><Counter />{total([1, 2])}<button onClick={() => 1}>Go</button></main>; }\n",
  'app/api/items/route.ts': "import { parse } from '@/lib/math';\nexport async function GET() { return Response.json([parse('1')]); }\n",
  'components/counter.tsx': "'use client';\nimport { useState } from 'react';\nexport function Counter() {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(count + 1)}>{count}{process.env.NEXT_PUBLIC_NAME}</button>;\n}\n",
  'components/view.jsx': "import { legacy } from '../lib/legacy';\nexport const View = ({ name }) => <p title={name}>{legacy(name)}</p>;\n",
  'lib/math.ts': "/** Math helpers. */\nimport type { Shape } from './types';\nexport function parse(text: string): number;\nexport function parse(text: string, base: number): number;\n"
    + "export function parse(text: string, base = 10) {\n  const value = Number.parseInt(text, base);\n  if (Number.isNaN(value)) throw new Error('not a number');\n  return value;\n}\n"
    + 'export const total = (list: number[]) => list.reduce((sum, item) => sum + item, 0);\nexport class Box implements Shape { area() { return 1; } static of() { return new Box(); } }\n',
  'lib/types.ts': 'export interface Shape { area(): number }\nexport type Unit = "cm" | "mm";\n',
  'lib/legacy.js': "const { total } = require('./math');\nfunction legacy(name) { return name ? total([name.length]) : null; }\nmodule.exports = { legacy };\nexports.extra = () => import('./types');\n",
  'lib/esm.mjs': "import { parse } from './math';\nexport default function run(value) { try { return parse(value); } catch (error) { return { error }; } }\n",
  'lib/broken.ts': "import { total } from './math';\nexport function broken( {\n  return total(\n",
  'lib/server.ts': "import 'server-only';\nexport const secret = process.env.SECRET_KEY;\n",
  'test/math.test.ts': "import { describe, it, expect } from 'vitest';\nimport { parse, total } from '../lib/math';\ndescribe('math', () => {\n"
    + "  it('parses', () => { expect(parse('2')).toBe(2); });\n  it('rejects text', () => { expect(() => parse('x')).toThrow('not a number'); });\n  it.skip('sums', () => { expect(total([1])).toBe(1); });\n});\n",
  'test/legacy.test.js': "const test = require('node:test');\nconst assert = require('node:assert');\nconst { legacy } = require('../lib/legacy');\ntest('legacy', () => { assert.equal(legacy(''), null); });\n",
  'test/esm.spec.mjs': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport run from '../lib/esm.mjs';\ntest('run returns an error', () => { assert.ok(run('x').error); });\n",
};

function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-cache-')), stores = mkdtempSync(join(tmpdir(), 'code-map-cache-stores-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(stores, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  for (const [path, text] of Object.entries(files)) put(path, text);
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'fixture');
  return { root, put, git, store: (name) => join(stores, name) };
}

function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
}

function summary(root, store, extra = []) {
  const output = run(root, ['inspect', '--summary', '--ref', 'HEAD', '--store', store, ...extra]);
  assert.equal(output.status, 0, output.stderr);
  return JSON.parse(output.stdout);
}

const stored = (store, id) => JSON.parse(gunzipSync(readFileSync(join(store, 'analyses', `${id}.json.gz`))).toString('utf8'));
/** Removes run timestamps and cache counts before checking byte identity. */
const normalized = (analysis) => JSON.stringify({ ...analysis, cache: null }).replaceAll(analysis.createdAt, '<time>');
const cacheLine = (report) => report.limits.find((line) => /file cache/.test(line));

test('a warm file cache gives a byte-identical stored analysis, and the summary counts the hits and misses', (t) => {
  const { root, store } = project(t), first = store('first'), off = store('off');
  const cold = summary(root, first), coldStored = stored(first, cold.analysis.id), count = coldStored.cache.misses;
  assert.ok(count >= 12, `the fixture analyzes ${count} files`);
  assert.deepEqual(coldStored.cache, { state: 'on', hits: 0, misses: count, written: count, removed: 0 });
  assert.ok(coldStored.data.analysis.files.some((file) => file.path === 'lib/broken.ts'), 'the file with a syntax error is in the analysis');
  assert.equal(coldStored.data.analysis.frameworks.nextjs.detected, true);
  assert.equal(readdirSync(join(first, 'files')).length, count);
  rmSync(join(first, 'analyses'), { recursive: true });
  const warm = summary(root, first), warmStored = stored(first, warm.analysis.id);
  assert.equal(warm.analysis.id, cold.analysis.id);
  assert.equal(warm.analysis.reused, false, 'the analysis is new, but its file facts come from the cache');
  assert.deepEqual(warmStored.cache, { state: 'on', hits: count, misses: 0, written: 0, removed: 0 });
  assert.equal(normalized(warmStored), normalized(coldStored));
  const none = summary(root, off, ['--no-cache']), noneStored = stored(off, none.analysis.id);
  assert.deepEqual(noneStored.cache, { state: 'off', hits: 0, misses: count, written: 0, removed: 0 });
  assert.equal(normalized(noneStored), normalized(coldStored), '--no-cache gives the same analysis');
  assert.equal(existsSync(join(off, 'files')), false, '--no-cache writes no files folder');
  assert.equal(cacheLine(cold), `The file cache gave the facts of 0 of ${count} files. Code-map parsed the other ${count} files. A cached fact is the same as a new parse of the same file.`);
  assert.match(cacheLine(warm), new RegExp(`gave the facts of ${count} of ${count} files\\. Code-map parsed the other 0 files`));
  assert.match(cacheLine(none), new RegExp(`file cache was off \\(--no-cache\\)\\. Code-map parsed all ${count} files`));
  const view = (report) => JSON.stringify({ ...report, analysis: { ...report.analysis, createdAt: null }, limits: report.limits.filter((line) => line !== cacheLine(report)) }).replaceAll(off, first);
  assert.equal(view(warm), view(cold), 'the summaries differ only in the cache line');
  assert.equal(view(none), view(cold));
});

test('verify parses only the changed files of the base when the head analysis filled the cache, and gives the results of --no-cache', (t) => {
  const { root, put, git, store } = project(t), cached = store('cached'), off = store('off');
  put('lib/math.ts', `${files['lib/math.ts']}export const extra = 2;\n`);
  git('commit', '-qam', 'small change');
  const request = store('request.json');
  writeFileSync(request, JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1, base: 'HEAD~1', head: 'HEAD', intent: 'Add a constant.', acceptanceCriteria: [],
    allowedPaths: null, changeType: 'feature', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
    execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } }));
  const verify = (folder, extra = []) => {
    const output = run(root, ['verify', '--request', request, '--store', folder, ...extra]);
    assert.ok(output.status >= 0 && output.status <= 3, output.stderr);
    const printed = JSON.parse(output.stdout), results = JSON.parse(readFileSync(printed.files.results, 'utf8'));
    return { results, head: stored(folder, results.head.analysisId), base: stored(folder, results.base.analysisId) };
  };
  const first = verify(cached), count = first.head.cache.misses;
  assert.deepEqual(first.head.cache, { state: 'on', hits: 0, misses: count, written: count, removed: 0 });
  assert.deepEqual(first.base.cache, { state: 'on', hits: count - 1, misses: 1, written: 1, removed: 0 }, 'only lib/math.ts differs between the base and the head');
  const none = verify(off, ['--no-cache']);
  assert.equal(none.base.cache.state, 'off');
  const plain = ({ results }, folder) => JSON.stringify({ ...results, runId: null, createdAt: null }).replaceAll(folder, '<store>');
  assert.equal(plain(none, off), plain(first, cached));
  assert.equal(normalized(none.base), normalized(first.base));
  assert.equal(normalized(none.head), normalized(first.head));
});

test('--no-cache needs --summary with inspect, and a files folder that points into the repository is refused', (t) => {
  const { root, store } = project(t), linked = store('linked');
  for (const args of [['inspect', '--no-cache'], ['inspect', '--analysis', 'A-0123456789abcdef', '--no-cache']]) {
    const output = run(root, args);
    assert.equal(output.status, 1);
    assert.match(output.stderr, /--no-cache needs --summary/);
  }
  mkdirSync(linked);
  symlinkSync(join(root, 'lib'), join(linked, 'files'));
  const output = run(root, ['inspect', '--summary', '--ref', 'HEAD', '--store', linked]);
  assert.equal(output.status, 1);
  assert.match(output.stderr, /inside the repository/);
  assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }), '', 'nothing was written into the repository');
});

test('configuration and dependency-lock changes invalidate the file cache in new snapshots', (t) => {
  const { root, store, put, git } = project(t), folder = store('lock');
  const cold = summary(root, folder), count = stored(folder, cold.analysis.id).cache.misses;
  put('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: {} }));
  git('add', 'package-lock.json'); git('commit', '-qm', 'add lockfile');
  const next = summary(root, folder), record = stored(folder, next.analysis.id).cache;
  assert.equal(record.hits, 0);
  assert.equal(record.misses, count);
  put('.code-map.json', JSON.stringify({ history: 399 }));
  git('add', '.code-map.json'); git('commit', '-qm', 'change settings');
  const configured = summary(root, folder), changed = stored(folder, configured.analysis.id).cache;
  assert.equal(changed.hits, 0);
  assert.equal(changed.misses, count);
});

test('--no-cache reparses a snapshot already stored in the same store', (t) => {
  const { root, store } = project(t), folder = store('reuse');
  const cold = summary(root, folder), count = stored(folder, cold.analysis.id).cache.misses;
  const none = summary(root, folder, ['--no-cache']);
  assert.equal(none.analysis.reused, false);
  assert.deepEqual(stored(folder, none.analysis.id).cache, { state: 'off', hits: 0, misses: count, written: 0, removed: 0 });
});

test('an unavailable cache reports counts without its folder error in the summary', (t) => {
  const { root, store } = project(t), folder = store('unavailable'), target = store('target');
  mkdirSync(folder); mkdirSync(target);
  symlinkSync(target, join(folder, 'files'));
  const report = summary(root, folder), record = stored(folder, report.analysis.id).cache;
  assert.equal(record.state, 'unavailable');
  assert.equal(cacheLine(report), `The file cache was unavailable. Code-map parsed all ${record.misses} files.`);
  assert.match(record.reason, /symlink/);
});
