// State models (C23): the declared model files `.code-map/models/*.json` and the checks of a state machine. A machine is a
// tree of state nodes with paths (the root is ''), its transitions and its UNKNOWN parts, from lib/models/xstate.mjs or from
// declaredMachine. The checks list unreachable states, the states without a way out that are not final, and the events that
// a state does not handle. Pure: the caller gives the events that the tests send.
import { isRecord, subjectProblems, text, textRule, unknownFields } from './validate.mjs';

const modelVersion = 1;
const maxStates = 1000, maxTransitions = 5000;
const fields = ['modelVersion', 'name', 'states', 'initial', 'final', 'transitions', 'subject'], transitionFields = ['from', 'event', 'to'];

/** { ok: true, model } or { ok: false, problems: [{ path, message }] } for the parsed JSON of a model file. */
export function validateStateModel(value) {
  if (!isRecord(value)) return { ok: false, problems: [{ path: '', message: 'must be an object with modelVersion, name, states, initial and transitions.' }] };
  const problems = [], add = (path, message) => problems.push({ path, message }), states = new Set();
  unknownFields(value, fields, '', add);
  if (value.modelVersion !== modelVersion) add('modelVersion', `must be ${modelVersion}.`);
  if (!text(value.name)) add('name', textRule);
  if (!Array.isArray(value.states) || !value.states.length) add('states', 'must be a list of the state names, with at least one state.');
  else if (value.states.length > maxStates) add('states', `must have at most ${maxStates} states.`);
  else value.states.forEach((state, index) => {
    if (!text(state)) add(`states[${index}]`, textRule);
    else if (states.has(state)) add(`states[${index}]`, `repeats the state ${JSON.stringify(state)}.`);
    else states.add(state);
  });
  if (!states.has(value.initial)) add('initial', 'must be one of the states.');
  if (value.final !== undefined && !Array.isArray(value.final)) add('final', 'must be a list of states.');
  else for (const [index, state] of (value.final ?? []).entries()) if (!states.has(state)) add(`final[${index}]`, 'must be one of the states.');
  const pairs = new Set();
  if (!Array.isArray(value.transitions)) add('transitions', 'must be a list.');
  else if (value.transitions.length > maxTransitions) add('transitions', `must have at most ${maxTransitions} transitions.`);
  else value.transitions.forEach((transition, index) => {
    const at = `transitions[${index}]`;
    if (!isRecord(transition)) { add(at, 'must be an object with from, event and to.'); return; }
    unknownFields(transition, transitionFields, at, add);
    if (!states.has(transition.from)) add(`${at}.from`, 'must be one of the states.');
    if (!text(transition.event)) add(`${at}.event`, textRule);
    if (!states.has(transition.to)) add(`${at}.to`, 'must be one of the states.');
    const pair = JSON.stringify([transition.from, transition.event]);
    if (pairs.has(pair)) add(at, `repeats the event ${JSON.stringify(transition.event)} of the state ${JSON.stringify(transition.from)}. A state can have one transition for each event.`);
    pairs.add(pair);
  });
  if (value.subject !== undefined) subjectProblems(value.subject, add);
  if (problems.length) return { ok: false, problems };
  return { ok: true, model: { modelVersion, name: value.name, states: [...value.states], initial: value.initial, final: [...(value.final ?? [])],
    transitions: value.transitions.map(({ from, event, to }) => ({ from, event, to })), subject: value.subject ? { file: value.subject.file, export: value.subject.export } : null } };
}

/** A valid declared model as a machine: one level of states below the root. */
export function declaredMachine(model) {
  const finals = new Set(model.final);
  return { variable: null, id: null, line: null, initial: model.initial,
    nodes: [{ path: '', parent: null, type: 'compound', initial: model.initial, children: [...model.states], line: null },
      ...model.states.map((state) => ({ path: state, parent: '', type: finals.has(state) ? 'final' : 'atomic', initial: null, children: [], line: null }))],
    transitions: model.transitions.map(({ from, event, to }) => ({ from, event, kind: 'event', to: [to], line: null })), unknown: [] };
}

