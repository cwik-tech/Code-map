import assert from 'node:assert/strict';
import { test } from 'node:test';
import { typedFacts } from '../lib/types/collect.mjs';
import { compareApi } from '../lib/api-compare.mjs';
import { symbolImpact } from '../lib/types/impact.mjs';
import { compilerCoverage, parseTscFiles } from '../lib/types/discovery.mjs';

const texts = (code, extra = {}) => new Map(Object.entries({
  'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true }, include: ['src/**/*.ts'], exclude: ['src/excluded.ts'] }),
  'package.json': JSON.stringify({ main: 'src/api.ts', version: '1.0.0' }),
  'src/api.ts': code, ...extra,
}));
const facts = (code, extra) => typedFacts(texts(code, extra), { budgetMs: 15000 });
const stored = (records, typed, version = '1.0.0', imports = []) => ({ data: { analysis: {
  files: [{ path: 'src/api.ts', imports: [] }, { path: 'src/use.ts', imports }],
  api: { files: { 'src/api.ts': records }, entryPoints: { files: [{ path: 'src/api.ts', package: 'package.json' }], unresolved: [] }, packages: { 'package.json': version } },
  ...(typed ? { typed } : {}),
} } });
const record = (name, digest = 'shape') => ({ name, kind: 'function', text: `function ${name}()`, digest, inferred: true, source: name });
const compare = (a, b, options = {}) => compareApi(a, b, { state: 'COMPARABLE', ...options });

test('compiler discovery honors include, exclude, imports and nested project configs', () => {
  const result = facts('export function value() { return 1; }', {
    'src/use.ts': "import { value } from './api'; value();", 'src/excluded.ts': 'export const x = 1;',
    'other/tsconfig.json': '{"files":["lib.ts"]}', 'other/lib.ts': 'export const y = 1;',
  });
  assert.equal(result.state, 'COMPLETE');
  assert.deepEqual(result.programs.map((p) => p.config), ['other/tsconfig.json', 'tsconfig.json']);
  assert.deepEqual(result.programs[1].files, ['src/api.ts', 'src/use.ts']);
  assert.match(result.exports['src/api.ts'].value.text, /number/);
});

test('a hard budget stop discards all typed facts', () => {
  const result = typedFacts(texts('export const value = 1;'), { budgetMs: 1 });
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.reason, 'budget');
  assert.deepEqual(result.programs, []);
  assert.deepEqual(result.exports, {});
});

test('equal inferred checker types compare unchanged while changed return types compare changed', () => {
  const a = facts('export function value() { return 1; }');
  const b = facts('export function value() { return 2; }');
  const c = facts("export function value() { return 'x'; }");
  assert.equal(compare(stored([record('value')], a), stored([{ ...record('value'), source: 'new' }], b)).items.length, 0);
  assert.equal(compare(stored([record('value')], a), stored([record('value')], c)).items[0].status, 'CHANGED');
  assert.equal(compare(stored([record('value')]), stored([{ ...record('value'), source: 'new' }])).items[0].status, 'UNKNOWN');
});

test('unique matching signatures pair renamed exports and release policy permits deliberate breaks', () => {
  const a = stored([record('old')]);
  const b = stored([record('new')], undefined, '2.0.0');
  const result = compare(a, b);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].status, 'RENAMED');
  assert.deepEqual(result.items[0].pair, { from: 'old', to: 'new' });
  assert.equal(result.items[0].releasePolicy.allowed, true);
  b.data.analysis.api.breaking = 'forbidden';
  assert.equal(compare(a, b).items[0].releasePolicy.allowed, false);
});

test('checker calls reject incompatible argument types and accept compatible calls', () => {
  const result = facts('export function value(x: number) { return x; }', {
    'src/use.ts': "import { value as v } from './api'; v('bad'); v(1);",
  });
  assert.deepEqual(result.calls.map((call) => call.compatibility), ['INCOMPATIBLE', 'COMPATIBLE']);
  assert.equal(result.calls[0].export.name, 'value');
});

test('symbol impact follows named re-exports and reports depth truncation', () => {
  const analysis = { files: [
    { path: 'src/barrel.ts', imports: [{ target: 'src/api.ts', valueNames: ['old'], line: 1 }] },
    { path: 'src/use.ts', imports: [{ target: 'src/barrel.ts', valueNames: ['alias'], line: 1 }] },
  ], api: { files: { 'src/barrel.ts': [{ name: 'alias', from: { target: 'src/api.ts', name: 'old' } }] } } };
  const changes = [{ status: 'REMOVED', path: 'src/api.ts', name: 'old' }];
  assert.deepEqual(symbolImpact(changes, analysis).items.map((item) => item.path), ['src/barrel.ts', 'src/use.ts']);
  assert.equal(symbolImpact(changes, analysis, { depth: 1 }).truncated, true);
});

