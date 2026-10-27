// Real snapshot import evidence for test files and package-root configuration files.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { collect, mapData } from '../lib/build.mjs';
import { fileURLToPath } from 'node:url';
import { findingDetails } from '../lib/finding-details.mjs';
import { defaults } from '../lib/project.mjs';
import { deriveFindings, fingerprintOf } from '../lib/findings.mjs';
import { openFileCache } from '../lib/file-cache.mjs';
import { importOrigins } from '../lib/verify-change.mjs';
import { evaluate, modified, request } from './profile-fixtures.mjs';

function project(t, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-import-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  for (const [path, text] of Object.entries({ 'package.json': '{}', 'src/a.ts': 'export const a = 1;',
    'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }), ...extra })) put(path, text);
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@local', ...args]);
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'fixture');
  const snapshot = (cache = null) => {
    const facts = collect(root, defaults, { worktree: true }, cache);
    return mapData(root, defaults, facts, 1, true).analysis;
  };
  return { root, put, snapshot };
}
function checks(base, head, ...paths) {
  const findings = deriveFindings(head), before = new Set(deriveFindings(base).map((item) => item.id));
  const labels = Object.fromEntries(findings.map((item) => [item.id, before.has(item.id) ? 'EXISTING' : 'NEW']));
  return evaluate({ base: { analysis: base }, head: { analysis: head, findings }, labels,
    importOrigins: importOrigins(base, findings, labels, []), change: modified(...paths) }).byId;
}

const check = (...args) => checks(...args)['structure.imports-resolve'];

test('a newly broken test import gives a finding and FAIL, while a resolved import permits PASS', (t) => {
  const { put, snapshot } = project(t, { 'tests/a.test.ts': "import { a } from '../src/a';" });
  const base = snapshot();
  assert.equal(check(base, base, 'tests/a.test.ts').result, 'PASS');
  put('tests/a.test.ts', "import { a } from '../src/missing';");
  const head = snapshot();
  assert.ok(deriveFindings(head).some((item) => item.ruleId === 'IMPORT-UNRESOLVED' && item.location.path === 'tests/a.test.ts'));
  assert.equal(check(base, head, 'tests/a.test.ts').result, 'FAIL');
});

for (const extension of ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts']) test(`a package-root .config.${extension} import is checked`, (t) => {
  const path = `packages/tool/tool.config.${extension}`;
  const { put, snapshot } = project(t, { 'packages/tool/package.json': '{}', [path]: "import { a } from '../../src/a';" });
  const base = snapshot();
  assert.equal(check(base, base, path).result, 'PASS');
  put(path, "import './missing';");
  const head = snapshot();
  assert.ok(deriveFindings(head).some((item) => item.ruleId === 'IMPORT-UNRESOLVED' && item.location.path === path));
  assert.equal(check(base, head, path).result, 'FAIL');
});

test('test aliases resolve and a lost alias import fails verification', (t) => {
  const { put, snapshot } = project(t, { 'tests/a.test.ts': "import { a } from '@/a';" });
  const base = snapshot();
  assert.equal(check(base, base, 'tests/a.test.ts').result, 'PASS');
  put('src/a.ts', 'export const other = 1;');
  const missingName = snapshot();
  assert.ok(deriveFindings(missingName).some((item) => item.ruleId === 'IMPORT-NAME-MISSING' && item.location.path === 'tests/a.test.ts'));
  put('tests/a.test.ts', "import { a } from '@/missing';");
  assert.equal(check(base, snapshot(), 'tests/a.test.ts').result, 'FAIL');
});

test('declarations and files outside the import scan remain UNKNOWN', (t) => {
  const { snapshot } = project(t, { 'src/types.d.ts': "import './missing';", 'tools/run.ts': "import './missing';", 'tools/tool.config.ts': "import './missing';" });
  const head = snapshot();
  assert.equal(check(head, head, 'src/types.d.ts').result, 'UNKNOWN');
  assert.equal(check(head, head, 'tools/run.ts').result, 'UNKNOWN');
  assert.equal(check(head, head, 'tools/tool.config.ts').result, 'UNKNOWN');
});

test('source finding identity keys stay unchanged', (t) => {
  const { snapshot } = project(t, { 'src/b.ts': "import './missing'; import { absent } from './a';" });
  const findings = deriveFindings(snapshot());
  const unresolved = findings.find((item) => item.ruleId === 'IMPORT-UNRESOLVED');
  const named = findings.find((item) => item.ruleId === 'IMPORT-NAME-MISSING');
  assert.equal(unresolved.id, `IMPORT-UNRESOLVED-${fingerprintOf('IMPORT-UNRESOLVED', ['src/b.ts', './missing']).slice(0, 10)}`);
  assert.equal(named.id, `IMPORT-NAME-MISSING-${fingerprintOf('IMPORT-NAME-MISSING', ['src/b.ts', 'src/a.ts', 'absent']).slice(0, 10)}`);
});

test('cold and warm caches keep test and config edges and invalidate changed resolution answers', (t) => {
  const { root, put, snapshot } = project(t, { 'tests/a.test.ts': "import '../src/missing';", 'tool.config.mjs': "import './src/missing';" });
  const store = join(root, '.cache');
  const cold = openFileCache(store), first = snapshot(cold); cold.finish();
  const warm = openFileCache(store), second = snapshot(warm);
  assert.deepEqual(second.importFiles, first.importFiles);
  assert.deepEqual(second.importNames, first.importNames);
  assert.deepEqual(deriveFindings(second), deriveFindings(first));
  assert.equal(warm.finish().misses, 0);
  put('src/missing.ts', 'export const value = 1;');
  const updated = openFileCache(store), third = snapshot(updated);
  assert.equal(deriveFindings(third).filter((item) => item.ruleId === 'IMPORT-UNRESOLVED').length, 0);
  assert.ok(updated.finish().misses >= 3);
  assert.equal(check(first, third, 'tests/a.test.ts', 'tool.config.mjs').result, 'PASS');
});

test('verification and finding retrieval use test and config imports through the CLI', (t) => {
  const { root, put } = project(t, { 'tests/a.test.ts': "import '../src/a';", 'tool.config.mjs': "import './src/a';" });
  put('tests/a.test.ts', "import '../src/missing';");
  put('tool.config.mjs', "import './src/missing';");
  put('.request.json', JSON.stringify(request({ base: 'HEAD', head: 'worktree', allowedPaths: null })));
  const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 30000 });
  const store = mkdtempSync(join(tmpdir(), 'code-map-import-store-'));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  const output = run('verify', '--request', '.request.json', '--store', store);
  assert.ok(output.status >= 0 && output.status <= 3, output.stderr);
  const summary = JSON.parse(output.stdout), result = JSON.parse(readFileSync(summary.files.results, 'utf8'));
  assert.equal(result.obligations.find((item) => item.id === 'structure.imports-resolve').result, 'FAIL');
  const found = run('inspect', '--analysis', result.head.analysisId, '--findings', '--rule', 'IMPORT-UNRESOLVED', '--store', store);
  assert.equal(found.status, 0, found.stderr);
  assert.match(found.stdout, /tests\/a\.test\.ts/);
  assert.match(found.stdout, /tool\.config\.mjs/);
});

