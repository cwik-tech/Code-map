import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { project, authorize, sandboxed, budgets } from './worker-fixtures.mjs';
import { generateForLanguage } from '../lib/mutation/language.mjs';
import { applyMutation } from '../lib/mutation/edit.mjs';
import { parseMutmut } from '../lib/mutation/mutmut.mjs';
import { summarizeMutation, mutationWords } from '../lib/mutation/report.mjs';
import { collect, mapData } from '../lib/build.mjs';
import { loadConfig } from '../lib/project.mjs';
import { mutate } from '../lib/mutation/run.mjs';
import { findInterpreter } from '../lib/python/interpreter.mjs';
const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const generate = (text, lines) => generateForLanguage(process.cwd(), {}, 'orchard.py', text, lines);

test('Python parser generates matching mutators only on changed token lines', () => {
  const text = 'untouched = False\ndef pear(x) -> int | None:\n    return 1 + 2 if not True and x < 3 else None\n';
  const edits = generate(text, [3]);
  assert.deepEqual(edits.map((x) => [x.original, x.replacement, x.mutatorName]), [
    ['1 + 2 if not True and x < 3 else None', 'None', 'ReturnNone'], ['+', '-', 'ArithmeticOperator'],
    ['not True', 'True', 'UnaryNot'], ['True', 'False', 'BooleanLiteral'], ['and', 'or', 'LogicalOperator'], ['<', '<=', 'Comparison'],
  ]);
  assert.equal(generate(text, [1]).length, 1);
  assert.equal(generate('def f(x):\n    return x + "pear"\n', [2]).length, 0);
  assert.equal(generate('if ready:\n    pass\nwhile ready:\n    pass\n', [1, 3]).length, 0);
});
test('Python comparison edits preserve UTF-16 offsets after non-ASCII text', () => {
  const text = 'label = "🍐é"; result = a < b <= c > d >= e == f != g is h is not i in j not in k\n';
  const edits = generate(text, [1]);
  assert.deepEqual(edits.map((x) => [text.slice(x.start, x.end), x.replacement]), [
    ['<', '<='], ['<=', '<'], ['>', '>='], ['>=', '>'], ['==', '!='], ['!=', '=='], ['is', 'is not'], ['is not', 'is'], ['in', 'not in'], ['not in', 'in'],
  ]);
  assert.equal(edits[0].location.start.column, text.indexOf('<'));
  assert.equal(generate('x = True or False\n', [1]).some((x) => x.original === 'or'), false);
  assert.equal(generate('# True < False\nx = "True < False"\n', [1, 2]).length, 0);
});
test('Python compile errors refuse the edit before any worker command', (t) => {
  const f = project(t), text = 'flag = True\n'; f.put('orchard.py', text);
  assert.throws(() => applyMutation(f.root, { path: 'orchard.py', start: 7, end: 11, original: 'True', replacement: ')' }), { code: 'MUTATION_COMPILE' });
  assert.equal(readFileSync(join(f.root, 'orchard.py'), 'utf8'), text);
});
const files = [{ path: 'orchard.py', language: 'python', python: { module: 'orchard' }, declarations: [
  { name: 'pear', kind: 'function', start: 2, end: 5, children: [] },
] }];
test('mutmut results map statuses to function ranges and exclude unknown statuses from scores', () => {
  const text = '    orchard.x_pear__mutmut_1: killed\n    orchard.x_pear__mutmut_2: survived\n    orchard.x_pear__mutmut_3: no tests\n    orchard.x_pear__mutmut_4: timeout\n    orchard.x_pear__mutmut_5: suspicious\n';
  const parsed = parseMutmut(text, { files });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.report.generator, 'mutmut');
  assert.equal(parsed.report.mutants[0].locationKind, 'function');
  const summary = summarizeMutation(parsed.report, new Map([['orchard.py', [4]]]));
  assert.equal(summary.score, 50);
  assert.equal(summary.counts.unknown, 1);
  assert.match(mutationWords([summary]).join('\n'), /mutmut/);
  assert.equal(summarizeMutation(parsed.report, new Map([['orchard.py', [7]]])).score, null);
});
test('mutmut refuses malformed entries unsafe paths and bounded report overflow', () => {
  assert.equal(parseMutmut('broken', { files }).ok, false);
  assert.equal(parseMutmut('    ../orchard.x_pear__mutmut_1: survived', { files }).ok, false);
  assert.equal(parseMutmut('    missing.x_pear__mutmut_1: survived', { files }).ok, false);
  assert.equal(parseMutmut('    orchard.x_pear__mutmut_1: survived\nbroken', { files }).ok, false);
  assert.equal(parseMutmut('x'.repeat(11), { files, maxBytes: 10 }).ok, false);
  assert.equal(parseMutmut('    orchard.x_pear__mutmut_1: survived', { files, maxMutants: 0 }).ok, false);
});
function fixture(t) {
  const f = project(t);
  f.put('.code-map.json', JSON.stringify({ roots: ['.'] }));
  f.put('orchard.py', 'def pear(x):\n    unused = False\n    return x < 2\n');
  f.git('add', '.'); f.git('commit', '-qm', 'python base'); f.git('tag', '-f', 'base');
  f.put('orchard.py', 'def pear(x):\n    unused = True\n    return x <= 2\n');
  // A real Python program writes the same JUnit cases after assertions. It needs no third-party runner.
  f.put('test_pear.py', `import sys\nimport orchard\nfrom pathlib import Path\ndef test_edge():\n    assert orchard.pear(2) is True\nfailed = False\ntry:\n    test_edge()\nexcept AssertionError:\n    failed = True\nPath('junit.xml').write_text('<testsuite name="pear"><testcase classname="test_pear" name="test_edge">' + ('<failure message="AssertionError"/>' if failed else '') + '</testcase></testsuite>')\nsys.exit(1 if failed else 0)\n`);
  f.git('add', '.'); f.git('commit', '-qm', 'python head');
  const python = findInterpreter(undefined, f.root).interpreter.path;
  return { ...f, python };
}
test('Python mutation selects linked tests and runs killed and surviving mutants only in worker copies', sandboxed, async (t) => {
  const f = fixture(t), command = [f.python, 'test_pear.py', '--junitxml=junit.xml'];
  const before = readFileSync(join(f.root, 'orchard.py'), 'utf8');
  const facts = collect(f.root, loadConfig(f.root), { ref: 'HEAD' });
  const analysis = mapData(f.root, loadConfig(f.root), facts, 2, false).analysis;
  assert.ok(analysis.api.testImports.some((edge) => edge.source === 'test_pear.py'), JSON.stringify({ python: analysis.python, tests: analysis.tests, api: analysis.api }));
  const selected = await mutate(f.root, loadConfig(f.root), { base: 'base', command: [f.python, '{testFiles}', '--junitxml=junit.xml'], printSelection: true });
  assert.deepEqual(selected.command, command);
  assert.deepEqual(selected.selection.files, ['test_pear.py']);
  const output = spawnSync(process.execPath, [cli, 'mutate', '--base', 'base', '--max', '20', '--store', f.store,
    '--authorization', authorize(f, command), '--', f.python, '{testFiles}', '--junitxml=junit.xml'], { cwd: f.root, encoding: 'utf8', timeout: 240000 });
  assert.equal(output.status, 0, output.stderr);
  const summary = JSON.parse(output.stdout), report = JSON.parse(readFileSync(summary.files.artifact, 'utf8'));
  assert.equal(summary.counts.killed, 1); assert.equal(summary.counts.survived, 1);
  assert.equal(summary.counts.equivalentCandidate, 0);
  const cached = await mutate(f.root, loadConfig(f.root), { base: 'base', command: [f.python, '{testFiles}', '--junitxml=junit.xml'],
    max: 20, store: f.store, authorization: authorize(f, command) });
  assert.equal(cached.cached, true); assert.equal(cached.generator, summary.generator);
  assert.deepEqual(cached.counts, summary.counts);
  assert.equal(existsSync(join(f.root, 'junit.xml')), false);
  assert.equal(report.files['orchard.py'].language, 'python');
  assert.match(report.generator, /Python/);
  assert.equal(readFileSync(join(f.root, 'orchard.py'), 'utf8'), before);
});
test('verify runs generated Python tests against changed-line Python mutants', sandboxed, (t) => {
  const f = fixture(t), words = [f.python, 'test_pear.py'];
  f.put('request.json', JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base', head: 'HEAD',
    intent: 'Accept the pear edge.', acceptanceCriteria: [], allowedPaths: null, changeType: 'fix', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0',
    reportInputs: [], generatedTests: [{ file: 'test_pear.py', mutationAuthorization: authorize(f, words) }],
    execution: { enabled: true, authorization: authorize(f, words), budgets, commands: [{ id: 'pear', words,
      generatedTestWords: [f.python, '{testFile}'], kind: 'junit', artifact: 'junit.xml', sides: ['head'] }] } }));
  const output = spawnSync(process.execPath, [cli, 'verify', '--request', join(f.root, 'request.json'), '--store', f.store],
    { cwd: f.root, encoding: 'utf8', timeout: 240000 });
  assert.notEqual(output.status, 4, output.stderr);
  assert.ok(output.stdout, `${output.status}: ${output.stderr}`);
  const summary = JSON.parse(output.stdout), results = JSON.parse(readFileSync(summary.files.results, 'utf8'));
  const item = results.generatedTestMutations[0];
  assert.equal(item.compilation.status, 'passed'); assert.equal(item.head.status, 'passed');
  assert.equal(item.failureSensitive, true);
  assert.deepEqual(item.mutants.map((x) => x.status), ['Survived', 'Killed']);
  assert.match(item.generator, /Python/);
  assert.match(readFileSync(summary.files.report, 'utf8'), /Code-map Python mutants/);
});

