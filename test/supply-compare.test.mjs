// The dependency change between a base and a head inventory: added, removed, upgraded, downgraded and changed packages,
// packages that now have an install script, and packages whose host or license changed. Pure functions, no Git.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareSupply } from '../lib/supply/compare.mjs';
import { dependencyList, supplyChange, supplyView } from '../lib/supply/summary.mjs';
import { item, supplyOf } from './supply-fixtures.mjs';

const changes = (result) => result.changes.map(({ change, name, from, to }) => [change, name, from, to]);
const comparisonOf = (base, state = 'COMPARABLE') => ({ base: { id: 'A-base', data: { analysis: base === undefined ? {} : { supply: base } } }, result: { state } });

test('the comparison names added, removed, upgraded, downgraded and changed packages, by package name and version', () => {
  const base = supplyOf([item('keep', '1.0.0'), item('gone', '2.0.0'), item('up', '1.9.0'), item('down', '3.1.0'), item('pre', '1.0.0-beta.2'),
    item('fork', 'github:a/fork#aaaa', { kind: 'git', host: 'github.com' }), item('multi', '1.0.0'), item('multi', '2.0.0', { path: 'node_modules/x/node_modules/multi' })]);
  const head = supplyOf([item('keep', '1.0.0'), item('new', '0.1.0'), item('up', '1.10.0'), item('down', '3.0.9'), item('pre', '1.0.0'),
    item('fork', 'github:a/fork#bbbb', { kind: 'git', host: 'github.com' }), item('multi', '1.0.0'), item('multi', '2.1.0', { path: 'node_modules/x/node_modules/multi' }),
    item('multi', '3.0.0', { path: 'node_modules/y/node_modules/multi' }), item('mine', '9.0.0', { kind: 'local', path: 'packages/mine', host: null })]);
  const result = compareSupply(base, head);
  assert.equal(result.state, 'compared');
  assert.deepEqual(result.counts, { added: 2, removed: 1, upgraded: 3, downgraded: 1, changed: 1, installScript: 0, hostChanged: 0, licenseChanged: 0 });
  assert.deepEqual(changes(result), [
    ['added', 'multi', null, '3.0.0'], ['added', 'new', null, '0.1.0'], ['downgraded', 'down', '3.1.0', '3.0.9'], ['changed', 'fork', 'github:a/fork#aaaa', 'github:a/fork#bbbb'],
    ['upgraded', 'multi', '2.0.0', '2.1.0'], ['upgraded', 'pre', '1.0.0-beta.2', '1.0.0'], ['upgraded', 'up', '1.9.0', '1.10.0'], ['removed', 'gone', '2.0.0', null]],
    'versions compare as semantic versions, a prerelease comes before its release, and local packages are not compared');
});

test('the comparison names packages that now have an install script, and packages whose host or license changed', () => {
  const base = supplyOf([item('hooked', '1.0.0'), item('moved', '1.0.0'), item('relicensed', '1.0.0'), item('scripted', '1.0.0', { installScript: true })]);
  const head = supplyOf([item('hooked', '1.0.1', { installScript: true }), item('moved', '1.0.0', { host: 'evil.example' }), item('relicensed', '1.0.0', { license: 'BUSL-1.1' }),
    item('scripted', '1.0.0', { installScript: true }), item('fresh', '1.0.0', { installScript: true })]);
  const result = compareSupply(base, head);
  assert.deepEqual(changes(result).filter(([change]) => !['added', 'upgraded'].includes(change)), [
    ['installScript', 'fresh', null, '1.0.0'], ['installScript', 'hooked', null, '1.0.1'], ['hostChanged', 'moved', 'registry.npmjs.org', 'evil.example'],
    ['licenseChanged', 'relicensed', 'MIT', 'BUSL-1.1']], 'a package that had its install script before is not new');
  assert.deepEqual([result.counts.installScript, result.counts.added, result.counts.upgraded], [2, 1, 1]);
});

test('a version 1 base records no install scripts and no licenses, so the comparison does not claim new ones and says why', () => {
  const v1 = (entry) => ({ ...entry, installScript: null, license: null });
  const base = supplyOf([v1(item('hooked', '1.0.0')), v1(item('relicensed', '1.0.0'))], { lockfileVersion: 1 });
  const head = supplyOf([item('hooked', '1.0.0', { installScript: true }), item('relicensed', '1.0.0', { license: 'BUSL-1.1' })]);
  const result = compareSupply(base, head);
  assert.deepEqual(changes(result), []);
  assert.match(result.reasons.join(' '), /version 1/);
});

