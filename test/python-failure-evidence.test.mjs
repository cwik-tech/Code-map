import assert from 'node:assert/strict';
import { collect, mapData } from '../lib/build.mjs';
import { defaults } from '../lib/project.mjs';
import { reportCases } from '../lib/adapters/report-cases.mjs';
import { regression, preserved } from '../lib/profiles/evidence-v1-behavior.mjs';
import { context, isolated } from './evidence-v1-fixtures.mjs';
import { fixture, pythonTest } from './python-fixtures.mjs';

pythonTest('Python failure cases feed named regression and behavior-preservation obligations through pytest reports', (t) => {
  const root = fixture(t, { 'src/flint.py': 'def split():\n    raise ValueError()\n',
    'tests/test_flint.py': 'import pytest\nfrom flint import split\ndef test_regression():\n    with pytest.raises(ValueError):\n        split()\n' });
  const data = mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true);
  assert.deepEqual(data.analysis.tests.cases[0].failureTargets, ['src/flint.py#split']);
  const xml = '<testsuites><testsuite name="pytest"><testcase classname="tests.test_flint" name="test_regression" /></testsuite></testsuites>';
  const run = { workingDirectory: '.', command: ['pytest'], tools: [{ name: 'pytest', version: 'fixture' }] }, paths = new Set(['tests/test_flint.py']);
  const head = reportCases(xml, 'junit', root, run, paths);
  const base = reportCases(xml.replace(' />', '><failure message="regression" /></testcase>'), 'junit', root, run, paths);
  assert.equal(head.error, undefined);
  assert.equal(base.error, undefined);
  const c = context({ request: { regressionTests: [{ file: 'tests/test_flint.py', name: 'test_regression' }] },
    change: { paths: ['src/flint.py'], files: [{ path: 'src/flint.py', status: 'M' }] },
    head: { sha: 'head', analysis: data.analysis }, base: { sha: 'base', analysis: data.analysis },
    reports: { head: [isolated(head.cases, { run })], base: [isolated(base.cases, { run })] } });
  assert.equal(regression(c, true)[0], 'PASS');
  assert.equal(regression(c, false)[0], 'PASS');
  assert.equal(regression({ ...c, reports: { head: [], base: [] } }, true)[0], 'UNKNOWN');
  assert.equal(preserved({ ...c, reports: { head: [isolated(head.cases, { run })], base: [isolated(head.cases, { run })] } })[0], 'PASS');
});

pythonTest('Python helper bounds stop recursion, deep chains and more than thirty-two helpers', (t) => {
  const many = Array.from({ length: 35 }, (_, i) => `def check_${i}():\n    assert True\n`).join('');
  const calls = Array.from({ length: 35 }, (_, i) => `    check_${i}()\n`).join('');
  const chain = Array.from({ length: 6 }, (_, i) => `def chain_${i}():\n    ${i === 5 ? 'assert True' : `chain_${i + 1}()`}\n`).join('');
  const root = fixture(t, { 'tests/test_flint.py': `${many}${chain}def recursive():\n    recursive()\n    assert True\ndef test_many():\n${calls}def test_deep():\n    chain_0()\ndef test_recursive():\n    recursive()\n` });
  const cases = collect(root, defaults, { worktree: true }).testFacts[0].testScan.cases;
  assert.deepEqual(cases.map((c) => c.assertions), [32, 0, 1]);
});

pythonTest('Python class methods retain failure evidence and nested handlers stop at function boundaries', (t) => {
  const root = fixture(t, { 'src/flint.py': 'class Flint:\n    async def split(self):\n        raise ValueError()\ndef wrap():\n    try:\n        pass\n    except Exception:\n        def nested():\n            raise ValueError()\n        return nested\n',
    'tests/test_flint.py': 'import pytest\nfrom flint import Flint\ndef test_method():\n    with pytest.raises(ValueError):\n        Flint.split(None)\n' });
  const facts = collect(root, defaults, { worktree: true });
  assert.deepEqual(facts.files[0].declarations[1].children[0].metrics.failureExits, [{ line: 9, kind: 'throw' }]);
  assert.deepEqual(facts.files[0].declarations[1].metrics.failureExits, [{ line: 7, kind: 'catch', probe: 8 }, { line: 9, kind: 'throw' }]);
  const units = mapData(root, defaults, facts, 1, true).analysis.tests.units;
  assert.equal(units.find((u) => u.name === 'Flint').status, 'direct');
});

pythonTest('Python conditional fixture factories stay unknown and give no assertion credit', (t) => {
  const root = fixture(t, { 'tests/conftest.py': 'import pytest\n@pytest.fixture\ndef verifier(flag):\n    def check():\n        assert True\n    if flag:\n        return check\n    return None\n',
    'tests/test_flint.py': 'def test_conditional(verifier):\n    verifier()\n' });
  const item = collect(root, defaults, { worktree: true }).testFacts[0].testScan.cases[0];
  assert.equal(item.assertions, 0);
  assert.deepEqual(item.failures, []);
});

