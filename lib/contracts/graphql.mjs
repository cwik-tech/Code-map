// Bounded GraphQL SDL subset. A partial type is never reported as known.
import { tokens, cursor } from './tokens.mjs';
const definitions = new Set(['type', 'input', 'enum', 'union', 'scalar', 'interface', 'extend', 'schema', 'directive']);
function typeOf(c, depth = 0) {
  if (depth > 32) throw new Error('type-depth');
  let value;
  if (c.peek() === '[') { c.take(); value = `[${typeOf(c, depth + 1)}]`; c.expect(']'); }
  else value = c.name();
  if (c.peek() === '!') value += c.take();
  return value;
}
function defaultOf(c) {
  if (c.peek() !== '=') return false;
  c.take();
  // Only scalar defaults belong to this subset. Object and list defaults stay UNKNOWN.
  const value = c.take();
  if (!/^(?:"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?|[A-Za-z_]\w*)$/.test(value ?? '')) throw new Error('unsupported-default');
  return true;
}
function fieldsOf(items, input) {
  const c = cursor(items), fields = [];
  while (c.more()) {
    if (c.peek().startsWith('"')) c.take();
    const name = c.name(), args = [];
    if (c.peek() === '(' && !input) {
      c.take();
      while (c.more() && c.peek() !== ')') {
        const name = c.name(); c.expect(':'); const type = typeOf(c), hasDefault = defaultOf(c);
        args.push({ name, type, required: type.endsWith('!') && !hasDefault });
      }
      c.expect(')');
    }
    c.expect(':'); const type = typeOf(c), hasDefault = input ? defaultOf(c) : false;
    if (fields.some((x) => x.name === name) || new Set(args.map((x) => x.name)).size !== args.length) throw new Error('duplicate-field');
    fields.push({ name, type, args, required: input && type.endsWith('!') && !hasDefault });
  }
  return fields;
}
/** Read types, inputs, enums and unions. Other constructs give UNKNOWN entries. */
export function parseGraphql(text) {
  const c = cursor(tokens(text)), types = [], gaps = [];
  while (c.more()) {
    if (c.peek().startsWith('"')) { c.take(); continue; }
    let kind = c.take(), name, extended = false;
    if (kind === 'extend') { extended = true; kind = c.take(); }
    try { name = c.name(); } catch { gaps.push('unsupported-definition'); break; }
    const item = { kind, name, state: 'KNOWN', fields: [], values: [] };
    let bounded = false;
    try {
      if (kind === 'scalar') {
        item.state = 'UNKNOWN'; bounded = true;
      } else if (kind === 'union') {
        c.expect('='); if (c.peek() === '|') c.take();
        item.values.push(c.name());
        while (c.peek() === '|') { c.take(); item.values.push(c.name()); }
        bounded = true;
      } else {
        let unsupported = false;
        while (c.more() && c.peek() !== '{') {
          if (definitions.has(c.peek())) throw new Error('missing-type-body');
          unsupported = true; c.take();
        }
        const body = c.block(); bounded = true;
        if (unsupported || !['type', 'input', 'enum'].includes(kind)) throw new Error('unsupported-definition');
        if (kind === 'enum') {
          const values = cursor(body);
          while (values.more()) { if (values.peek().startsWith('"')) values.take(); item.values.push(values.name()); }
          if (new Set(item.values).size !== item.values.length) throw new Error('duplicate-enum');
        } else item.fields = fieldsOf(body, kind === 'input');
      }
      if (c.peek() === '@') {
        item.state = 'UNKNOWN'; c.take();
        while (c.more() && !definitions.has(c.peek())) c.take();
      }
      if (extended) throw new Error('extension');
    } catch { item.state = 'UNKNOWN'; if (!bounded) gaps.push('unsupported-definition'); }
    const previous = types.find((x) => x.name === name);
    if (previous) previous.state = 'UNKNOWN';
    else types.push(item);
  }
  return { format: 'graphql', types, gaps };
}
