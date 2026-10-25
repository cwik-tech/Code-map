import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hypothesisVersion } from '../lib/python/properties.mjs';

test('Hypothesis version evidence reads requirements pyproject and lock declarations without guessing', () => {
  assert.equal(hypothesisVersion(new Map([['pyproject.toml', '[tool.poetry.dependencies]\nhypothesis = "^6.100"']])).value, '^6.100');
  assert.equal(hypothesisVersion(new Map([['requirements-dev.txt', 'hypothesis>=6.100,<7\n']])).value, '>=6.100,<7');
  assert.equal(hypothesisVersion(new Map([['uv.lock', '[[package]]\nname = "hypothesis"\nversion = "6.100.1"']])).value, '==6.100.1');
  assert.equal(hypothesisVersion(new Map([['Pipfile.lock', '{"develop":{"hypothesis":{"version":"==6.100.1"}}}']])).value, '==6.100.1');
  assert.equal(hypothesisVersion(new Map([['requirements.txt', '# hypothesis==9\nother==1\n']])).state, 'UNKNOWN');
});

test('a bound command seed applies only to property cases named in its report', async () => {
  const { propertyEvidence } = await import('../lib/python/properties.mjs');
  const property = { kind: 'given', seed: { state: 'random' }, examples: [], generators: [], settings: {} };
  const analysis = { files: [{ path: 'widget.py', imports: [] }], importFiles: [{ path: 'test_widget.py', imports: [{ target: 'widget.py' }] }], tests: { testFiles: [{ path: 'test_widget.py' }], cases: [{ path: 'test_widget.py', name: 'test_one', suite: '', property }, { path: 'test_widget.py', name: 'test_two', suite: '', property }] } };
  const info = propertyEvidence(analysis, ['widget.py'], [{ run: { command: ['pytest', '--hypothesis-seed=10'] }, cases: [{ file: 'test_widget.py', name: 'test_one' }] }]);
  assert.equal(info.fixed, 1);
  assert.equal(info.random, 1);
  assert.equal(info.tests[0].seed.value, '10');
});

test('computed settings parents do not inherit literal profile limits as known', async () => {
  const { resolveProperties } = await import('../lib/python/properties.mjs');
  const conftest = { path: 'conftest.py', properties: { profiles: [{ name: { state: 'literal', value: 'repeat' }, settings: { max_examples: { state: 'literal', value: 12 } } }], loads: [{ state: 'literal', value: 'repeat' }], tests: [] } };
  const raw = { path: 'test_widget.py', properties: { profiles: [], loads: [], tests: [{ name: 'test_one', kind: 'given', seed: null, settings: { _unknown: { state: 'UNKNOWN', reason: 'Computed parent.' } } }] } };
  assert.equal(resolveProperties(raw, [conftest, raw], { state: 'UNKNOWN' })[0].settings.max_examples.state, 'UNKNOWN');
});

test('invalid literal property limits remain UNKNOWN rather than Hypothesis defaults', async () => {
  const { resolveProperties } = await import('../lib/python/properties.mjs');
  const raw = { path: 'test_limits.py', properties: { profiles: [], loads: [], tests: [{ name: 'test_limits', seed: null, settings: { max_examples: { state: 'literal', value: -1 }, deadline: { state: 'literal', value: 'fast' }, phases: { state: 'literal', value: 'shrink' } } }] } };
  const p = resolveProperties(raw, [raw], { state: 'UNKNOWN' })[0];
  assert.equal(p.settings.max_examples.state, 'UNKNOWN');
  assert.equal(p.settings.deadline.state, 'UNKNOWN');
  assert.equal(p.shrink, 'UNKNOWN');
});

test('profile facts apply only below their conftest directory', async () => {
  const { resolveProperties } = await import('../lib/python/properties.mjs');
  const profile = { path: 'checks/conftest.py', properties: { profiles: [{ name: { state: 'literal', value: 'repeat' }, settings: { derandomize: { state: 'literal', value: true } } }], loads: [{ state: 'literal', value: 'repeat' }], tests: [] } };
  const raw = { path: 'other/test_widget.py', properties: { profiles: [], loads: [], tests: [{ name: 'test_one', seed: null, settings: {} }] } };
  assert.equal(resolveProperties(raw, [profile, raw], { state: 'UNKNOWN' })[0].seed.state, 'random');
  assert.equal(resolveProperties({ ...raw, path: 'checks/test_widget.py' }, [profile], { state: 'UNKNOWN' })[0].seed.state, 'fixed');
});

test('nested profile configuration and shadowed decorators do not create reproducibility leads', async () => {
  const { parsePython } = await import('../lib/python/parse.mjs');
  const { findInterpreter } = await import('../lib/python/interpreter.mjs');
  const choice = findInterpreter();
  assert.equal(choice.state, 'KNOWN');
  const parsed = parsePython(choice.interpreter, [{ path: 'conftest.py', text: `from hypothesis import settings
if FLAG:
    settings.load_profile('ci')
` }, { path: 'test_widget.py', text: `from hypothesis import given
from local_helpers import decorate
given = decorate
@given(1)
def test_plain(x):
    assert x
` }]);
  assert.equal(parsed.files[0].properties.loads[0].state, 'UNKNOWN');
  assert.equal(parsed.files[1].properties.tests.length, 0);
});