/** An event key handles an event: the same name, `*`, or a prefix pattern such as `error.*`. */
const handles = (key, event) => key === event || key === '*' || (key.endsWith('.*') && event.startsWith(key.slice(0, -1)));

/**
 * The checks of one machine. `sends` maps each event that a linked test sends to those tests, or is null when no test file is
 * linked to the model: `named` is then null. Reachability is UNKNOWN when a part that is not a literal can hide a target. A
 * state with an UNKNOWN part, on itself or on a parent, is not judged for a way out or for unhandled events.
 */
export function checkStateModel(machine, sends = new Map()) {
  const nodes = new Map(machine.nodes.map((node) => [node.path, node])), outgoing = new Map();
  for (const transition of machine.transitions) outgoing.set(transition.from, [...(outgoing.get(transition.from) ?? []), transition]);
  const lineage = (path) => { const list = []; for (let current = path; current !== null && current !== undefined; current = nodes.get(current)?.parent) list.push(current); return list; };
  const flagged = new Set(machine.unknown.map((item) => item.state)), judged = (path) => !lineage(path).some((item) => flagged.has(item));
  const reachKnown = !machine.unknown.some((item) => item.reason !== 'target-not-found');
  const reached = new Set(), entered = new Set(), queue = [];
  const enter = (path) => {
    for (const item of lineage(path)) if (!reached.has(item)) { reached.add(item); queue.push(item); }
    if (entered.has(path)) return;
    entered.add(path);
    const node = nodes.get(path);
    if (node.type === 'parallel') for (const child of node.children) enter(child);
    else if (node.type === 'compound' && node.initial !== null) enter(node.initial);
  };
  enter('');
  for (let index = 0; index < queue.length; index++) for (const transition of outgoing.get(queue[index]) ?? []) for (const target of transition.to ?? []) enter(target);
  const states = machine.nodes.filter((node) => node.path !== ''), keys = (path) => lineage(path).flatMap((item) => (outgoing.get(item) ?? []).map((transition) => transition.event).filter((event) => event !== null));
  const events = [...new Set(machine.transitions.map((item) => item.event).filter((event) => event !== null && !event.includes('*')))].sort();
  const wayOut = (path) => lineage(path).some((item) => (outgoing.get(item) ?? []).some((transition) => transition.to !== null && transition.to.some((target) => target !== path)));
  const open = states.filter((node) => node.type === 'atomic' && judged(node.path));
  const unhandled = open.map((node) => ({ state: node.path, events: events.filter((event) => !keys(node.path).some((key) => handles(key, event))) })).filter((item) => item.events.length);
  const anyKey = machine.transitions.map((item) => item.event).filter((event) => event !== null);
  const hiddenEvents = machine.unknown.some((item) => ['config', 'states', 'on'].includes(item.part));
  const unknownEvents = sends === null || hiddenEvents ? [] : [...sends].filter(([event]) => !anyKey.some((key) => handles(key, event))).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([event, tests]) => ({ event, tests }));
  const rootUnknown = states.length === 0 && machine.unknown.length > 0;
  return {
    state: rootUnknown ? 'UNKNOWN' : machine.unknown.length ? 'PARTIAL' : 'KNOWN', initial: machine.initial,
    states: states.map((node) => ({ state: node.path, type: node.type, line: node.line })), events,
    transitions: machine.transitions.map((transition) => ({ ...transition, named: sends === null ? null : transition.event !== null && sends.has(transition.event), tests: sends?.get(transition.event) ?? [] })),
    reachability: reachKnown ? 'KNOWN' : 'UNKNOWN', unreachable: reachKnown ? states.filter((node) => !reached.has(node.path)).map((node) => node.path) : [],
    deadEnds: open.filter((node) => !wayOut(node.path)).map((node) => node.path), unhandled, unknownEvents, unknown: machine.unknown,
  };
}
