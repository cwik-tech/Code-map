import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { createReport } from '../lib/analysis.mjs';
import { collect, mapData } from '../lib/build.mjs';
import { loadConfig } from '../lib/project.mjs';
import { deriveFindings } from '../lib/findings.mjs';
import { repository, manifest } from './packages-fixture.mjs';

const scan = (text) => analyzeFile('test/sample.test.ts', text,
  createResolver(new Set(['test/sample.test.ts']), { aliases: [], baseUrl: null }), { tests: true }).testScan;

test('ternary case and suite aliases retain conditional inventory', () => {
  const found = scan(`import { it, describe } from 'vitest';
    const installed = hasTool ? it.skip : it;
    const maybe = enabled ? describe.skip : describe;
    installed('tool case', () => expect(1).toBe(1));
    maybe('group', () => it('nested case', () => expect(1).toBe(1)));
    const unrelated = enabled ? log : it;
    unrelated('not a proven alias', () => {});`);
  assert.deepEqual(found.cases.map(({ name, status }) => [name, status]),
    [['tool case', 'conditional'], ['nested case', 'conditional']]);
});

test('suite registrar parameters retain definition-site cases and their reason', () => {
  const found = scan(`export function registerContract({ describe, expect, it }) {
    describe('contract', () => it('rejects input', () => expect(() => parse()).toThrow()));
  }`);
  assert.equal(found.cases.length, 1);
  assert.match(found.cases[0].reason, /registrar receives/i);
  assert.equal(found.cases[0].suite, 'contract');
});

test('failure helpers bind checked parameters and preserve expected operands', (t) => {
  const fixture = repository(t, {
    'package.json': manifest({ name: 'fixture' }),
    'src/parse.ts': `export function parse() { throw new Error('invalid'); }
      export function expected() { throw new Error('expected'); }`,
    'test/helpers.ts': `export async function verify(value, expected) { await expect(value).rejects.toMatchObject(expected); }
      export function sync(value) { expect(value).toThrow(); }`,
    'test/sample.test.ts': `import { it } from 'vitest';
      import { parse, expected } from '../src/parse';
      import { verify, sync } from './helpers';
      async function local(value) { await expect(value).rejects.toBeInstanceOf(Error); }
      it('rejects locally', async () => { await local(parse()); });
      it('rejects by shape', async () => { await verify(parse(), expected()); });
      it('throws through helper', () => { sync(() => parse()); });
      it('rejects directly', async () => { await expect(parse()).rejects.toThrow('invalid'); });`,
  });
  const config = loadConfig(fixture.root);
  const data = mapData(fixture.root, config, collect(fixture.root, config, { ref: 'HEAD' }), 1);
  const cases = data.analysis.tests.cases;
  assert.deepEqual(cases.map((item) => item.failureTargets), Array(4).fill(['src/parse.ts#parse']));
  assert.equal(data.analysis.tests.units.find((item) => item.name === 'parse').failureDirect, 4);
  const findings = deriveFindings(data.analysis);
  assert.equal(findings.filter((item) => ['TEST-UNREACHED', 'TEST-NO-FAILURE-ASSERTION'].includes(item.ruleId)
    && item.location.path === 'src/parse.ts' && item.location.symbol === 'parse').length, 0);
});

test('hotspot reports disclose the count window independently of snapshot history', (t) => {
  const fixture = repository(t, { 'package.json': manifest({ name: 'fixture' }), 'src/a.ts': 'export const a = 1;' });
  fixture.put('src/a.ts', 'export const a = 2;');
  fixture.git('add', '.'); fixture.git('commit', '-qm', 'second');
  fixture.put('src/a.ts', 'export const a = 3;');
  fixture.git('add', '.'); fixture.git('commit', '-qm', 'third');
  const config = loadConfig(fixture.root), facts = collect(fixture.root, config, { ref: 'HEAD' });
  const data = mapData(fixture.root, config, facts, 2);
  const report = createReport(data);
  assert.equal(report.hotspots[0].commits, 3);
  assert.equal(report.hotspotWindow.commits, 3);
  assert.equal(report.hotspotWindow.firstDate, fixture.git('show', '-s', '--format=%cI', 'HEAD~2'));
  assert.equal(report.hotspotWindow.lastDate, fixture.git('show', '-s', '--format=%cI', 'HEAD'));
  assert.deepEqual(report.summary.hotspotWindow, report.hotspotWindow);
  const summary = fixture.json(['inspect', '--summary', '--ref', 'HEAD', '--store', fixture.store]);
  assert.deepEqual(summary.hotspotWindow, report.hotspotWindow);
});

