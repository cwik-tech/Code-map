// Pure, bounded parsing and comparison. Observations are information and never a verification check.
const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value);
const handles = (key, event) => key === event || (event !== null && key === '*') || (key?.endsWith('.*') && event?.startsWith(key.slice(0, -1)));
const within = (path, parent) => parent === '' || path === parent || path.startsWith(parent + '.');
const eventMatches = (transition, event) => handles(transition.event, event) || (transition.event === null && (
  transition.kind === 'after' && event?.startsWith('xstate.after.')
  || transition.kind === 'done' && event?.startsWith('xstate.done.state.')
  || transition.kind === 'invoke' && (event?.startsWith('xstate.done.actor.') || event?.startsWith('xstate.error.actor.'))));
const matches = (transition, row) => within(row.from, transition.from) && eventMatches(transition, row.event)
  && (transition.to === null ? row.to === row.from : transition.to?.some((target) => within(row.to, target)));
const unknown = (reason) => ({ state: 'UNKNOWN', reason, models: [], unauthorized: [], unhandled: [], observations: 0 });
/** Reads trace JSON lines and compares unique machine IDs with the selected snapshot models. */
export function traceInformation(source, models = []) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > 50 * 1024 * 1024) return unknown('Trace exceeds the byte limit.');
  const lines = source.trim().split('\n');
  if (lines.length > 100000) return unknown('Trace exceeds 100000 records.');
  const rows = [], statuses = [];
  for (const line of lines) {
    let value;
    try { value = JSON.parse(line); } catch { return unknown('Trace contains invalid JSON.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return unknown('Invalid trace record.');
    const fields = value.type === 'status' ? ['type', 'state', 'reason'] : ['type', 'machine', 'from', 'event', 'to', 'handled'];
    if (Object.keys(value).some((key) => !fields.includes(key))) return unknown('Unknown trace record field.');
    if (value.type === 'status' && ['KNOWN', 'UNKNOWN'].includes(value.state) && (value.reason === null || text(value.reason))) statuses.push(value);
    else if (value.type === 'transition' && ['machine', 'from', 'to'].every((key) => text(value[key])) && (value.event === null || text(value.event)) && (value.handled === undefined || typeof value.handled === 'boolean')) rows.push(value);
    else return unknown('Invalid trace record.');
  }
  if (!statuses.some((item) => item.state === 'KNOWN')) return unknown(statuses[0]?.reason ?? 'No actor observations.');
  const unsupported = statuses.find((item) => item.state === 'UNKNOWN' && !item.reason?.includes('no supported actor observation'));
  const result = { state: unsupported ? 'PARTIAL' : 'KNOWN', reason: unsupported?.reason ?? null, observations: rows.length,
    models: [], unauthorized: [], unhandled: [], note: 'Information only. Unseen transitions apply only to this run. Trace data is self-reported by project code.' };
  const anonymous = models.some((model) => model.source === 'xstate' && !model.id);
  if (anonymous) { result.state = 'PARTIAL'; result.reason ??= 'An extracted model has no stable runtime machine ID.'; }
  const identities = new Map();
  for (const model of models) {
    const id = model.id ?? model.name;
    identities.set(id, [...(identities.get(id) ?? []), model]);
  }
  for (const model of models) {
    const id = model.id ?? model.name, selected = rows.filter((row) => row.machine === id && row.handled !== false);
    const known = !(model.source === 'xstate' && !model.id) && identities.get(id).length === 1 && model.state === 'KNOWN' && !unsupported;
    result.models.push({ machine: id, file: model.file ?? null, state: known ? 'KNOWN' : 'UNKNOWN',
      reason: known ? null : 'Ambiguous, incomplete or unsupported model observations.',
      unseen: known ? model.transitions.filter((transition) => !selected.some((row) => matches(transition, row))) : [] });
  }
  for (const row of rows) {
    const candidates = identities.get(row.machine) ?? [];
    if (candidates.length > 1 || (candidates[0] && (candidates[0].state !== 'KNOWN' || candidates[0].source === 'xstate' && !candidates[0].id))) continue;
    const model = candidates[0];
    if (row.handled === false) { result.unhandled.push(row); continue; }
    if (model?.transitions.some((transition) => matches(transition, row))) continue;
    if (!model) { if (!anonymous) result.unauthorized.push(row); continue; }
    if (row.from === row.to) result.unhandled.push(row);
    else result.unauthorized.push(row);
  }
  return result;
}
