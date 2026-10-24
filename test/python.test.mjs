import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collect, mapData } from '../lib/build.mjs';
import { defaults } from '../lib/project.mjs';
import { findInterpreter } from '../lib/python/interpreter.mjs';
import { deriveFindings } from '../lib/findings.mjs';

import { fixture, pythonTest } from './python-fixtures.mjs';

test('an unavailable configured Python interpreter preserves unsupported inventory and a named gap', (t) => {
  const root = fixture(t, { 'app.py': 'pass\n' });
  const config = { ...defaults, python: { interpreter: '/no-such-code-map-python' } };
  const facts = collect(root, config, { worktree: true });
  const a = mapData(root, config, facts, 1, true).analysis;
  assert.equal(a.unsupportedFiles['.py'], 1);
  assert.equal(a.python.state, 'UNKNOWN');
  assert.match(a.python.reason, /interpreter/i);
});

pythonTest('pytest.ini and setup.cfg configure Python test discovery', (t) => {
  const ini = fixture(t, { 'pytest.ini': '[pytest]\ntestpaths = checks\npython_files = check_*.py\n', 'checks/check_one.py': 'def test_one():\n    pass', 'tests/test_default.py': 'pass' });
  const cfg = fixture(t, { 'setup.cfg': '[tool:pytest]\ntestpaths = checks\npython_files = check_*.py\n', 'checks/check_one.py': 'def test_one():\n    pass', 'tests/test_default.py': 'pass' });
  assert.deepEqual(collect(ini, defaults, { worktree: true }).testFacts.map((f) => f.path), ['checks/check_one.py']);
  assert.deepEqual(collect(cfg, defaults, { worktree: true }).testFacts.map((f) => f.path), ['checks/check_one.py']);
});

pythonTest('Python source and pytest configuration edits invalidate the stored analysis identity', async (t) => {
  const { analysisInputs, analysisId } = await import('../lib/inputs.mjs');
  const root = fixture(t, { 'app.py': 'value = 1\n', 'pytest.ini': '[pytest]\npython_files = test_*.py\n' });
  const before = analysisId(analysisInputs(root, defaults, { worktree: true }, null));
  writeFileSync(join(root, 'app.py'), 'value = 2\n');
  const source = analysisId(analysisInputs(root, defaults, { worktree: true }, null));
  assert.notEqual(source, before);
  writeFileSync(join(root, 'pytest.ini'), '[pytest]\npython_files = check_*.py\n');
  assert.notEqual(analysisId(analysisInputs(root, defaults, { worktree: true }, null)), source);
});

pythonTest('pytest JUnit and coverage.py LCOV reports bind and map to Python modules', async (t) => {
  const { buildManifest } = await import('../lib/manifest.mjs');
  const { analysisInputs } = await import('../lib/inputs.mjs');
  const { loadReports } = await import('../lib/verify-reports.mjs');
  const root = fixture(t, { '.gitignore': 'reports/\n', 'src/app.py': 'def run():\n    return 1\n', 'tests/test_app.py': 'from app import run\ndef test_run():\n    assert run() == 1\n' });
  mkdirSync(join(root, 'reports'));
  writeFileSync(join(root, 'reports/junit.xml'), '<?xml version="1.0" encoding="utf-8"?><testsuites><testsuite name="pytest" tests="1" failures="0" errors="0" skipped="0"><testcase classname="tests.test_app" name="test_run" time="0.001" /></testsuite></testsuites>');
  writeFileSync(join(root, 'reports/lcov.info'), 'SF:src/app.py\nDA:1,1\nDA:2,1\nLF:2\nLH:2\nend_of_record\n');
  const junit = buildManifest(root, defaults, { artifact: 'reports/junit.xml', kind: 'junit', exitStatus: '0', command: ['pytest', '--junitxml=reports/junit.xml'] });
  const lcov = buildManifest(root, defaults, { artifact: 'reports/lcov.info', kind: 'lcov', exitStatus: '0', command: ['coverage', 'lcov', '-o', 'reports/lcov.info'] });
  writeFileSync(join(root, 'reports/junit.manifest.json'), JSON.stringify(junit));
  writeFileSync(join(root, 'reports/lcov.manifest.json'), JSON.stringify(lcov));
  const analysis = mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true).analysis;
  const inputs = analysisInputs(root, defaults, { worktree: true }, null), side = { inputs, sha: inputs.sha, analysis };
  const loaded = loadReports(root, [{ artifact: 'reports/junit.xml', manifest: 'reports/junit.manifest.json' }, { artifact: 'reports/lcov.info', manifest: 'reports/lcov.manifest.json' }], { head: side, base: side }, undefined, join(root, 'reports/store'), { extended: true });
  assert.deepEqual(loaded.executions.map((e) => e.binding), ['BOUND', 'BOUND']);
  assert.equal(loaded.reports.head[0].cases[0].file, 'tests/test_app.py');
  assert.ok(analysis.files.some((f) => loaded.coverage[0].files.has(f.path)));
  assert.equal(loaded.coverage[0].files.get('src/app.py').lines.get(2), 1);
});

