// Compares the schema inventories of a base analysis and a head analysis. Each change is breaking, compatible or unknown,
// and a Prisma or Drizzle schema change without a new migration in the same change is reported. Pure: no I/O.
// A class is a static reading of the schema text. It is not a test of the data or of the database.
import { canonical } from '../inputs.mjs';

/** The class of each change. Code-map does not classify the other changes, so they are unknown. */
const classes = {
  'entity-removed': 'breaking', 'name-changed': 'breaking', 'field-removed': 'breaking', 'field-added-required': 'breaking', 'type-changed': 'breaking',
  'field-required': 'breaking', 'value-removed': 'breaking', 'entity-added': 'compatible', 'field-added': 'compatible', 'field-optional': 'compatible', 'value-added': 'compatible',
};
const classOrder = ['breaking', 'unknown', 'compatible'], kindOrder = ['prisma', 'drizzle', 'sql', 'json-schema'];
const databaseKinds = new Set(['prisma', 'drizzle', 'sql']);
const empty = { sources: [], entities: [], unread: [], migrations: [] };
/** Drizzle modifiers that give a column a value when an insert has none. A serial builder has a default too. */
const defaults = new Set(['default', 'defaultNow', 'defaultRandom', '$default', '$defaultFn', 'generatedAlwaysAs', 'generatedAlwaysAsIdentity', 'generatedByDefaultAsIdentity', 'autoincrement']);
const serials = new Set(['serial', 'smallserial', 'bigserial']);
const classified = new Set([...defaults, 'notNull', 'primaryKey', 'unique', 'references', 'array']);
const typeNames = { schema: 'JSON Schema' };
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const capital = (text) => text[0].toUpperCase() + text.slice(1);
const segment = (name) => name.replaceAll('~', '~0').replaceAll('/', '~1');

/** True when an analysis found a schema source, an unread schema file or a migration folder. */
export const hasSchemas = (schemas) => !!schemas && schemas.sources.length + schemas.unread.length + schemas.migrations.length > 0;

/** One sentence for a change. */
function describe({ change, kind, type, entity, member, from, to }) {
  const what = `${typeNames[type] ?? type} ${entity}`, json = kind === 'json-schema';
  const part = member === null ? `the ${what}` : `the ${json ? 'property' : type === 'enum' ? 'value' : 'field'} ${member} of the ${what}`;
  const texts = {
    'entity-removed': `The head has no ${what}.`, 'entity-added': `The ${what} is new in the head.`,
    'name-changed': `The database name of ${part} changed from ${from} to ${to}.`, 'field-removed': `The head has no ${part.slice(4)}.`,
    'field-added-required': `${capital(part)} is new. It is required and has no default.`, 'field-added': `${capital(part)} is new. It is ${json ? 'not required' : 'optional or has a default'}.`,
    'type-changed': `The type of ${part} changed from ${from} to ${to}.`, 'field-required': `${capital(part)} became required${json ? '' : ' and has no default'}.`,
    'field-required-default': `${capital(part)} became required. It has a default, but existing rows without a value can stop the migration.`,
    'field-optional': `${capital(part)} became optional.`,
    'value-removed': json ? `The enum of ${part} has no value ${from} in the head.` : `The head has no value ${member} in the ${what}.`,
    'value-added': json ? `The enum of ${part} has the new value ${to}.` : `The value ${member} is new in the ${what}.`,
    'default-changed': `The default of ${part} changed.`, 'relation-changed': `The relation of ${part} changed.`,
    'constraint-changed': json ? `The head adds or removes the enum of ${part}.` : `A key or unique constraint of ${part} changed.`,
    'attributes-changed': `Other attributes of ${part} changed. Code-map does not classify them.`,
    'keywords-changed': `Keywords that Code-map compares only as text changed at ${part}.`,
    'not-parsed': `Code-map cannot read the ${what} in the base or in the head, and its text changed.`,
    'not-compared': `Code-map cannot read all of the schema on one side. Thus it cannot tell whether the head removes or adds the ${what}.`,
  };
  return texts[change];
}

/** Pairs two member lists by name: `removed`, `added` and `both` get the members. */
function pairs(before, after, removed, added, both) {
  const old = new Map(before.map((item) => [item.name, item])), now = new Map(after.map((item) => [item.name, item]));
  for (const [name, item] of old) if (now.has(name)) both(item, now.get(name)); else removed(item);
  for (const [name, item] of now) if (!old.has(name)) added(item);
}

