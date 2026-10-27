// Environment template files (C26): the four template names in a package folder, and the files that Code-map must not read:
// other env files, a template outside a package folder, a symlink (in a commit and in the working tree) and a large file.
import assert from 'node:assert/strict';
import { chmodSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { collect, mapData } from '../lib/build.mjs';
import { loadConfig } from '../lib/project.mjs';
import { repository } from './nextjs-fixture.mjs';

const json = (output) => { assert.equal(output.status, 0, output.stderr); return JSON.parse(output.stdout); };
const secrets = ['prod-secret-5521', 'dev-secret-6632', 'link-secret-7743', 'PROD_ONLY', 'DEV_ONLY', 'LINK_ONLY', 'NO_PACKAGE'];
const templateFiles = {
  'package.json': JSON.stringify({ name: 'shop' }),
  '.env.example': 'ROOT_EXAMPLE=1\n',
  'apps/web/package.json': JSON.stringify({ name: 'web' }),
  'apps/web/.env.sample': 'WEB_SAMPLE=2\n',
  'apps/web/.env.template': 'WEB_TEMPLATE=3\n',
  'apps/web/.env.defaults': 'WEB_DEFAULTS=4\n',
  // Other env files can hold secret values. Code-map never reads them.
  'apps/web/.env.production': 'PROD_ONLY=prod-secret-5521\n',
  'apps/web/.env.development.local': 'DEV_ONLY=dev-secret-6632\n',
  // A template outside a package folder is not read.
  'tools/.env.example': 'NO_PACKAGE=5\n',
  'big/package.json': JSON.stringify({ name: 'big' }),
  'big/.env.example': `BIG_NAME=1\n# ${'x'.repeat(300 * 1024)}\n`,
  'linked/package.json': JSON.stringify({ name: 'linked' }),
  'linked/.env': 'LINK_ONLY=link-secret-7743\n',
  'src/index.ts': 'export const url = process.env.ROOT_EXAMPLE;\n',
  'linked/src/index.ts': 'export const url = process.env.ANY_NAME;\n',
};
const expected = [['.env.example', 'read'], ['apps/web/.env.defaults', 'read'], ['apps/web/.env.sample', 'read'], ['apps/web/.env.template', 'read'],
  ['big/.env.example', 'too-large'], ['linked/.env.example', 'symlink']];

/** The environment report of the commit (`ref`) or of the working tree. */
const envOf = (root, options) => { const config = loadConfig(root); return mapData(root, config, collect(root, config, options), 2, options.worktree === true).analysis.frameworks.env; };

test('Code-map reads the names of the four template files in a package folder, and it does not follow a symlink or read a large file', (t) => {
  const { root, git } = repository(t, templateFiles);
  // A committed symlink to a file with secret values. Code-map does not follow it, in the commit or in the working tree.
  symlinkSync('.env', join(root, 'linked/.env.example'));
  git('add', 'linked/.env.example'); git('commit', '-qm', 'link the template');
  for (const options of [{ ref: 'HEAD' }, { worktree: true }]) {
    const env = envOf(root, options), label = JSON.stringify(options);
    assert.deepEqual(env.templates.map((item) => [item.path, item.state]), expected, label);
    assert.deepEqual(env.templates.flatMap((item) => item.names.map((entry) => entry.name)), ['ROOT_EXAMPLE', 'WEB_DEFAULTS', 'WEB_SAMPLE', 'WEB_TEMPLATE'], label);
    // The linked package has a template that Code-map did not read, so its read of ANY_NAME is not a lead.
    assert.deepEqual(env.leads.undeclared, [], label);
    const text = JSON.stringify(env);
    for (const secret of secrets) assert.ok(!text.includes(secret), `${label}: the report does not hold "${secret}"`);
  }
});

test('a template that Code-map cannot read is missing, and the collection goes on', (t) => {
  const { root } = repository(t, templateFiles);
  chmodSync(join(root, 'apps/web/.env.sample'), 0o000); // the cleanup of the fixture removes the file in any mode
  const env = envOf(root, { worktree: true });
  assert.equal(env.templates.find((item) => item.path === 'apps/web/.env.sample').state, process.getuid?.() === 0 ? 'read' : 'missing');
});

test('a template that is a symlink counts only as a symlink: it changes the ID, but an edit of its target does not', (t) => {
  const { root, store, put, run } = repository(t, templateFiles);
  const id = () => json(run(['inspect', '--summary', '--worktree', '--store', store])).analysis.id;
  const clean = id();
  rmSync(join(root, '.env.example'));
  symlinkSync('.env', join(root, '.env.example'));
  put('.env', 'ROOT_EXAMPLE=first-secret\n');
  const linked = id();
  assert.notEqual(linked, clean, 'a template that becomes a symlink changes the analysis');
  put('.env', 'ROOT_EXAMPLE=second-secret\nNEW_NAME=x\n');
  assert.equal(id(), linked, 'Code-map does not follow the symlink, so its target is not an input');
});

test('working-tree inspection does not open secret env files or the target of a template symlink', (t) => {
  const { root, store, put, run } = repository(t, templateFiles);
  put('.env.local', 'PRIVATE_TOKEN=unreadable-secret\n');
  chmodSync(join(root, '.env.local'), 0o000);
  rmSync(join(root, '.env.example'));
  symlinkSync('.env.local', join(root, '.env.example'));
  const output = run(['inspect', '--summary', '--worktree', '--store', store]);
  assert.equal(output.status, 0, output.stderr);
  assert.equal(JSON.parse(output.stdout).frameworks.env.templates.read, 3);
});
