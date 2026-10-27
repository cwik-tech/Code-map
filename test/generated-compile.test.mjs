import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { compileGenerated } from '../lib/mutation/compile.mjs';
import { project } from './oracle-fixtures.mjs';

test('generated TypeScript reports syntax and type errors with project settings', (t) => {
  const f = project(t);
  mkdirSync(join(f.root, 'node_modules'));
  f.put('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022' }, include: ['test'] }));
  f.put('test/generated.test.ts', 'const value: number = "wrong";\nfunction run(input) { return input; }\nconst broken = ;\n');
  const result = compileGenerated(f.root, null, 'test/generated.test.ts');
  assert.equal(result.status, 'failed');
  assert.equal(result.config, 'tsconfig.json');
  assert.ok(result.typeCheck.diagnostics.some((item) => item.code === 2322 && item.line === 1));
  assert.ok(result.typeCheck.diagnostics.some((item) => item.code === 7006 && item.line === 2));
  assert.ok(result.diagnostics.some((item) => item.code === 1109 && item.line === 3));
});

test('generated compilation checks the committed snapshot rather than later working files', (t) => {
  const f = project(t);
  mkdirSync(join(f.root, 'node_modules'));
  f.put('test/generated.test.mjs', 'export const value = 1;\n');
  const sha = f.commit('generated case');
  f.put('test/generated.test.mjs', 'export const value = ;\n');
  assert.equal(compileGenerated(f.root, sha, 'test/generated.test.mjs').status, 'passed');
  const current = compileGenerated(f.root, null, 'test/generated.test.mjs');
  assert.equal(current.status, 'failed');
  assert.equal(current.diagnostics[0].code, 1109);
});

