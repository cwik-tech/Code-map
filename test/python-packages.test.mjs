import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { collect, mapData } from '../lib/build.mjs';
import { defaults } from '../lib/project.mjs';
import { deriveFindings } from '../lib/findings.mjs';
import { fixture, pythonTest } from './python-fixtures.mjs';

const lockNames = (...names) => names.map((name) => `[[package]]\nname=${JSON.stringify(name)}\n`).join('');
const scan = (root) => mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true).analysis;
const packages = (a, rule) => deriveFindings(a).filter((f) => f.ruleId === rule).map((f) => f.facts.package).sort();

pythonTest('Python declared packages feed findings and preserve JavaScript package findings', (t) => {
  const root = fixture(t, { 'pyproject.toml': '[project]\ndependencies = ["invented-used", "invented-idle"]\n',
    'uv.lock': lockNames('invented-missing'), 'src/main.py': 'import invented_used\nimport invented_missing\n', 'package.json': '{"dependencies":{"js-used":"1"}}',
    'src/main.ts': 'import "js-used"; import "js-missing";' });
  const a = scan(root);
  assert.deepEqual(packages(a, 'PACKAGE-UNDECLARED'), ['invented-missing', 'js-missing']);
  assert.deepEqual(packages(a, 'PACKAGE-UNUSED'), ['invented-idle']);
  assert.ok(a.packages.manifests.some((m) => m.path === 'pyproject.toml'));
});

const formats = [
  ['PEP 621, groups, Poetry and uv', 'pyproject.toml', '[project]\ndependencies=["invented-main[fast]>=1; python_version > \'3\'"]\n[project.optional-dependencies]\nextra=["invented-opt"]\n[dependency-groups]\ntest=["invented-test", {include-group="base"}]\nbase=["invented-base"]\n[tool.poetry.dependencies]\npython="^3.8"\ninvented-poetry="*"\n[tool.poetry.group.qa.dependencies]\ninvented-qa="*"\n[tool.poetry.dev-dependencies]\ninvented-dev="*"\n[tool.uv]\ndev-dependencies=["invented-uv"]\n', ['invented-base','invented-dev','invented-main','invented-opt','invented-poetry','invented-qa','invented-test','invented-uv']],
  ['setup.cfg', 'setup.cfg', '[options]\ninstall_requires =\n invented-main>=1\n[options.extras_require]\nfast =\n invented-opt\n', ['invented-main','invented-opt']],
  ['literal setup.py', 'setup.py', 'from setuptools import setup\nsetup(install_requires=["invented-main"], extras_require={"fast": ["invented-opt"]}, tests_require=["invented-test"])\n', ['invented-main','invented-opt','invented-test']],
  ['Pipfile', 'Pipfile', '[packages]\ninvented-main="*"\n[dev-packages]\ninvented-test={version="*"}\n', ['invented-main','invented-test']],
];
for (const [name, path, text, expected] of formats) pythonTest(`Python declarations read ${name} as text`, (t) => {
  const a = scan(fixture(t, { [path]: text, 'main.py': 'pass\n' }));
  assert.deepEqual(a.packages.python.declarations.map((d) => d.name).sort(), expected);
});

pythonTest('requirements includes stop cycles and paths while locks never declare packages', (t) => {
  const a = scan(fixture(t, { 'requirements.txt': '-r requirements/base.txt\n-c constraints.txt\n-e .\n--index-url https://invalid.example\nhttps://invalid.example/archive.whl\n../local\n',
    'requirements/base.txt': '-r ../requirements.txt\ninvented-core[fast]>=1; os_name == "posix"\n',
    'constraints.txt': 'invented-constraint==2\n', 'uv.lock': '[[package]]\nname="invented-locked"\nversion="1"\n',
    'main.py': 'import invented_locked\n' }));
  assert.deepEqual(a.packages.python.declarations.map((d) => d.name), ['invented-core']);
  assert.ok(a.packages.python.unknown.some((d) => /cycle/.test(d.reason)));
  assert.ok(a.packages.python.skipped.length >= 4);
  assert.ok(a.packages.python.skipped.every((s) => Number.isInteger(s.line) && s.line > 0));
  assert.deepEqual(packages(a, 'PACKAGE-UNDECLARED'), ['invented-locked']);
});

pythonTest('computed setup dependencies stay UNKNOWN and optional or guarded imports stay silent', (t) => {
  const a = scan(fixture(t, { 'setup.py': 'setup(install_requires=read_deps())\n',
    'main.py': 'from typing import TYPE_CHECKING\nimport sys\ntry:\n import invented_optional\nexcept ImportError:\n pass\nif TYPE_CHECKING:\n import invented_types\nif sys.platform == "win32":\n import invented_platform\nimport invented_required\n' }));
  assert.ok(a.packages.python.unknown.some((d) => /computed/.test(d.reason)));
  assert.deepEqual(packages(a, 'PACKAGE-UNDECLARED'), []);
});