test('compiler discovery names unchecked changed files even with a clean bound diagnostic report', () => {
  const typed = facts('export const x = 1;');
  assert.deepEqual(compilerCoverage(['src/api.ts', 'src/excluded.ts'], typed, []).unchecked, ['src/excluded.ts']);
  const parsed = parseTscFiles('/repo/src/api.ts\n/repo/src/excluded.ts\n', { repository: '/repo', workingDirectory: '.' });
  assert.equal(parsed.ok, true);
  assert.deepEqual(compilerCoverage(['src/excluded.ts'], undefined, [parsed]).unchecked, []);
  assert.equal(parseTscFiles('error TS1234: bad\n', { repository: '/repo' }).ok, false);
});

test('unknown return types do not establish equal inferred interfaces', () => {
  const a = facts('export function value() { return missing; }');
  assert.equal(a.exports['src/api.ts'].value.state, 'UNKNOWN');
});

test('declared structural changes remain visible when checker type names stay equal', () => {
  const a = facts('export interface Value { x: string }');
  const b = facts('export interface Value { x: number }');
  const before = { ...record('Value', 'old'), kind: 'interface', inferred: false };
  const after = { ...before, digest: 'new' };
  assert.equal(compare(stored([before], a), stored([after], b)).items[0].status, 'CHANGED');
});

test('noCheck programs and unchecked JavaScript do not attest checked files', () => {
  const stopped = typedFacts(new Map([['tsconfig.json', '{"compilerOptions":{"noCheck":true}}'], ['src/api.ts', 'export const x=1;']]));
  assert.equal(stopped.state, 'UNKNOWN');
  assert.deepEqual(stopped.programs[0].files, []);
  const js = typedFacts(new Map([['tsconfig.json', '{"compilerOptions":{"allowJs":true}}'], ['src/api.js', 'export const x=1;']]));
  assert.deepEqual(js.programs[0].files, []);
});

test('ambiguous rename signatures remain separate and zero-major minor releases permit breaks', () => {
  const a = stored([record('old'), record('other')], undefined, '0.1.0');
  const b = stored([record('new')], undefined, '0.2.0');
  const result = compare(a, b);
  assert.equal(result.items.filter((item) => item.status === 'RENAMED').length, 0);
  assert.equal(result.items.find((item) => item.status === 'REMOVED').releasePolicy.allowed, true);
});

test('symbol impact follows local wrapper declarations to downstream named consumers', () => {
  const analysis = { files: [
    { path: 'src/wrapper.ts', imports: [{ target: 'src/api.ts', valueNames: ['value'], line: 1 }] },
    { path: 'src/use.ts', imports: [{ target: 'src/wrapper.ts', valueNames: ['wrapped'], line: 1 }] },
    { path: 'src/other.ts', imports: [{ target: 'src/wrapper.ts', valueNames: ['unrelated'], line: 1 }] },
  ], api: { files: {}, symbols: { 'src/wrapper.ts': [{ name: 'wrapped', references: ['src/api.ts#value'] }] } } };
  const result = symbolImpact([{ path: 'src/api.ts', name: 'value', status: 'CHANGED' }], analysis);
  assert.deepEqual(result.items.map((item) => item.path), ['src/wrapper.ts', 'src/use.ts']);
});

test('language-service references include removed namespace member uses and import aliases', () => {
  const result = facts('export const live = 1;', { 'src/use.ts': "import * as api from './api'; api.old; import { old as stale } from './api'; stale;" });
  assert.ok(result.references.some((reference) => reference.name === 'old' && reference.column === 31));
  assert.ok(result.references.some((reference) => reference.name === 'old' && reference.column > 60));
});

test('inferred object properties with unresolved types retain UNKNOWN', () => {
  const result = facts('export function value() { return { data: missing }; }');
  assert.equal(result.exports['src/api.ts'].value.state, 'UNKNOWN');
});

