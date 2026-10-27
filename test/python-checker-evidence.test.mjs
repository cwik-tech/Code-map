import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compilerLifecycle } from '../lib/compiler-lifecycle.mjs';
import { evaluateProfile as evaluateV1 } from '../lib/profiles/evidence-v1.mjs';
import { context as v1Context } from './evidence-v1-fixtures.mjs';
import { compilerLines } from '../lib/compiler-report.mjs';
import { evaluate, analysis, source, modified, compilerReport, diagnostic } from './profile-fixtures.mjs';

const report = (kind, message = 'Bad type "str" at line 1 [assignment]', fields = {}) => compilerReport([
  diagnostic('src/leaf.py', 'assignment', { message, tool: kind.startsWith('mypy') ? 'mypy' : kind.split('-')[0] }),
], { kind, exitStatus: 1, run: { command: [kind], workingDirectory: '.', tools: [], environment: {} }, ...fields });
const check = (head, base = [], fields = {}) => evaluate({ head: { analysis: analysis({ files: [source('src/leaf.py'), source('src/use.py', { imports: [{ target: 'src/leaf.py' }] })] }) },
  change: modified('src/leaf.py'), compiler: { head, base }, ...fields });
const type = (result) => result.byId['structure.types-compatible'];

test('bound Python type errors fail changed files and identify earlier errors', () => {
  const head = report('mypy-json');
  assert.equal(type(check([head])).result, 'FAIL');
  assert.match(type(check([head], [head])).rationale, /earlier error/);
  assert.doesNotMatch(type(check([head])).rationale, /TSassignment/);
  const importer = report('pyright-json', 'Invalid call', { diagnostics: [diagnostic('src/use.py', 'reportArgumentType', { tool: 'pyright' })] });
  assert.equal(type(check([importer])).result, 'FAIL');
});

test('ruff lint information changes no check or rating and names missing Python type reports', () => {
  const plain = check([]), lint = check([report('ruff-json')]);
  assert.deepEqual(lint.obligations, plain.obligations);
  assert.deepEqual(lint.ratings, plain.ratings);
  assert.equal(type(lint).result, 'NOT_APPLICABLE');
  assert.match(type(lint).rationale, /mypy-json.*mypy-text.*pyright-json/);
});

test('mixed TypeScript and Python changes require both tool families', () => {
  const facts = { typescript: true, change: modified('src/leaf.py', 'src/a.ts'), head: { analysis: analysis({ files: [source('src/leaf.py'), source('src/a.ts')] }) } };
  assert.equal(type(check([compilerReport([])], [], facts)).result, 'UNKNOWN');
  assert.equal(type(check([compilerReport([]), report('pyright-json', '', { diagnostics: [], errors: 0, exitStatus: 0 })], [], facts)).result, 'PASS');
  assert.equal(type(check([compilerReport([diagnostic('src/a.ts')]), report('pyright-json')], [], facts)).result, 'FAIL');
});

test('Python lifecycle matches renames and messages separately for each tool', () => {
  const before = report('mypy-json'), after = report('mypy-json', 'Bad type "int" at line 99 [assignment]', {
    diagnostics: [diagnostic('src/moved.py', 'assignment', { message: 'Bad type "int" at line 99 [assignment]', tool: 'mypy' })] });
  const result = compilerLifecycle({ base: [before, compilerReport([])], head: [after, compilerReport([])] }, {
    comparable: true, complete: true, renames: [{ from: 'src/leaf.py', to: 'src/moved.py', similarity: 100 }],
  });
  assert.deepEqual(result.counts, { new: 0, existing: 1, resolved: 0, unknown: 0 });
  assert.equal(result.entries[0].matchedBy, 'rename');
  const unknown = compilerLifecycle({ base: [before], head: [{ ...after, incomplete: true }] }, { comparable: true, complete: true });
  assert.equal(unknown.counts.unknown, 2);
});

test('Python Markdown labels each tool and keeps ruff informational', () => {
  const result = compilerLifecycle({ base: [report('ruff-json', '', { diagnostics: [], errors: 0, exitStatus: 0 })], head: [report('ruff-json')] }, { comparable: true, complete: true });
  const text = compilerLines(result, 20).join('\n');
  assert.match(text, /ruff/);
  assert.match(text, /No check or rating reads ruff/);
  assert.doesNotMatch(text, /TSassignment/);
});

