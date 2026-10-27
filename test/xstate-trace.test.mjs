import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { project, authorize, run, sandboxed } from './worker-fixtures.mjs';
import { authorizeWork } from '../lib/worker/cli.mjs';
import { traceCommand } from '../lib/models/trace-run.mjs';
import { traceInformation } from '../lib/models/trace-report.mjs';

const model = { name: 'door', id: 'door', state: 'KNOWN', unknown: [], transitions: [
  { from: 'closed', event: 'OPEN', to: ['open'] }, { from: 'open', event: 'CLOSE', to: ['closed'] } ] };
const line = (value) => JSON.stringify(value) + '\n';
const ready = line({ type: 'status', state: 'KNOWN', reason: null });
const observation = (event, to) => ({ type: 'transition', machine: 'door', from: 'closed', event, to });

test('trace comparison lists unseen, unauthorized and unhandled observations', () => {
  const report = traceInformation(ready + line(observation('OPEN', 'open')) + line(observation('BREAK', 'broken'))
    + line(observation('IGNORE', 'closed')), [model]);
  assert.equal(report.state, 'KNOWN');
  assert.deepEqual(report.models[0].unseen, [model.transitions[1]]);
  assert.equal(report.unauthorized[0].event, 'BREAK');
  assert.equal(report.unhandled[0].event, 'IGNORE');
});

test('missing, malformed and ambiguous traces stay UNKNOWN', () => {
  assert.equal(traceInformation('', [model]).state, 'UNKNOWN');
  assert.equal(traceInformation('{bad', [model]).state, 'UNKNOWN');
  assert.equal(traceInformation(ready + line({ type: 'transition', machine: '../x' }), [model]).state, 'UNKNOWN');
  assert.equal(traceInformation(ready, [model, model]).models[0].state, 'UNKNOWN');
});

test('trace mode requires authorization of the preload command', async (t) => {
  const f = project(t), command = ['node', 'test.mjs'], authorization = authorize(f, command);
  await assert.rejects(run(f, command, { authorization, traceXstate: true }, { backend: null }), /other command words/);
  assert.deepEqual(traceCommand(command), ['node', '--import', './.code-map-xstate/preload.mjs', 'test.mjs']);
  assert.throws(() => traceCommand(['npm', 'test']), /Node/);
});

// The brief requires a hand-written package fixture. No real XState integration claim follows from this stand-in.
const standin = `export function createActor(machine, options = {}) {
 let value = 'closed';
 const actor = { logic: { id: machine.id }, getSnapshot: () => ({ value }), start() { return this; }, send(event) {
   options.inspect?.({ type: '@xstate.event', actorRef: actor, event });
   if (event.type === 'OPEN') value = 'open';
   if (event.type === 'BREAK') value = 'broken';
   options.inspect?.({ type: '@xstate.snapshot', actorRef: actor, event, snapshot: { value } });
 } }; return actor;
}
`;

test('worker keeps a trace artifact from an ESM XState stand-in', sandboxed, async (t) => {
  const f = project(t);
  f.put('node_modules/xstate/package.json', JSON.stringify({ type: 'module', exports: './index.mjs' }));
  f.put('node_modules/xstate/index.mjs', standin);
  f.put('trace-test.mjs', "import { createActor } from 'xstate'; const a = createActor({ id: 'door' }).start(); a.send({type:'OPEN'}); a.send({type:'BREAK'});\n");
  const command = ['node', '--test', 'trace-test.mjs'], authorization = authorize(f, traceCommand(command));
  const result = await run(f, command, { traceXstate: true, authorization, worktree: true, head: undefined });
  assert.equal(result.exitCode, 0, JSON.stringify(result.summary));
  assert.equal(result.record.artifact.kind, 'xstate-trace');
  assert.deepEqual(result.record.command, traceCommand(command));
  const info = traceInformation(readFileSync(result.paths.artifact, 'utf8'), [model]);
  assert.equal(info.models[0].unseen.length, 1);
  assert.equal(info.unauthorized.length, 1);
});

test('a worker without XState keeps an UNKNOWN trace with its reason', sandboxed, async (t) => {
  const f = project(t), command = ['node', '-e', 'void 0'], authorization = authorize(f, traceCommand(command));
  const result = await run(f, command, { traceXstate: true, authorization });
  const info = traceInformation(readFileSync(result.paths.artifact, 'utf8'), [model]);
  assert.equal(info.state, 'UNKNOWN');
  assert.match(info.reason, /not installed/);
});