pythonTest('no declarations produce a Python package gap and no undeclared findings', (t) => {
  const a = scan(fixture(t, { 'main.py': 'import invented_unknown\n', 'poetry.lock': '[[package]]\nname="invented_unknown"\n' }));
  assert.deepEqual(packages(a, 'PACKAGE-UNDECLARED'), []);
  assert.ok(a.packages.python.unknown.some((d) => d.reason === 'no-declarations'));
});

pythonTest('distribution aliases and tools or plugins never produce unused leads', (t) => {
  const a = scan(fixture(t, { 'pyproject.toml': '[project]\ndependencies=["PyYAML", "Pillow", "scikit-learn", "beautifulsoup4", "python-dateutil", "opencv-python", "protobuf", "attrs", "pyjwt", "python-dotenv", "pywin32", "pytest-invented", "flake8-invented", "types-invented", "pytest", "ruff", "mypy", "black", "setuptools", "flake8", "pyright", "invented-stubs"]\n',
    'main.py': 'import yaml, PIL, sklearn, bs4, dateutil, cv2, google.protobuf, attr, jwt, dotenv, win32api\n' }));
  assert.deepEqual(packages(a, 'PACKAGE-UNDECLARED'), []);
  assert.deepEqual(packages(a, 'PACKAGE-UNUSED'), []);
});

pythonTest('virtual environment metadata maps imports without running any environment code', (t) => {
  const root = fixture(t, { 'pyproject.toml': '[project]\ndependencies=["invented-one", "invented-two"]\n', 'main.py': 'import alien_one, alien_two\n',
    '.venv/pyvenv.cfg': 'home = /nowhere\n', '.venv/lib/python3.8/site-packages/invented_one-1.dist-info/top_level.txt': 'alien_one\n',
    '.venv/lib/python3.8/site-packages/invented_two-1.dist-info/RECORD': 'alien_two/feature.py,,\n' });
  const a = scan(root);
  assert.deepEqual(packages(a, 'PACKAGE-UNDECLARED'), []);
  assert.deepEqual(packages(a, 'PACKAGE-UNUSED'), []);
  assert.equal(existsSync(join(root, 'executed')), false);
  assert.equal(a.packages.python.installed.length, 2);
});

pythonTest('Python development groups report production imports while tests stay silent', (t) => {
  const a = scan(fixture(t, { 'pyproject.toml': '[project]\ndependencies=[]\n[dependency-groups]\ntest=["invented-dev"]\n',
    'main.py': 'import invented_dev\n', 'tests/test_one.py': 'import invented_dev\ndef test_one():\n assert True\n' }));
  assert.deepEqual(packages(a, 'PACKAGE-DEV-ONLY'), ['invented-dev']);
  assert.equal(deriveFindings(a).find((f) => f.ruleId === 'PACKAGE-DEV-ONLY').location.path, 'main.py');
});

pythonTest('Python namespace imports match the full declared import name', (t) => {
  const a = scan(fixture(t, { 'pyproject.toml': '[project]\ndependencies=["protobuf"]\n', 'main.py': 'from google import protobuf\n' }));
  assert.deepEqual(packages(a, 'PACKAGE-UNDECLARED'), []);
  assert.deepEqual(packages(a, 'PACKAGE-UNUSED'), []);
});

pythonTest('invalid declarations and missing requirement includes keep package use UNKNOWN', (t) => {
  const a = scan(fixture(t, { 'pyproject.toml': '[project]\ndependencies=["invented-idle"]\n', 'requirements.txt': '-r absent.txt\n', 'main.py': 'import invented_other\n' }));
  assert.deepEqual(packages(a, 'PACKAGE-UNDECLARED'), []);
  assert.deepEqual(packages(a, 'PACKAGE-UNUSED'), []);
  assert.ok(a.packages.python.unknown.some((u) => u.reason === 'requirements-include-unavailable'));
  assert.equal(a.packages.unknown.unused[0].state, 'UNKNOWN');
});