pythonTest('Python parser batches large inventories and reports oversized files without losing other modules', async () => {
  const { findInterpreter } = await import('../lib/python/interpreter.mjs');
  const { parsePython, pythonLimits } = await import('../lib/python/parse.mjs');
  const files = Array.from({ length: pythonLimits.batchFiles + 1 }, (_, i) => ({ path: `m${i}.py`, text: 'pass\n' }));
  const parsed = parsePython(findInterpreter().interpreter, [...files, { path: 'large.py', text: '#'.repeat(pythonLimits.inputBytes + 1) }]);
  assert.equal(parsed.files.length, pythonLimits.batchFiles + 1);
  assert.deepEqual(parsed.errors, [{ path: 'large.py', reason: 'Python file exceeds the parser input limit.' }]);
});

pythonTest('explicit Python roots report excluded modules and do not widen TypeScript roots', (t) => {
  const root = fixture(t, { 'app/pkg.py': 'pass', 'extra/outside.py': 'pass', 'src/main.ts': 'export const value = 1;', 'outside.ts': 'export const extra = 1;' });
  const config = { ...defaults, roots: ['app', 'src'] };
  const facts = collect(root, config, { worktree: true });
  assert.deepEqual(facts.files.map((f) => f.path).sort(), ['app/pkg.py', 'src/main.ts']);
  assert.ok(facts.outside.paths.includes('extra/outside.py'));
  assert.ok(facts.outside.paths.includes('outside.ts'));
  const row = mapData(root, config, facts, 1, true).analysis.completeness.find((r) => r.stack === 'Python');
  assert.deepEqual([row.supported, row.parsed, row.skipped], [2, 1, 1]);
});

pythonTest('Python module changes select direct and transitive pytest files for impact', async (t) => {
  const { changeImpact } = await import('../lib/impact/reach.mjs');
  const root = fixture(t, { 'src/app.py': 'def run():\n    return 1', 'src/helper.py': 'from app import run', 'tests/test_app.py': 'from app import run\ndef test_run():\n    assert run()', 'checks/test_helper.py': 'import helper\ndef test_helper():\n    assert True' });
  const analysis = mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true).analysis;
  const result = changeImpact(analysis, ['src/app.py']);
  assert.deepEqual(result.tests.map((f) => [f.path, f.depth]), [['tests/test_app.py', 1], ['checks/test_helper.py', 2]]);
});

pythonTest('Python metadata reaches reports and missing namespace children produce unresolved findings', async (t) => {
  const { createReport } = await import('../lib/analysis.mjs');
  const { summaryReport } = await import('../lib/overview.mjs');
  const root = fixture(t, { 'src/ns/known.py': 'pass', 'src/app.py': 'from ns import missing\n' });
  const data = mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true);
  assert.ok(deriveFindings(data.analysis).some((f) => f.ruleId === 'IMPORT-UNRESOLVED' && f.key.includes('ns')));
  assert.equal(data.analysis.files.find((f) => f.path === 'src/app.py').lines, 1);
  assert.ok(createReport(data).python.interpreter.path);
  assert.equal(createReport(data).python.retries, 0);
  const summary = summaryReport({ id: 'A-fixture', inputs: {}, findings: [], data }, { id: 'A-fixture', command: (args) => args.join(' ') });
  assert.equal(summary.python.interpreter.version, data.analysis.python.interpreter.version);
});

pythonTest('unrelated TOML dates do not prevent Python parsing and stacked unknown parameters stay unknown', async () => {
  const { findInterpreter } = await import('../lib/python/interpreter.mjs');
  const { parsePython } = await import('../lib/python/parse.mjs');
  const parsed = parsePython(findInterpreter().interpreter, [{ path: 'test_app.py', text: '@pytest.mark.parametrize("a", values)\n@pytest.mark.parametrize("b", [1, 2])\ndef test_rows(a, b):\n    assert a\n' }], { 'pyproject.toml': '[unrelated]\ndate = 2026-10-24\n' });
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.files[0].cases[0].each, null);
});

pythonTest('TypeScript syntax rules skip Python modules in mixed projects', (t) => {
  const root = fixture(t, { 'src/app.py': 'oldCall()\n', 'src/app.ts': 'oldCall();' });
  const config = { ...defaults, migrations: [{ from: 'oldCall', to: 'newCall', note: 'Replace this API.' }] };
  const a = mapData(root, config, collect(root, config, { worktree: true }), 1, true).analysis;
  assert.deepEqual(a.migrations.map((m) => m.path), ['src/app.ts']);
});

