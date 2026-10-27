import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collect, mapData } from '../lib/build.mjs';
import { openFileCache } from '../lib/file-cache.mjs';
import { loadConfig } from '../lib/project.mjs';
import { repository, manifest } from './packages-fixture.mjs';

test('unchanged files reuse path candidates and helper assertions across analyses', (t) => {
  const fixture = repository(t, {
    'package.json': manifest({ name: 'fixture' }),
    'src/main.ts': "const target = './worker.ts'; fork(target);",
    'src/worker.ts': "export function work() { throw new Error('invalid'); }",
    'test/helper.ts': 'export function verify(value) { expect(value).toThrow(); }',
    'test/work.test.ts': `import { work } from '../src/worker'; import { verify } from './helper';
      it('rejects', () => verify(() => work()));`,
  });
  const config = loadConfig(fixture.root), cold = openFileCache(fixture.store);
  const first = collect(fixture.root, config, { ref: 'HEAD' }, cold);
  assert.deepEqual(first.files.find((file) => file.path === 'src/main.ts').pathCandidates[0].literals, ['./worker.ts']);
  assert.equal(first.testFacts.find((file) => file.path === 'test/helper.ts').helperAssertions.verify.assertions, 1);
  assert.equal(cold.finish().misses, 4);
  fixture.put('README.md', 'A second snapshot with unchanged code.');
  fixture.git('add', 'README.md'); fixture.git('commit', '-qm', 'documentation');
  const warm = openFileCache(fixture.store), second = collect(fixture.root, config, { ref: 'HEAD' }, warm);
  assert.deepEqual(warm.finish(), { state: 'on', hits: 4, misses: 0, written: 0, removed: 0 });
  assert.deepEqual(second.testFacts, first.testFacts);
  const data = mapData(fixture.root, config, second, 2);
  assert.deepEqual(data.analysis.tests.cases[0].failureTargets, ['src/worker.ts#work']);
  fixture.put('test/helper.ts', 'export function verify(value) { expect(value).toBeDefined(); }');
  const changed = openFileCache(fixture.store), third = collect(fixture.root, config, { worktree: true }, changed);
  assert.equal(changed.finish().misses, 1);
  assert.deepEqual(mapData(fixture.root, config, third, 2, true).analysis.tests.cases[0].failureTargets, []);
});

test('cached helper links preserve the previous scan for local wrappers and custom assertions', async (t) => {
  const { default: ts } = await import('typescript');
  const { scanTests } = await import('../lib/test-scan.mjs');
  const { localChecker } = await import('../lib/source-metrics.mjs');
  const helper = `import { work } from '../src/worker';
    export function verify(value, expected) { expect(value).toThrow(expected); }
    export function own() { expect(work).toThrow(); }`;
  const text = `import { work } from '../src/worker'; import { verify, own } from './helper';
    import { check as expectError } from './custom';
    function wrap(value, expected) { verify(value, expected); }
    function fallback(value) { expectError(value); }
    function wrapOwn() { own(); }
    it('wraps', () => { wrap(() => work(), 'bad'); expect(work).toThrow(); own(); });
    it('helper reference', () => expect(wrapOwn).toThrow());
    it('fallback', () => fallback(() => work()));
    it('conditional fallback', () => { if (true) expectError(work); });
    it('swallowed fallback', () => { try { expectError(work); } catch {} });`;
  const fixture = repository(t, {
    'package.json': manifest({ name: 'fixture' }),
    'src/worker.ts': "export function work() { throw new Error('invalid'); }",
    'test/helper.ts': helper,
    'test/custom.ts': 'export function check(value) { return value; }',
    'test/work.test.ts': text,
  });
  const config = loadConfig(fixture.root), facts = collect(fixture.root, config, { ref: 'HEAD' });
  const source = ts.createSourceFile('test/work.test.ts', text, ts.ScriptTarget.Latest, true);
  const previous = scanTests(source, localChecker(source), facts.resolveImport, { helperTexts: new Map([['test/helper.ts', helper]]) });
  assert.deepEqual(facts.testFacts.find((file) => file.path === 'test/work.test.ts').testScan, previous);
});

