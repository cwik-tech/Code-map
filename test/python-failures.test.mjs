import assert from 'node:assert/strict';
import { collect, mapData } from '../lib/build.mjs';
import { defaults } from '../lib/project.mjs';
import { deriveFindings } from '../lib/findings.mjs';
import { fixture, pythonTest } from './python-fixtures.mjs';

const scan = (t, entries) => {
  const root = fixture(t, entries), facts = collect(root, defaults, { worktree: true });
  return { facts: { ...facts, files: structuredClone(facts.files) }, analysis: mapData(root, defaults, facts, 1, true).analysis };
};
const source = 'def crumble(value=None):\n    raise ValueError(value)\n';

pythonTest('Python failure exits distinguish raises, handlers, process exits and removable asserts', (t) => {
  const { facts } = scan(t, { 'src/stone.py': `import sys as system
import os
from sys import exit as stop
def crumble():
    raise ValueError()
def bare():
    raise
def caught():
    try:
        crumble()
    except ValueError:
        raise
    except TypeError:
        raise RuntimeError()
def terminate(code):
    system.exit(2)
    stop(code)
    exit(1)
    quit(-1)
    os._exit(3)
    os.abort()
def safe():
    sys.exit(0)
    system.exit(0)
    system.exit()
    exit(0)
    assert False
def shadow(exit):
    exit(4)
` });
  const declarations = facts.files[0].declarations;
  const exits = (name) => declarations.find((d) => d.name === name).metrics.failureExits;
  assert.deepEqual(exits('crumble'), [{ line: 5, kind: 'throw' }]);
  assert.deepEqual(exits('bare'), [{ line: 7, kind: 'throw' }]);
  assert.deepEqual(exits('caught'), [{ line: 11, kind: 'catch', probe: 12 }, { line: 13, kind: 'catch', probe: 14 }]);
  assert.deepEqual(exits('terminate').map((e) => e.kind), Array(6).fill('exit'));
  assert.deepEqual(exits('safe'), []);
  assert.deepEqual(exits('shadow'), []);
  assert.deepEqual(declarations.find((d) => d.name === 'caught').metrics.references, ['src/stone.py#crumble']);
});

pythonTest('Python failure assertions bind context, callable and caught-error targets', (t) => {
  const { facts } = scan(t, { 'src/stone.py': source, 'tests/test_stone.py': `import pytest as pt
from pytest import raises as rejects
from stone import crumble as crack
import unittest
class TestStone(unittest.TestCase):
    def test_context(self):
        with self.assertRaises(ValueError):
            crack()
    def test_callable(self):
        self.assertRaises(ValueError, crack, 'x')
    def test_regex(self):
        self.assertRaisesRegex(ValueError, 'x', crack, 'x')
def test_context():
    with pt.raises(ValueError):
        crack()
def test_callable():
    rejects(ValueError, crack, 'x')
def test_caught():
    try:
        crack()
    except ValueError as err:
        assert str(err) == 'x'
def test_warning():
    with pt.warns(UserWarning):
        crack()
def test_fail():
    pt.fail('x')
def test_alias():
    operation = crack
    with pt.raises(ValueError):
        operation()
` });
  const cases = facts.testFacts[0].testScan.cases;
  assert.deepEqual(cases.slice(0, 6).map((c) => c.failures.map((f) => [f.kind, f.targets])), [...Array.from({ length: 5 }, () => [['throws', ['src/stone.py#crumble']]]), [['error-value', ['src/stone.py#crumble']]]]);
  assert.deepEqual(cases.slice(6, 8).map((c) => [c.assertions, c.failures]), [[1, []], [1, []]]);
  assert.deepEqual(cases[8].references, ['src/stone.py#crumble']);
  assert.deepEqual(cases[8].failures[0].targets, ['src/stone.py#crumble']);
});

pythonTest('Python assertion helpers bind parameters across test modules and conftest without fixture credit', (t) => {
  const { facts } = scan(t, { 'src/stone.py': source,
    'tests/conftest.py': 'import pytest\ndef check_failure(action):\n    with pytest.raises(ValueError):\n        action()\n@pytest.fixture\ndef prepared():\n    assert True\n    return 1\n',
    'tests/helpers.py': 'from tests.conftest import check_failure\ndef ensure_bad(action):\n    check_failure(action)\n',
    'tests/test_stone.py': 'from stone import crumble\nfrom tests.helpers import ensure_bad\nfrom tests.conftest import check_failure\ndef test_helper():\n    ensure_bad(crumble)\ndef test_conftest():\n    check_failure(crumble)\ndef test_fixture(prepared):\n    crumble()\n' });
  const cases = facts.testFacts[0].testScan.cases;
  assert.deepEqual(cases.map((c) => c.assertions), [1, 1, 0]);
  assert.deepEqual(cases.slice(0, 2).map((c) => c.failures[0].targets), [['src/stone.py#crumble'], ['src/stone.py#crumble']]);
  assert.deepEqual(cases[2].failures, []);
});

