// The model report through the CLI (C22 to C24): the models block of the summary, the paged model lists, refused model
// files (not JSON, too large, a link, a link outside the repository, too many files), and the analysis ID after a model edit.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { maxModelBytes, readModelFiles } from '../lib/models/model-files.mjs';
import { modelSummary } from '../lib/models/model-report.mjs';
import { projectPart } from '../lib/overview.mjs';
import { repository } from './nextjs-fixture.mjs';

const json = (output) => { assert.equal(output.status, 0, output.stderr); return JSON.parse(output.stdout); };
const argsOf = (command) => command.split(' ').slice(1);
const order = { modelVersion: 1, name: 'order', states: ['new', 'paid', 'shipped', 'cancelled', 'lost'], initial: 'new', final: ['shipped', 'cancelled'],
  transitions: [{ from: 'new', event: 'PAY', to: 'paid' }, { from: 'new', event: 'CANCEL', to: 'cancelled' }, { from: 'paid', event: 'SHIP', to: 'shipped' }] };
const discount = { tableVersion: 1, name: 'discount', subject: { file: 'src/price.ts', export: 'discount' },
  conditions: [{ name: 'member', values: [true, false] }, { name: 'total', values: ['low', 'high'] }],
  rules: [{ when: { member: true }, then: 10 }, { when: { member: true, total: 'high' }, then: 15 }, { when: { member: false, total: 'low' }, then: 0 }] };
const code = {
  'package.json': JSON.stringify({ name: 'shop' }),
  'src/schema.ts': "import { z } from 'zod';\nexport const Age = z.number().int().min(1).max(10);\nexport const Name = z.string().min(LIMIT);\nconst LIMIT = 3;\n",
  'src/door.ts': "import { createMachine } from 'xstate';\nexport const door = createMachine({ id: 'door', initial: 'closed', states: { closed: { on: { OPEN: 'open' } }, open: { on: { CLOSE: 'closed' } }, stuck: {} } });\n",
  'src/price.ts': 'export function discount(member: boolean, total: string) { return member && total ? 10 : 0; }\n',
  'test/schema.test.ts': "import { Age } from '../src/schema';\ntest('age', () => { Age.parse(0); Age.parse(11); });\n",
  'test/door.test.ts': "import { door } from '../src/door';\ntest('door', () => { createActor(door).send({ type: 'OPEN' }); });\n",
};
const files = { ...code, '.code-map/models/order.json': JSON.stringify(order), '.code-map/models/notes.md': 'Not a model.\n',
  '.code-map/decisions/discount.json': JSON.stringify(discount), '.code-map/decisions/broken.json': '{ "tableVersion": 1, ' };

test('acceptance: the summary counts the boundary values, the state models, the decision tables and the refused model files', (t) => {
  const { store, run } = repository(t, files);
  const summary = json(run(['inspect', '--summary', '--ref', 'HEAD', '--store', store]));
  const { models } = summary;
  assert.deepEqual(Object.keys(summary).slice(-6), ['frameworks', 'architecture', 'models', 'documentation', 'commands', 'limits']);
  assert.equal(models.available, true);
  assert.deepEqual({ ...models.boundaries, next: null }, { schemas: 2, fields: 2, values: 6, named: 2, unknownFields: 1, next: null });
  assert.deepEqual({ ...models.states, next: null }, { models: 2, declared: 1, xstate: 1, transitions: 5, named: 1, unreachable: 2, deadEnds: 2, unhandled: 10, unknownEvents: 0, next: null });
  assert.deepEqual({ ...models.decisions, next: null, nextCases: null }, { tables: 1, rules: 3, overlaps: 1, conflicts: 1, cases: 4, gaps: 1, pairwise: 0, next: null, nextCases: null });
  assert.deepEqual({ ...models.errors, next: null }, { total: 1, next: null });
  assert.match(models.text, /named in a test/);
  assert.ok(summary.gaps.every((gap) => !/model/i.test(gap.key)), 'the model report does not change the evidence gaps that verify reads');

  const boundaries = json(run(argsOf(models.boundaries.next)));
  assert.deepEqual([boundaries.reportType, boundaries.part, boundaries.target, boundaries.page.total], ['code-map-evidence', 'models.boundaries', { models: 'boundaries' }, 2]);
  const [age, name] = boundaries.page.items;
  assert.deepEqual([age.name, age.file, age.line, age.tests], ['Age', 'src/schema.ts', 2, ['test/schema.test.ts']]);
  assert.deepEqual(age.fields[0].values.map((item) => [item.value, item.expected, item.named]), [[0, 'invalid', true], [1, 'valid', false], [2, 'valid', false], [9, 'valid', false], [10, 'valid', false], [11, 'invalid', true]]);
  assert.deepEqual([name.name, name.fields[0].state, name.fields[0].unknown[0].reason], ['Name', 'UNKNOWN', 'not-literal']);

  const states = json(run(argsOf(models.states.next))).page.items;
  assert.deepEqual(states.map((item) => [item.name, item.source, item.file, item.unreachable, item.deadEnds]),
    [['order', 'declared', '.code-map/models/order.json', ['lost'], ['lost']], ['door', 'xstate', 'src/door.ts', ['stuck'], ['stuck']]]);
  assert.deepEqual(states[1].transitions.map((item) => [item.event, item.named, item.tests]), [['OPEN', true, ['test/door.test.ts']], ['CLOSE', false, []]]);
  assert.deepEqual(states[0].transitions.map((item) => item.named), [null, null, null], 'a declared model without a subject names no test file, so Code-map cannot tell');

  const [table] = json(run(argsOf(models.decisions.next))).page.items;
  assert.deepEqual([table.name, table.file, table.subject, table.method, table.combinations, table.cases, table.gaps],
    ['discount', '.code-map/decisions/discount.json', { file: 'src/price.ts', export: 'discount', state: 'found' }, 'all', 4, 4, [{ member: false, total: 'high' }]]);
  const cases = json(run([...argsOf(models.decisions.nextCases), '--limit', '3']));
  assert.deepEqual([cases.page.total, cases.page.items.length, cases.page.items[0]], [4, 3, { table: 'discount', file: '.code-map/decisions/discount.json', index: 0,
    values: { member: true, total: 'low' }, rules: [0], expected: 10, state: 'covered' }]);
  assert.equal(json(run(argsOf(cases.page.next))).page.items[0].state, 'gap');
  const errors = json(run(argsOf(models.errors.next))).page.items;
  assert.deepEqual(errors.map((item) => [item.path, item.kind, item.reason]), [['.code-map/decisions/broken.json', 'decision-table', 'not-json']]);
});

