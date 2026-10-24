import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collect, mapData, renderPage } from '../lib/build.mjs';
import { defaults } from '../lib/project.mjs';
import { findInterpreter } from '../lib/python/interpreter.mjs';
import { deriveFindings } from '../lib/findings.mjs';

import { fixture, pythonTest } from './python-fixtures.mjs';

pythonTest('Python imports resolve and mixed repositories expose cycles, tests and completeness without executing source', (t) => {
  const root = fixture(t, {
    'src/pkg/__init__.py': 'from .core import run\n',
    'src/pkg/core.py': 'from . import other\nfrom .missing import absent\nimport pkg.absent\nimport os\nimport requests\nimport importlib\nimportlib.import_module(name)\n__import__(name)\n__all__ = ["run"]\nasync def run(x):\n    if x:\n        for y in x:\n            pass\n    return x\n',
    'src/pkg/other.py': 'from pkg.core import run\n',
    'src/bad.py': 'def broken(:\n',
    'src/safe.py': 'pass\n',
    'src/main.ts': 'export const value = 1;',
    'tests/test_core.py': 'from pkg.core import run\nimport pytest\n@pytest.mark.skip(reason="parked")\ndef test_skip():\n    assert run(1)\n@pytest.mark.skipif(True, reason="condition")\ndef test_conditional():\n    pass\n@pytest.mark.xfail\ndef test_xfail():\n    assert False\n@pytest.mark.parametrize("x", [1, 2, 3])\ndef test_values(x):\n    assert x\nclass TestCore:\n    def test_method(self):\n        assert True\n',
    'tests/test_unit.py': 'import unittest\nfrom pkg.other import run\nclass Checks(unittest.TestCase):\n    def test_ok(self):\n        self.assertTrue(True)\n',
    'tests/main.test.ts': "import { value } from '../src/main'; import { test } from 'node:test'; test('value', () => {});",
  });
  // A real marker path proves that parsing never executes a top-level project command.
  writeFileSync(join(root, 'src/safe.py'), `import os\nos.system("touch ${join(root, 'executed')}")\n`);
  const facts = collect(root, defaults, { worktree: true });
  assert.ok(facts.files.some((file) => file.path === 'src/pkg/core.py'));
  const data = mapData(root, defaults, facts, 1, true), a = data.analysis;
  assert.equal(existsSync(join(root, 'executed')), false);
  assert.match(a.python.interpreter.version, /^3\./);
  const core = a.files.find((file) => file.path === 'src/pkg/core.py');
  assert.ok(core.imports.some((edge) => edge.target === 'src/pkg/other.py'));
  assert.ok(core.imports.some((edge) => edge.classification === 'stdlib' && edge.specifier === 'os'));
  assert.ok(core.imports.some((edge) => edge.classification === 'third-party' && edge.specifier === 'requests'));
  assert.deepEqual(core.tests.direct, ['tests/test_core.py']);
  assert.deepEqual(core.tests.transitive, ['tests/test_unit.py']);
  assert.ok(a.cycles.value.some((group) => group.files.includes('src/pkg/core.py')));
  assert.equal(core.declarations.find((d) => d.name === 'run').async, true);
  assert.deepEqual(core.declarations.find((d) => d.name === 'run').complexity, { cyclomatic: 3, nesting: 2 });
  assert.equal(a.syntaxErrors.find((file) => file.path === 'src/bad.py').diagnostics[0].line, 1);
  const row = a.completeness.find((r) => r.stack === 'Python');
  assert.deepEqual([row.discovered, row.parsed, row.malformed, row.dynamicallyUnresolved], [7, 7, 1, 2]);
  assert.equal(a.unsupportedFiles['.py'], undefined);
  assert.equal(a.tests.cases.length, 7);
  assert.deepEqual(a.tests.cases.filter((c) => c.path.endsWith('test_core.py')).map((c) => [c.name, c.status, c.each]), [
    ['test_skip', 'skipped', null], ['test_conditional', 'conditional', null], ['test_xfail', 'expected-failure', null],
    ['test_values', 'active', 3], ['test_method', 'active', null],
  ]);
  const leads = deriveFindings(a);
  assert.ok(leads.some((f) => f.ruleId === 'IMPORT-UNRESOLVED' && f.key.includes('pkg.absent')));
  assert.ok(leads.some((f) => f.ruleId === 'IMPORT-UNRESOLVED' && f.key.includes('.missing')));
  assert.equal(leads.some((f) => f.ruleId === 'FILE-ORPHANED' && f.paths.some((p) => p.endsWith('.py'))), false);
  assert.ok(renderPage(data, null).includes('src/pkg/core.py'));
});

