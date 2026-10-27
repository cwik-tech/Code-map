// The dependency inventory of a snapshot: npm lockfiles of version 1, 2 and 3, workspaces, the kinds of package source,
// the other lockfiles that Code-map does not read, and the limits for untrusted lockfiles.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSupply } from '../lib/supply/lockfile.mjs';
import { lineOf, lockfile, registry } from './supply-fixtures.mjs';

const read = (files, policy = null, limits) => readSupply(Object.keys(files), new Map(Object.entries(files)), policy, limits);
const byPath = (supply) => Object.fromEntries(supply.packages.map((entry) => [entry.path, entry]));

test('a version 3 lockfile gives one record for each package, with its source, integrity, install script, license and flags', () => {
  const text = lockfile({
    'node_modules/zeta': registry('zeta', '2.0.0', { dev: true }),
    'node_modules/@scope/alpha': registry('@scope/alpha', '1.2.3', { hasInstallScript: true, license: 'Apache-2.0', optional: true }),
    'node_modules/private': { version: '0.1.0', resolved: 'https://user:secret-token@npm.example.com:8443/private/-/private-0.1.0.tgz', license: 'UNLICENSED', peer: true },
    'node_modules/forked': { version: '1.0.0', resolved: 'git+ssh://git@github.com/team/forked.git#0123456789abcdef0123456789abcdef01234567', license: 'MIT', devOptional: true },
    'node_modules/omitted': { version: '3.0.0', integrity: 'sha512-abc' },
    'node_modules/zeta/node_modules/inner': registry('inner', '1.0.0', { inBundle: true, resolved: undefined, integrity: undefined }),
  });
  const supply = read({ 'package-lock.json': text, 'src/index.ts': 'export {};\n' });
  assert.equal(supply.lockfile, 'package-lock.json');
  assert.equal(supply.lockfileVersion, 3);
  assert.deepEqual(supply.lockfiles, [{ path: 'package-lock.json', manager: 'npm', state: 'read', lockfileVersion: 3, packages: 6 }]);
  assert.deepEqual(supply.packages.map((entry) => entry.name), ['@scope/alpha', 'forked', 'inner', 'omitted', 'private', 'zeta'], 'sorted by name; the root project is not a package');
  const packages = byPath(supply);
  assert.deepEqual(packages['node_modules/@scope/alpha'], { path: 'node_modules/@scope/alpha', name: '@scope/alpha', version: '1.2.3', kind: 'remote', host: 'registry.npmjs.org',
    integrity: true, installScript: true, license: 'Apache-2.0', dev: false, optional: true, peer: false, line: lineOf(text, 'node_modules/@scope/alpha'), hashes: [], dependencies: [] });
  assert.deepEqual([packages['node_modules/private'].host, packages['node_modules/private'].kind, packages['node_modules/private'].integrity, packages['node_modules/private'].peer],
    ['npm.example.com:8443', 'remote', false, true]);
  assert.ok(!JSON.stringify(supply).includes('secret-token'), 'Code-map keeps the host of a resolved URL, never its credentials');
  assert.deepEqual([packages['node_modules/forked'].kind, packages['node_modules/forked'].host, packages['node_modules/forked'].dev, packages['node_modules/forked'].optional], ['git', 'github.com', true, true]);
  assert.deepEqual([packages['node_modules/omitted'].kind, packages['node_modules/omitted'].host], ['unknown', null], 'no resolved URL: the host is unknown');
  assert.deepEqual([packages['node_modules/zeta/node_modules/inner'].kind, packages['node_modules/zeta/node_modules/inner'].name], ['bundled', 'inner']);
  assert.equal(packages['node_modules/zeta'].dev, true);
  assert.equal(supply.policy, null);
});

test('a version 2 lockfile is read from "packages", and its "dependencies" copy for npm 6 is not counted again', () => {
  const text = JSON.stringify({ name: 'app', lockfileVersion: 2, requires: true, packages: { '': { name: 'app' }, 'node_modules/left': registry('left', '1.0.0') },
    dependencies: { left: { version: '1.0.0', resolved: 'https://registry.npmjs.org/left/-/left-1.0.0.tgz', integrity: 'sha512-x' }, other: { version: '9.9.9' } } }, null, 2);
  const supply = read({ 'package-lock.json': text });
  assert.equal(supply.lockfileVersion, 2);
  assert.deepEqual(supply.packages.map((entry) => [entry.path, entry.version, entry.license]), [['node_modules/left', '1.0.0', 'MIT']]);
});