pythonTest('Python C09 and C12 findings share TypeScript failure evidence and preserve mixed findings', (t) => {
  const { facts, analysis } = scan(t, { 'src/stone.py': source + 'def untouched():\n    raise ValueError()\ndef happy():\n    raise ValueError()\n',
    'src/other.ts': 'export function untouched() { throw new Error(); }',
    'tests/test_stone.py': 'import pytest\nfrom stone import crumble, happy\ndef test_bad():\n    with pytest.raises(ValueError):\n        crumble()\ndef test_happy():\n    assert happy()\n' });
  assert.deepEqual(analysis.tests.units.filter((u) => u.path.endsWith('.py')).map((u) => [u.name, u.status]), [['crumble', 'direct'], ['untouched', 'unreached'], ['happy', 'no-failure-assertion']]);
  const findings = deriveFindings(analysis).filter((f) => /^TEST-(UNREACHED|NO-FAILURE-ASSERTION)$/.test(f.ruleId));
  assert.deepEqual(findings.map((f) => [f.ruleId, f.location.path, f.location.symbol]).sort(), [
    ['TEST-NO-FAILURE-ASSERTION', 'src/stone.py', 'happy'], ['TEST-UNREACHED', 'src/other.ts', 'untouched'], ['TEST-UNREACHED', 'src/stone.py', 'untouched']].sort());
});

pythonTest('Python LCOV probes measure own-line exits and keep inline exits unknown', (t) => {
  const { analysis } = scan(t, { 'src/stone.py': source + 'def inline(x):\n    if x: raise ValueError()\n',
    'coverage/lcov.info': 'SF:src/stone.py\nDA:1,1\nDA:2,0\nDA:3,1\nDA:4,1\nLF:4\nLH:3\nend_of_record\n' });
  assert.deepEqual(analysis.tests.units.map((u) => u.exits[0].hits), [0, null]);
  assert.deepEqual(deriveFindings(analysis).filter((f) => f.ruleId === 'TEST-EXIT-NOT-RUN').map((f) => f.location.symbol), ['crumble']);
});

pythonTest('Python smells detect swallowed assertions and literal sleeps without flagging handled errors', (t) => {
  const { facts } = scan(t, { 'tests/test_stone.py': `import time as clock
from time import sleep as pause
def test_swallowed():
    try:
        assert False
    except Exception:
        pass
    clock.sleep(0.3)
def test_handled(delay):
    try:
        assert False
    except Exception as err:
        assert str(err)
    pause(delay)
` });
  assert.deepEqual(facts.testFacts[0].testScan.cases.map((c) => c.smells), [['fixed-wait', 'swallowed-error'], []]);
});

pythonTest('Python computed, star and shadowed names give no invented references or failure checks', (t) => {
  const { facts } = scan(t, { 'src/stone.py': source, 'tests/test_stone.py': `from stone import *
import stone
import pytest
def test_computed(name):
    getattr(stone, name)()
def test_star():
    crumble()
def test_shadow(stone, pytest):
    with pytest.raises(ValueError):
        stone.crumble()
def test_reassigned():
    action = stone.crumble
    action = lambda: None
    action()
` });
  assert.deepEqual(facts.testFacts[0].testScan.cases.map((c) => c.failures), [[], [], [], []]);
  assert.deepEqual(facts.testFacts[0].testScan.cases.slice(0, 3).map((c) => c.references), [[], [], []]);
});

pythonTest('Python helper assertions follow nested and keyword operands without copying unused or production bodies', (t) => {
  const { facts } = scan(t, { 'src/stone.py': source,
    'src/check.py': 'def check(value):\n    assert value\n',
    'src/consumer.py': 'from check import check\n',
    'tests/test_stone.py': `import pytest
from stone import crumble
from check import check
def assert_bad(action):
    with pytest.raises(ValueError):
        action()
def test_local():
    def nested(action):
        assert_bad(action=action)
    nested(crumble)
def test_unused():
    def unused():
        assert False
    crumble()
def test_production():
    check(True)
` });
  const cases = facts.testFacts[0].testScan.cases;
  assert.deepEqual(cases.map((c) => c.assertions), [1, 0, 0]);
  assert.deepEqual(cases[0].failures[0].targets, ['src/stone.py#crumble']);
});