test('verify and inspect bind traces and keep their comparisons informational', sandboxed, async (t) => {
  const f = project(t);
  f.put('node_modules/xstate/package.json', JSON.stringify({ type: 'module', exports: './index.mjs' }));
  f.put('node_modules/xstate/index.mjs', standin);
  f.put('trace-test.mjs', "import { createActor } from 'xstate'; const a = createActor({id:'door'}).start(); a.send({type:'OPEN'});\n");
  const command = ['node', 'trace-test.mjs'], authorization = authorize(f, traceCommand(command));
  const result = await run(f, command, { traceXstate: true, authorization, worktree: true, head: undefined });
  const { analysisInputs } = await import('../lib/inputs.mjs');
  const { loadConfig } = await import('../lib/project.mjs');
  const { loadReports } = await import('../lib/verify-reports.mjs');
  const { retrieveTrace: retrieve } = await import('../lib/models/trace-inspect.mjs');
  const inputs = analysisInputs(f.root, loadConfig(f.root), { worktree: true }, null);
  const side = { inputs, sha: inputs.sha, analysis: { models: { states: [model] } } };
  const reports = loadReports(f.root, [{ run: result.record.runId }], { head: side, base: side }, undefined, f.store);
  assert.equal(reports.executions[0].xstateTrace.models[0].unseen.length, 1);
  assert.equal(reports.executions[0].eligible, false);
  assert.deepEqual(reports.reports.ineligible, []);
  const summary = retrieve(f.root, loadConfig(f.root), { summary: true, worktree: true, store: f.store, run: result.record.runId });
  assert.equal(summary.xstateTrace.binding, 'BOUND');
  assert.equal(summary.xstateTrace.information.observations, 1);
  f.put('src/sum.mjs', 'export const sum = 42;');
  const stale = retrieve(f.root, loadConfig(f.root), { summary: true, worktree: true, store: f.store, run: result.record.runId });
  assert.equal(stale.xstateTrace.binding, 'STALE');
  assert.equal(stale.xstateTrace.information, null);
});

test('worker records XState 4 CommonJS transitions and unhandled events', sandboxed, async (t) => {
  const f = project(t);
  f.put('node_modules/xstate/package.json', JSON.stringify({ main: 'index.cjs' }));
  f.put('node_modules/xstate/index.cjs', `exports.interpret = machine => {
    let listener, value = 'closed';
    const actor = { state: {value}, onTransition(fn) { listener = fn; return this; },
      start() { listener({value, event: {type:'xstate.init'}}); return this; },
      send(event) { if(event === 'OPEN') value = 'open'; listener({value, event: {type:event}}); } };
    return actor;
  };`);
  f.put('trace-test.cjs', "const {interpret} = require('xstate'); const a = interpret({id:'door'}).start(); a.send('IGNORE'); a.send('OPEN');");
  const command = ['node', 'trace-test.cjs'], authorization = authorize(f, traceCommand(command));
  const result = await run(f, command, { traceXstate: true, authorization, worktree: true, head: undefined });
  const info = traceInformation(readFileSync(result.paths.artifact, 'utf8'), [model]);
  assert.equal(info.observations, 2);
  assert.equal(info.unhandled[0].event, 'IGNORE');
  assert.equal(info.models[0].unseen.length, 1);
});

test('worker retains intermediate XState 5 microsteps', sandboxed, async (t) => {
  const f = project(t);
  f.put('node_modules/xstate/package.json', JSON.stringify({ type: 'module', exports: './index.mjs' }));
  f.put('node_modules/xstate/index.mjs', standin.replace("if (event.type === 'OPEN') value = 'open';", `if (event.type === 'OPEN') {
    value = 'opening'; options.inspect?.({type:'@xstate.microstep', actorRef:actor, event, snapshot:{value}});
    value = 'open'; options.inspect?.({type:'@xstate.microstep', actorRef:actor, event:{type:'xstate.always'}, snapshot:{value}});
  }`));
  f.put('trace-test.mjs', "import {createActor} from 'xstate'; createActor({id:'door'}).start().send({type:'OPEN'});");
  const command = ['node', 'trace-test.mjs'], authorization = authorize(f, traceCommand(command));
  const result = await run(f, command, { traceXstate: true, authorization, worktree: true, head: undefined });
  const info = traceInformation(readFileSync(result.paths.artifact, 'utf8'), [model]);
  assert.equal(info.observations, 2);
  assert.equal(info.unauthorized[0].to, 'opening');
});

