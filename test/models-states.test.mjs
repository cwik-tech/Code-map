// Unit tests of state models (C23): XState machines from the syntax, declared model files, and the checks of a model:
// unreachable states, states without a way out, unhandled events, UNKNOWN parts and the events that tests send.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFile } from '../lib/analyze.mjs';
import { analyzeModels } from '../lib/models/models.mjs';
import { checkStateModel, declaredMachine, validateStateModel } from '../lib/models/state-model.mjs';

const machines = (text, header = "import { createMachine, setup } from 'xstate';\n") => analyzeFile('src/door.ts', header + text, () => null).models?.machines ?? [];
const check = (machine, sends = new Map()) => checkStateModel(machine, sends);
const unhandled = (result) => result.unhandled.map((item) => [item.state, item.events]);
const order = { modelVersion: 1, name: 'order', states: ['new', 'paid', 'shipped', 'cancelled', 'lost'], initial: 'new', final: ['shipped', 'cancelled'],
  transitions: [{ from: 'new', event: 'PAY', to: 'paid' }, { from: 'new', event: 'CANCEL', to: 'cancelled' }, { from: 'paid', event: 'SHIP', to: 'shipped' }] };

const door = `export const door = createMachine({
  id: 'door',
  initial: 'closed',
  states: {
    closed: { on: { OPEN: 'open', LOCK: { target: 'locked' } } },
    open: { on: { CLOSE: 'closed' } },
    locked: {},
    broken: { on: { FIX: 'closed' } },
    gone: { type: 'final' },
  },
});
`;

test('an XState machine: an unreachable state, a state without a way out and the unhandled events of each state', () => {
  const [machine] = machines(door);
  assert.deepEqual([machine.variable, machine.id, machine.line, machine.initial], ['door', 'door', 2, 'closed']);
  assert.deepEqual(machine.nodes.filter((node) => node.path !== '').map((node) => [node.path, node.type, node.line]),
    [['closed', 'atomic', 6], ['open', 'atomic', 7], ['locked', 'atomic', 8], ['broken', 'atomic', 9], ['gone', 'final', 10]]);
  assert.deepEqual(machine.transitions.map((item) => [item.from, item.event, item.to, item.line]),
    [['closed', 'OPEN', ['open'], 6], ['closed', 'LOCK', ['locked'], 6], ['open', 'CLOSE', ['closed'], 7], ['broken', 'FIX', ['closed'], 9]]);
  const result = check(machine);
  assert.deepEqual([result.state, result.reachability, result.unreachable, result.deadEnds], ['KNOWN', 'KNOWN', ['broken', 'gone'], ['locked']]);
  assert.deepEqual(result.events, ['CLOSE', 'FIX', 'LOCK', 'OPEN']);
  assert.deepEqual(unhandled(result), [['closed', ['CLOSE', 'FIX']], ['open', ['FIX', 'LOCK', 'OPEN']], ['locked', ['CLOSE', 'FIX', 'LOCK', 'OPEN']], ['broken', ['CLOSE', 'LOCK', 'OPEN']]],
    'a final state accepts no event, so it is not in the list');
});

test('nested states, targets by ID and from the root, parallel regions and eventless transitions', () => {
  const [machine] = machines(`const job = setup({ actors: {} }).createMachine({
  id: 'job', initial: 'idle', on: { RESET: '.idle' },
  states: {
    idle: { on: { START: 'run' } },
    run: { initial: 'slow', states: { slow: { on: { FAST: 'fast' } }, fast: { after: { 1000: '#job.end' } } } },
    side: { type: 'parallel', states: { a: { on: { NEXT: { target: '#done' } } }, b: {} } },
    end: { id: 'done', type: 'final', always: [{ target: 'idle', guard: 'again' }] },
  },
});
`);
  assert.deepEqual(machine.transitions.map((item) => [item.from, item.event, item.kind, item.to]), [['', 'RESET', 'event', ['idle']], ['idle', 'START', 'event', ['run']],
    ['run.slow', 'FAST', 'event', ['run.fast']], ['run.fast', null, 'after', ['end']], ['side.a', 'NEXT', 'event', ['end']], ['end', null, 'always', ['idle']]]);
  const result = check(machine);
  assert.deepEqual([result.unknown, result.reachability, result.unreachable], [[], 'KNOWN', ['side', 'side.a', 'side.b']]);
  assert.deepEqual(result.deadEnds, [], 'the root handles RESET, so every state has a way out');
  assert.deepEqual(unhandled(result), [['idle', ['FAST', 'NEXT']], ['run.slow', ['NEXT', 'START']], ['run.fast', ['FAST', 'NEXT', 'START']], ['side.a', ['FAST', 'START']], ['side.b', ['FAST', 'NEXT', 'START']]]);
});

