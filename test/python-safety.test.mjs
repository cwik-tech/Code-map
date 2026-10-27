import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, mapData } from '../lib/build.mjs';
import { defaults, loadConfig } from '../lib/project.mjs';
import { findInterpreter } from '../lib/python/interpreter.mjs';

import { fixture, pythonTest } from './python-fixtures.mjs';

const environments = new WeakMap();
function setEnv(t, name, value) {
  if (!environments.has(t)) {
    const before = { ...process.env };
    environments.set(t, before);
    t.after(() => { process.env = before; });
  }
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
}

// Each child uses a real repository and its own environment, without changing this process.
function pythonChoice(root, env = {}, setting) {
  const module = new URL('../lib/python/interpreter.mjs', import.meta.url).href;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    `import { findInterpreter } from ${JSON.stringify(module)}; console.log(JSON.stringify(findInterpreter(${JSON.stringify(setting)}, ${JSON.stringify(root)})));`],
  { cwd: root, encoding: 'utf8', env: { ...process.env, CODE_MAP_PYTHON: '', ...env }, timeout: 15000 }));
}
function markerProgram(root, name = 'tools/x') {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n/usr/bin/touch "${join(root, 'executed')}"\n`);
  chmodSync(path, 0o755);
  return path;
}

test('repository interpreter scripts are refused without execution and the gap names the setting', (t) => {
  const root = fixture(t, { 'app.py': 'pass', '.code-map.json': '{"python":{"interpreter":"./tools/x"}}' });
  markerProgram(root);
  const choice = pythonChoice(root, { CODE_MAP_PYTHON: undefined }, loadConfig(root).python.interpreter);
  assert.equal(existsSync(join(root, 'executed')), false);
  assert.equal(choice.state, 'UNKNOWN');
  assert.match(choice.reason, /python.interpreter.*\.\/tools\/x/);
  const facts = collect(root, loadConfig(root), { worktree: true });
  assert.equal(facts.python.state, 'UNKNOWN');
  assert.match(facts.python.reason, /python.interpreter.*\.\/tools\/x/);
});

test('absolute repository settings outside the repository are refused without execution', (t) => {
  const root = fixture(t, { 'app.py': 'pass' }), outside = fixture(t, { 'app.py': 'pass' });
  const choice = pythonChoice(root, { CODE_MAP_PYTHON: undefined }, markerProgram(outside));
  assert.equal(existsSync(join(outside, 'executed')), false);
  assert.equal(choice.state, 'UNKNOWN');
  assert.match(choice.reason, /python.interpreter/);
});

test('relative PATH entries never run a planted python3', (t) => {
  const root = fixture(t, { 'app.py': 'pass' });
  markerProgram(root, 'python3');
  const choice = pythonChoice(root, { PATH: '.:tools:', CODE_MAP_PYTHON: undefined });
  assert.equal(existsSync(join(root, 'executed')), false);
  assert.equal(choice.interpreter.source, 'discovery');
});

pythonTest('absolute environment interpreters take precedence and reach analysis summary and snapshot identity', async (t) => {
  const { summaryReport } = await import('../lib/overview.mjs');
  const { analysisInputs, analysisId } = await import('../lib/inputs.mjs');
  const root = fixture(t, { 'app.py': 'pass' }), interpreter = findInterpreter().interpreter;
  setEnv(t, 'CODE_MAP_PYTHON', interpreter.path);
  const config = { ...defaults, python: { interpreter: './refused' } };
  const data = mapData(root, config, collect(root, config, { worktree: true }), 1, true);
  assert.deepEqual(data.analysis.python.interpreter, { ...interpreter, source: 'environment' });
  const summary = summaryReport({ id: 'A-fixture', inputs: {}, findings: [], data }, { id: 'A-fixture', command: (args) => args.join(' ') });
  assert.equal(summary.python.interpreter.source, 'environment');
  const inputs = analysisInputs(root, config, { worktree: true }, null);
  assert.equal(inputs.python.interpreter.source, 'environment');
  assert.notEqual(analysisId(inputs), analysisId({ ...inputs, python: { ...inputs.python, interpreter } }));
});

test('environment paths inside the repository are refused through symlinks without execution', (t) => {
  const root = fixture(t, { 'app.py': 'pass' }), outside = fixture(t, { 'app.py': 'pass' });
  const path = markerProgram(root), link = join(outside, 'python');
  symlinkSync(path, link);
  assert.equal(pythonChoice(root, { CODE_MAP_PYTHON: path }).state, 'UNKNOWN');
  const choice = pythonChoice(root, { CODE_MAP_PYTHON: link });
  assert.equal(choice.state, 'UNKNOWN');
  assert.match(choice.reason, /inside.*repository/);
  assert.equal(existsSync(join(root, 'executed')), false);
});

test('relative environment interpreter paths give a named UNKNOWN gap', (t) => {
  const root = fixture(t, { 'app.py': 'pass' });
  markerProgram(root);
  const choice = pythonChoice(root, { CODE_MAP_PYTHON: './tools/x' });
  assert.equal(choice.state, 'UNKNOWN');
  assert.match(choice.reason, /CODE_MAP_PYTHON.*absolute/);
  assert.equal(existsSync(join(root, 'executed')), false);
});

pythonTest('versioned interpreter command settings use trusted folders and record setting source', (t) => {
  const root = fixture(t, { 'app.py': 'pass' });
  const name = `python3.${findInterpreter().interpreter.version.split('.')[1]}`;
  const choice = pythonChoice(root, { CODE_MAP_PYTHON: undefined }, name);
  assert.equal(choice.state, 'KNOWN');
  assert.equal(choice.interpreter.source, 'setting');
  assert.equal(choice.interpreter.version.split('.')[1], name.split('.')[1]);
});

pythonTest('interpreter choices separate repository roots environment PATH and changed symlink targets', (t) => {
  const root = fixture(t, { 'app.py': 'pass' }), other = fixture(t, { 'app.py': 'pass' });
  const interpreter = findInterpreter().interpreter, link = join(other, 'python3');
  symlinkSync(interpreter.path, link);
  setEnv(t, 'CODE_MAP_PYTHON', link);
  assert.equal(findInterpreter(undefined, root).state, 'KNOWN');
  rmSync(link); symlinkSync(markerProgram(root), link);
  assert.equal(findInterpreter(undefined, root).state, 'UNKNOWN');
  setEnv(t, 'CODE_MAP_PYTHON', interpreter.path);
  assert.equal(findInterpreter(undefined, root).interpreter.source, 'environment');
  assert.equal(findInterpreter(undefined, dirname(interpreter.path)).state, 'UNKNOWN');
  setEnv(t, 'CODE_MAP_PYTHON', undefined);
  writeFileSync(join(other, 'python3.99'), `#!/bin/sh\nexec "${interpreter.path}" "$@"\n`);
  chmodSync(join(other, 'python3.99'), 0o755);
  setEnv(t, 'PATH', root);
  assert.equal(findInterpreter('python3.99', root).state, 'UNKNOWN');
  setEnv(t, 'PATH', other);
  const selected = findInterpreter('python3.99', root);
  assert.equal(selected.state, 'KNOWN', selected.reason);
});

