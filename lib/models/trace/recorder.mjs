// Runs inside the worker. Append-only records also retain observations from Node test child processes.
import { appendFileSync } from 'node:fs';
const output = new URL('./trace.jsonl', import.meta.url);
const wrapped = new WeakMap();
/** Writes one bounded observation without context or event payload data. */
export function record(value) { appendFileSync(output, JSON.stringify(value) + '\n'); }
const state = (snapshot) => statePath(snapshot?.value);
function statePath(value, depth = 0) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || depth >= 32) return null;
  const entries = Object.entries(value);
  if (entries.length !== 1) return null;
  const [key, child] = entries[0], nested = statePath(child, depth + 1);
  return nested === null ? null : `${key}.${nested}`;
}
const eventName = (event) => typeof event === 'string' ? event : event?.type;
/** Wraps the installed public actor factory. Flat and single-branch nested states have transition comparisons. */
export function wrap(factory, version) {
  if (typeof factory !== 'function') return factory;
  if (wrapped.has(factory)) return wrapped.get(factory);
  const replacement = function(machine, options = {}, ...rest) {
    record({ type: 'status', state: 'KNOWN', reason: null });
    const pending = new WeakMap();
    const inspect = (entry) => {
      const actor = entry.actorRef;
      if (eventName(entry.event) === 'xstate.init' && entry.type !== '@xstate.microstep') {
        if (typeof options.inspect === 'function') options.inspect(entry);
        else options.inspect?.next?.(entry);
        return;
      }
      if (actor && entry.type === '@xstate.event') pending.set(actor, { from: state(actor.getSnapshot?.()), event: eventName(entry.event) });
      if (actor && entry.type === '@xstate.microstep') {
        const initial = eventName(entry.event) === 'xstate.init', path = entry._transitions?.[0]?.source?.path;
        const from = initial && Array.isArray(path) && path.every((part) => typeof part === 'string') ? path.join('.') : state(actor.getSnapshot?.());
        const before = pending.get(actor) ?? { from, event: eventName(entry.event) };
        const next = state(entry.snapshot), transitions = entry._transitions;
        const event = Array.isArray(transitions) && transitions.length === 1 && transitions[0].eventType === '' ? null
          : eventName(entry.event) === 'xstate.always' ? null : eventName(entry.event);
        emit(actor.logic?.id, before.from, event, next, Array.isArray(transitions) ? transitions.length > 0 : undefined);
        pending.set(actor, { from: next, event: before.event, microsteps: true });
      }
      if (actor && entry.type === '@xstate.snapshot') {
        const before = pending.get(actor);
        if (before) {
          if (!before.microsteps) emit(actor.logic?.id, before.from, before.event, state(entry.snapshot));
          pending.delete(actor);
        }
      }
      if (typeof options.inspect === 'function') options.inspect(entry);
      else options.inspect?.next?.(entry);
    };
    const actor = factory.call(this, machine, version === 5 ? { ...options, inspect } : options, ...rest);
    if (version === 4) {
      let previous = state(actor.state ?? actor.getSnapshot?.());
      actor.onTransition((snapshot) => {
        const next = state(snapshot), event = eventName(snapshot.event);
        if (event !== 'xstate.init') emit(machine?.id, previous, event, next);
        previous = next;
      });
    }
    return actor;
  };
  wrapped.set(factory, replacement);
  return replacement;
}
function emit(machine, from, event, to, handled) {
  if ((event !== null && (typeof event !== 'string' || !event.length || event.length > 200)) || ![machine, from, to].every((value) => typeof value === 'string' && value.length > 0 && value.length <= 200)) {
    record({ type: 'status', state: 'UNKNOWN', reason: 'Unsupported actor identity, event or nested state value.' });
    return;
  }
  record({ type: 'transition', machine, from, event, to, ...(handled === undefined ? {} : { handled }) });
}

const namespaces = new WeakMap();
/** Keeps repeated CommonJS loads stable while replacing public actor factories. */
export function wrapApi(api) {
  if (!api || typeof api !== 'object') return api;
  if (namespaces.has(api)) return namespaces.get(api);
  const value = { ...api };
  if (typeof api.createActor === 'function') value.createActor = wrap(api.createActor, 5);
  if (typeof api.interpret === 'function') value.interpret = wrap(api.interpret, typeof api.createActor === 'function' ? 5 : 4);
  namespaces.set(api, value);
  return value;
}