test('a version 1 lockfile is read from its nested "dependencies", and its unknown install scripts and licenses stay null', () => {
  const text = JSON.stringify({ name: 'app', version: '1.0.0', lockfileVersion: 1, requires: true, dependencies: {
    express: { version: '4.17.1', resolved: 'https://registry.npmjs.org/express/-/express-4.17.1.tgz', integrity: 'sha512-e', requires: { debug: '2.6.9' },
      dependencies: { debug: { version: '2.6.9', resolved: 'https://registry.npmjs.org/debug/-/debug-2.6.9.tgz', integrity: 'sha512-d' } } },
    mocha: { version: '8.0.0', resolved: 'https://registry.npmjs.org/mocha/-/mocha-8.0.0.tgz', integrity: 'sha512-m', dev: true },
    fork: { version: 'github:team/fork#0123456789abcdef0123456789abcdef01234567', from: 'github:team/fork' },
    vendored: { version: 'file:vendor/vendored' },
    packed: { version: '1.0.0', bundled: true },
  } }, null, 2);
  const supply = read({ 'package-lock.json': text });
  const packages = byPath(supply);
  assert.deepEqual(Object.keys(packages).sort(), ['node_modules/express', 'node_modules/express/node_modules/debug', 'node_modules/fork', 'node_modules/mocha', 'node_modules/packed', 'node_modules/vendored']);
  assert.deepEqual([packages['node_modules/express/node_modules/debug'].name, packages['node_modules/express/node_modules/debug'].installScript, packages['node_modules/express/node_modules/debug'].license],
    ['debug', null, null], 'version 1 records no install scripts and no licenses');
  assert.equal(packages['node_modules/express'].line, lineOf(text, 'express'));
  assert.deepEqual([packages['node_modules/fork'].kind, packages['node_modules/fork'].host], ['git', 'github.com']);
  assert.deepEqual([packages['node_modules/vendored'].kind, packages['node_modules/packed'].kind, packages['node_modules/mocha'].dev], ['local', 'bundled', true]);
});

test('a workspace project lists its workspace folders as local packages, skips the links to them, and reads the packages inside them', () => {
  const text = lockfile({
    'node_modules/@app/web': { resolved: 'packages/web', link: true },
    'node_modules/@app/lib': { resolved: 'packages/lib', link: true },
    'packages/web': { name: '@app/web', version: '0.2.0', license: 'UNLICENSED', dependencies: { react: '^18.0.0' } },
    'packages/lib': { name: '@app/lib', version: '0.1.0' },
    'packages/web/node_modules/react': registry('react', '18.3.1'),
    'node_modules/react': registry('react', '17.0.2'),
  });
  const supply = read({ 'package-lock.json': text, 'packages/web/package.json': '{}' });
  assert.deepEqual(supply.packages.map((entry) => [entry.path, entry.name, entry.kind]), [
    ['packages/lib', '@app/lib', 'local'], ['packages/web', '@app/web', 'local'], ['node_modules/react', 'react', 'remote'], ['packages/web/node_modules/react', 'react', 'remote']]);
  assert.equal(supply.lockfiles[0].packages, 4, 'a link is not a package');
});

test('npm-shrinkwrap.json wins over package-lock.json, and other lockfiles are ignored', () => {
  const supply = read({ 'npm-shrinkwrap.json': lockfile({ 'node_modules/a': registry('a', '1.0.0') }), 'package-lock.json': lockfile({}),
    'pnpm-lock.yaml': 'lockfileVersion: 9.0\n', 'yarn.lock': '# yarn lockfile v1\n', 'bun.lock': '{}', 'apps/site/package-lock.json': '{}',
    'node_modules/dep/package-lock.json': '{}', 'test/fixtures/yarn.lock': '' });
  assert.equal(supply.lockfile, 'npm-shrinkwrap.json');
  assert.deepEqual(supply.lockfiles.map(({ path, manager, state }) => [path, manager, state]), [
    ['npm-shrinkwrap.json', 'npm', 'read'], ['package-lock.json', 'npm', 'ignored'], ['pnpm-lock.yaml', 'pnpm', 'ignored'], ['yarn.lock', 'yarn', 'ignored'], ['bun.lock', 'bun', 'ignored']]);
  assert.deepEqual(supply.nested, { count: 2, paths: ['apps/site/package-lock.json', 'test/fixtures/yarn.lock'] }, 'lockfiles inside node_modules are not counted');
  assert.deepEqual(supply.packages.map((entry) => entry.name), ['a']);
});

test('a snapshot without a lockfile has no inventory, and a pnpm project has an inventory without packages', () => {
  assert.equal(read({ 'src/index.ts': 'export {};\n', 'package.json': '{}' }), null);
  const pnpm = read({ 'pnpm-lock.yaml': 'lockfileVersion: 9.0\n' });
  assert.deepEqual([pnpm.lockfile, pnpm.lockfileVersion, pnpm.packages], ['pnpm-lock.yaml', 9, []]);
});