const has = (column, name) => column.modifiers.some((modifier) => modifier.name === name);
const drizzle = {
  type: (column) => `${column.builder}${column.args ? `(${column.args})` : ''}${'[]'.repeat(column.modifiers.filter((modifier) => modifier.name === 'array').length)}`,
  required: (column) => has(column, 'notNull') || has(column, 'primaryKey'),
  defaulted: (column) => serials.has(column.builder) || column.modifiers.some((modifier) => defaults.has(modifier.name)),
  pick: (column, test) => canonical(column.modifiers.filter((modifier) => test(modifier.name))),
};

/**
 * { counts, changes, migrations } for two schema inventories (either can be null). `renames` from Git move a JSON Schema
 * file. `complete` false means that Git can have missed renames: a removed or new JSON Schema file is then unknown.
 * Prisma and Drizzle definitions keep their identity by package and name, so a moved file changes nothing.
 */
export function compareSchemas(base, head, renames = [], complete = true) {
  base = base ?? empty; head = head ?? empty;
  const forward = new Map(renames.map(({ from, to }) => [from, to])), back = new Map(renames.map(({ from, to }) => [to, from]));
  const toHead = (path) => path === null ? null : forward.get(path) ?? path, toBase = (path) => path === null ? null : back.get(path) ?? path;
  const keyOf = (entity, namespace) => JSON.stringify([entity.kind, namespace, entity.type, entity.kind === 'json-schema' ? '' : entity.name]);
  const before = new Map(base.entities.map((entity) => [keyOf(entity, toHead(entity.namespace)), entity])), after = new Map(head.entities.map((entity) => [keyOf(entity, entity.namespace), entity]));
  const lost = (side, kind, namespace) => side.unread.some((entry) => entry.lost && entry.kind === kind && (entry.namespace === null || entry.namespace === namespace));
  const modelOf = (side, namespace, type) => side.entities.find((entity) => entity.kind === 'prisma' && entity.namespace === namespace && entity.type === 'model' && entity.name === type);
  /**
   * A relation field has no column. It still needs a migration when it holds the foreign key, or when it is a list of a
   * many-to-many relation (the other model has a list of this model), because Prisma keeps a join table for that relation.
   */
  const column = (field, side, entity) => {
    const target = modelOf(side, entity.namespace, field.type);
    if (!target || field.foreignKey) return true;
    return field.list && (target.state !== 'read' || target.fields.some((back) => back.list && back.type === entity.name && !(target.name === entity.name && back.name === field.name)));
  };
  const changes = [];
  /** `entity` and `side` tell where the change is: a removed item is in the base, every other one in the head. */
  const record = (change, entity, side, { member = null, line = entity.line, from = null, to = null, needsMigration = databaseKinds.has(entity.kind) } = {}) => {
    const item = { class: classes[change] ?? 'unknown', change, kind: entity.kind, type: entity.type, entity: entity.name, member, from, to, path: entity.path, line: line ?? null, side, needsMigration };
    changes.push({ ...item, text: describe(item), namespace: side === 'base' ? toHead(entity.namespace) : entity.namespace });
  };
  const fields = (old, now) => {
    const required = (field) => !field.optional && !field.list, label = (field) => `${field.type}${field.list ? '[]' : ''}`;
    pairs(old.fields, now.fields, (field) => record('field-removed', old, 'base', { member: field.name, line: field.line, needsMigration: column(field, base, old) }),
      (field) => record(required(field) && field.default === null ? 'field-added-required' : 'field-added', now, 'head', { member: field.name, line: field.line, needsMigration: column(field, head, now) }),
      (f, g) => {
        const at = { member: g.name, line: g.line, needsMigration: column(f, base, old) || column(g, head, now) }, madeRequired = f.list === g.list && !required(f) && required(g);
        if (label(f) !== label(g)) record('type-changed', now, 'head', { ...at, from: label(f), to: label(g) });
        if ((f.map ?? f.name) !== (g.map ?? g.name)) record('name-changed', now, 'head', { ...at, from: f.map ?? f.name, to: g.map ?? g.name });
        if (madeRequired) record(g.default === null ? 'field-required' : 'field-required-default', now, 'head', at);
        else if (f.list === g.list && required(f) && !required(g)) record('field-optional', now, 'head', at);
        if (f.default !== g.default && !(madeRequired && f.default === null)) record('default-changed', now, 'head', at);
        if (f.id !== g.id || f.unique !== g.unique) record('constraint-changed', now, 'head', at);
        if (f.relation !== g.relation) record('relation-changed', now, 'head', at);
        if (canonical(f.attributes) !== canonical(g.attributes)) record('attributes-changed', now, 'head', at);
      });
  };
  const columns = (old, now) => pairs(old.columns, now.columns, (column) => record('field-removed', old, 'base', { member: column.name, line: column.line }),
    (column) => record(drizzle.required(column) && !drizzle.defaulted(column) ? 'field-added-required' : 'field-added', now, 'head', { member: column.name, line: column.line }),
    (f, g) => {
      const at = { member: g.name, line: g.line }, madeRequired = !drizzle.required(f) && drizzle.required(g), defaultsOf = (column) => drizzle.pick(column, (name) => defaults.has(name));
      // Drizzle runs a `$` modifier, such as `$type` or `$defaultFn`, in the application. A change of only these needs no migration.
      const database = (test) => ({ ...at, needsMigration: drizzle.pick(f, (name) => test(name) && !name.startsWith('$')) !== drizzle.pick(g, (name) => test(name) && !name.startsWith('$')) });
      if (drizzle.type(f) !== drizzle.type(g)) record('type-changed', now, 'head', { ...at, from: drizzle.type(f), to: drizzle.type(g) });
      if ((f.column ?? f.name) !== (g.column ?? g.name)) record('name-changed', now, 'head', { ...at, from: f.column ?? f.name, to: g.column ?? g.name });
      if (madeRequired) record(drizzle.defaulted(g) ? 'field-required-default' : 'field-required', now, 'head', at);
      else if (drizzle.required(f) && !drizzle.required(g)) record('field-optional', now, 'head', at);
      if (defaultsOf(f) !== defaultsOf(g) && !(madeRequired && !drizzle.defaulted(f))) record('default-changed', now, 'head', database((name) => defaults.has(name)));
      if (drizzle.pick(f, (name) => name === 'primaryKey' || name === 'unique') !== drizzle.pick(g, (name) => name === 'primaryKey' || name === 'unique')) record('constraint-changed', now, 'head', at);
      if (drizzle.pick(f, (name) => name === 'references') !== drizzle.pick(g, (name) => name === 'references')) record('relation-changed', now, 'head', at);
      if (drizzle.pick(f, (name) => !classified.has(name)) !== drizzle.pick(g, (name) => !classified.has(name))) record('attributes-changed', now, 'head', database((name) => !classified.has(name)));
    });
  const values = (old, now) => pairs(old.values, now.values, (value) => record('value-removed', old, 'base', { member: value.name, line: value.line }),
    (value) => record('value-added', now, 'head', { member: value.name, line: value.line }),
    (v, w) => {
      if ((v.map ?? v.name) !== (w.map ?? w.name)) record('name-changed', now, 'head', { member: w.name, line: w.line, from: v.map ?? v.name, to: w.map ?? w.name });
      if (canonical(v.attributes) !== canonical(w.attributes)) record('attributes-changed', now, 'head', { member: w.name, line: w.line });
    });
  const nodes = (old, now) => {
    const a = new Map(old.nodes.map((node) => [node.pointer, node])), b = new Map(now.nodes.map((node) => [node.pointer, node]));
    const at = (member) => ({ member, line: null, needsMigration: false }), types = (node) => node.type === null ? 'any' : node.type.join('|');
    for (const [pointer, x] of a) {
      const y = b.get(pointer);
      if (!y) { if (x.parent !== null && b.has(x.parent)) record(x.name === null ? 'keywords-changed' : 'field-removed', old, 'base', at(pointer)); continue; }
      if (types(x) !== types(y)) record('type-changed', now, 'head', { ...at(pointer), from: types(x), to: types(y) });
      if (x.enum && y.enum) {
        for (const value of x.enum) if (!y.enum.includes(value)) record('value-removed', now, 'head', { ...at(pointer), from: value });
        for (const value of y.enum) if (!x.enum.includes(value)) record('value-added', now, 'head', { ...at(pointer), to: value });
      } else if (!x.enum !== !y.enum) record('constraint-changed', now, 'head', at(pointer));
      if (x.other !== y.other) record('keywords-changed', now, 'head', { ...at(pointer), from: x.otherKeys.join(', ') || null, to: y.otherKeys.join(', ') || null });
      // A required entry of a new or a removed property is part of that change, so it is not a change of its own.
      const was = new Set(x.required ?? []), is = new Set(y.required ?? []), child = (name) => `${pointer}/properties/${segment(name)}`;
      for (const name of is) if (!was.has(name) && (a.has(child(name)) || !b.has(child(name)))) record('field-required', now, 'head', at(child(name)));
      for (const name of was) if (!is.has(name) && (b.has(child(name)) || !a.has(child(name)))) record('field-optional', now, 'head', at(child(name)));
    }
    for (const [pointer, y] of b) {
      if (a.has(pointer) || y.parent === null || !a.has(y.parent)) continue;
      record(y.name === null ? 'keywords-changed' : (b.get(y.parent).required ?? []).includes(y.name) ? 'field-added-required' : 'field-added', now, 'head', at(pointer));
    }
  };
  for (const [key, old] of before) {
    const now = after.get(key);
    if (!now) { record(lost(head, old.kind, toHead(old.namespace)) || (old.kind === 'json-schema' && !complete) ? 'not-compared' : 'entity-removed', old, 'base'); continue; }
    if (now.digest === old.digest) continue;
    if (old.state !== 'read' || now.state !== 'read') { record('not-parsed', now, 'head'); continue; }
    if ((old.map ?? old.name) !== (now.map ?? now.name) && now.kind === 'prisma') record('name-changed', now, 'head', { from: old.map ?? old.name, to: now.map ?? now.name });
    if (canonical(old.attributes ?? null) !== canonical(now.attributes ?? null) || old.extra !== now.extra) record('attributes-changed', now, 'head');
    if (now.type === 'model') fields(old, now);
    else if (now.type === 'table') columns(old, now);
    else if (now.type === 'enum') values(old, now);
    else if (now.type === 'schema') nodes(old, now);
  }
  for (const [key, now] of after) {
    if (!before.has(key)) record(lost(base, now.kind, toBase(now.namespace)) || (now.kind === 'json-schema' && !complete) ? 'not-compared' : 'entity-added', now, 'head');
  }
  changes.sort((x, y) => classOrder.indexOf(x.class) - classOrder.indexOf(y.class) || kindOrder.indexOf(x.kind) - kindOrder.indexOf(y.kind)
    || order(x.entity, y.entity) || order(x.member ?? '', y.member ?? '') || order(x.change, y.change));
  const count = (name) => changes.filter((item) => item.class === name).length;
  return { counts: { breaking: count('breaking'), compatible: count('compatible'), unknown: count('unknown') },
    changes: changes.map(({ namespace, ...item }) => item), migrations: migrationStates(base, head, changes, { toHead, toBase, lost }) };
}