test('trace comparisons retain guarded misses and eventless nested transitions', () => {
  const nested = { ...model, transitions: [ { from: 'closed', event: 'OPEN', to: ['open'] },
    { from: 'open', event: null, to: ['done'] } ] };
  const source = ready + line({ ...observation('OPEN', 'closed'), handled: false })
    + line({ type: 'transition', machine: 'door', from: 'open.ready', event: null, to: 'done' });
  const result = traceInformation(source, [nested]);
  assert.deepEqual(result.models[0].unseen, [nested.transitions[0]]);
  assert.equal(result.unhandled[0].event, 'OPEN');
  assert.deepEqual(result.unauthorized, []);
  assert.equal(traceInformation(ready + line({ ...observation('OPEN', 'open'), payload: 'secret' }), [model]).state, 'UNKNOWN');
});

test('CLI authorization explicitly names trace mode and stores the preload words', (t) => {
  const f = project(t), command = ['node', '--test'];
  const result = authorizeWork(f.root, { store: f.store, 'trace-xstate': true }, ['authorize'], command);
  assert.deepEqual(result.command, traceCommand(command));
  const stored = JSON.parse(readFileSync(result.file, 'utf8'));
  assert.deepEqual(stored.command, traceCommand(command));
});

test('tracing preserves CommonJS default imports and repeated require identity', sandboxed, async (t) => {
  const f = project(t);
  f.put('node_modules/xstate/package.json', JSON.stringify({ main: 'index.cjs' }));
  f.put('node_modules/xstate/index.cjs', standin.replace('export function createActor', 'exports.createActor = function'));
  f.put('trace-test.mjs', `import xstate from 'xstate';
    import {createRequire} from 'node:module';
    const require = createRequire(import.meta.url);
    if (require('xstate') !== require('xstate')) throw Error('require identity changed');
    xstate.createActor({id:'door'}).start().send({type:'OPEN'});
  `);
  const command = ['node', 'trace-test.mjs'], authorization = authorize(f, traceCommand(command));
  const result = await run(f, command, { traceXstate: true, authorization, worktree: true, head: undefined });
  assert.equal(result.record.exitStatus, 0, readFileSync(result.paths.stderr, 'utf8'));
  assert.equal(traceInformation(readFileSync(result.paths.artifact, 'utf8'), [model]).observations, 1);
});

test('generated timer and completion events match extracted eventless model kinds', () => {
  const generated = { ...model, transitions: [{ from: 'closed', event: null, kind: 'after', to: ['open'] }] };
  const info = traceInformation(ready + line(observation('xstate.after.1000.door.closed', 'open')), [generated]);
  assert.deepEqual(info.models[0].unseen, []);
  assert.deepEqual(info.unauthorized, []);
});

test('initial eventless microsteps retain their declared source', sandboxed, async (t) => {
  const f = project(t);
  f.put('node_modules/xstate/package.json', JSON.stringify({ type: 'module', exports: './index.mjs' }));
  f.put('node_modules/xstate/index.mjs', standin.replace('start() { return this; }', `start() {
    value = 'open'; options.inspect?.({type:'@xstate.microstep', actorRef:actor, event:{type:'xstate.init'},
      snapshot:{value}, _transitions:[{eventType:'', source:{path:['closed']}}]}); return this;
  }`));
  f.put('trace-test.mjs', "import {createActor} from 'xstate'; createActor({id:'door'}).start();");
  const command = ['node', 'trace-test.mjs'], authorization = authorize(f, traceCommand(command));
  const result = await run(f, command, { traceXstate: true, authorization, worktree: true, head: undefined });
  const initial = { ...model, transitions: [{ from: 'closed', event: null, kind: 'always', to: ['open'] }] };
  const info = traceInformation(readFileSync(result.paths.artifact, 'utf8'), [initial]);
  assert.equal(info.observations, 1);
  assert.deepEqual(info.models[0].unseen, []);
});

test('anonymous extracted machines prevent unsupported unauthorized claims', () => {
  const anonymous = { ...model, source: 'xstate', name: 'variableName', id: null };
  const info = traceInformation(ready + line({ ...observation('OPEN', 'open'), machine: '(machine)' }), [anonymous]);
  assert.equal(info.state, 'PARTIAL');
  assert.deepEqual(info.unauthorized, []);
  assert.equal(info.models[0].state, 'UNKNOWN');
});