test('an untrusted lockfile that is invalid, too large, of another version or with too many packages gives no packages and a reason', () => {
  const cases = [
    ['{"lockfileVersion": 3,', 'invalid', /not valid JSON/],
    ['[1, 2]', 'invalid', /JSON object/],
    [JSON.stringify({ lockfileVersion: 4, packages: {} }), 'unsupported-version', /versions 1, 2 and 3/],
    [JSON.stringify({ lockfileVersion: 3, packages: [] }), 'invalid', /"packages"/],
    [JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/a': 'x' } }), 'invalid', /not an object/],
    [JSON.stringify({ lockfileVersion: 1, dependencies: { a: { version: '1.0.0', dependencies: 7 } } }), 'invalid', /"dependencies"/],
    [lockfile({ 'node_modules/a': registry('a', '1.0.0'), 'node_modules/b': registry('b', '1.0.0'), 'node_modules/c': registry('c', '1.0.0') }), 'too-large', /more than 2 packages/],
    ['x'.repeat(600), 'too-large', /at most 512 bytes/],
  ];
  for (const [text, state, reason] of cases) {
    const supply = read({ 'package-lock.json': text }, null, { bytes: 512 * (text.startsWith('x') ? 1 : 100), packages: 2 });
    assert.deepEqual([supply.lockfile, supply.packages, supply.lockfiles[0].state], [null, [], state], text.slice(0, 40));
    assert.match(supply.lockfiles[0].error, reason, text.slice(0, 40));
  }
  const missing = readSupply(['package-lock.json'], new Map(), null);
  assert.deepEqual([missing.lockfiles[0].state, missing.packages], ['invalid', []], 'a lockfile that Git cannot give as text');
});

test('a lockfile without "packages" has no packages, and long or wrong-typed values are cut or left out', () => {
  assert.deepEqual(read({ 'package-lock.json': '{"lockfileVersion":3}\n' }).packages, []);
  const long = 'n'.repeat(5000);
  const [entry] = read({ 'package-lock.json': lockfile({ [`node_modules/${long}`]: { version: 7, resolved: 42, integrity: '', license: { type: 'ISC' }, hasInstallScript: 'yes', dev: 'true' } }) }).packages;
  assert.equal(entry.name.length, 214, 'npm names have at most 214 characters');
  assert.equal(entry.path.length, 4096);
  assert.deepEqual([entry.version, entry.kind, entry.host, entry.integrity, entry.license, entry.installScript, entry.dev], [null, 'unknown', null, false, 'ISC', false, false]);
});

test('a version 1 tree that nests deeply has short paths, and all its paths together have the limit of the lockfile', () => {
  const chain = (depth, bottom) => { let node = { version: '1.0.0', integrity: 'sha512-x', dependencies: bottom }; for (let index = 1; index < depth; index++) node = { version: '1.0.0', integrity: 'sha512-x', dependencies: { a: node } }; return node; };
  const deep = read({ 'package-lock.json': JSON.stringify({ lockfileVersion: 1, dependencies: { a: chain(400, {}) } }) });
  assert.equal(deep.packages.length, 400);
  assert.ok(deep.packages.every((entry) => entry.path.length <= 4096), 'a path is cut before its children use it');
  // 40 packages at a depth of 30 have paths of about 450 characters each: 18,000 characters from a lockfile of about 4,000 bytes.
  const siblings = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`s${index}`, { version: '1.0.0', integrity: 'sha512-x' }]));
  const text = JSON.stringify({ lockfileVersion: 1, dependencies: { a: chain(30, siblings) } });
  assert.ok(text.length < 8192);
  const planted = read({ 'package-lock.json': text }, null, { bytes: 8192, packages: 1000 });
  assert.deepEqual([planted.lockfiles[0].state, planted.packages], ['too-large', []]);
  assert.match(planted.lockfiles[0].error, /package paths of the lockfile have more than 8192 characters/);
});

test('a version that is a URL loses its credentials, and a resolved value without a scheme is not a local package', () => {
  const v1 = read({ 'package-lock.json': JSON.stringify({ lockfileVersion: 1, dependencies: {
    fork: { version: 'git+https://x-access-token:ghp_SECRET@github.com/team/fork.git#0123456789abcdef0123456789abcdef01234567' },
    tar: { version: 'https://user:SECRET@files.example.com/tar-1.0.0.tgz', integrity: 'sha512-t' } } }) });
  assert.deepEqual(v1.packages.map((entry) => [entry.name, entry.version, entry.host]), [
    ['fork', 'git+https://github.com/team/fork.git#0123456789abcdef0123456789abcdef01234567', 'github.com'], ['tar', 'https://files.example.com/tar-1.0.0.tgz', 'files.example.com']]);
  assert.ok(!JSON.stringify(v1).includes('SECRET'));
  // npm writes a path without "file:" only for a link. A planted entry of this form must not escape the rules as the project's own code.
  const [planted] = read({ 'package-lock.json': lockfile({ 'node_modules/evil': { version: '1.0.0', resolved: 'evil.example/evil.tgz' } }) }).packages;
  assert.deepEqual([planted.kind, planted.host, planted.integrity], ['unknown', null, false]);
});