test('a target, an event list or states that are not literals are UNKNOWN, and a missing target state is reported', () => {
  const [machine] = machines(`const flow = createMachine({
  initial: 'a',
  states: {
    a: { on: { GO: { target: next }, STOP: 'b' } },
    b: { on: { BACK: '.missing', ...more } },
    c: {},
    d: config,
  },
});
`);
  const result = check(machine);
  assert.deepEqual(result.unknown, [
    { state: 'a', part: 'target', event: 'GO', reason: 'not-literal', line: 5 },
    { state: 'b', part: 'on', event: null, reason: 'not-literal', line: 6 },
    { state: 'b', part: 'target', event: 'BACK', reason: 'target-not-found', line: 6 },
    { state: 'd', part: 'config', event: null, reason: 'not-literal', line: 8 },
  ]);
  assert.deepEqual([result.state, result.reachability, result.unreachable], ['PARTIAL', 'UNKNOWN', []], 'a target that is not a literal can reach any state');
  assert.deepEqual(result.deadEnds, ['c'], 'only states without an UNKNOWN part are judged');
  assert.deepEqual(unhandled(result), [['c', ['BACK', 'GO', 'STOP']]]);
  const [whole] = machines('const m = createMachine(config);\n');
  assert.deepEqual([check(whole).state, check(whole).unknown[0].part], ['UNKNOWN', 'config']);
  assert.deepEqual(machines(door, "import { createMachine } from './local';\n"), [], 'without an import from xstate, createMachine is not XState');
});

test('a transition is named in a test when a test that imports the machine file sends its event', () => {
  const file = analyzeFile('src/door.ts', "import { createMachine } from 'xstate';\n" + door, () => null);
  const tests = [{ path: 'test/door.test.ts', imports: ['src/door.ts'] }, { path: 'test/far.test.ts', imports: [] }];
  const texts = new Map([['test/door.test.ts', "const actor = createActor(door);\nactor.send({ type: 'OPEN' });\nactor.send('KNOCK');\n"], ['test/far.test.ts', "send({ type: 'CLOSE' });\n"]]);
  const [model] = analyzeModels({ files: [file], testFacts: tests, texts }).states;
  assert.deepEqual([model.name, model.source, model.file, model.tests], ['door', 'xstate', 'src/door.ts', ['test/door.test.ts']]);
  assert.deepEqual(model.transitions.map((item) => [item.event, item.named, item.tests]),
    [['OPEN', true, ['test/door.test.ts']], ['LOCK', false, []], ['CLOSE', false, []], ['FIX', false, []]], 'the far test sends CLOSE, but it does not import the machine file');
  assert.deepEqual(model.unknownEvents, [{ event: 'KNOCK', tests: ['test/door.test.ts'] }], 'a sent event that no transition handles');
});