test('helper links keep the limit of 32 imported helper bindings', (t) => {
  const names = Array.from({ length: 33 }, (_, index) => `verify${index}`);
  const fixture = repository(t, {
    'package.json': manifest({ name: 'fixture' }),
    'src/worker.ts': "export function work() { throw new Error('invalid'); }",
    'test/helper.ts': names.map((name) => `export function ${name}(value) { expect(value).toThrow(); }`).join('\n'),
    'test/work.test.ts': `import { work } from '../src/worker'; import { ${names.join(', ')} } from './helper';
      it('rejects', () => { ${names.map((name) => `${name}(work);`).join(' ')} });`,
  });
  const config = loadConfig(fixture.root), facts = collect(fixture.root, config, { ref: 'HEAD' });
  assert.equal(facts.testFacts.find((file) => file.path === 'test/work.test.ts').testScan.cases[0].assertions, 32);
});

test('the file cache keeps helpers and path starts outside source roots', (t) => {
  const fixture = repository(t, {
    '.code-map.json': manifest({ roots: ['src'] }),
    'package.json': manifest({ name: 'fixture' }),
    'src/worker.ts': "export function work() { throw new Error('invalid'); }",
    'support/check.ts': "export function verify(value) { expect(value).toThrow(); } fork('../src/worker.ts');",
    'test/work.test.ts': `import { work } from '../src/worker'; import { verify } from '../support/check';
      it('rejects', () => verify(work));`,
  });
  const config = loadConfig(fixture.root), cache = openFileCache(fixture.store);
  const first = collect(fixture.root, config, { ref: 'HEAD' }, cache);
  assert.equal(cache.finish().misses, 3);
  const warm = openFileCache(fixture.store), second = collect(fixture.root, config, { ref: 'HEAD' }, warm);
  assert.equal(warm.finish().misses, 0);
  const data = mapData(fixture.root, config, second, 1);
  assert.equal(first.testFacts.find((file) => file.path === 'test/work.test.ts').testScan.cases[0].assertions, 1);
  assert.deepEqual(data.analysis.tests.cases[0].failureTargets, ['src/worker.ts#work']);
  assert.ok(data.startedPaths.entries.some((entry) => entry.via === 'support/check.ts' && entry.path === 'src/worker.ts'));
});

test('path candidates create a checker only for bound names', async () => {
  const { default: ts } = await import('typescript');
  const { pathCandidates } = await import('../lib/path-candidates.mjs');
  const { localChecker } = await import('../lib/source-metrics.mjs');
  let checkers = 0;
  const literal = ts.createSourceFile('src/main.ts', "import('./worker.ts');", ts.ScriptTarget.Latest, true);
  const literalFacts = pathCandidates(literal, () => { checkers++; return localChecker(literal); });
  assert.equal(checkers, 0);
  assert.deepEqual(literalFacts[0].literals, ['./worker.ts']);
  const bound = ts.createSourceFile('src/main.ts', "import { fork as start } from 'node:child_process'; start('./worker.ts');", ts.ScriptTarget.Latest, true);
  const boundFacts = pathCandidates(bound, () => { checkers++; return localChecker(bound); });
  assert.equal(checkers, 1);
  assert.equal(boundFacts[0].name, 'fork');
  assert.deepEqual(boundFacts[0].literals, ['./worker.ts']);
});

test('files loaded only for compiler facts do not become assertion helpers', (t) => {
  const fixture = repository(t, {
    '.code-map.json': manifest({ roots: ['src'] }),
    'package.json': manifest({ name: 'fixture' }),
    'src/worker.ts': "export function work() { throw new Error('invalid'); }",
    'dist/check.ts': 'export function verify(value) { expect(value).toThrow(); }',
    'test/work.test.ts': `import { work } from '../src/worker'; import { verify } from '../dist/check';
      it('rejects', () => verify(work));`,
  });
  const config = loadConfig(fixture.root), cache = openFileCache(fixture.store);
  const plain = collect(fixture.root, config, { ref: 'HEAD' }, cache);
  const typed = collect(fixture.root, config, { ref: 'HEAD', types: true }, cache);
  assert.deepEqual(typed.testFacts, plain.testFacts);
  assert.equal(typed.testFacts.find((file) => file.path === 'test/work.test.ts').testScan.cases[0].assertions, 0);
});