test('each test and config unresolved finding exposes its import lines', (t) => {
  const { snapshot } = project(t, { 'tests/a.test.ts': "import '../missing';", 'tool.config.mjs': "import './missing';" });
  const analysis = snapshot();
  const findings = deriveFindings(analysis).filter((item) => item.ruleId === 'IMPORT-UNRESOLVED');
  assert.equal(findings.length, 2);
  for (const finding of findings) {
    const result = findingDetails(analysis, finding, (_, list) => list, (path) => path);
    assert.deepEqual(result.details.import.lines, [1]);
    assert.equal(result.details.file, null, 'source-only file reports must not link to auxiliary files');
  }
});

test('missing names in config files and test helpers have findings and inspectable exports', (t) => {
  const { snapshot } = project(t, { 'tool.config.mjs': "import { absent } from './src/a';",
    'tests/helper.ts': 'export const helper = 1;', 'tests/a.test.ts': "import { absent } from './helper';" });
  const analysis = snapshot(), findings = deriveFindings(analysis).filter((item) => item.ruleId === 'IMPORT-NAME-MISSING');
  assert.equal(findings.length, 2);
  const finding = findings.find((item) => item.location.path === 'tests/a.test.ts');
  const details = findingDetails(analysis, finding, (_, list) => list, (path) => path).details;
  assert.deepEqual(details.exports, ['helper']);
  assert.deepEqual(details.files, { source: null, target: null });
});