test('a declared model file: the checks of a valid model', () => {
  const checked = validateStateModel(order);
  assert.equal(checked.ok, true, JSON.stringify(checked.problems));
  const result = check(declaredMachine(checked.model));
  assert.deepEqual([result.state, result.unreachable, result.deadEnds], ['KNOWN', ['lost'], ['lost']]);
  assert.deepEqual(unhandled(result), [['new', ['SHIP']], ['paid', ['CANCEL', 'PAY']], ['lost', ['CANCEL', 'PAY', 'SHIP']]]);
  assert.deepEqual(result.transitions[0], { from: 'new', event: 'PAY', kind: 'event', to: ['paid'], line: null, named: false, tests: [] });
  assert.equal(validateStateModel({ ...order, subject: { file: 'src/order.ts', export: 'order' } }).ok, true, 'a subject is optional');
});

test('a declared model file is validated strictly, and each problem has its path', () => {
  const problems = (value) => { const checked = validateStateModel(value); assert.equal(checked.ok, false); return checked.problems.map((item) => `${item.path}: ${item.message}`); };
  const lines = problems({ ...order, modelVersion: 2, color: 'red', states: ['new', 'paid', 'paid', ''], initial: 'start', final: ['gone'],
    transitions: [{ from: 'new', event: 'PAY', to: 'nowhere' }, { from: 'new', event: 'PAY', to: 'paid' }, { from: 'paid', event: '', to: 'new', extra: 1 }, 'x'] });
  for (const pattern of [/^modelVersion: must be 1/, /^color: is not a known field/, /^states\[2\]: repeats the state "paid"/, /^states\[3\]: must be a text/,
    /^initial: must be one of the states/, /^final\[0\]: must be one of the states/, /^transitions\[0\]\.to: must be one of the states/,
    /^transitions\[1\]: repeats the event "PAY" of the state "new"/, /^transitions\[2\]\.event: must be a text/, /^transitions\[2\]\.extra: is not a known field/, /^transitions\[3\]: must be an object/]) {
    assert.ok(lines.some((line) => pattern.test(line)), `${pattern} in ${lines.join(' | ')}`);
  }
  assert.match(problems([]).join(), /^: must be an object/);
  assert.match(problems({ ...order, states: 'new' }).join(), /states: must be a list/);
  assert.match(problems({ ...order, subject: { file: '../x.ts', export: 'x' } }).join(), /subject\.file: must be a path inside the repository/);
  assert.match(problems({ ...order, states: Array.from({ length: 1001 }, (_, index) => `s${index}`) }).join(), /states: must have at most 1000 states/);
});

test('a declared model with a subject links the tests that import its file, and an invalid model file becomes an error', () => {
  const file = { path: 'src/order.ts', exports: ['order'], models: null };
  const tests = [{ path: 'test/order.test.ts', imports: ['src/order.ts'] }];
  const texts = new Map([['test/order.test.ts', "actor.send({ type: 'PAY' });\nactor.send('REFUND');\n"]]);
  const subject = (name) => ({ file: 'src/order.ts', export: name });
  const modelFiles = { errors: [], files: [{ path: '.code-map/models/order.json', kind: 'state-model', value: { ...order, subject: subject('order') } },
    { path: '.code-map/models/other.json', kind: 'state-model', value: { ...order, name: 'other', subject: subject('missing') } },
    { path: '.code-map/models/bad.json', kind: 'state-model', value: { ...order, modelVersion: 3 } }] };
  const result = analyzeModels({ files: [file], testFacts: tests, texts, modelFiles, paths: ['src/order.ts'] });
  const [model, other] = result.states;
  assert.deepEqual([model.subject, model.tests], [{ file: 'src/order.ts', export: 'order', state: 'found' }, ['test/order.test.ts']]);
  assert.deepEqual(model.transitions.map((item) => [item.event, item.named]), [['PAY', true], ['CANCEL', false], ['SHIP', false]]);
  assert.deepEqual(model.unknownEvents, [{ event: 'REFUND', tests: ['test/order.test.ts'] }]);
  assert.equal(other.subject.state, 'export-missing');
  assert.deepEqual(result.errors, [{ path: '.code-map/models/bad.json', kind: 'state-model', reason: 'invalid', problems: [{ path: 'modelVersion', message: 'must be 1.' }] }]);
});