test('path-started workers processes and package scripts are recorded as entry points', (t) => {
  const fixture = repository(t, {
    '.code-map.json': manifest({ roots: ['.'] }),
    'package.json': manifest({ name: 'fixture', scripts: { start: 'tsx src/command.ts', job: 'ts-node src/job.ts', script: 'node tasks/run.mjs' } }),
    'src/main.ts': `import { Worker } from 'node:worker_threads'; import { spawn, fork, execFile } from 'node:child_process';
      import { join } from 'node:path';
      new Worker(new URL('./worker.js', import.meta.url));
      const child = join(__dirname, 'child.js'); fork(child);
      const task = new URL('./task.js', import.meta.url); spawn('node', [task]);
      execFile('node', [new URL('./execute.js', import.meta.url)]);
      const lazy = new URL('./lazy.js', import.meta.url); import(lazy);
      const unresolved = join(__dirname, dynamic); fork(unresolved);`,
    'src/worker.ts': 'export const worker = 1;', 'src/child.ts': 'export const child = 1;',
    'src/task.ts': 'export const task = 1;', 'src/execute.ts': 'export const execute = 1;',
    'src/lazy.ts': 'export const lazy = 1;', 'src/command.ts': 'export const command = 1;',
    'src/job.ts': 'export const job = 1;', 'tasks/run.mjs': 'export const run = 1;',
  });
  const config = loadConfig(fixture.root);
  const data = mapData(fixture.root, config, collect(fixture.root, config, { ref: 'HEAD' }), 1);
  const targets = ['src/worker.ts', 'src/child.ts', 'src/task.ts', 'src/execute.ts', 'src/lazy.ts', 'src/command.ts', 'src/job.ts', 'tasks/run.mjs'];
  assert.deepEqual(data.analysis.entryPoints.filter((item) => targets.includes(item.path)).map((item) => item.path).sort(), targets.sort());
  assert.ok(data.analysis.entryPoints.every((item) => item.reason.length > 0));
  assert.ok(data.analysis.entryPointUnknown.some((item) => item.reason === 'unresolved-path-start'));
  assert.equal(deriveFindings(data.analysis).filter((item) => item.ruleId === 'FILE-ORPHANED' && targets.includes(item.location.path)).length, 0);
  assert.equal(deriveFindings(data.analysis).filter((item) => item.ruleId === 'EXPORT-TEST-ONLY' && targets.includes(item.location.path)).length, 0);
});

test('failure exits tested through imported helpers produce no false test gap', (t) => {
  const fixture = repository(t, {
    'package.json': manifest({ name: 'fixture' }),
    'src/parse.ts': "export function parse() { throw new Error('invalid'); }",
    'test/helpers.ts': 'export function verifyCheck(value) { expect(value).toThrow(); }',
    'test/parse.test.ts': `import { parse } from '../src/parse'; import { verifyCheck } from './helpers';
      it('rejects invalid input', () => verifyCheck(() => parse()));`,
  });
  const config = loadConfig(fixture.root);
  const data = mapData(fixture.root, config, collect(fixture.root, config, { ref: 'HEAD' }), 2);
  assert.equal(data.analysis.tests.units.find((item) => item.name === 'parse').status, 'direct');
  assert.deepEqual(deriveFindings(data.analysis).filter((item) =>
    ['TEST-UNREACHED', 'TEST-NO-FAILURE-ASSERTION'].includes(item.ruleId)), []);
});

test('helper checks exclude expected operands and do not follow a second imported helper', (t) => {
  const fixture = repository(t, {
    'package.json': manifest({ name: 'fixture' }),
    'src/parse.ts': "export function parse() { throw new Error('invalid'); }",
    'test/inner.ts': 'export function inner(value) { expect(value).toThrow(); }',
    'test/helpers.ts': `import { inner } from './inner';
      export function outer(value) { inner(value); }
      export function checkExpected(actual, expected) { expect(expected).toThrow(); }
      export function noFailure(value) { expect(value).not.toThrow(); }`,
    'test/parse.test.ts': `import { parse } from '../src/parse'; import { outer, checkExpected, noFailure } from './helpers';
      function local(actual, expected) { expect(expected).toThrow(); }
      it('expected only', () => checkExpected(parse, () => {}));
      it('local expected only', () => local(parse, () => {}));
      it('second import', () => outer(parse));
      it('does not throw', () => noFailure(parse));`,
  });
  const config = loadConfig(fixture.root);
  const data = mapData(fixture.root, config, collect(fixture.root, config, { ref: 'HEAD' }), 2);
  assert.deepEqual(data.analysis.tests.cases.map((item) => item.failureTargets), [[], [], [], []]);
  assert.equal(data.analysis.tests.units.find((item) => item.name === 'parse').failureDirect, 0);
});


test('resolved path entries suppress orphan and test-only importer leads without broad dynamic imports', (t) => {
  const fixture = repository(t, {
    'package.json': manifest({ name: 'fixture' }),
    'src/main.ts': `import { fork } from 'node:child_process'; import { join } from 'node:path';
      const worker = join(__dirname, 'worker.js'); fork(worker);`,
    'src/worker.ts': 'export function work() { return 1; }',
    'src/idle.ts': 'export const idle = 1;',
    'test/work.test.ts': `import { work } from '../src/worker'; it('work', () => expect(work()).toBe(1));`,
  });
  const config = loadConfig(fixture.root);
  const data = mapData(fixture.root, config, collect(fixture.root, config, { ref: 'HEAD' }), 2);
  const findings = deriveFindings(data.analysis);
  assert.equal(data.analysis.files.find((file) => file.path === 'src/worker.ts').exports[0].usage, 'entry-point');
  assert.deepEqual(findings.filter((item) => ['FILE-ORPHANED', 'EXPORT-TEST-ONLY'].includes(item.ruleId)
    && item.location.path === 'src/worker.ts'), []);
  assert.ok(findings.some((item) => item.ruleId === 'FILE-ORPHANED' && item.location.path === 'src/idle.ts'));
});