pythonTest('packaging and local metadata edits invalidate Python snapshot identity', async (t) => {
  const { analysisInputs, analysisId } = await import('../lib/inputs.mjs');
  const { writeFileSync } = await import('node:fs');
  const root = fixture(t, { 'requirements.txt': 'invented-one\n', 'main.py': 'import alien_one\n',
    '.gitignore': '.venv/\n', '.venv/pyvenv.cfg': '', '.venv/lib/python3.8/site-packages/invented_one-1.dist-info/top_level.txt': 'alien_one\n' });
  const id = () => analysisId(analysisInputs(root, defaults, { worktree: true }, null));
  const before = id();
  writeFileSync(join(root, 'requirements.txt'), 'invented-two\n');
  const declaration = id();
  assert.notEqual(declaration, before);
  writeFileSync(join(root, '.venv/lib/python3.8/site-packages/invented_one-1.dist-info/top_level.txt'), 'alien_changed\n');
  assert.notEqual(id(), declaration);
});

pythonTest('complete declarations suppress only optional, type and platform imports', (t) => {
  const a = scan(fixture(t, { 'pyproject.toml': '[project]\ndependencies=[]\n', 'uv.lock': lockNames('invented-required', 'invented-optional', 'invented-types', 'invented-platform'), 'main.py': 'from typing import TYPE_CHECKING\nimport sys\ntry:\n import invented_optional\nexcept ImportError:\n pass\nif TYPE_CHECKING:\n import invented_types\nif sys.platform == "win32":\n import invented_platform\nimport invented_required\n' }));
  assert.deepEqual(packages(a, 'PACKAGE-UNDECLARED'), ['invented-required']);
});

pythonTest('declarations do not count as their own config use but tool settings do', (t) => {
  const a = scan(fixture(t, { 'pyproject.toml': '[tool.poetry.dependencies]\ninventedidle="*"\ninventedused="*"\n[tool.invented]\nplugin="inventedused"\n', 'main.py': 'pass\n' }));
  assert.deepEqual(packages(a, 'PACKAGE-UNUSED'), ['inventedidle']);
});

pythonTest('source strings and conftest plugin registration prevent unused package leads', (t) => {
  const a = scan(fixture(t, { 'pyproject.toml': '[project]\ndependencies=["invented-plugin", "invented-worker"]\n',
    'conftest.py': 'pytest_plugins = ["invented_plugin"]\n', 'main.py': 'worker_name = "invented_worker"\n' }));
  assert.deepEqual(packages(a, 'PACKAGE-UNUSED'), []);
});

pythonTest('requirement includes and requirements folders declare dependencies for their project sources', (t) => {
  const included = scan(fixture(t, { 'requirements.txt': '-r config/base.txt\n', 'config/base.txt': 'invented-core\n', 'main.py': 'import invented_core\n' }));
  const folder = scan(fixture(t, { 'requirements/runtime.txt': 'invented-core\n', 'main.py': 'import invented_core\n' }));
  assert.deepEqual(packages(included, 'PACKAGE-UNDECLARED'), []);
  assert.deepEqual(packages(included, 'PACKAGE-UNUSED'), []);
  assert.deepEqual(packages(folder, 'PACKAGE-UNDECLARED'), []);
  assert.deepEqual(packages(folder, 'PACKAGE-UNUSED'), []);
  assert.equal(folder.packages.python.unknown.some((u) => u.reason === 'no-declarations'), false);
});

pythonTest('lock and environment names identify undeclared distributions without declaring them', (t) => {
  const a = scan(fixture(t, { 'pyproject.toml': '[project]\ndependencies=[]\n',
    'poetry.lock': '[[package]]\nname="PyYAML"\n', 'Pipfile.lock': '{"default":{"invented-locked":{}},"develop":{}}',
    'main.py': 'import yaml\nimport invented_locked\n' }));
  assert.deepEqual(packages(a, 'PACKAGE-UNDECLARED'), ['invented-locked', 'pyyaml']);
  assert.deepEqual(a.packages.python.declarations, []);
});

pythonTest('requirements includes accept repository text files without a txt extension', (t) => {
  const a = scan(fixture(t, { 'requirements.txt': '-r deps/base.in\n-c deps/constraints\n',
    'deps/base.in': '-r nested.requirements\n', 'deps/nested.requirements': 'invented-core\n', 'deps/constraints': 'invented-constraint==1\n', 'main.py': 'import invented_core\n' }));
  assert.deepEqual(a.packages.python.declarations.map((d) => d.name), ['invented-core']);
  assert.deepEqual(packages(a, 'PACKAGE-UNDECLARED'), []);
  assert.deepEqual(a.packages.python.unknown, []);
});

pythonTest('requirement includes read tracked dependency text inside documentation folders', (t) => {
  const a = scan(fixture(t, { 'requirements.txt': '-r docs/dependencies.in\n', 'docs/dependencies.in': 'invented-core\n', 'main.py': 'import invented_core\n' }));
  assert.deepEqual(a.packages.python.declarations.map((d) => d.name), ['invented-core']);
  assert.deepEqual(a.packages.python.unknown, []);
});