pythonTest('Python case and extractor validators reject malformed failure records', async () => {
  const { validCases } = await import('../lib/python/validate.mjs');
  const { validFailureFacts } = await import('../lib/python/failure-validation.mjs');
  const { parsePython } = await import('../lib/python/parse.mjs');
  const { findInterpreter } = await import('../lib/python/interpreter.mjs');
  const parsed = parsePython(findInterpreter().interpreter, [{ path: 'test_stone.py', text: 'import pytest\ndef test_one():\n    with pytest.raises(ValueError):\n        run()\n' }]);
  const fn = parsed.files[0].failureFacts[0], item = parsed.files[0].cases[0];
  assert.equal(validFailureFacts([fn]), true);
  assert.equal(validFailureFacts([{ ...fn, exits: [{ line: -1, kind: 'throw' }] }]), false);
  assert.equal(validFailureFacts([{ ...fn, calls: [{ callee: 'run', arguments: [3], keywords: {} }] }]), false);
  const failure = { line: 3, kind: 'throws', targets: ['src/stone.py#crumble'], expectedTargets: [] };
  assert.equal(validCases([{ ...item, failures: [failure], references: failure.targets }]), true);
  assert.equal(validCases([{ ...item, failures: [{ ...failure, kind: 'warning' }] }]), false);
  assert.equal(validCases([{ ...item, failures: [{ ...failure, targets: [3] }] }]), false);
});

pythonTest('Python factory fixtures count only explicit calls to a literal returned helper', (t) => {
  const { facts } = scan(t, { 'src/stone.py': source,
    'tests/conftest.py': 'import pytest\n@pytest.fixture\ndef verifier():\n    assert True\n    def verify(action):\n        with pytest.raises(ValueError):\n            action()\n    return verify\n',
    'tests/test_stone.py': 'from stone import crumble\ndef test_factory(verifier):\n    verifier(crumble)\ndef test_received(verifier):\n    crumble()\n' });
  assert.deepEqual(facts.testFacts[0].testScan.cases.map((c) => c.assertions), [1, 0]);
  assert.deepEqual(facts.testFacts[0].testScan.cases[0].failures[0].targets, ['src/stone.py#crumble']);
});

pythonTest('Python references resolve relative imports and package reexports without treating function references as calls', (t) => {
  const { facts, analysis } = scan(t, { 'src/pebble/__init__.py': 'from .stone import crumble\n', 'src/pebble/stone.py': source,
    'src/pebble/outer.py': 'from .stone import crumble\ndef outer():\n    return crumble()\n',
    'tests/test_stone.py': 'import pytest\nfrom pebble import crumble\nfrom pebble.outer import outer\ndef unused():\n    assert True\ndef test_reference():\n    action = unused\ndef test_outer():\n    with pytest.raises(ValueError):\n        outer()\ndef test_package():\n    with pytest.raises(ValueError):\n        crumble()\n' });
  assert.equal(facts.testFacts[0].testScan.cases[0].assertions, 0);
  assert.deepEqual(facts.testFacts[0].testScan.cases[2].failures[0].targets, ['src/pebble/stone.py#crumble']);
  assert.equal(analysis.tests.units.find((u) => u.name === 'crumble').failureDirect, 1);
  assert.equal(analysis.tests.units.find((u) => u.name === 'crumble').viaFailure, 1);
});

pythonTest('Python shadowed process APIs and prototype-like names do not invent failure evidence', (t) => {
  const { facts } = scan(t, { 'src/stone.py': 'def exit(code):\n    return code\ndef harmless():\n    exit(4)\n',
    'tests/test_stone.py': 'import pytest\npytest = object()\ndef test_local(toString):\n    toString()\n    with pytest.raises(ValueError):\n        toString()\n' });
  assert.deepEqual(facts.files[0].declarations.find((d) => d.name === 'harmless').metrics.failureExits, []);
  assert.deepEqual(facts.testFacts[0].testScan.cases[0].failures, []);
});

pythonTest('Python namespace module references bind while eagerly evaluated raises arguments stay outside the failure target', (t) => {
  const { facts } = scan(t, { 'src/pebble/stone.py': source + 'def input_value():\n    return 1\n',
    'tests/test_stone.py': 'import pebble.stone\nimport pytest\ndef test_callable():\n    pytest.raises(ValueError, pebble.stone.crumble, pebble.stone.input_value())\n' });
  const item = facts.testFacts[0].testScan.cases[0];
  assert.deepEqual(item.references, ['src/pebble/stone.py#crumble', 'src/pebble/stone.py#input_value']);
  assert.deepEqual(item.failures[0].targets, ['src/pebble/stone.py#crumble']);
  assert.deepEqual(item.failures[0].expectedTargets, ['src/pebble/stone.py#input_value']);
});