test('imported assertion helpers outside test folders bind their checked parameters', (t) => {
  const fixture = repository(t, {
    '.code-map.json': manifest({ roots: ['.'] }),
    'package.json': manifest({ name: 'fixture' }),
    'src/parse.ts': "export function parse() { throw new Error('invalid'); }",
    'support/check.ts': 'export function verify(value) { expect(value).toThrow(); }',
    'test/parse.test.ts': `import { parse } from '../src/parse'; import { verify } from '../support/check';
      it('rejects invalid input', () => verify(() => parse()));`,
  });
  const config = loadConfig(fixture.root);
  const data = mapData(fixture.root, config, collect(fixture.root, config, { ref: 'HEAD' }), 2);
  assert.deepEqual(data.analysis.tests.cases[0].failureTargets, ['src/parse.ts#parse']);
});

test('constant skip aliases stay parked and positional registrars state their reason', () => {
  const found = scan(`import { it, describe } from 'vitest';
    const parked = it.skip; parked('parked case', () => expect(() => parse()).toThrow());
    const group = describe.skip; group('parked group', () => it('child', () => expect(1).toBe(1)));
    export function register(it) { it('received case', () => expect(1).toBe(1)); }`);
  assert.deepEqual(found.cases.map((item) => item.status), ['skipped', 'skipped', 'active']);
  assert.match(found.cases[2].reason, /registrar receives/i);
});

test('imported helper exports resolve aliases and default functions without reading a private namesake', (t) => {
  const fixture = repository(t, {
    'package.json': manifest({ name: 'fixture' }),
    'src/parse.ts': "export function parse() { throw new Error('invalid'); }",
    'test/helpers.ts': `function verify(value) { expect(value).toThrow(); }
      export { verify as renamed }; export default function check(value) { expect(value).toThrow(); }`,
    'test/decoy.ts': `function check(value) { expect(value).toThrow(); }
      function empty(value) {} export { empty as check };`,
    'test/parse.test.ts': `import { parse } from '../src/parse'; import check, { renamed } from './helpers';
      import { check as decoy } from './decoy';
      it('default failure helper', () => check(() => parse()));
      it('renamed failure helper', () => renamed(() => parse()));
      it('private namesake', () => decoy(() => parse()));`,
  });
  const config = loadConfig(fixture.root);
  const data = mapData(fixture.root, config, collect(fixture.root, config, { ref: 'HEAD' }), 2);
  assert.deepEqual(data.analysis.tests.cases.map((item) => item.failureTargets), [['src/parse.ts#parse'], ['src/parse.ts#parse'], []]);
});

test('known failure-named helpers use their body instead of assuming the first argument is checked', (t) => {
  const fixture = repository(t, {
    'package.json': manifest({ name: 'fixture' }),
    'src/parse.ts': `export function parse() { throw new Error('invalid'); }
      export function expected() { throw new Error('expected'); }`,
    'test/helpers.ts': 'export function expectInvalid(expected, value) { expect(value).toThrow(expected); }',
    'test/parse.test.ts': `import { parse, expected } from '../src/parse'; import { expectInvalid } from './helpers';
      it('rejects invalid input', () => expectInvalid(expected, () => parse()));`,
  });
  const config = loadConfig(fixture.root);
  const data = mapData(fixture.root, config, collect(fixture.root, config, { ref: 'HEAD' }), 2);
  assert.deepEqual(data.analysis.tests.cases[0].failureTargets, ['src/parse.ts#parse']);
  assert.equal(data.analysis.tests.cases[0].assertions, 1);
});

test('helper arguments retain source origins through local variables and exclude expected origins', (t) => {
  const fixture = repository(t, {
    'package.json': manifest({ name: 'fixture' }),
    'src/parse.ts': `export function parse() { throw new Error('invalid'); }
      export function expected() { throw new Error('expected'); }`,
    'test/helpers.ts': 'export function verify(value, expected) { expect(value).toThrow(expected); }',
    'test/parse.test.ts': `import { parse, expected } from '../src/parse'; import { verify } from './helpers';
      it('checks the local value', () => { const value = () => parse(); const message = expected; verify(value, message); });
      it('excludes the local expected value', () => { const message = parse; verify(() => {}, message); });`,
  });
  const config = loadConfig(fixture.root);
  const data = mapData(fixture.root, config, collect(fixture.root, config, { ref: 'HEAD' }), 2);
  assert.deepEqual(data.analysis.tests.cases.map((item) => item.failureTargets), [['src/parse.ts#parse'], []]);
});