pythonTest('parsed Python modules feed the existing structural import check', async (t) => {
  const { evaluate, modified } = await import('./profile-fixtures.mjs');
  const root = fixture(t, { 'src/app.py': 'pass\n' });
  const analysis = mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true).analysis;
  const result = evaluate({ head: { analysis }, base: { analysis }, change: modified('src/app.py') });
  assert.equal(result.byId['structure.imports-resolve'].result, 'PASS');
  const missing = evaluate({ head: { analysis: { ...analysis, files: [] } }, base: { analysis }, change: modified('src/app.py') });
  assert.equal(missing.byId['structure.imports-resolve'].result, 'UNKNOWN');
});

pythonTest('Python analysis identity records the selected parser interpreter', async (t) => {
  const { analysisInputs, changedInputs } = await import('../lib/inputs.mjs');
  const { comparability } = await import('../lib/compare.mjs');
  const root = fixture(t, { 'app.py': 'pass\n' });
  const inputs = analysisInputs(root, defaults, { worktree: true }, null);
  assert.deepEqual(inputs.python, findInterpreter());
  const other = { ...inputs, python: { state: 'UNKNOWN', interpreter: null } };
  assert.ok(changedInputs(inputs, other).includes('environment'));
  assert.ok(comparability({ inputs, data: { roots: ['.'] } }, { inputs: other, data: { roots: ['.'] } }).reasons.includes('environment'));
});

pythonTest('a resolved namespace child does not hide a missing sibling in the same Python import', (t) => {
  const root = fixture(t, { 'src/ns/known.py': 'pass\n', 'src/app.py': 'from ns import known, missing\n' });
  const data = mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true);
  const imports = data.analysis.files.find((f) => f.path === 'src/app.py').imports;
  assert.ok(imports.some((e) => e.target === 'src/ns/known.py'));
  assert.ok(imports.some((e) => e.target === null && e.unresolvedLocal));
  assert.ok(deriveFindings(data.analysis).some((f) => f.ruleId === 'IMPORT-UNRESOLVED'));
});

pythonTest('pytest assertion APIs count through aliases and direct imports but project helpers do not', (t) => {
  const root = fixture(t, { 'test_checks.py': `import pytest as pt
from pytest import raises as expect_error, warns, deprecated_call, fail

def test_checks():
    with pt.raises(ValueError): pass
    with pt.warns(Warning): pass
    with pt.deprecated_call(): pass
    pt.raises(ValueError, int, 'x')
    pt.warns(Warning, str, 'x')
    pt.deprecated_call(str, 'x')
    pt.fail('stop')
    with expect_error(ValueError): pass
    with warns(Warning): pass
    with deprecated_call(): pass
    expect_error(ValueError, int, 'x')
    warns(Warning, str, 'x')
    deprecated_call(str, 'x')
    fail('stop')
    assert True
    self.assertEqual(1, 1)

def test_helper():
    project_helper()
` });
  const data = mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true);
  assert.deepEqual(data.analysis.tests.cases.map((c) => c.assertions), [16, 0]);
  assert.equal(deriveFindings(data.analysis).filter((f) => f.ruleId === 'TEST-NO-ASSERTIONS').length, 1);
});

pythonTest('parser splits output-limited batches and skips only a failing singleton', async (t) => {
  const { parsePython, pythonLimits } = await import('../lib/python/parse.mjs');
  const root = fixture(t, { 'app.py': 'pass' }), interpreter = findInterpreter().interpreter;
  const wrapper = join(root, 'bounded-parser');
  writeFileSync(wrapper, `#!${interpreter.path}\nimport sys,json,os\npayload=sys.stdin.buffer.read()\nfiles=[f for f in json.loads(payload) if f['path'].endswith('.py')]\nif len(files)>1 or files[0]['path']=='bad.py':\n    sys.stdout.write('x'*${pythonLimits.outputBytes + 1})\nelse:\n    import subprocess\n    result=subprocess.run([${JSON.stringify(interpreter.path)}]+sys.argv[1:],input=payload,stdout=sys.stdout.buffer,stderr=sys.stderr.buffer,timeout=10)\n    sys.exit(result.returncode)\n`);
  chmodSync(wrapper, 0o755);
  const result = parsePython({ path: wrapper }, ['one.py', 'bad.py', 'two.py'].map((path) => ({ path, text: 'pass' })));
  assert.deepEqual(result.files.map((f) => f.path), ['one.py', 'two.py']);
  assert.deepEqual(result.errors.map((f) => f.path), ['bad.py']);
  assert.equal(result.retries, 4);
});