test('Python invalid generated mutants count as compile errors without a mutant run', sandboxed, async (t) => {
  const f = project(t);
  f.put('orchard.py', 'def pear():\n    return (yield 1)\n');
  f.put('check_pear.py', 'import orchard\nassert list(orchard.pear()) == [1]\n');
  f.git('add', '.'); f.git('commit', '-qm', 'generator base'); f.git('tag', '-f', 'base');
  f.put('orchard.py', 'def pear():\n    return not (yield 1)\n');
  f.git('add', '.'); f.git('commit', '-qm', 'generator head');
  const command = [findInterpreter(undefined, f.root).interpreter.path, 'check_pear.py'];
  const result = await mutate(f.root, loadConfig(f.root), { command, authorization: authorize(f, command), base: 'base', store: f.store });
  assert.equal(result.counts.compileError, 1);
  const report = JSON.parse(readFileSync(result.files.artifact, 'utf8'));
  assert.deepEqual(report.runs.map((x) => [x.status, x.runId]), [['CompileError', null]]);
});

test('mutmut reports bind through manifests and retain function precision in JSON and Markdown', (t) => {
  const f = fixture(t);
  f.put('reports/mutmut.txt', '    orchard.x_pear__mutmut_1: survived\n');
  const manifest = spawnSync(process.execPath, [cli, 'manifest', '--artifact', 'reports/mutmut.txt', '--kind', 'mutmut-text', '--exit-status', '0',
    '--out', 'reports/mutmut.manifest.json', '--', 'mutmut', 'results', '--all', 'true'], { cwd: f.root, encoding: 'utf8', timeout: 30000 });
  assert.equal(manifest.status, 0, manifest.stderr);
  const request = { requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base', head: 'worktree', intent: 'Check pears.',
    acceptanceCriteria: [], allowedPaths: null, changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0',
    reportInputs: [{ artifact: 'reports/mutmut.txt', manifest: 'reports/mutmut.manifest.json' }],
    execution: { enabled: false, authorization: null, budgets } };
  const path = join(f.work, 'verify.json');
  // Keep the request outside the repository so it does not change the manifest snapshot.
  writeFileSync(path, JSON.stringify(request));
  const output = spawnSync(process.execPath, [cli, 'verify', '--request', path, '--store', f.store], { cwd: f.root, encoding: 'utf8', timeout: 240000 });
  assert.notEqual(output.status, 4, output.stderr);
  const summary = JSON.parse(output.stdout), results = JSON.parse(readFileSync(summary.files.results, 'utf8'));
  assert.equal(results.mutation[0].generator, 'mutmut');
  assert.equal(results.mutation[0].survivors[0].locationKind, 'function');
  assert.match(readFileSync(summary.files.report, 'utf8'), /mutmut.*function range/s);
  assert.equal(results.executions.find((x) => x.kind === 'mutmut-text').eligible, true);
});

