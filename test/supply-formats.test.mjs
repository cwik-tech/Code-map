import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSupply } from '../lib/supply/lockfile.mjs';
import { buildSbom } from '../lib/supply/sbom.mjs';
const read = (path, text) => readSupply([path], new Map([[path, text]]));

test('SBOM preserves npm identity, licenses, integrity hashes and resolved dependency relationships', () => {
  const supply = read('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: {
    'node_modules/a': { version: '1.0.0', license: 'MIT', integrity: 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', dependencies: { b: '^2' } },
    'node_modules/b': { version: '2.0.0' },
  } }));
  const bom = buildSbom(supply);
  assert.deepEqual([bom.bomFormat, bom.specVersion, bom.version], ['CycloneDX', '1.5', 1]);
  assert.deepEqual(bom.components[0], { type: 'library', 'bom-ref': 'node_modules/a', name: 'a', version: '1.0.0', purl: 'pkg:npm/a@1.0.0',
    licenses: [{ expression: 'MIT' }], hashes: [{ alg: 'SHA-256', content: '00'.repeat(32) }] });
  assert.deepEqual(bom.dependencies[0], { ref: 'node_modules/a', dependsOn: ['node_modules/b'] });
});

test('Yarn classic selectors resolve dependencies to locked packages', () => {
  const supply = read('yarn.lock', '# yarn lockfile v1\n\na@^1:\n  version "1.0.0"\n  integrity sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n  dependencies:\n    b "^2"\n\nb@^2, b@~2:\n  version "2.0.0"\n');
  assert.equal(supply.lockfiles[0].state, 'read');
  assert.deepEqual(supply.packages.map(({ name, version }) => [name, version]), [['a', '1.0.0'], ['b', '2.0.0']]);
  assert.deepEqual(buildSbom(supply).dependencies[0].dependsOn, ['b@2.0.0']);
});

for (const version of [6, 9]) test(`pnpm ${version} reads packages and snapshot dependency edges`, () => {
  const key = version === 6 ? '/a@1.0.0' : 'a@1.0.0';
  const other = version === 6 ? '/b@2.0.0' : 'b@2.0.0';
  const text = `lockfileVersion: '${version}.0'\n\npackages:\n\n  ${key}:\n    resolution: {integrity: sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=}\n    dependencies:\n      b: 2.0.0\n\n  ${other}:\n    resolution: {integrity: sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=}\n`;
  const supply = read('pnpm-lock.yaml', text);
  assert.equal(supply.lockfiles[0].state, 'read', supply.lockfiles[0].error);
  assert.deepEqual(supply.packages.map(({ name, version }) => [name, version]), [['a', '1.0.0'], ['b', '2.0.0']]);
  assert.deepEqual(buildSbom(supply).dependencies[0].dependsOn, ['b@2.0.0']);
});

test('bun JSON comments and trailing commas preserve string URLs', () => {
  const supply = read('bun.lock', '{// comment\n"lockfileVersion":1,"packages":{"a":["a@1.0.0","https://registry.example",{},"sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="],},}');
  assert.equal(supply.lockfiles[0].state, 'read', supply.lockfiles[0].error);
  assert.deepEqual(supply.packages.map(({ name, version, host }) => [name, version, host]), [['a', '1.0.0', 'registry.example']]);
});

test('unsupported YAML aliases, tags and versions are refused with reasons', () => {
  assert.match(read('pnpm-lock.yaml', 'lockfileVersion: 8.0\npackages: {}\n').lockfiles[0].error, /6 and 9/);
  assert.match(read('pnpm-lock.yaml', 'lockfileVersion: 9.0\npackages: &all\n  a: *all\n').lockfiles[0].error, /YAML/);
  assert.match(read('yarn.lock', '__metadata:\n  version: 8\n').lockfiles[0].error, /classic|version 1/);
});

test('pnpm 9 reads peer-qualified snapshot edges without losing the package version', () => {
  const supply = read('pnpm-lock.yaml', "lockfileVersion: '9.0'\npackages:\n  a@1.0.0:\n    resolution: {integrity: sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=}\n  b@2.0.0:\n    resolution: {}\nsnapshots:\n  a@1.0.0(b@2.0.0):\n    dependencies:\n      b: 2.0.0\n  b@2.0.0: {}\n");
  assert.equal(supply.lockfiles[0].state, 'read', supply.lockfiles[0].error);
  assert.equal(supply.packages[0].version, '1.0.0');
  assert.deepEqual(buildSbom(supply).dependencies[0].dependsOn, ['b@2.0.0']);
});

test('Bun resolves nested dependency identities and Yarn merges repeated component identities', () => {
  const bun = read('bun.lock', JSON.stringify({ lockfileVersion: 1, packages: {
    a: ['a@1.0.0', '', { dependencies: { b: '2.0.0' } }, ''], 'a/b': ['b@2.0.0', '', {}, ''] } }));
  assert.deepEqual(buildSbom(bun).dependencies[0].dependsOn, ['a/b']);
  const yarn = read('yarn.lock', '# yarn lockfile v1\na@^1:\n  version "1.0.0"\na@~1:\n  version "1.0.0"\n');
  assert.equal(buildSbom(yarn).components.length, 1);
});

test('SBOM omits malformed integrity hashes and encodes scoped package purls', () => {
  const supply = read('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: {
    'node_modules/@scope/a': { version: '1.0.0', integrity: 'sha256-abc' } } }));
  const component = buildSbom(supply).components[0];
  assert.equal(component.purl, 'pkg:npm/%40scope/a@1.0.0');
  assert.equal(component.hashes, undefined);
});