test('checker call compatibility follows public aliases and preserves overloaded failures', () => {
  const result = facts('export function value(x: string): string; export function value(x: number): number; export function value(x: string | number) { return x; }', {
    'src/index.ts': "export { value as publicValue } from './api';",
    'src/use.ts': "import { publicValue } from './index'; publicValue(true); publicValue(1);",
  });
  assert.deepEqual(result.calls.map((call) => call.compatibility), ['INCOMPATIBLE', 'COMPATIBLE']);
});

test('removed-module references join through the base import without accepting unrelated unresolved imports', async () => {
  const { typeInformation } = await import('../lib/types/verify.mjs');
  const base = stored([record('old')]);
  base.data.analysis.files[1].imports = [{ source: 'src/use.ts', target: 'src/api.ts', specifier: './api', valueNames: ['old'] }];
  const head = stored([], { state: 'COMPLETE', programs: [], exports: {}, calls: [], references: [
    { path: 'src/use.ts', name: 'old', target: null, specifier: './api', evidence: 'language-service' },
    { path: 'src/use.ts', name: 'old', target: null, specifier: './unrelated', evidence: 'language-service' },
  ] });
  delete head.data.analysis.api.files['src/api.ts'];
  head.data.analysis.api.entryPoints.files = [];
  const result = typeInformation(base, head, { result: { state: 'COMPARABLE' }, renames: [], complete: true }, { files: [] });
  assert.deepEqual(result.staleReferences.map((item) => item.specifier), ['./api']);
});

test('an error inside a callback call does not mark its outer call incompatible', () => {
  const result = facts('export function value(callback: () => void): void { callback(); } export function inner(x: number): void {}', {
    'src/use.ts': "import { value, inner } from './api'; value(() => { inner('bad'); });",
  });
  assert.equal(result.calls.find((call) => call.export.name === 'value' && call.path === 'src/use.ts').compatibility, 'COMPATIBLE');
  assert.equal(result.calls.find((call) => call.export.name === 'inner').compatibility, 'INCOMPATIBLE');
});

test('inferred methods and returned named objects expose structural checker changes', () => {
  const a = facts('class Hidden { method() { return 1; } } export function value() { return new Hidden(); } export class Public { method() { return 1; } }');
  const b = facts("class Hidden { method() { return 'changed'; } } export function value() { return new Hidden(); } export class Public { method() { return 'changed'; } }");
  const changes = compare(stored([record('value'), { ...record('Public'), kind: 'class' }], a), stored([record('value'), { ...record('Public'), kind: 'class' }], b));
  assert.equal(changes.items.find((item) => item.name === 'value').status, 'CHANGED');
  assert.equal(changes.items.find((item) => item.name === 'Public').status, 'CHANGED');
});

test('renamed inferred functions with different compiler signatures remain removed and added', () => {
  const a = facts('export function old() { return 1; }');
  const b = facts("export function next() { return 'different'; }");
  const result = compare(stored([record('old')], a), stored([record('next')], b));
  assert.deepEqual(result.items.map((item) => item.status), ['REMOVED', 'ADDED']);
});

test('compiler export records preserve names that match object prototype properties', () => {
  const result = facts('export const __proto__ = 1; export const constructor = 2;');
  assert.equal(Object.hasOwn(result.exports['src/api.ts'], '__proto__'), true);
  assert.equal(result.exports['src/api.ts'].constructor.state, 'KNOWN');
});

test('a symbol file budget reports truncation before a downstream re-export is omitted', () => {
  const analysis = { files: [
    { path: 'src/barrel.ts', imports: [{ target: 'src/api.ts', valueNames: ['old'], line: 1 }] },
    { path: 'src/use.ts', imports: [{ target: 'src/barrel.ts', valueNames: ['alias'], line: 1 }] },
  ], api: { files: { 'src/barrel.ts': [{ name: 'alias', from: { target: 'src/api.ts', name: 'old' } }] } } };
  assert.equal(symbolImpact([{ status: 'REMOVED', path: 'src/api.ts', name: 'old' }], analysis, { files: 1 }).truncated, true);
});

test('compiler information escapes untrusted unchecked paths in Markdown', async () => {
  const { typeLines } = await import('../lib/types/verify.mjs');
  const markdown = typeLines({ state: 'UNKNOWN', compilerCoverage: { state: 'UNKNOWN', unchecked: ['<script>.ts'] },
    calls: [], staleReferences: [], symbolImpact: { truncated: false } }).join('\n');
  assert.equal(markdown.includes('<script>'), false);
});