/**
 * For each Prisma or Drizzle namespace: whether its schema changed, the new migration files of the head, and the state.
 * `schemaChanged` is null when Code-map cannot read all of the schema on one side and cannot tell.
 */
function migrationStates(base, head, changes, { toHead, toBase, lost }) {
  const spaces = new Map();
  const mark = (kind, namespace) => { if (databaseKinds.has(kind) && namespace !== null) spaces.set(JSON.stringify([kind, namespace]), { kind, namespace }); };
  for (const item of [...base.sources, ...base.unread.filter((entry) => entry.lost)]) mark(item.kind, toHead(item.namespace));
  for (const item of [...head.sources, ...head.unread.filter((entry) => entry.lost)]) mark(item.kind, item.namespace);
  const list = [];
  for (const { kind, namespace } of [...spaces.values()].sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || order(a.namespace, b.namespace))) {
    const of = (side, map) => side.migrations.filter((item) => item.kind === kind && map(item.namespace) === namespace);
    const known = new Set(of(base, toHead).flatMap((item) => item.files.map(toHead))), folders = of(head, (path) => path);
    const added = [...new Set(folders.flatMap((item) => item.files))].filter((path) => !known.has(path)).sort();
    const mine = changes.filter((item) => item.kind === kind && item.namespace === namespace);
    const digests = (side, map) => canonical(side.sources.filter((item) => item.kind === kind && map(item.namespace) === namespace).map((item) => item.digest).sort());
    const unsure = mine.some((item) => item.change === 'not-compared')
      || ((lost(base, kind, toBase(namespace)) || lost(head, kind, namespace)) && digests(base, toHead) !== digests(head, (path) => path));
    const schemaChanged = mine.some((item) => item.needsMigration && item.change !== 'not-compared') ? true : unsure ? null : false;
    list.push({ kind, package: namespace, folders: (folders.length ? folders : of(base, toHead)).map((item) => item.folder), schemaChanged, added, addedTotal: added.length,
      state: schemaChanged === false ? 'NO_SCHEMA_CHANGE' : schemaChanged === null ? 'UNKNOWN' : added.length ? 'MIGRATION_ADDED' : 'MIGRATION_MISSING' });
  }
  return list;
}