test('Hypothesis retains large integer seeds without JavaScript rounding', async () => {
  const { parsePython } = await import('../lib/python/parse.mjs');
  const { findInterpreter } = await import('../lib/python/interpreter.mjs');
  const { resolveProperties } = await import('../lib/python/properties.mjs');
  const parsed = parsePython(findInterpreter().interpreter, [{ path: 'test_seed.py', text: `from hypothesis import given, seed
@given(x=1)
@seed(123456789012345678901234567890)
def test_seed(x):
    assert x
` }]);
  const p = resolveProperties(parsed.files[0], parsed.files, { state: 'UNKNOWN' })[0];
  assert.equal(p.seed.state, 'fixed');
  assert.equal(p.seed.value, '123456789012345678901234567890');
});

test('Python evidence sections honor verification report detail limits', async () => {
  const { propertyLines } = await import('../lib/python/properties.mjs');
  const { pytestBenchmarkLines } = await import('../lib/python/benchmark.mjs');
  const property = { path: 'test_widget.py', suite: '', seed: { state: 'random' }, settings: {}, shrink: 'default' };
  const info = { count: 2, fixed: 0, random: 2, unknown: 0, retainedExamples: 0, tests: [{ ...property, name: 'sentinelone' }, { ...property, name: 'sentineltwo' }] };
  assert.equal(propertyLines(info, 1).filter((line) => line.includes('sentinel')).length, 1);
  assert.equal(pytestBenchmarkLines({ state: 'COMPARED', entries: [{ fullname: 'sentinelone', state: 'STABLE' }, { fullname: 'sentineltwo', state: 'ADDED' }] }, 1).filter((line) => line.includes('sentinel')).length, 1);
});

test('Hypothesis versions ignore comments and unrelated project metadata', () => {
  assert.equal(hypothesisVersion(new Map([['requirements.txt', 'other==1 # hypothesis==9\n']])).state, 'UNKNOWN');
  assert.equal(hypothesisVersion(new Map([['pyproject.toml', '[project]\ndescription = "hypothesis>=9"\n']])).state, 'UNKNOWN');
  assert.equal(hypothesisVersion(new Map([['pyproject.toml', '[project]\ndependencies = ["hypothesis>=6,<7"]\n']])).value, '>=6,<7');
});

test('Hypothesis lock pins take precedence over ranges and conflicting locks remain UNKNOWN', () => {
  const locked = hypothesisVersion(new Map([
    ['pyproject.toml', '[project]\ndependencies = ["hypothesis>=6,<7"]\n'],
    ['uv.lock', '[[package]]\nname = "hypothesis"\nversion = "6.100.1"\n'],
  ]));
  assert.equal(locked.value, '==6.100.1');
  assert.equal(locked.state, 'locked');
  assert.deepEqual(locked.declarations, ['>=6,<7']);
  assert.equal(hypothesisVersion(new Map([
    ['uv.lock', '[[package]]\nname = "hypothesis"\nversion = "6.100.1"\n'],
    ['poetry.lock', '[[package]]\nname = "hypothesis"\nversion = "6.101.0"\n'],
  ])).state, 'UNKNOWN');
});

test('Hypothesis version facts reject URLs templates and similarly named distributions', () => {
  assert.equal(hypothesisVersion(new Map([['pyproject.toml', '[tool.poetry.dependencies]\nhypothesis = "https://packages.invalid/archive.whl"\n']])).state, 'UNKNOWN');
  assert.equal(hypothesisVersion(new Map([['uv.lock', '[[package]]\nname = "hypothesis"\nversion = "{{VERSION}}"\n']])).state, 'UNKNOWN');
  assert.equal(hypothesisVersion(new Map([['pyproject.toml', '[project]\ndependencies = ["friendly-hypothesis>=9"]\n']])).state, 'UNKNOWN');
});

test('computed keyword settings parents keep inherited seeds and limits UNKNOWN', async () => {
  const { parsePython } = await import('../lib/python/parse.mjs');
  const { findInterpreter } = await import('../lib/python/interpreter.mjs');
  const { resolveProperties } = await import('../lib/python/properties.mjs');
  const parsed = parsePython(findInterpreter().interpreter, [
    { path: 'conftest.py', text: `from hypothesis import settings
settings.register_profile('repeat', parent=PARENT, max_examples=12)
settings.load_profile('repeat')
` },
    { path: 'test_parents.py', text: `from hypothesis import given, settings, strategies as st
@given(st.integers())
@settings(parent=PARENT)
def test_parent(x):
    assert x == x
@given(st.integers())
def test_loaded(x):
    assert x == x
` },
  ]);
  const tests = resolveProperties(parsed.files[1], parsed.files, hypothesisVersion(new Map()));
  assert.equal(tests[0].seed.state, 'UNKNOWN');
  assert.equal(tests[0].settings.max_examples.state, 'UNKNOWN');
  assert.equal(tests[1].seed.state, 'UNKNOWN');
  assert.equal(tests[1].settings.max_examples.value, 12);
});
