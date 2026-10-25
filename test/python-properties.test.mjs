import assert from 'node:assert/strict';
import { collect, mapData } from '../lib/build.mjs';
import { deriveFindings } from '../lib/findings.mjs';
import { defaults } from '../lib/project.mjs';
import { propertyEvidence, propertyLines } from '../lib/python/properties.mjs';
import { fixture, pythonTest } from './python-fixtures.mjs';

const source = `from hypothesis import given, settings, seed, example, strategies as st, Phase
from widget import normalize
@given(x=st.integers(min_value=-3, max_value=8), y=st.text())
@seed(17)
@settings(max_examples=42, deadline=None, phases=[Phase.generate])
@example(x=0, y='')
def test_normalize(x, y):
    assert normalize(x) == normalize(x)
@given(st.builds(dict))
@settings(max_examples=LIMIT)
def test_computed(x):
    assert normalize(x)
@given(st.from_type(int))
def test_random(x):
    assert normalize(x)
def test_plain():
    assert normalize(1)
`;
const analysisOf = (root) => mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true).analysis;

pythonTest('Hypothesis records literal domains seeds limits shrink phases examples and computed UNKNOWN', (t) => {
  const a = analysisOf(fixture(t, { 'widget.py': 'def normalize(x):\n    return x\n', 'tests/test_widget.py': source, 'requirements.txt': 'hypothesis==6.123.4\n' }));
  const cases = a.tests.cases.filter((c) => c.path === 'tests/test_widget.py');
  assert.equal(cases[0].property.seed.state, 'fixed');
  assert.equal(cases[0].property.seed.value, 17);
  assert.equal(cases[0].property.settings.max_examples.value, 42);
  assert.equal(cases[0].property.settings.deadline.value, null);
  assert.equal(cases[0].property.shrink, 'disabled');
  assert.match(cases[0].property.generators[0].source, /min_value=-3, max_value=8/);
  assert.equal(cases[0].property.examples.length, 1);
  assert.equal(cases[0].property.version.value, '==6.123.4');
  assert.equal(cases[1].property.settings.max_examples.state, 'UNKNOWN');
  assert.equal(cases[2].property.seed.state, 'random');
  assert.equal(cases[3].property, undefined);
});

pythonTest('Hypothesis loads scoped literal conftest profiles and recognizes state machine rules', (t) => {
  const a = analysisOf(fixture(t, { 'widget.py': 'pass', 'conftest.py': `from hypothesis import settings
settings.register_profile('repeat', max_examples=12, derandomize=True, deadline=500)
settings.load_profile('repeat')`, 'tests/test_machine.py': `from hypothesis.stateful import RuleBasedStateMachine, rule, invariant
from hypothesis import strategies as st
class Ledger(RuleBasedStateMachine):
    @rule(x=st.integers())
    def add(self, x):
        pass
    @invariant()
    def balanced(self):
        assert True
TestLedger = Ledger.TestCase
` }));
  const p = a.tests.cases.find((c) => c.path === 'tests/test_machine.py').property;
  assert.equal(p.kind, 'stateful');
  assert.equal(a.tests.cases[0].assertions, 1);
  assert.equal(deriveFindings(a).some((f) => f.ruleId === 'TEST-NO-ASSERTIONS'), false);
  assert.deepEqual(p.rules.map((r) => r.name), ['add', 'balanced']);
  assert.equal(p.seed.state, 'fixed');
  assert.equal(p.settings.max_examples.value, 12);
  assert.equal(p.settings.deadline.value, 500);
});

