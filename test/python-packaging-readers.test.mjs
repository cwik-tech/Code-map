import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findInterpreter } from '../lib/python/interpreter.mjs';
import { readPythonDeclarations } from '../lib/python/declarations.mjs';
import { installedPythonDistributions } from '../lib/python/installed.mjs';
import { fixture, pythonTest } from './python-fixtures.mjs';
import { collect, mapData } from '../lib/build.mjs';
import { defaults } from '../lib/project.mjs';

const metadata = fileURLToPath(new URL('../lib/python/metadata.py', import.meta.url));

pythonTest('bounded TOML fallback reads arrays and inline dependency groups without tomllib', () => {
  const child = spawnSync(findInterpreter().interpreter.path, ['-I', '-S', '-B', '-W', 'ignore', '-c', `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('packaging_reader',sys.argv[1])
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
print(json.dumps([m.parse(i['path'],i['text'],m.fallback_toml) for i in json.load(sys.stdin)]))`, metadata], {
    input: JSON.stringify([{ path: 'pyproject.toml', text: '[project]\ndependencies=["invented-main"]\n[dependency-groups]\nqa=["invented-qa", {include-group="base"}]\nbase=["invented-base"]\n[tool.poetry.dependencies]\ninvented-extra={version="*"}\n' }]), encoding: 'utf8', timeout: 15000 });
  assert.equal(child.status, 0, child.stderr);
  const [parsed] = JSON.parse(child.stdout);
  assert.deepEqual(parsed.dependencies.map((d) => d.value).sort(), ['invented-base', 'invented-extra', 'invented-main', 'invented-qa']);
  assert.deepEqual(parsed.unknown, []);
});

pythonTest('environment programs and startup hooks cannot create a marker during collection', (t) => {
  const root = fixture(t, { 'pyproject.toml': '[project]\ndependencies=["invented-one"]\n', 'main.py': 'import alien_one\n',
    '.venv/pyvenv.cfg': 'home=/nowhere\n', '.venv/lib/python3.9/site-packages/invented_one-1.dist-info/top_level.txt': 'alien_one\n' });
  const marker = join(root, 'executed');
  mkdirSync(join(root, '.venv/bin'));
  writeFileSync(join(root, '.venv/bin/python3'), `#!/bin/sh\ntouch '${marker}'\n`);
  chmodSync(join(root, '.venv/bin/python3'), 0o755);
  writeFileSync(join(root, '.venv/lib/python3.9/site-packages/sitecustomize.py'), `open(${JSON.stringify(marker)}, "w").write("executed")`);
  writeFileSync(join(root, '.venv/lib/python3.9/site-packages/hostile.pth'), `import pathlib; pathlib.Path(${JSON.stringify(marker)}).touch()`);
  const a = mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true).analysis;
  assert.equal(a.packages.python.installed[0].name, 'invented-one');
  assert.equal(existsSync(marker), false);
});

test('virtual environment metadata refuses symlink directories and oversized text', (t) => {
  const root = fixture(t, { 'main.py': 'pass', '.venv/pyvenv.cfg': '', '.venv/lib/python3.9/site-packages/invented_one-1.dist-info/top_level.txt': 'x'.repeat(1024 * 1024 + 1) });
  const outside = fixture(t, { 'site-packages/invented_two-1.dist-info/top_level.txt': 'alien_two' });
  mkdirSync(join(root, 'venv'));
  symlinkSync(outside, join(root, 'venv/Lib'));
  const result = installedPythonDistributions(root);
  assert.deepEqual(result.distributions, []);
  assert.ok(result.unknown.some((u) => u.reason === 'environment-metadata-limit'));
});

pythonTest('requirements constraints never become declarations through directory enumeration', (t) => {
  const result = readPythonDeclarations(new Map([
    ['requirements/base.txt', '-c constraints.txt\ninvented-core\n'],
    ['requirements/constraints.txt', 'invented-constraint==1\n'],
    ['requirements/dev.txt', '-r base.txt\ninvented-dev\n'],
  ]), null);
  assert.deepEqual([...new Set(result.declarations.map((d) => d.name))].sort(), ['invented-core', 'invented-dev']);
});

pythonTest('requirements constraint includes do not declare a file that sorts before its parent', () => {
  const result = readPythonDeclarations(new Map([
    ['requirements/a-constraints.txt', 'invented-constraint==1\n'],
    ['requirements/z-main.txt', '-c a-constraints.txt\ninvented-core\n'],
  ]), null);
  assert.deepEqual(result.declarations.map((d) => d.name), ['invented-core']);
});

