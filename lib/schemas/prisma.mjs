// Reads one Prisma schema file: its models and enums, with their fields, values and attributes. A small parser for this
// grammar only. It runs no code. A statement that it does not understand makes its block UNKNOWN, so a comparison never
// reads a wrong model. Text outside a known block is unread and marks the file as incomplete (`lost`).
import { digest, lineFinder } from './shared.mjs';

const header = /([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*\{/y, space = /\s*/y;
/** The field attributes that a comparison classifies. Each one can occur only one time on a field. */
const classified = ['id', 'default', 'unique', 'relation', 'map'];
const opens = '([{', closes = ')]}';

/** The text without comments. Each comment character becomes a space, so offsets and line numbers stay the same. */
function withoutComments(text) {
  const out = [];
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      out.push(char);
      if (char === '\\' && index + 1 < text.length && text[index + 1] !== '\n') out.push(text[++index]);
      else if (char === '"' || char === '\n') quoted = false;
    } else if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') { out.push(' '); index++; }
      if (index < text.length) out.push('\n');
    } else { out.push(char); quoted = char === '"'; }
  }
  return out.join('');
}

/** The offset after the bracket that closes the one at `open`, or -1. With `braces`, only braces count. Strings can hold brackets. */
function after(text, open, braces = false) {
  let depth = 0, quoted = false;
  for (let index = open; index < text.length; index++) {
    const char = text[index];
    if (quoted) { if (char === '\\') index++; else if (char === '"' || (braces && char === '\n')) quoted = false; }
    else if (char === '"') quoted = true;
    else if (braces ? char === '{' : opens.includes(char)) depth++;
    else if ((braces ? char === '}' : closes.includes(char)) && --depth === 0) return index + 1;
  }
  return -1;
}

/** The statements of a block body: one for each line, but a line break inside brackets or a string does not end one. */
function statements(body, start) {
  const list = [];
  let depth = 0, quoted = false, from = 0;
  const end = (to) => {
    const text = body.slice(from, to), trimmed = text.trim();
    if (trimmed) list.push({ text: trimmed, offset: start + from + text.length - text.trimStart().length });
  };
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (quoted) { if (char === '\\') index++; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if (opens.includes(char)) depth++;
    else if (closes.includes(char)) depth--;
    else if (char === '\n' && depth <= 0) { end(index); from = index + 1; depth = 0; }
  }
  end(body.length);
  return list;
}

/** Spaces outside strings are not part of an argument. */
const compact = (text) => text.replace(/"(?:[^"\\]|\\.)*"|\s+/g, (match) => match.startsWith('"') ? match : '');

/** The attributes in `text` (each `@name` or `@@name`, with optional arguments), or null when other text is there. */
function attributesOf(text, prefix) {
  const list = [], name = /[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/y;
  for (let index = 0; ;) {
    while (/\s/.test(text[index] ?? '')) index++;
    if (index >= text.length) return list;
    if (!text.startsWith(prefix, index) || text[index + prefix.length] === '@') return null;
    name.lastIndex = index + prefix.length;
    const found = name.exec(text);
    if (!found) return null;
    index = name.lastIndex;
    let args = null;
    if (text[index] === '(') {
      const end = after(text, index);
      if (end < 0) return null;
      args = compact(text.slice(index + 1, end - 1));
      index = end;
    }
    list.push({ name: found[0], args });
  }
}

/** An attribute that a comparison does not classify keeps its name. Its arguments become a digest. */
const shown = (attribute, prefix) => `${prefix}${attribute.name}${attribute.args === null ? '' : `(${digest(attribute.args)})`}`;

/** The name in `@map("x")` or `@map(name: "x")`, or undefined when the argument is not one string. */
function mapName(args) {
  const match = /^(?:name:)?("(?:[^"\\]|\\.)*")$/.exec(args ?? '');
  if (!match) return undefined;
  try { return JSON.parse(match[1]); } catch { return match[1].slice(1, -1); }
}

/** The arguments of the `@relation` attribute without the text of its strings, so that a relation name cannot look like an argument. */
const relationArgs = (attributes) => (attributes.find((attribute) => attribute.name === 'relation')?.args ?? '').replace(/"(?:[^"\\]|\\.)*"/g, '""');