test('generated TypeScript resolves local imports and aliases from an extended project config', (t) => {
  const f = project(t);
  mkdirSync(join(f.root, 'node_modules'));
  f.put('config/base.json', JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', baseUrl: '..', paths: { '@app/*': ['src/*'] } } }));
  f.put('tsconfig.json', JSON.stringify({ extends: './config/base.json', include: ['test'] }));
  f.put('test/generated.test.ts', 'import { login } from "@app/login";\nconst value: number = login("a");\n');
  const result = compileGenerated(f.root, null, 'test/generated.test.ts');
  assert.equal(result.status, 'passed');
  assert.equal(result.typeCheck.status, 'failed');
  assert.ok(result.typeCheck.diagnostics.some((item) => item.code === 2322));
  assert.ok(!result.typeCheck.diagnostics.some((item) => item.code === 2307));
});

test('generated TypeScript uses the matching referenced project rather than an empty root config', (t) => {
  const f = project(t);
  mkdirSync(join(f.root, 'node_modules'));
  f.put('tsconfig.json', JSON.stringify({ files: [], references: [{ path: './tsconfig.tests.json' }] }));
  f.put('tsconfig.tests.json', JSON.stringify({ compilerOptions: { strict: true }, include: ['test'] }));
  f.put('test/generated.test.ts', 'function run(input) { return input; }\n');
  const result = compileGenerated(f.root, null, 'test/generated.test.ts');
  assert.equal(result.config, 'tsconfig.tests.json');
  assert.equal(result.status, 'passed');
  assert.equal(result.typeCheck.status, 'failed');
  assert.ok(result.typeCheck.diagnostics.some((item) => item.code === 7006));
});

function packageProject(t) {
  const f = project(t);
  f.put('.gitignore', 'node_modules/\n');
  f.put('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, module: 'NodeNext' }, include: ['test'] }));
  f.put('node_modules/.pnpm/tiny/node_modules/tiny/package.json', JSON.stringify({ name: 'tiny', types: 'index.d.ts' }));
  f.put('node_modules/.pnpm/tiny/node_modules/tiny/index.d.ts', 'export function accepts(value: number): number;\n');
  symlinkSync('.pnpm/tiny/node_modules/tiny', join(f.root, 'node_modules/tiny'));
  return f;
}

test('generated type checks read installed declarations through internal package links', (t) => {
  const f = packageProject(t);
  f.put('test/correct.test.ts', 'import { accepts } from "tiny"; accepts(1);\n');
  f.put('test/wrong.test.ts', 'import { accepts } from "tiny"; accepts("wrong");\n');
  const correct = compileGenerated(f.root, null, 'test/correct.test.ts');
  const wrong = compileGenerated(f.root, null, 'test/wrong.test.ts');
  assert.equal(correct.status, 'passed');
  assert.equal(correct.typeCheck.status, 'passed', JSON.stringify(correct));
  assert.equal(wrong.status, 'passed');
  assert.equal(wrong.typeCheck.status, 'failed');
  assert.ok(wrong.typeCheck.diagnostics.some((item) => item.code === 2345));
});

test('generated type checks refuse package links outside node_modules and package source files', (t) => {
  const f = packageProject(t);
  f.put('outside/index.d.ts', 'export const value: number;');
  symlinkSync('../outside', join(f.root, 'node_modules/escape'));
  f.put('node_modules/source/package.json', '{"types":"index.ts"}');
  f.put('node_modules/source/index.ts', 'export const value = 1;');
  f.put('test/generated.test.ts', 'import { value } from "escape"; import { value as other } from "source";');
  const result = compileGenerated(f.root, null, 'test/generated.test.ts');
  assert.equal(result.status, 'passed');
  assert.equal(result.typeCheck.status, 'failed');
  assert.equal(result.typeCheck.diagnostics.filter((item) => item.code === 2307).length, 2);
});

test('generated type checks report missing dependencies without blocking compilation', (t) => {
  const f = project(t);
  f.put('tsconfig.json', JSON.stringify({ compilerOptions: { types: ['node'] } }));
  f.put('test/generated.test.ts', 'import { test } from "node:test"; test("runs", () => {});');
  const result = compileGenerated(f.root, null, 'test/generated.test.ts');
  assert.equal(result.status, 'passed');
  assert.equal(result.typeCheck.status, 'unavailable');
  assert.match(result.typeCheck.reason, /node_modules/);
});

test('generated type checks bound each installed declaration file', (t) => {
  const f = packageProject(t);
  f.put('node_modules/.pnpm/tiny/node_modules/tiny/index.d.ts', ' '.repeat(8 * 1024 * 1024 + 1));
  f.put('test/generated.test.ts', 'import { accepts } from "tiny"; accepts(1);');
  const result = compileGenerated(f.root, null, 'test/generated.test.ts');
  assert.equal(result.status, 'passed');
  assert.equal(result.typeCheck.status, 'unavailable');
  assert.match(result.typeCheck.reason, /8 MiB/);
});

test('generated type checks bound total installed type information', (t) => {
  const f = packageProject(t);
  const declaration = '/*' + ' '.repeat(7 * 1024 * 1024) + '*/ export const value: number;';
  for (const name of ['one', 'two', 'three', 'four', 'five']) {
    f.put(`node_modules/${name}/package.json`, '{"types":"index.d.ts"}');
    f.put(`node_modules/${name}/index.d.ts`, declaration);
  }
  f.put('test/generated.test.ts', 'import "one"; import "two"; import "three"; import "four"; import "five";');
  const result = compileGenerated(f.root, null, 'test/generated.test.ts');
  assert.equal(result.status, 'passed');
  assert.equal(result.typeCheck.status, 'unavailable');
  assert.match(result.typeCheck.reason, /32 MiB/);
});

test('generated compilation rejects invalid project configuration', (t) => {
  const f = packageProject(t);
  f.put('tsconfig.json', '{"compilerOptions":{"target":"invalid"}}');
  f.put('test/generated.test.ts', 'export const value = 1;');
  const result = compileGenerated(f.root, null, 'test/generated.test.ts');
  assert.equal(result.status, 'failed');
  assert.ok(result.diagnostics.some((item) => item.code === 6046));
});
