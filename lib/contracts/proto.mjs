// Bounded Protocol Buffers definitions. Nested declarations and options stay UNKNOWN.
import { tokens, cursor } from './tokens.mjs';
function numbered(c) {
  const value = c.take();
  if (!/^\d+$/.test(value ?? '') || !Number.isSafeInteger(Number(value))) throw new Error('invalid-number');
  return Number(value);
}
function bodyOf(item, body) {
  const c = cursor(body);
  while (c.more()) {
    if (c.peek() === 'reserved' && item.kind === 'message') {
      c.take();
      while (c.more() && c.peek() !== ';') {
        if (/^"/.test(c.peek())) item.reservedNames.push(JSON.parse(c.take()));
        else {
          const from = numbered(c); let to = from;
          if (c.peek() === 'to') { c.take(); to = c.peek() === 'max' ? (c.take(), 536870911) : numbered(c); }
          if (to < from) throw new Error('invalid-reserved');
          item.reserved.push([from, to]);
        }
      }
      c.expect(';'); continue;
    }
    if (item.kind === 'service') {
      c.expect('rpc'); const name = c.name(); c.expect('(');
      const request = c.take(); c.expect(')'); c.expect('returns'); c.expect('(');
      const response = c.take(); c.expect(')'); c.expect(';');
      item.methods.push({ name, request, response }); continue;
    }
    if (item.kind === 'enum') {
      const name = c.name(); c.expect('='); const number = numbered(c); c.expect(';');
      item.values.push({ name, number }); continue;
    }
    let label = '';
    if (['optional', 'required', 'repeated'].includes(c.peek())) label = c.take();
    const type = c.take();
    if (!/^\.?[A-Za-z_][\w.]*$/.test(type ?? '')) throw new Error('unsupported-type');
    const name = c.name(); c.expect('='); const number = numbered(c); c.expect(';');
    if (number < 1 || number > 536870911 || (number >= 19000 && number <= 19999)) throw new Error('invalid-field-number');
    item.fields.push({ name, number, type: `${label ? label + ' ' : ''}${type}` });
  }
  const entries = item.kind === 'enum' ? item.values : item.kind === 'service' ? item.methods : item.fields;
  if (new Set(entries.map((x) => x.name)).size !== entries.length) throw new Error('duplicate-name');
  item.conflicts = item.fields.filter((field, index) => item.fields.slice(0, index).some((x) => x.number === field.number)).map((x) => x.number);
  if (item.kind === 'message' && (new Set(item.fields.map((x) => x.number)).size !== item.fields.length
    || item.fields.some((x) => item.reservedNames.includes(x.name) || item.reserved.some(([a, b]) => x.number >= a && x.number <= b)))) throw new Error('reused-number');
}
/** Read messages, numbered enum values and unary service methods. */
export function parseProto(text) {
  const c = cursor(tokens(text)), types = [], gaps = [];
  while (c.more()) {
    const kind = c.take();
    if (['syntax', 'package', 'import', 'option'].includes(kind)) {
      while (c.more() && c.take() !== ';') { /* File metadata does not define a field. */ }
      continue;
    }
    let name;
    try { name = c.name(); } catch { gaps.push('unsupported-definition'); break; }
    const item = { kind, name, state: 'KNOWN', fields: [], values: [], methods: [], reserved: [], reservedNames: [] };
    let bounded = false;
    try {
      const body = c.block(); bounded = true;
      if (!['message', 'enum', 'service'].includes(kind)) throw new Error('unsupported-definition');
      bodyOf(item, body);
    } catch { item.state = 'UNKNOWN'; if (!bounded) gaps.push('unsupported-definition'); }
    const previous = types.find((x) => x.name === name);
    if (previous) previous.state = 'UNKNOWN'; else types.push(item);
  }
  return { format: 'proto', types, gaps };
}
