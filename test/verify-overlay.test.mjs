// Host-side copy safety before any project process exists.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { applyTestOverlay, readTestOverlay } from '../lib/worker/test-overlay.mjs';
import { project } from './worker-fixtures.mjs';

test('copying refuses a symlink at the source file or any source parent', (t) => {
  const fixture = project(t);
  symlinkSync(join(fixture.root, 'test/sum.test.mjs'), join(fixture.root, 'link.test.mjs'));
  symlinkSync(join(fixture.root, 'test'), join(fixture.root, 'linked'));
  assert.throws(() => readTestOverlay(fixture.root, { head: null, files: ['link.test.mjs'] }), /symlink/);
  assert.throws(() => readTestOverlay(fixture.root, { head: null, files: ['linked/sum.test.mjs'] }), /symlink/);
});

test('copying refuses a destination symlink and never changes its target', (t) => {
  const fixture = project(t), target = join(fixture.work, 'tree'); mkdirSync(target);
  const files = readTestOverlay(fixture.root, { head: fixture.git('rev-parse', 'HEAD'), files: ['test/sum.test.mjs'] });
  symlinkSync(join(fixture.root, 'test'), join(target, 'test'));
  const before = readFileSync(join(fixture.root, 'test/sum.test.mjs'), 'utf8');
  assert.throws(() => applyTestOverlay(target, files, { sha: 'base' }), /symlink/);
  assert.equal(readFileSync(join(fixture.root, 'test/sum.test.mjs'), 'utf8'), before);
});

test('copying refuses traversal, metadata and dependency paths', (t) => {
  const fixture = project(t);
  assert.throws(() => readTestOverlay(fixture.root, { head: null, files: ['../outside'] }), /Unsafe/);
  assert.throws(() => readTestOverlay(fixture.root, { head: null, files: ['.git/config'] }), /Unsafe/);
  assert.throws(() => readTestOverlay(fixture.root, { head: null, files: ['node_modules/test.mjs'] }), /Unsafe/);
});
