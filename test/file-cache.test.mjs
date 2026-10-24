import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { fileKey, openFileCache } from '../lib/file-cache.mjs';
import { analyzer } from '../lib/inputs.mjs';

const posix = { skip: process.platform === 'win32' && 'needs POSIX owners, modes and symlinks' };
const paths = ['src/a.ts', 'src/b.ts', 'src/c/index.ts', 'test/a.test.ts'];
const resolve = createResolver(new Set(paths), { aliases: [], baseUrl: null });
const sourceA = "import { b } from './b';\nimport { c } from './c';\n/** Runs. */\nexport function run(x: number) {\n  if (x < 0) throw new Error('bad');\n  return b(x) + c;\n}\n";
const testA = "import { test, expect } from 'vitest';\nimport { run } from '../src/a';\ntest('run rejects a negative value', () => { expect(() => run(-1)).toThrow('bad'); });\n";
const day = 24 * 60 * 60 * 1000;

function store(t) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-file-cache-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const entries = (root) => readdirSync(join(root, 'files')).filter((name) => /^[0-9a-f]{64}\.json\.gz$/.test(name)).sort();
const entryOf = (root, path, text, tests = false) => join(root, 'files', `${fileKey(path, text, { tests })}.json.gz`);
/** One run of the cache: the facts of each file and the counts that the stored analysis records. */
function run(root, files, options = {}, resolver = resolve) {
  const cache = openFileCache(root, options);
  const facts = files.map(([path, text, tests]) => cache.analyze(path, text, resolver, tests ? { tests: true } : {}));
  return { facts, record: cache.finish() };
}

test('a cache hit gives the same facts as a new parse, for a source file and a test file', posix, (t) => {
  const root = store(t), files = [['src/a.ts', sourceA], ['test/a.test.ts', testA, true]];
  const cold = run(root, files), warm = run(root, files);
  assert.deepEqual(cold.record, { state: 'on', hits: 0, misses: 2, written: 2, removed: 0 });
  assert.deepEqual(warm.record, { state: 'on', hits: 2, misses: 0, written: 0, removed: 0 });
  const fresh = [analyzeFile('src/a.ts', sourceA, resolve), analyzeFile('test/a.test.ts', testA, resolve, { tests: true })];
  assert.deepEqual(cold.facts, fresh);
  assert.deepEqual(warm.facts, fresh);
  assert.ok(warm.facts[1].testScan.cases.length === 1 && warm.facts[0].declarations.length === 1, 'the facts hold the test scan and the declarations');
  assert.equal(statSync(join(root, 'files')).mode & 0o777, 0o700);
  for (const name of entries(root)) assert.equal(statSync(join(root, 'files', name)).mode & 0o777, 0o600);
});

test('the key changes with the content, the path, the settings and the analyzer version, and nothing else', () => {
  const key = fileKey('src/a.ts', sourceA, { tests: false });
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(fileKey('src/a.ts', sourceA, { tests: false }), key, 'the same inputs give the same key');
  const others = [fileKey('src/a.ts', sourceA + ' ', { tests: false }), fileKey('src/z.ts', sourceA, { tests: false }), fileKey('src/a.ts', sourceA, { tests: true }),
    fileKey('src/a.ts', sourceA, { tests: false }, { ...analyzer(), source: '0'.repeat(64) }), fileKey('src/a.ts', sourceA, { tests: false }, { ...analyzer(), typescript: '0.0.0' })];
  assert.equal(new Set([key, ...others]).size, 6);
});

test('an entry is used only while the resolver gives the same answers, so a new file that an import now reaches invalidates it', posix, (t) => {
  const root = store(t), files = [['src/a.ts', sourceA]];
  run(root, files);
  // With src/c.ts, './c' resolves to that file instead of src/c/index.ts.
  const moved = createResolver(new Set([...paths, 'src/c.ts']), { aliases: [], baseUrl: null });
  const changed = run(root, files, {}, moved);
  assert.deepEqual(changed.record, { state: 'on', hits: 0, misses: 1, written: 1, removed: 0 });
  assert.deepEqual(changed.facts[0], analyzeFile('src/a.ts', sourceA, moved));
  assert.ok(changed.facts[0].imports.includes('src/c.ts'));
  assert.deepEqual(run(root, files, {}, moved).record.hits, 1, 'the new entry serves the new answers');
  assert.deepEqual(entries(root).length, 1, 'one entry for each key');
});

