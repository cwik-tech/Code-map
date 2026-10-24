import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findInterpreter } from '../lib/python/interpreter.mjs';
import { parsePython } from '../lib/python/parse.mjs';
import { fixture, pythonTest } from './python-fixtures.mjs';

function runParser(script, payload, cwd) {
  return JSON.parse(execFileSync(findInterpreter().interpreter.path,
    ['-I', '-S', '-B', '-W', 'ignore', fileURLToPath(script)],
    { input: JSON.stringify(payload), encoding: 'utf8', timeout: 15000, cwd }));
}
const entry = new URL('../lib/python/facts.py', import.meta.url);
const baseline = new URL('./fixtures/python/phase1-facts.py', import.meta.url);
const files = [
  { path: 'src/pkg/core.py', text: `import os as operating
from . import other
try:
    import pkg.optional
    __import__('pkg.dynamic')
except (ValueError, ImportError):
    pass
importlib.import_module(name)
__all__ = ('outer', 'Service')
value: int = 1
@decorate
def outer(x):
    def inner(y):
        if y:
            return y
    return [inner(y) for y in x if y and operating]
class Service:
    @staticmethod
    async def run():
        return 1
if True:
    def conditional():
        pass
` },
  { path: 'tests/test_core.py', text: `import pytest as pt
from pytest import raises as check
import unittest
@pt.mark.skipif(True, reason='condition')
@pt.mark.parametrize('x', [1, 2])
@pt.mark.parametrize('y', values)
def test_values(x, y):
    with check(ValueError):
        assert x
@pt.mark.skip(reason='parked')
class TestCore:
    @pt.mark.xfail
    def test_method(self):
        pt.fail('failure')
class Checks(unittest.TestCase):
    @unittest.expectedFailure
    def test_ok(self):
        self.assertTrue(True)
` },
  { path: 'bad.py', text: 'def broken(:\n' },
  { path: 'empty.py', text: '' },
  { path: 'unicode.py', text: 'value = "ł😀"\n' },
];

pythonTest('extractors preserve phase 1 JSON for source facts syntax errors and pytest settings', () => {
  const config = [{ path: 'pyproject.toml', text: '[tool.pytest.ini_options]\ntestpaths = ["checks"]\npython_files = ["check_*.py"]\n' }];
  assert.deepEqual(runParser(entry, [...files, ...config]), runParser(baseline, [...files, ...config]));
  const ini = [{ path: 'pytest.ini', text: '[pytest]\ntestpaths = checks\n' }, { path: 'setup.cfg', text: '[tool:pytest]\npython_files = ignored_*.py\n' }];
  assert.deepEqual(runParser(entry, [...files, ...ini]), runParser(baseline, [...files, ...ini]));
  assert.deepEqual(parsePython(findInterpreter().interpreter, files).files, runParser(baseline, files).files);
});

pythonTest('project extractor names in the repository and child folder never execute', (t) => {
  const marker = "from pathlib import Path\nPath('executed').touch()\nraise RuntimeError('project extractor loaded')\n";
  const root = fixture(t, { 'imports.py': marker, 'common.py': marker, 'extractors/imports.py': marker, 'extractors/common.py': marker });
  const payload = [{ path: 'imports.py', text: marker }, { path: 'common.py', text: marker }, ...files];
  assert.deepEqual(runParser(entry, payload, root), runParser(baseline, payload, root));
  assert.deepEqual(parsePython(findInterpreter().interpreter, payload).files, runParser(baseline, payload).files);
  assert.equal(existsSync(join(root, 'executed')), false);
});

test('file validation refuses unknown missing and invalid keys', async () => {
  const { validFile } = await import('../lib/python/validate.mjs');
  const valid = { path: 'app.py', imports: [], definitions: [], all: null, names: [], cases: [], errors: [] };
  assert.equal(validFile(valid), true);
  assert.equal(validFile({ ...valid, surprise: [] }), false);
  const { names, ...missing } = valid;
  assert.equal(validFile(missing), false);
  assert.equal(validFile({ ...valid, names: 1 }), false);
  assert.equal(validFile(null), false);
});

pythonTest('shipped extractors expose the documented extension contract', () => {
  const code = `import runpy, sys
modules = runpy.run_path(sys.argv[1])['EXTRACTORS']
assert tuple(module.NAME for module in modules) == ('imports', 'definitions', None, 'cases')
assert all(callable(module.extract) for module in modules)
`;
  assert.doesNotThrow(() => execFileSync(findInterpreter().interpreter.path,
    ['-I', '-S', '-B', '-W', 'ignore', '-c', code, fileURLToPath(entry)],
    { input: '[]', encoding: 'utf8', timeout: 15000 }));
});