test('interrupted and filtered Python runs cannot establish compatible types', () => {
  assert.equal(type(check([report('mypy-json', 'Fatal', { incomplete: true })])).result, 'UNKNOWN');
  assert.equal(type(check([report('mypy-json', '', { diagnostics: [], errors: 0, exitStatus: 2 })])).result, 'UNKNOWN');
  assert.equal(type(check([report('pyright-json', '', { diagnostics: [], errors: 0, exitStatus: 0, filtered: true })])).result, 'UNKNOWN');
});

test('ordinary ruff exit status one supports NEW and RESOLVED lint lifecycle', () => {
  const clean = report('ruff-json', '', { diagnostics: [], errors: 0, exitStatus: 0 });
  const lint = report('ruff-json', 'Unused name', { errors: 0, exitStatus: 1 });
  const result = compilerLifecycle({ base: [clean], head: [lint] }, { comparable: true, complete: true });
  assert.equal(result.counts.new, 1);
  assert.equal(compilerLifecycle({ base: [lint], head: [clean] }, { comparable: true, complete: true }).counts.resolved, 1);
});

test('fatal Python exit status leaves even reported errors UNKNOWN', () => {
  const fatal = report('mypy-json', 'Cannot continue', { exitStatus: 2 });
  assert.equal(type(check([fatal])).result, 'UNKNOWN');
  assert.equal(compilerLifecycle({ base: [report('mypy-json')], head: [fatal] }, { comparable: true, complete: true }).counts.unknown, 2);
});

test('diagnostic identities include the Python tool even when codes and messages agree', () => {
  const first = report('mypy-json'), second = report('pyright-json');
  const result = compilerLifecycle({ base: [], head: [first, second] });
  assert.equal(result.entries.length, 2);
  assert.notEqual(result.entries[0].fingerprint, result.entries[1].fingerprint);
});

test('ruff changes no evidence-v1 check or category predicate', () => {
  const context = v1Context({ compiler: { head: [], base: [] } });
  const clean = evaluateV1(context);
  const lint = evaluateV1({ ...context, compiler: { head: [report('ruff-json', '', { diagnostics: [], errors: 0, exitStatus: 0 })], base: [] } });
  assert.deepEqual(lint, clean);
});

test('an interrupted Python report cannot prove a public consumer incompatible', () => {
  const context = v1Context({ compiler: { head: [report('mypy-json', 'Cannot continue', { incomplete: true, exitStatus: 2 })], base: [] } });
  context.evidence.api = { state: 'COMPARABLE', complete: true, items: [{ group: 'public', status: 'CHANGED', name: 'value', path: 'src/api.py', consumers: { items: [{ path: 'src/leaf.py' }] } }] };
  const result = evaluateV1(context).obligations.find((item) => item.id === 'structure.public-interface');
  assert.equal(result.result, 'UNKNOWN');
});

test('Python lifecycle preserves unquoted bracket content in pyright and ruff messages', () => {
  const before = report('pyright-json', 'Expected list[str]'), after = report('pyright-json', 'Expected list[int]');
  const result = compilerLifecycle({ base: [before], head: [after] }, { comparable: true, complete: true });
  assert.deepEqual(result.counts, { new: 1, existing: 0, resolved: 1, unknown: 0 });
  const oldLint = report('ruff-json', 'Use value [first]'), newLint = report('ruff-json', 'Use value [second]');
  assert.deepEqual(compilerLifecycle({ base: [oldLint], head: [newLint] }, { comparable: true, complete: true }).counts,
    { new: 1, existing: 0, resolved: 1, unknown: 0 });
});

test('a bound base Python type report keeps missing head evidence UNKNOWN', () => {
  assert.equal(type(check([], [report('mypy-json')])).result, 'UNKNOWN');
});

test('pyright warning-only runs remain comparable type evidence', () => {
  const run = { command: ['pyright', '--outputjson', '--warnings'], workingDirectory: '.', tools: [], environment: {} };
  const clean = report('pyright-json', '', { diagnostics: [], errors: 0, exitStatus: 0, run });
  const warning = report('pyright-json', 'Deprecated declaration', { diagnostics: [diagnostic('src/leaf.py', 'reportDeprecated', { tool: 'pyright', category: 'warning' })], errors: 0, exitStatus: 1, run });
  assert.equal(type(check([warning])).result, 'PASS');
  assert.equal(compilerLifecycle({ base: [clean], head: [warning] }, { comparable: true, complete: true }).counts.new, 1);
});