pythonTest('Hypothesis summary and changed module evidence retain random reproducibility leads without verdicts', async (t) => {
  const { summaryReport } = await import('../lib/overview.mjs');
  const root = fixture(t, { 'widget.py': 'def normalize(x):\n    return x', 'tests/test_widget.py': source });
  const data = mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true);
  const summary = summaryReport({ id: 'A-fixture', inputs: {}, findings: [], data }, { id: 'A-fixture', command: (args) => args.join(' ') });
  assert.equal(summary.properties.count, 3);
  assert.equal(summary.properties.fixed, 1);
  assert.equal(summary.properties.random, 2);
  const evidence = propertyEvidence(data.analysis, ['widget.py']);
  assert.equal(evidence.count, 3);
  assert.deepEqual(evidence.tests[0].modules, ['widget.py']);
  assert.match(propertyLines(evidence).join('\n'), /reproducibility lead/);
  assert.equal(propertyEvidence(data.analysis, ['unrelated.py']).count, 0);
  const seeded = propertyEvidence(data.analysis, ['widget.py'], [{ run: { command: ['pytest', '--hypothesis-seed=99'] }, cases: data.analysis.tests.cases.map((c) => ({ file: c.path, name: c.name, suite: c.suite })) }]);
  assert.equal(seeded.fixed, 3);
  assert.equal(seeded.tests[0].seed.value, 17);
  assert.equal(seeded.tests[1].seed.value, '99');
});

pythonTest('unrelated given decorators and unresolved profiles produce no fixed-seed claims', (t) => {
  const a = analysisOf(fixture(t, { 'conftest.py': `from hypothesis import settings
settings.load_profile(PROFILE)`, 'test_cases.py': `from hypothesis import given, settings
from another import given as custom
@custom(x=1)
def test_plain(x):
    assert x
@given(x=1)
@settings(derandomize=FLAG)
def test_unknown(x):
    assert x` }));
  const cases = a.tests.cases.filter((c) => c.path === 'test_cases.py');
  assert.equal(cases[0].property, undefined);
  assert.equal(cases[1].property.seed.state, 'UNKNOWN');
});

pythonTest('verify reports property reachability while preserving checks and ratings', async (t) => {
  const { runVerify } = await import('../lib/verify.mjs');
  const { writeFileSync, readFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const root = fixture(t, { 'widget.py': 'def normalize(x):\n    return x', 'tests/test_widget.py': source });
  const out = mkdtempSync(join(tmpdir(), 'property-verify-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  writeFileSync(join(root, 'widget.py'), 'def normalize(x):\n    return abs(x)');
  const request = join(out, 'request.json');
  writeFileSync(request, JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1, base: 'HEAD', head: 'worktree', intent: 'Normalize widget values', acceptanceCriteria: [], allowedPaths: ['**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [], execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } }));
  const result = runVerify(root, defaults, { request, store: join(out, 'store'), 'out-dir': join(out, 'result') });
  assert.equal(result.results.properties.count, 3);
  assert.equal(result.results.properties.random, 2);
  assert.match(readFileSync(result.paths.markdownPath, 'utf8'), /Random seed reproducibility lead/);
  assert.ok(result.results.obligations.every((o) => !/hypothesis|property|throughput/i.test(o.id)));
});

pythonTest('Hypothesis records direct deterministic settings explicit shrink defaults and unknown versions', (t) => {
  const a = analysisOf(fixture(t, { 'test_forms.py': `import hypothesis as h
from hypothesis import strategies as st
@h.given(st.from_type(int))
@h.settings(derandomize=True, phases=(h.Phase.generate, h.Phase.shrink), deadline=80)
def test_fixed(x):
    assert x == x
@h.given(st.text)
@h.seed(SEED)
@h.settings(CONFIG)
def test_unknown(x):
    assert x
@h.given(st.builds(dict))
@h.example({})
def test_default(x):
    assert x == x
` }));
  const cases = a.tests.cases;
  assert.equal(cases[0].property.seed.state, 'fixed');
  assert.equal(cases[0].property.shrink, 'enabled');
  assert.equal(cases[0].property.settings.deadline.value, 80);
  assert.equal(cases[0].property.version.state, 'UNKNOWN');
  assert.match(cases[0].property.invariant, /assert x == x/);
  assert.equal(cases[1].property.seed.state, 'UNKNOWN');
  assert.equal(cases[1].property.settings.max_examples.state, 'UNKNOWN');
  assert.equal(cases[2].property.shrink, 'default');
  assert.equal(cases[2].property.examples.length, 1);
});