/** A field: name, type (with `Unsupported("…")`), `[]` or `?`, and attributes. Null when the statement is not a field. */
function fieldOf(text) {
  const head = /^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)/.exec(text);
  if (!head) return null;
  let index = head[0].length, type = head[2];
  if (text[index] === '(') {
    const end = after(text, index);
    if (end < 0) return null;
    type += compact(text.slice(index, end));
    index = end;
  }
  const list = text.startsWith('[]', index);
  if (list) index += 2;
  const optional = text[index] === '?';
  if (optional) index++;
  if ((list && optional) || (index < text.length && !/[\s@]/.test(text[index]))) return null;
  const attributes = attributesOf(text.slice(index), '@');
  if (!attributes) return null;
  const field = { name: head[1], type, list, optional, id: null, unique: null, default: null, relation: null, foreignKey: false, map: null, attributes: [] };
  for (const attribute of attributes) {
    if (!classified.includes(attribute.name)) field.attributes.push(shown(attribute, '@'));
    else if (field[attribute.name] !== null) return null;
    else if (attribute.name === 'map') { field.map = mapName(attribute.args) ?? null; if (field.map === null) return null; }
    else field[attribute.name] = attribute.args === null ? '' : digest(attribute.args);
  }
  // The side of a relation with `fields:` or `references:` holds the foreign key, so a change of it changes the database.
  field.foreignKey = field.relation !== null && /(?:^|,)(?:fields|references):/.test(relationArgs(attributes));
  return field;
}

/** Adds a block attribute (`@@map` or another one) to the entity. False when the statement is not one block attribute. */
function blockAttribute(entity, text) {
  const list = attributesOf(text, '@@');
  if (!list || list.length !== 1) return false;
  if (list[0].name !== 'map') { entity.attributes.push(shown(list[0], '@@')); return true; }
  const name = mapName(list[0].args);
  if (name === undefined || entity.map !== null) return false;
  entity.map = name;
  return true;
}

/** A model or an enum. The first statement that the parser does not understand makes the whole block UNKNOWN. */
function block(type, name, list, line, at) {
  const entity = { type, name, line, state: 'read', reason: null, map: null, attributes: [], ...(type === 'model' ? { fields: [] } : { values: [] }) };
  for (const statement of list) {
    const member = statement.text.startsWith('@@') ? null : type === 'model' ? fieldOf(statement.text) : valueOf(statement.text);
    const members = entity.fields ?? entity.values;
    const read = member === null ? statement.text.startsWith('@@') && blockAttribute(entity, statement.text) : !members.some((item) => item.name === member.name);
    if (!read) return { ...entity, state: 'unknown', reason: 'unknown-statement', problemLine: at(statement.offset), map: null, attributes: [], [type === 'model' ? 'fields' : 'values']: [] };
    if (member) members.push({ ...member, line: at(statement.offset) });
  }
  return entity;
}

/** An enum value with an optional `@map`. Null when the statement is not one value. */
function valueOf(text) {
  const head = /^[A-Za-z_]\w*/.exec(text), attributes = head && attributesOf(text.slice(head[0].length), '@');
  if (!attributes) return null;
  const value = { name: head[0], map: null, attributes: [] };
  for (const attribute of attributes) {
    if (attribute.name !== 'map') value.attributes.push(shown(attribute, '@'));
    else if (value.map !== null || mapName(attribute.args) === undefined) return null;
    else value.map = mapName(attribute.args);
  }
  return value;
}

/**
 * The models and enums of one Prisma file, and the text that it cannot read. Datasource and generator blocks have no
 * schema. A view or a composite type is UNKNOWN. Each entity has a digest of its text without comments and extra spaces.
 */
export function parsePrisma(text) {
  const clean = withoutComments(text), at = lineFinder(text), entities = [], unread = [];
  // One unread entry for each run of lines outside a block, so that a file of stray lines gives one entry, not one for each line.
  let stray = false;
  for (let index = 0; ;) {
    space.lastIndex = index; space.exec(clean); index = space.lastIndex;
    if (index >= clean.length) break;
    header.lastIndex = index;
    const match = header.exec(clean);
    if (!match) {
      if (!stray) unread.push({ line: at(index), reason: 'unknown-text', lost: true });
      stray = true;
      const end = clean.indexOf('\n', index);
      index = end < 0 ? clean.length : end + 1;
      continue;
    }
    stray = false;
    const [, keyword, name] = match, open = header.lastIndex - 1, close = after(clean, open, true), line = at(index);
    if (close < 0) { unread.push({ line, entity: name, reason: 'unbalanced-block', lost: true }); break; }
    index = close;
    if (keyword === 'datasource' || keyword === 'generator') continue;
    const body = clean.slice(open + 1, close - 1), sign = digest(`${keyword} ${body.replace(/\s+/g, ' ').trim()}`);
    if (keyword === 'model' || keyword === 'enum') entities.push({ ...block(keyword, name, statements(body, open + 1), line, at), digest: sign });
    else if (keyword === 'view' || keyword === 'type') entities.push({ type: keyword, name, line, state: 'unknown', reason: 'unsupported-block', digest: sign });
    else unread.push({ line, entity: name, keyword, reason: 'unknown-block', lost: true });
  }
  return { entities, unread };
}