test('a damaged, planted or unreadable entry is a cache miss, never an error, and a new parse replaces it', posix, (t) => {
  const root = store(t), files = [['src/a.ts', sourceA]], path = entryOf(root, 'src/a.ts', sourceA), fresh = analyzeFile('src/a.ts', sourceA, resolve);
  run(root, files);
  const good = readFileSync(path), elsewhere = join(root, 'elsewhere.json.gz');
  writeFileSync(elsewhere, good, { mode: 0o600 });
  const value = (change) => gzipSync(JSON.stringify(change(JSON.parse(gunzipSync(good).toString('utf8')))));
  const damages = [
    ['truncated', () => writeFileSync(path, good.subarray(0, 20))],
    ['not JSON', () => writeFileSync(path, gzipSync('{"cacheVersion":1,'))],
    ['another key', () => writeFileSync(path, value((entry) => ({ ...entry, key: '0'.repeat(64) })))],
    ['another path', () => writeFileSync(path, value((entry) => ({ ...entry, path: 'src/b.ts' })))],
    ['nested facts changed', () => writeFileSync(path, value((entry) => ({ ...entry, facts: { ...entry.facts, declarations: [null] } })))],
    ['resolver answers removed', () => writeFileSync(path, value((entry) => ({ ...entry, resolutions: [] })))],
    ['facts without lists', () => writeFileSync(path, value((entry) => ({ ...entry, facts: { ...entry.facts, edges: 'none' } })))],
    ['answers of the wrong form', () => writeFileSync(path, value((entry) => ({ ...entry, resolutions: [['src/a.ts', 3, null]] })))],
    ['another cache version', () => writeFileSync(path, value((entry) => ({ ...entry, cacheVersion: 0 })))],
    ['writable by others', () => { writeFileSync(path, good); chmodSync(path, 0o666); }],
    ['a symlink', () => { rmSync(path); symlinkSync(elsewhere, path); }],
    ...(process.getuid?.() === 0 ? [] : [['unreadable', () => { writeFileSync(path, good); chmodSync(path, 0o000); }]]),
  ];
  for (const [name, damage] of damages) {
    damage();
    let result;
    assert.doesNotThrow(() => { result = run(root, files); }, name);
    assert.deepEqual(result.record, { state: 'on', hits: 0, misses: 1, written: 1, removed: 0 }, name);
    assert.deepEqual(result.facts[0], fresh, name);
    assert.ok(lstatSync(path).isFile() && (lstatSync(path).mode & 0o777) === 0o600, `${name}: a private file replaces the entry`);
    assert.equal(run(root, files).record.hits, 1, `${name}: the new entry is a hit`);
  }
  rmSync(path);
  mkdirSync(path);
  assert.deepEqual(run(root, files).record, { state: 'on', hits: 0, misses: 1, written: 0, removed: 0 }, 'a folder at the entry path is a miss, and the write fails quietly');
});

test('the cache reads and writes nothing in a files folder that is a symlink or that other users can change', posix, (t) => {
  const root = store(t), elsewhere = join(root, 'elsewhere'), linked = join(root, 'linked'), open = join(root, 'open'), files = [['src/a.ts', sourceA]];
  mkdirSync(elsewhere); mkdirSync(linked); mkdirSync(join(open, 'files'), { recursive: true });
  symlinkSync(elsewhere, join(linked, 'files'));
  chmodSync(join(open, 'files'), 0o777);
  for (const [folder, reason] of [[linked, /symlink/], [open, /other users can change it/]]) {
    const result = run(folder, files);
    assert.equal(result.record.state, 'unavailable');
    assert.match(result.record.reason, reason);
    assert.deepEqual({ ...result.record, reason: null }, { state: 'unavailable', reason: null, hits: 0, misses: 1, written: 0, removed: 0 });
    assert.deepEqual(result.facts[0], analyzeFile('src/a.ts', sourceA, resolve));
  }
  assert.deepEqual(readdirSync(elsewhere), []);
  assert.deepEqual(readdirSync(join(open, 'files')), []);
});