pythonTest('Collect across pytest honors configured paths and file patterns and links namespace imports', (t) => {
  const root = fixture(t, {
    'pyproject.toml': '[tool.pytest.ini_options]\ntestpaths = ["checks"]\npython_files = ["check_*.py"]\n',
    'src/ns/module.py': 'def run():\n    return 1\n',
    'checks/check_module.py': 'from ns.module import run\ndef test_run():\n    assert run() == 1\n',
    'tests/test_ignored.py': 'def test_ignored():\n    pass\n',
  });
  const facts = collect(root, defaults, { worktree: true });
  assert.deepEqual(facts.testFacts.map((f) => f.path), ['checks/check_module.py']);
  const a = mapData(root, defaults, facts, 1, true).analysis;
  assert.equal(a.tests.cases[0].name, 'test_run');
  assert.deepEqual(a.files.find((f) => f.path === 'src/ns/module.py').tests.direct, ['checks/check_module.py']);
});


pythonTest('Python AST facts retain nested definitions, decorators, top-level names and independent function complexity', async () => {
  const { findInterpreter } = await import('../lib/python/interpreter.mjs');
  const { parsePython } = await import('../lib/python/parse.mjs');
  const interpreter = findInterpreter().interpreter;
  const parsed = parsePython(interpreter, [{ path: 'module.py', text: 'import os as operating\nfrom sys import version as release\n__all__ = ["outer"]\n@decorate\ndef outer(x):\n    def inner(y):\n        if y:\n            return y\n    if x and operating:\n        return inner(x)\nclass Service:\n    @staticmethod\n    async def run():\n        return 1\nif True:\n    def conditional():\n        pass\n' }]);
  assert.equal(parsed.errors.length, 0);
  const file = parsed.files[0];
  assert.deepEqual(file.all, ['outer']);
  assert.ok(file.names.includes('operating'));
  assert.ok(file.names.includes('release'));
  assert.deepEqual(file.definitions.map((d) => d.name), ['outer', 'Service', 'conditional']);
  assert.deepEqual(file.definitions[0].decorators, ['decorate']);
  assert.deepEqual(file.definitions[0].complexity, { cyclomatic: 3, nesting: 1 });
  assert.deepEqual(file.definitions[0].children[0].complexity, { cyclomatic: 2, nesting: 1 });
  assert.deepEqual(file.definitions[1].children[0].decorators, ['staticmethod']);
  assert.equal(file.definitions[1].children[0].async, true);
});


test('Python source roots honor explicit, setuptools, Poetry and Hatch layouts', async () => {
  const { pythonRoots } = await import('../lib/python/project.mjs');
  const paths = ['src/pkg/main.py', 'lib/pkg/main.py'];
  assert.deepEqual(pythonRoots(paths, { roots: ['only'] }, ''), ['only']);
  assert.deepEqual(pythonRoots(paths, {}, '[tool.setuptools.packages.find]\nwhere = ["lib"]'), ['.', 'src', 'lib']);
  assert.deepEqual(pythonRoots(paths, {}, '[tool.setuptools.package-dir]\n"" = "lib"'), ['.', 'src', 'lib']);
  assert.deepEqual(pythonRoots(paths, {}, '[tool.poetry]\npackages = [{include = "pkg", from = "lib"}]'), ['.', 'src', 'lib']);
  assert.deepEqual(pythonRoots(paths, {}, '[tool.hatch.build.targets.wheel]\npackages = ["lib/pkg"]'), ['.', 'src', 'lib']);
});