test('a model folder or file outside the repository, a link and a file over the size limit are refused', (t) => {
  const { root, store, run } = repository(t, code);
  const outside = mkdtempSync(join(tmpdir(), 'code-map-models-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'order.json'), JSON.stringify(order));
  writeFileSync(join(outside, 'far.json'), JSON.stringify(discount));
  mkdirSync(join(root, '.code-map', 'decisions'), { recursive: true });
  symlinkSync(join(outside), join(root, '.code-map', 'models'));
  symlinkSync(join(outside, 'far.json'), join(root, '.code-map', 'decisions', 'far.json'));
  writeFileSync(join(root, '.code-map', 'decisions', 'big.json'), `{"name":"${'x'.repeat(maxModelBytes)}"}`);
  writeFileSync(join(root, '.code-map', 'decisions', 'here.json'), JSON.stringify(discount));
  symlinkSync('here.json', join(root, '.code-map', 'decisions', 'alias.json'));
  const { models } = json(run(['inspect', '--summary', '--worktree', '--store', store]));
  const errors = json(run(argsOf(models.errors.next))).page.items;
  assert.deepEqual(errors.map((item) => [item.path, item.reason]), [['.code-map/decisions/alias.json', 'symbolic-link'], ['.code-map/decisions/big.json', 'too-large'],
    ['.code-map/decisions/far.json', 'outside-repository'], ['.code-map/models', 'outside-repository']]);
  assert.match(errors.at(-1).problems[0].message, /outside the repository/);
  assert.deepEqual([models.states.declared, models.decisions.tables], [0, 1], 'Code-map reads only the table inside the repository');
});

test('a model edit in the working tree changes the analysis ID, and the model files are not settings', (t) => {
  const { root, store, run } = repository(t, files);
  const first = json(run(['inspect', '--summary', '--worktree', '--store', store]));
  writeFileSync(join(root, '.code-map', 'models', 'order.json'), JSON.stringify({ ...order, name: 'purchase' }));
  const second = json(run(['inspect', '--summary', '--worktree', '--store', store]));
  assert.notEqual(second.analysis.id, first.analysis.id);
  assert.equal(json(run(argsOf(second.models.states.next))).page.items[0].name, 'purchase');
  const old = json(run(['inspect', '--analysis', first.analysis.id, '--store', store]));
  assert.deepEqual([old.analysis.freshness.state, old.analysis.freshness.changed], ['stale', ['worktree']], 'a model file is part of the code, not of the settings digest');
});

test('an analysis that an older Code-map stored has no model report', () => {
  assert.deepEqual(modelSummary({}, () => 'next'), { available: false, text: 'This stored analysis has no model report. Run code-map inspect --summary again for a new analysis.' });
  const stored = { id: 'A-0123456789abcdef', createdAt: '2026-10-23T00:00:00.000Z', data: { analysis: { files: [], frameworks: {} } } };
  assert.throws(() => projectPart(stored, { id: stored.id, freshness: { state: 'current' }, command: (args) => args.join(' ') }, 'models.states'), /has no model report, because an older Code-map stored it/);
});

test('in a commit, a committed link, a file in place of a model folder and each file after the first 50 of a folder are refused', (t) => {
  const many = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`.code-map/decisions/t${String(index).padStart(2, '0')}.json`, JSON.stringify({ ...discount, name: `t${index}` })]));
  const { root, git } = repository(t, { ...code, ...many, '.code-map/models': 'not a folder\n', '.code-map/decisions/sub/deep.json': '{}' });
  symlinkSync('t00.json', join(root, '.code-map', 'decisions', 'link.json'));
  git('add', '.'); git('commit', '-qm', 'link');
  const { files: read, errors } = readModelFiles(root, git('rev-parse', 'HEAD'), [], new Map());
  // link.json comes first in the folder, so it takes one of the 50 places.
  assert.deepEqual(errors.map((item) => [item.path, item.kind, item.reason]), [['.code-map/decisions/link.json', 'decision-table', 'symbolic-link'],
    ['.code-map/decisions/t49.json', 'decision-table', 'too-many-files'], ['.code-map/models', 'state-model', 'not-a-folder']]);
  assert.deepEqual([read.length, read[0].path, read.at(-1).path, read[0].value.name], [49, '.code-map/decisions/t00.json', '.code-map/decisions/t48.json', 't0'], 'a nested folder is not read');
});