test('changed-export call counts include checker argument failures', async () => {
  const { callSites } = await import('../lib/impact/calls.mjs');
  const old = facts('export function value(x: string) { return x; }');
  const typed = facts('export function value(x: number) { return x; }', { 'src/use.ts': "import { value } from './api'; value('bad');" });
  const imports = [{ source: 'src/use.ts', target: 'src/api.ts', specifier: './api', line: 1, typeNames: [], valueNames: ['value'], mode: 'static' }];
  const base = stored([record('value')], old), head = stored([record('value')], typed, '1.0.0', imports);
  const result = callSites(compare(base, head).items, head, new Map([['src/use.ts', "import { value } from './api'; value('bad');"]]));
  assert.equal(result.exports[0].likelyBreaks, 1);
});

test('symbol impact keeps unresolved head consumers of a removed module', () => {
  const head = { files: [{ path: 'src/use.ts', imports: [{ target: null, specifier: './api', valueNames: ['old'], line: 1 }] }], api: { files: {} } };
  const base = { files: [{ path: 'src/use.ts', imports: [{ target: 'src/api.ts', specifier: './api', valueNames: ['old'], line: 1 }] }], api: { files: {} } };
  const result = symbolImpact([{ path: 'src/api.ts', name: 'old', status: 'REMOVED' }], head, { base });
  assert.deepEqual(result.items.map((item) => item.path), ['src/use.ts']);
});

test('a project config with incremental builds and options that TypeScript 6 deprecates still gives complete typed facts', () => {
  const config = JSON.stringify({ compilerOptions: { strict: true, incremental: true, baseUrl: '.', moduleResolution: 'node10', module: 'commonjs', paths: { '@/*': ['./src/*'] } }, include: ['src/**/*.ts'] });
  const result = typedFacts(texts('export function value() { return 1; }', { 'tsconfig.json': config }), { budgetMs: 15000 });
  assert.equal(result.state, 'COMPLETE');
  assert.deepEqual(result.programs.map((p) => [p.config, p.state]), [['tsconfig.json', 'COMPLETE']]);
});

test('explicit named return shapes change the public API', () => {
  const a = facts("interface Result { value: string } export function value(): Result { return { value: 'ok' }; }");
  const b = facts('interface Result { value: number } export function value(): Result { return { value: 1 }; }');
  const declared = { ...record('value'), inferred: false };
  assert.equal(compare(stored([declared], a), stored([declared], b)).items[0]?.status, 'CHANGED');
});

test('imported named parameters select incompatible unchanged consumers after a shape change', async () => {
  const { typeInformation } = await import('../lib/types/verify.mjs');
  const code = "import type { Input } from './model'; export function value(x: Input): void {}";
  const extra = { 'src/model.ts': 'export interface Input { value: string }',
    'src/use.ts': "import { value } from './api'; value({ value: 'ok' });" };
  const a = facts(code, extra), b = facts(code, { ...extra, 'src/model.ts': 'export interface Input { value: number }' });
  assert.equal(a.calls[0].compatibility, 'COMPATIBLE');
  const declared = { ...record('value'), inferred: false };
  const base = stored([declared], a), head = stored([declared], b);
  const result = typeInformation(base, head, { result: { state: 'COMPARABLE' }, renames: [], complete: true }, { files: [] });
  assert.equal(result.api[0]?.status, 'CHANGED');
  assert.equal(result.calls[0]?.compatibility, 'INCOMPATIBLE');
});

test('unknown explicit checker shapes never establish an unchanged API', () => {
  const declared = { ...record('value'), inferred: false };
  const unknown = { state: 'COMPLETE', exports: { 'src/api.ts': { value: { state: 'UNKNOWN', text: '() => Missing' } } } };
  const result = compare(stored([declared], unknown), stored([declared], unknown));
  assert.deepEqual(result.items[0]?.reasons, ['checker-type-unknown']);
  assert.equal(result.items[0]?.status, 'UNKNOWN');
});

for (const typed of [{ state: 'UNKNOWN', reason: 'budget' }, undefined]) test(`explicit API shapes retain UNKNOWN with unavailable compiler evidence: ${typed?.reason ?? 'missing side'}`, () => {
  const declared = { ...record('value'), inferred: false };
  const known = { state: 'COMPLETE', exports: { 'src/api.ts': { value: { state: 'KNOWN', text: '() => Result', shapeDigest: 'same' } } } };
  const result = compare(stored([declared], known), stored([declared], typed));
  assert.equal(result.items[0]?.status, 'UNKNOWN');
  assert.deepEqual(result.items[0]?.reasons, ['checker-unavailable']);
});