pythonTest('Python test patterns apply outside testpaths and helpers never become unreadable tests', (t) => {
  const root = fixture(t, { 'pytest.ini': '[pytest]\ntestpaths = tests\npython_files = check_*.py\n',
    'tests/check_one.py': 'def test_one():\n    assert True', 'plugins/x/check_two.py': 'def test_two():\n    assert True',
    'tests/conftest.py': 'def test_helper():\n    pass', 'tests/util.py': 'pass' });
  const data = mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true);
  const facts = collect(root, defaults, { worktree: true });
  assert.deepEqual(facts.testFacts.map((f) => [f.path, f.testScan.defaultCollected]).sort(), [['plugins/x/check_two.py', false], ['tests/check_one.py', true]]);
  assert.equal(deriveFindings(data.analysis).filter((f) => f.ruleId === 'TEST-UNREADABLE-FILE').length, 0);
  assert.deepEqual(data.analysis.tests.testFiles.map((f) => [f.path, f.defaultCollected]).sort(), [['plugins/x/check_two.py', false], ['tests/check_one.py', true]]);
});

pythonTest('optional Python imports suppress unresolved findings while required imports stay visible', (t) => {
  const root = fixture(t, { 'pkg/known.py': '', 'app.py': `try:
    from pkg import missing_one
except ImportError:
    pass
try:
    import pkg.missing_two
except (ValueError, ModuleNotFoundError):
    pass
try:
    from pkg import missing_three
except:
    pass
try:
    from pkg import missing_four
except Exception:
    pass
try:
    from pkg import required
except ValueError:
    from pkg import handler_required
else:
    from pkg import else_required
finally:
    from pkg import finally_required
` });
  const data = mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true);
  const edges = data.analysis.files.find((f) => f.path === 'app.py').imports;
  assert.equal(edges.filter((e) => e.optional).length, 4);
  assert.equal(data.analysis.python.optionalUnresolvedImports, 4);
  assert.equal(deriveFindings(data.analysis).filter((f) => f.ruleId === 'IMPORT-UNRESOLVED').length, 1);
  assert.equal(edges.filter((e) => e.unresolvedLocal).length, 4);
});

pythonTest('Python self imports add no self edges and retain cycles between modules', (t) => {
  const root = fixture(t, { 'pkg/__init__.py': 'import pkg as _pkg', 'own.py': 'import own',
    'a.py': 'import b', 'b.py': 'import a' });
  const data = mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true);
  assert.deepEqual(data.analysis.files.find((f) => f.path === 'pkg/__init__.py').imports, []);
  assert.deepEqual(data.analysis.files.find((f) => f.path === 'own.py').imports, []);
  assert.equal(deriveFindings(data.analysis).filter((f) => f.ruleId === 'CYCLE-VALUE').length, 1);
});

pythonTest('parser splits timed-out batches without changing the child time limit', async (t) => {
  const { parsePython, pythonLimits } = await import('../lib/python/parse.mjs');
  const root = fixture(t, { 'app.py': 'pass' }), interpreter = findInterpreter().interpreter;
  const wrapper = join(root, 'timed-parser');
  writeFileSync(wrapper, `#!${interpreter.path}\nimport sys,json,signal,subprocess\npayload=sys.stdin.buffer.read()\nif len(json.loads(payload))>1:\n    signal.pause()\nelse:\n    result=subprocess.run([${JSON.stringify(interpreter.path)}]+sys.argv[1:],input=payload,stdout=sys.stdout.buffer,stderr=sys.stderr.buffer,timeout=10)\n    sys.exit(result.returncode)\n`);
  chmodSync(wrapper, 0o755);
  const result = parsePython({ path: wrapper }, [{ path: 'one.py', text: 'pass' }, { path: 'two.py', text: 'pass' }]);
  assert.deepEqual(result.files.map((f) => f.path), ['one.py', 'two.py']);
  assert.deepEqual(result.errors, []);
  assert.equal(result.retries, 2);
  assert.equal(pythonLimits.timeoutMs, 15000);
});

pythonTest('conftest stays a helper even when Python file patterns include every module', (t) => {
  const root = fixture(t, { 'pytest.ini': '[pytest]\npython_files = *.py\n',
    'conftest.py': 'def test_helper():\n    pass', 'test_app.py': 'def test_app():\n    assert True' });
  const data = mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true);
  assert.deepEqual(data.analysis.tests.testFiles.map((f) => [f.path, f.defaultCollected]), [['test_app.py', true]]);
  assert.equal(deriveFindings(data.analysis).filter((f) => f.ruleId === 'TEST-UNREADABLE-FILE').length, 0);
});