test('Python JUnit classification requires mapped cases and matching baseline identities', async (t) => {
  const { readMutationCases, junitArtifact } = await import('../lib/mutation/python-outcome.mjs');
  const { generatedMutantStatus } = await import('../lib/verify-test-validation.mjs');
  const f = project(t);
  f.put('report.xml', '<testsuite><testcase classname="test_pear" name="test_edge"/></testsuite>');
  const run = { paths: { artifact: join(f.root, 'report.xml') }, record: { workspace: { tree: f.root } } };
  const cases = readMutationCases(run, false, new Set(['test_pear.py']));
  assert.equal(cases[0].file, 'test_pear.py');
  assert.equal(readMutationCases(run, false, new Set()), null);
  assert.throws(() => junitArtifact(['python', '--junitxml=../outside.xml']), /safe relative/);
  assert.throws(() => junitArtifact(['python', '--junitxml=a.xml', '--junitxml=b.xml']), /one safe/);
  const result = { exitCode: 0, record: { stoppedBy: null, signal: null, exitStatus: 1 } };
  assert.equal(generatedMutantStatus(result, [{ ...cases[0], status: 'errored' }], cases), 'RuntimeError');
  assert.equal(generatedMutantStatus(result, [{ ...cases[0], name: 'collection failure', status: 'failed' }], cases), 'RuntimeError');
  assert.equal(generatedMutantStatus(result, [{ ...cases[0], status: 'failed' }], cases), 'Killed');
});