pythonTest('requirements group names use whole words rather than incidental test substrings', (t) => {
  const a = scan(fixture(t, { 'requirements-latest.txt': 'invented-core\n', 'main.py': 'import invented_core\n' }));
  assert.deepEqual(packages(a, 'PACKAGE-DEV-ONLY'), []);
  assert.equal(a.packages.python.declarations[0].group, 'main');
});

pythonTest('invalid dependency group members keep unmatched imports UNKNOWN', (t) => {
  const a = scan(fixture(t, { 'pyproject.toml': '[project]\ndependencies=[]\n[dependency-groups]\nqa=[7]\n', 'main.py': 'import invented_missing\n' }));
  assert.deepEqual(packages(a, 'PACKAGE-UNDECLARED'), []);
  assert.ok(a.packages.python.unknown.some((u) => /dependency group/.test(u.reason)));
});

pythonTest('invalid included requirement text keeps project imports UNKNOWN', (t) => {
  const a = scan(fixture(t, { 'requirements.txt': '-r deps/broken.in\n', 'deps/broken.in': 'invented invalid requirement\n', 'main.py': 'import invented_missing\n' }));
  assert.deepEqual(packages(a, 'PACKAGE-UNDECLARED'), []);
  assert.ok(a.packages.python.unknown.some((u) => u.reason === 'unsupported-dependency-requirement'));
});

pythonTest('unmapped import names stay UNKNOWN instead of guessing undeclared distributions', (t) => {
  const a = scan(fixture(t, { 'pyproject.toml': '[project]\ndependencies=["invented-distribution"]\n', 'main.py': 'import alien_import\nimport _private_helper\n' }));
  assert.deepEqual(packages(a, 'PACKAGE-UNDECLARED'), []);
  assert.ok(a.packages.python.unknown.some((u) => u.reason === 'import-name-not-mapped' && u.specifier === 'alien_import'));
  assert.deepEqual(packages(a, 'PACKAGE-UNUSED'), []);
});

pythonTest('distribution names cannot select inherited properties of the alias table', (t) => {
  const a = scan(fixture(t, { 'pyproject.toml': '[project]\ndependencies=["constructor"]\n', 'main.py': 'import constructor\n' }));
  assert.deepEqual(packages(a, 'PACKAGE-UNDECLARED'), []);
  assert.deepEqual(packages(a, 'PACKAGE-UNUSED'), []);
});

pythonTest('a namespace parent alone does not identify a distribution from the alias table', (t) => {
  const a = scan(fixture(t, { 'pyproject.toml': '[project]\ndependencies=[]\n', 'main.py': 'import google\n' }));
  assert.deepEqual(packages(a, 'PACKAGE-UNDECLARED'), []);
  assert.ok(a.packages.python.unknown.some((u) => u.reason === 'import-name-not-mapped'));
});

pythonTest('module-cache interception keeps injected imports UNKNOWN without hiding other dependencies', (t) => {
  // This is parsed project text. The test never executes the module interception.
  const a = scan(fixture(t, { 'pyproject.toml': '[project]\ndependencies=[]\n', 'uv.lock': lockNames('invented-injected', 'invented-required', 'invented-outside'),
    'tests/test_modules.py': 'import importlib\nfrom unittest.mock import patch, MagicMock\nwith patch.dict("sys.modules", {"invented_injected": MagicMock()}):\n import invented_injected, invented_required\n importlib.import_module("invented_injected")\nimport invented_outside\n' }));
  assert.deepEqual(packages(a, 'PACKAGE-UNDECLARED'), ['invented-outside', 'invented-required']);
  assert.ok(a.packages.python.unknown.some((u) => u.reason === 'module-cache-interception' && u.specifier === 'invented_injected'));
});

pythonTest('pytest importorskip protects matching imports only in its containing scope', (t) => {
  const a = scan(fixture(t, { 'pyproject.toml': '[project]\ndependencies=[]\n',
    'uv.lock': lockNames('invented-optional', 'invented-required'),
    'tests/test_optional.py': 'import pytest\ndef test_optional():\n pytest.importorskip("invented_optional")\n import invented_optional, invented_required\ndef test_required():\n import invented_optional\n' }));
  const leads = a.packages.leads.undeclared.filter((l) => l.language === 'python');
  assert.deepEqual(leads.map((l) => l.package).sort(), ['invented-optional', 'invented-required']);
  assert.deepEqual(leads.find((l) => l.package === 'invented-optional').lines, [6]);
});