pythonTest('Python optimized assertions and same-line exits do not add spurious failure probes', (t) => {
  const root = fixture(t, { 'src/flint.py': 'import sys\ndef diagnostic():\n    assert sys.exit(1)\ndef stop():\n    sys.exit(1); sys.exit(2)\n' });
  const declarations = collect(root, defaults, { worktree: true }).files[0].declarations;
  assert.deepEqual(declarations[0].metrics.failureExits, []);
  assert.deepEqual(declarations[1].metrics.failureExits, [{ line: 5, kind: 'exit' }]);
});

pythonTest('Python conditional declarations and nested classes retain their failure metrics', (t) => {
  const root = fixture(t, { 'src/flint.py': 'if enabled:\n    def split():\n        raise ValueError()\ndef factory():\n    class Flint:\n        def split(self):\n            raise TypeError()\n    return Flint\n' });
  const declarations = collect(root, defaults, { worktree: true }).files[0].declarations;
  assert.deepEqual(declarations[0].metrics.failureExits, [{ line: 3, kind: 'throw' }]);
  assert.deepEqual(declarations[1].children[0].children[0].metrics.failureExits, [{ line: 7, kind: 'throw' }]);
});

pythonTest('Python pytest.fail in an exception handler remains an assertion without failure-path credit', (t) => {
  const root = fixture(t, { 'src/flint.py': 'def split():\n    raise ValueError()\n',
    'tests/test_flint.py': 'import pytest\nfrom flint import split\ndef test_unexpected_error():\n    try:\n        split()\n    except ValueError as err:\n        pytest.fail(str(err))\n' });
  const item = collect(root, defaults, { worktree: true }).testFacts[0].testScan.cases[0];
  assert.equal(item.assertions, 1);
  assert.deepEqual(item.failures, []);
});

pythonTest('Python swallowed assertion smells require a handler that can catch AssertionError', (t) => {
  const root = fixture(t, { 'tests/test_flint.py': 'def test_unrelated():\n    try:\n        assert False\n    except RuntimeError:\n        pass\ndef test_tuple():\n    try:\n        assert False\n    except (ValueError, AssertionError):\n        pass\n' });
  const cases = collect(root, defaults, { worktree: true }).testFacts[0].testScan.cases;
  assert.deepEqual(cases.map((c) => c.smells), [[], ['swallowed-error']]);
});

pythonTest('Python repeated declaration names keep the exits from their own source ranges', (t) => {
  const root = fixture(t, { 'src/flint.py': 'def receive():\n    raise ValueError()\ndef receive():\n    raise TypeError()\n' });
  const declarations = collect(root, defaults, { worktree: true }).files[0].declarations;
  assert.deepEqual(declarations.map((d) => d.metrics.failureExits), [[{ line: 2, kind: 'throw' }], [{ line: 4, kind: 'throw' }]]);
});

pythonTest('Python explicit base classes carry transitive failure checks from derived classes', (t) => {
  const root = fixture(t, { 'src/flint.py': 'class Flint:\n    def split(self):\n        raise ValueError()\n',
    'src/pebble.py': 'from flint import Flint\nclass Pebble(Flint):\n    pass\n',
    'tests/test_flint.py': 'import pytest\nfrom pebble import Pebble\ndef test_inherited():\n    with pytest.raises(ValueError):\n        Pebble.split(None)\n' });
  const a = mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true).analysis;
  assert.equal(a.tests.units.find((u) => u.name === 'Flint').status, 'indirect');
});

pythonTest('Python error-value, false-success and error-status assertions use the shared failure kinds', (t) => {
  const root = fixture(t, { 'src/flint.py': 'def split():\n    raise ValueError()\n',
    'tests/test_flint.py': 'from flint import split\ndef test_error():\n    result = split()\n    assert result["error"]\ndef test_error_text():\n    result = split()\n    assert "missing" in result["error"].lower()\ndef test_flag():\n    result = split()\n    assert result["ok"] is False\ndef test_status():\n    result = split()\n    assert result.status_code == 403\ndef test_success():\n    result = split()\n    assert result["ok"] is True\n    assert result["error"] is None\n    assert result.status_code == 200\n' });
  const cases = collect(root, defaults, { worktree: true }).testFacts[0].testScan.cases;
  assert.deepEqual(cases.map((c) => c.failures.map((f) => f.kind)), [['error-value'], ['error-value'], ['ok-false'], ['status'], []]);
  assert.deepEqual(cases.slice(0, 4).map((c) => c.failures[0].targets), Array(4).fill(['src/flint.py#split']));
});

pythonTest('Python value-check helpers bind checked parameters and exclude unused expected operands', (t) => {
  const root = fixture(t, { 'src/flint.py': 'def split():\n    raise ValueError()\ndef expected(flag=None):\n    if flag:\n        raise ValueError()\n    return "missing"\n',
    'tests/test_flint.py': 'from flint import split, expected\ndef check_error(unused, value):\n    assert value["error"]\ndef test_known():\n    check_error(expected(), split())\ndef test_unknown(unknown):\n    check_error(expected(), unknown)\n' });
  const a = mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true).analysis;
  assert.deepEqual(a.tests.cases.map((c) => c.failureTargets), [['src/flint.py#split'], []]);
  assert.equal(a.tests.units.find((u) => u.name === 'expected').failureDirect, 0);
});