pythonTest('non-ASCII facts match under C locale and an ASCII standard input wrapper', async (t) => {
  const { parsePython } = await import('../lib/python/parse.mjs');
  const interpreter = findInterpreter().interpreter, files = [{ path: 'app.py', text: 'value = "ł😀"\n' }];
  const expected = parsePython(interpreter, files);
  setEnv(t, 'LANG', 'C'); setEnv(t, 'LC_ALL', 'C');
  assert.deepEqual(parsePython(interpreter, files), expected);
  const facts = fileURLToPath(new URL('../lib/python/facts.py', import.meta.url));
  const input = JSON.stringify(files), code = `import io,sys,runpy; sys.stdin=io.TextIOWrapper(sys.stdin.buffer,encoding="ascii"); runpy.run_path(${JSON.stringify(facts)},run_name="__main__")`;
  const result = JSON.parse(execFileSync(interpreter.path, ['-I', '-S', '-B', '-W', 'ignore', '-c', code], { input, encoding: 'utf8', timeout: 15000 }));
  assert.deepEqual(result.files, expected.files);
});

pythonTest('parser starts with isolated flags and suppresses warnings', async (t) => {
  const { parsePython } = await import('../lib/python/parse.mjs');
  const root = fixture(t, { 'app.py': 'pass' }), interpreter = findInterpreter().interpreter;
  const wrapper = join(root, 'parser');
  writeFileSync(wrapper, `#!/bin/sh\n[ "$1 $2 $3 $4 $5" = "-I -S -B -W ignore" ] || exit 42\nexec "${interpreter.path}" "$@"\n`);
  chmodSync(wrapper, 0o755);
  assert.deepEqual(parsePython({ path: wrapper }, [{ path: 'app.py', text: 'pass' }]).errors, []);
});

for (const setting of ['node', 'python', 'python2', '../python3', 'python3/evil', 'python3\\evil', 'python3\n', '', null, 3]) {
  test(`repository setting ${JSON.stringify(setting)} is not a Python command name`, () => {
    const choice = findInterpreter(setting);
    assert.equal(choice.state, 'UNKNOWN');
    assert.match(choice.reason, /python.interpreter/);
  });
}

test('trusted folder discovery refuses a symlink into the repository before probing', (t) => {
  const root = fixture(t, { 'app.py': 'pass' }), outside = fixture(t, { 'app.py': 'pass' });
  symlinkSync(markerProgram(root), join(outside, 'python3.99'));
  const choice = pythonChoice(root, { PATH: outside, CODE_MAP_PYTHON: undefined }, 'python3.99');
  assert.equal(choice.state, 'UNKNOWN');
  assert.match(choice.reason, /inside.*repository/);
  assert.equal(existsSync(join(root, 'executed')), false);
});