test('retained test edges distinguish an intentionally removed import from a broken import', (t) => {
  const { put, snapshot } = project(t, { 'tests/a.test.ts': "import { a } from '../src/a'; a;" });
  const base = snapshot();
  put('src/a.ts', 'export const a = 2;');
  put('tests/a.test.ts', 'export const fixture = 1;');
  assert.equal(checks(base, snapshot(), 'src/a.ts', 'tests/a.test.ts')['completeness.consumers-updated'].result, 'PASS');
});

test('a resolved package config does not count as a hidden consumer outside the import scan', (t) => {
  const { put, snapshot, root } = project(t, { 'src/unused.ts': 'export const unused = 1;', 'tool.config.mjs': "import './src/a';" });
  const base = snapshot();
  rmSync(join(root, 'src/unused.ts'));
  put('src/a.ts', 'export const a = 2;');
  const head = snapshot();
  assert.equal(base.outsideRoots.count, 0);
  assert.equal(check(base, head, 'src/a.ts').result, 'PASS');
});

test('import-equals retains located missing value and type dependencies', (t) => {
  const { snapshot } = project(t, { 'src/missing.cts': "\nimport lost = require('./not-here.cjs');\nimport type Shape = require('./shape.cjs');" });
  const analysis = snapshot();
  const edges = analysis.files.find((file) => file.path === 'src/missing.cts').imports;
  assert.deepEqual(edges.map(({ specifier, target, kind, mode, line }) => ({ specifier, target, kind, mode, line })), [
    { specifier: './not-here.cjs', target: null, kind: 'value', mode: 'require', line: 2 },
    { specifier: './shape.cjs', target: null, kind: 'type', mode: 'require', line: 3 },
  ]);
  assert.equal(deriveFindings(analysis).filter((item) => item.ruleId === 'IMPORT-UNRESOLVED').length, 2);
});

test('NodeNext findings agree with real compiler extension and import-equals errors', (t) => {
  const { root, snapshot } = project(t, {
    'package.json': '{"type":"module"}',
    'tsconfig.json': '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext"}}',
    'src/use.ts': "import { a } from './a';", 'src/missing.cts': "import lost = require('./not-here.cjs');",
  });
  const compiler = fileURLToPath(new URL('../node_modules/typescript/lib/tsc.js', import.meta.url));
  const output = spawnSync(process.execPath, [compiler, '--noEmit', '--pretty', 'false'], { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(output.status, 2, output.stderr);
  assert.match(output.stdout, /TS2835/);
  assert.match(output.stdout, /TS2307/);
  const findings = deriveFindings(snapshot()).filter((item) => item.ruleId === 'IMPORT-UNRESOLVED');
  assert.deepEqual(findings.map((item) => item.location.path).sort(), ['src/missing.cts', 'src/use.ts']);
});

test('with a tsconfig, relative stylesheet and image imports resolve to their files, and a missing one stays unresolved', (t) => {
  const { snapshot } = project(t, {
    'src/globals.css': 'body { margin: 0; }', 'src/logo.svg': '<svg/>',
    'src/use.ts': "import './globals.css';\nimport logo from './logo.svg';\nimport './missing.css';\nexport const use = logo;",
  });
  const analysis = snapshot(), use = analysis.files.find((file) => file.path === 'src/use.ts');
  assert.deepEqual(use.imports.map((edge) => [edge.specifier, edge.target]), [['./globals.css', 'src/globals.css'], ['./logo.svg', 'src/logo.svg'], ['./missing.css', null]]);
  const findings = deriveFindings(analysis).filter((item) => item.ruleId === 'IMPORT-UNRESOLVED');
  assert.deepEqual(findings.map((item) => item.facts.specifier), ['./missing.css']);
});

test('cyclic export-star barrels retain valid names through mapData', (t) => {
  const { snapshot } = project(t, {
    'src/a.ts': "export * from './b'; export const a = 1;",
    'src/b.ts': "export * from './a'; export const b = 2;",
    'src/use.ts': "import { a } from './a'; import { a as viaB } from './b'; import { absent } from './b'; export const use = a + viaB;",
  });
  const findings = deriveFindings(snapshot()).filter((item) => item.ruleId === 'IMPORT-NAME-MISSING');
  assert.deepEqual(findings.map((item) => item.key[2]), ['absent']);
});