test('pruning removes the entries used least recently until the cache fits its limits, and a hit keeps an old entry', posix, (t) => {
  const root = store(t), file = (index) => [`src/f${index}.ts`, `export const f${index} = ${index};\n`];
  run(root, [file(0), file(1), file(2)]);
  const age = (index, days) => { const time = new Date(Date.now() - days * day); utimesSync(entryOf(root, ...file(index)), time, time); };
  age(0, 3); age(1, 2); age(2, 1);
  // f0 is the oldest, but this run uses it, so f1 is now the least recently used entry.
  const result = run(root, [file(0), file(3)], { limits: { entries: 3, bytes: 1024 * 1024 } });
  assert.deepEqual(result.record, { state: 'on', hits: 1, misses: 1, written: 1, removed: 1 });
  assert.deepEqual(entries(root), [file(0), file(2), file(3)].map((item) => entryOf(root, ...item).split('/').pop()).sort());
  // The byte limit. An entry larger than the limit goes too.
  run(root, [file(4)], { limits: { entries: 100, bytes: 1 } });
  assert.deepEqual(entries(root), []);
  run(root, [file(5)]);
  age(5, 1);
  // f5 and f6 differ in one digit, so ten bytes more than f5 hold one of them, not both.
  const last = run(root, [file(6)], { limits: { entries: 100, bytes: statSync(entryOf(root, ...file(5))).size + 10 } });
  assert.equal(last.record.removed, 1);
  assert.deepEqual(entries(root), [entryOf(root, ...file(6)).split('/').pop()]);
});

test('pruning deletes leftover temporary files older than a day, and keeps other files', posix, (t) => {
  const root = store(t), folder = join(root, 'files'), key = 'a'.repeat(64);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const old = join(folder, `${key}.json.gz.123.abcdefabcdef.tmp`), recent = join(folder, `${key}.json.gz.456.abcdefabcdef.tmp`), other = join(folder, 'notes.txt');
  for (const path of [old, recent, other]) writeFileSync(path, 'x', { mode: 0o600 });
  const time = new Date(Date.now() - 2 * day);
  utimesSync(old, time, time); utimesSync(other, time, time);
  run(root, [['src/a.ts', sourceA]]);
  assert.deepEqual(readdirSync(folder).filter((name) => !/^[0-9a-f]{64}\.json\.gz$/.test(name)).sort(), [`${key}.json.gz.456.abcdefabcdef.tmp`, 'notes.txt']);
});

test('configuration and dependency-lock hashes invalidate per-file entries', (t) => {
  const root = store(t), files = [['src/a.ts', sourceA]];
  const original = { config: 'config-a', lockfile: { path: 'package-lock.json', digest: 'lock-a' } };
  assert.equal(run(root, files, { inputs: original }).record.misses, 1);
  assert.equal(run(root, files, { inputs: original }).record.hits, 1);
  assert.equal(run(root, files, { inputs: { ...original, config: 'config-b' } }).record.misses, 1);
  assert.equal(run(root, files, { inputs: { ...original, lockfile: { ...original.lockfile, digest: 'lock-b' } } }).record.misses, 1);
});

test('a FIFO at an entry path is a cache miss without waiting for a writer', posix, (t) => {
  const root = store(t), path = entryOf(root, 'src/a.ts', sourceA);
  run(root, [['src/a.ts', sourceA]]);
  rmSync(path);
  execFileSync('mkfifo', [path], { timeout: 2000 });
  const script = `import { openFileCache } from ${JSON.stringify(new URL('../lib/file-cache.mjs', import.meta.url).href)};
    const cache = openFileCache(${JSON.stringify(root)});
    cache.analyze('src/a.ts', ${JSON.stringify(sourceA)}, () => null);
    process.stdout.write(JSON.stringify(cache.finish()));`;
  const output = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 2000 });
  assert.equal(output.status, 0, String(output.error ?? output.stderr));
  assert.equal(JSON.parse(output.stdout).misses, 1);
});

test('cached import-equals keeps require resolution separate from static ESM resolution', async (t) => {
  const { readAliases } = await import('../lib/project.mjs');
  const root = store(t), text = "import lost = require('./b'); import './b';";
  const texts = new Map([['package.json', '{"type":"module"}'],
    ['tsconfig.json', '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext"}}'], ['src/a.ts', text], ['src/b.ts', 'export const b = 1;']]);
  const own = createResolver(new Set(texts.keys()), readAliases(texts));
  const cold = run(root, [['src/a.ts', text]], {}, own), warm = run(root, [['src/a.ts', text]], {}, own);
  assert.deepEqual(cold.facts[0].edges.map((edge) => edge.target), ['src/b.ts', null]);
  assert.deepEqual(warm.facts, cold.facts);
  assert.equal(warm.record.hits, 1);
});