test('a side whose lockfile Code-map cannot read makes the comparison unknown, and a side without a lockfile has no packages', () => {
  const unread = supplyOf([], { lockfile: null, lockfileVersion: null, lockfiles: [{ path: 'package-lock.json', manager: 'npm', state: 'invalid', error: 'The file is not valid JSON.' }] });
  const unknown = compareSupply(unread, supplyOf([item('a', '1.0.0')]));
  assert.deepEqual([unknown.state, unknown.counts, unknown.changes], ['unknown', null, []]);
  assert.match(unknown.reasons[0], /base.*package-lock\.json/);
  assert.deepEqual(changes(compareSupply(null, supplyOf([item('a', '1.0.0')]))), [['added', 'a', null, '1.0.0']], 'a new lockfile adds its packages');
  const nestedOnly = supplyOf([], { lockfile: null, lockfileVersion: null, lockfiles: [], nested: { count: 1, paths: ['fixtures/package-lock.json'] } });
  assert.equal(compareSupply(nestedOnly, null).state, 'compared', 'a lockfile in a subfolder is not a lockfile of the project');
});

test('the summary change has counts, at most five examples in risk order and the command for the full list', () => {
  const base = supplyOf(['a', 'b', 'c', 'd'].map((name) => item(name, '1.0.0')));
  const head = supplyOf([...['a', 'b', 'c', 'd'].map((name) => item(name, '2.0.0')), ...['e', 'f', 'g'].map((name) => item(name, '1.0.0', { installScript: name === 'g' }))]);
  const { supply } = supplyChange(comparisonOf(base), head, 'code-map inspect --analysis A-head --base-analysis A-base --dependencies');
  assert.deepEqual(supply.counts, { added: 3, removed: 0, upgraded: 4, downgraded: 0, changed: 0, installScript: 1, hostChanged: 0, licenseChanged: 0 });
  assert.deepEqual(supply.examples.map(({ change, name }) => [change, name]), [['installScript', 'g'], ['added', 'e'], ['added', 'f'], ['added', 'g'], ['upgraded', 'a']]);
  assert.equal(supply.next, 'code-map inspect --analysis A-head --base-analysis A-base --dependencies');
  assert.deepEqual(supplyChange(comparisonOf(undefined), undefined, 'x'), {}, 'without a lockfile on either side, the comparison has no supply part');
  assert.deepEqual(supplyChange(comparisonOf(base, 'NOT_COMPARABLE'), head, 'x'), { supply: null });
  const list = dependencyList(head, comparisonOf(base));
  assert.equal(list.items.length, 8);
  assert.deepEqual(list.view.counts, supply.counts);
});

test('the summary view counts packages, install scripts, missing integrity, other hosts and licenses, and leaves local packages out of the counts', () => {
  const supply = supplyOf([item('a', '1.0.0', { dev: true }), item('b', '1.0.0', { installScript: true, license: 'ISC' }), item('c', '1.0.0', { integrity: false, host: 'npm.example.com' }),
    item('d', '1.0.0', { kind: 'unknown', host: null, license: null, optional: true }), item('e', '1.0.0', { kind: 'git', host: 'github.com', integrity: false, peer: true }),
    item('mine', '1.0.0', { kind: 'local', path: 'packages/mine', host: null, integrity: false, license: 'UNLICENSED' })]);
  const view = supplyView(supply, 'code-map inspect --analysis A-head --dependencies');
  assert.deepEqual(view.counts, { packages: 6, local: 1, dev: 1, optional: 1, peer: 1, installScripts: 1, withoutIntegrity: 1, otherHosts: 2, unknownHost: 1 });
  assert.deepEqual(view.licenses, { total: 3, items: [{ license: 'MIT', count: 3 }, { license: 'ISC', count: 1 }, { license: null, count: 1 }] });
  assert.equal(view.next, 'code-map inspect --analysis A-head --dependencies');
  assert.deepEqual(dependencyList(supply, null).items.map((entry) => entry.name), ['a', 'b', 'c', 'd', 'e', 'mine']);
  const many = supplyView(supplyOf(Array.from({ length: 30 }, (_, index) => item(`p${index}`, '1.0.0', { license: `L-${String(index).padStart(2, '0')}` }))), 'x');
  assert.deepEqual([many.licenses.total, many.licenses.items.length, many.licenses.items[0].license], [30, 20, 'L-00']);
});