test('mutmut resolves src packages initializers and method keys without ambiguous matches', () => {
  const method = { name: 'taste', kind: 'method', start: 3, end: 4, children: [] };
  const packageFile = { path: 'src/garden/__init__.py', language: 'python', python: { module: 'src.garden' }, declarations: [
    { name: 'Pear', kind: 'class', start: 1, end: 4, children: [method] },
  ] };
  const text = '    garden.xǁPearǁtaste__mutmut_1: survived\n';
  const result = parseMutmut(text, { files: [packageFile] });
  assert.equal(result.ok, true);
  assert.equal(result.report.mutants[0].path, 'src/garden/__init__.py');
  assert.equal(parseMutmut(text, { files: [packageFile, packageFile] }).ok, false);
  assert.equal(parseMutmut(text + text, { files: [packageFile] }).ok, false);
});

test('Python mutation parsing never executes project imports or top-level statements', (t) => {
  const f = project(t);
  const text = `from pathlib import Path\nPath(${JSON.stringify(join(f.root, 'parser-ran'))}).write_text("unexpected")\nflag = True\n`;
  assert.equal(generateForLanguage(f.root, {}, 'orchard.py', text, [3]).length, 1);
  assert.equal(existsSync(join(f.root, 'parser-ran')), false);
  assert.throws(() => generateForLanguage(f.root, {}, 'orchard.py', 'flag = )\n', [1]), /parse failed/);
  assert.throws(() => generateForLanguage(f.root, {}, 'orchard.py', '#'.repeat(4 * 1024 * 1024), [1]), /input limit/);
});

test('Python mutation offsets preserve physical lines with Unicode separators inside strings', () => {
  const text = 'label = "pear\u2028plum"; flag = True\r\nother = False\n';
  const edits = generate(text, [1]);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].original, 'True');
  assert.equal(edits[0].start, text.indexOf('True'));
  assert.equal(edits[0].location.start.line, 1);
});

test('Python mutation end positions stay on the last physical line without a final newline', () => {
  const edits = generate('flag = True', [1]);
  assert.deepEqual(edits[0].location, { start: { line: 1, column: 7 }, end: { line: 1, column: 11 } });
  assert.equal(edits[0].end, 11);
});

test('Python mutation includes function defaults and decorators but leaves function annotations unchanged', () => {
  const text = '@tag(True)\ndef pear(flag=True, *, ready=False) -> Literal[True]:\n    return flag\n';
  const edits = generate(text, [1, 2]);
  assert.deepEqual(edits.map((edit) => [edit.original, edit.replacement, edit.location.start.line]), [
    ['True', 'False', 1], ['True', 'False', 2], ['False', 'True', 2],
  ]);
});