test('RECORD recognizes compiled import modules and records unavailable import names', (t) => {
  const root = fixture(t, { 'main.py': 'pass', '.venv/pyvenv.cfg': '',
    '.venv/lib/python3.9/site-packages/invented_binary-1.dist-info/RECORD': 'alien_binary.cpython-39-darwin.so,,\n',
    '.venv/lib/python3.9/site-packages/invented_unknown-1.dist-info/RECORD': 'invented_unknown-1.dist-info/METADATA,,\n' });
  const result = installedPythonDistributions(root);
  assert.ok(result.distributions.some((d) => d.name === 'invented-binary' && d.imports.includes('alien_binary')));
  assert.ok(result.unknown.some((u) => u.reason === 'environment-import-names-unavailable'));
});

pythonTest('package manifest symlinks retain JavaScript cache invalidation', async (t) => {
  const { analysisId, analysisInputs } = await import('../lib/inputs.mjs');
  const root = fixture(t, { '.gitignore': 'hidden/\n', 'main.py': 'pass', 'hidden/manifest.json': '{"dependencies":{"invented-one":"1"}}' });
  symlinkSync('hidden/manifest.json', join(root, 'package.json'));
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['-C', root, 'add', 'package.json']);
  execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@local', 'commit', '-qm', 'manifest link']);
  const before = analysisId(analysisInputs(root, defaults, { worktree: true }, null));
  writeFileSync(join(root, 'hidden/manifest.json'), '{"dependencies":{"invented-two":"1"}}');
  assert.notEqual(analysisId(analysisInputs(root, defaults, { worktree: true }, null)), before);
});

pythonTest('packaging inputs exclude environment files and hidden settings folders', (t) => {
  const root = fixture(t, { 'main.py': 'pass', '.env': 'TOKEN=fixture-value', '.env.local.toml': 'token="fixture-value"',
    '.settings/credentials.toml': 'token="fixture-value"', '.github/workflows/check.yml': 'run: python -m main\n' });
  const facts = collect(root, defaults, { worktree: true });
  assert.equal(facts.texts.has('.env'), false);
  assert.equal(facts.texts.has('.env.local.toml'), false);
  assert.equal(facts.texts.has('.settings/credentials.toml'), false);
  assert.equal(facts.texts.has('.github/workflows/check.yml'), true);
});

pythonTest('package reports retain distribution names without retaining unrelated configuration values', (t) => {
  const root = fixture(t, { 'pyproject.toml': '[project]\ndependencies=["invented-core"]\n[tool.invented]\ncredential="fixture configuration value"\n', 'main.py': 'import invented_core\n' });
  const a = mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true).analysis;
  assert.equal(JSON.stringify(a.packages).includes('fixture configuration value'), false);
  assert.equal(a.packages.python.declarations[0].name, 'invented-core');
});

pythonTest('ignored configuration candidates do not consume the packaging input file budget', (t) => {
  const ignored = Object.fromEntries(Array.from({ length: 513 }, (_, i) => [`docs/example${i}.toml`, 'name="invented-example"\n']));
  const root = fixture(t, { ...ignored, 'requirements.txt': 'invented-core\n', 'main.py': 'import invented_core\n' });
  const a = mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true).analysis;
  assert.deepEqual(a.packages.python.declarations.map((d) => d.name), ['invented-core']);
  assert.equal(a.packages.python.unknown.some((u) => u.reason === 'packaging-input-file-limit'), false);
});

test('environment metadata refuses special files without waiting for a writer', async (t) => {
  const { execFileSync } = await import('node:child_process');
  const root = fixture(t, { 'main.py': 'pass', '.venv/pyvenv.cfg': '', '.venv/lib/python3.9/site-packages/invented_one-1.dist-info/RECORD': 'alien_one/__init__.py,,\n' });
  execFileSync('mkfifo', [join(root, '.venv/lib/python3.9/site-packages/invented_one-1.dist-info/top_level.txt')]);
  const reader = new URL('../lib/python/installed.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', 'const m = await import(process.argv[1]); process.stdout.write(JSON.stringify(m.installedPythonDistributions(process.argv[2])));', reader, root], { encoding: 'utf8', timeout: 1000 });
  assert.equal(child.error, undefined, String(child.error));
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).distributions[0].name, 'invented-one');
});

test('unreadable environment metadata directories report UNKNOWN', (t) => {
  const root = fixture(t, { 'main.py': 'pass', '.venv/pyvenv.cfg': '', '.venv/lib/python3.9/site-packages/invented_one-1.dist-info/top_level.txt': 'alien_one\n' });
  const site = join(root, '.venv/lib/python3.9/site-packages');
  chmodSync(site, 0);
  let result;
  try { result = installedPythonDistributions(root); } finally { chmodSync(site, 0o755); }
  assert.deepEqual(result.distributions, []);
  assert.ok(result.unknown.some((u) => u.reason === 'environment-directory-unreadable'));
});
