// Resolve repository model inheritance and normalize Pydantic limits to the shared report.
import { settingsReads } from './settings.mjs';
import { posix } from 'node:path';
import { boundaryValues } from '../models/ranges.mjs';

const roots = new Map(['pydantic.BaseModel', 'pydantic.RootModel', 'pydantic.BaseSettings', 'pydantic_settings.BaseSettings',
  'pydantic.v1.BaseModel', 'pydantic.v1.BaseSettings'].map((name) => [name, name.endsWith('BaseSettings') ? 'settings' : 'model']));
const lengthNames = new Map([['min_items', 'min_length'], ['max_items', 'max_length']]);
const ranged = new Map([['gt', ['lower', false]], ['ge', ['lower', true]], ['lt', ['upper', false]], ['le', ['upper', true]],
  ['min_length', ['lower', true]], ['max_length', ['upper', true]]]);

function fieldReport(raw, enums, validators) {
  const field = { ...raw, integer: raw.type !== 'number' || raw.integer, limits: [], unknown: [...raw.unknown], unread: [], values: [] };
  if (enums) { field.type = 'enum'; field.members = enums; field.unknown = field.unknown.filter((x) => !x.startsWith('custom-type:')); }
  for (const validator of validators) if (!validator.fields.length || validator.fields.includes('*') || validator.fields.includes(field.path)) field.unknown.push(`validator:${validator.name}`);
  for (const limit of raw.limits) {
    const check = lengthNames.get(limit.check) ?? limit.check, range = ranged.get(check);
    const numeric = typeof limit.limit === 'number' && Number.isFinite(limit.limit);
    const length = ['min_length', 'max_length'].includes(check);
    if (range && numeric && (length ? ['string', 'array'].includes(field.type) && Number.isSafeInteger(limit.limit) && limit.limit >= 0 : field.type === 'number')) {
      field.limits.push({ ...limit, inclusive: range[1], side: range[0] });
    } else if (check === 'multiple_of' && numeric && limit.limit > 0 && field.type === 'number') {
      field.limits.push({ ...limit, inclusive: null, side: 'multiple' });
    } else {
      field.limits.push({ ...limit, inclusive: null });
      if (!['const', 'multiple_of'].includes(check)) field.unread.push(check);
      if (range || check === 'multiple_of' && (!numeric || limit.limit <= 0)) field.unknown.push(`invalid-limit:${check}`);
    }
  }
  const rangeField = { ...field, limits: field.limits.filter((x) => x.side), integer: field.type === 'number' ? field.integer : true };
  field.values = boundaryValues(rangeField);
  if (field.members.length) {
    if (field.limits.some((l) => l.check !== 'const')) field.unread.push('member-constraints');
    field.values = field.members.map((value) => ({ value, near: [{ check: 'enum', limit: null, position: 'member' }], expected: field.unknown.length || field.unread.length ? null : 'valid' }));
    field.type = 'enum';
  }
  field.state = field.unknown.length ? 'UNKNOWN' : field.unread.length ? 'PARTIAL' : 'KNOWN';
  field.limits = field.limits.map(({ side: _, ...limit }) => limit);
  return field;
}

/** Resolve only unique local classes. An unknown or cyclic base never becomes a model. */
export function attachPythonModels(files) {
  const owners = new Map(), entries = new Map(), classes = new Map(), modules = new Map(files.map((f) => [f.python.module, f]));
  for (const file of files) for (const model of file.python.pydantic.classes) {
    const entry = { file, model }, key = `${file.python.module}.${model.name}`;
    entries.set(model, entry);
    if (!model.nested) classes.set(key, classes.has(key) ? null : entry);
    for (const field of model.fields) owners.set(field, file);
  }
  const localName = (file, name) => {
    if (!name.startsWith('.')) return classes.has(`${file.python.module}.${name}`) ? `${file.python.module}.${name}` : name;
    const dots = /^\.+/.exec(name)[0].length, own = (file.python.module ?? '').split('.');
    if (posix.basename(file.path) !== '__init__.py') own.pop();
    return [...own.slice(0, own.length - dots + 1), name.slice(dots)].join('.');
  };
  const seen = new Map();
  const resolve = (entry, visiting = new Set()) => {
    if (!entry) return null;
    if (seen.has(entry)) return seen.get(entry);
    if (visiting.has(entry) || visiting.size >= 100) return null;
    const trail = new Set([...visiting, entry]);
    const { file, model } = entry, parents = model.bases.map((base) => roots.has(base) ? { kind: roots.get(base), fields: [], validators: [], config: {}, configUnknown: [] }
      : classes.has(localName(file, base)) ? resolve(classes.get(localName(file, base)), trail) : null);
    if ((!model.dataclass && !parents.some(Boolean)) || parents.some((p) => p === null)) return null;
    const fields = new Map(parents.flatMap((p) => p.fields).map((f) => [f.path, f]));
    for (const field of model.fields) fields.set(field.path, field);
    const result = { kind: parents.some((p) => p.kind === 'settings') ? 'settings' : 'model', fields: [...fields.values()],
      validators: [...parents.flatMap((p) => p.validators), ...model.validators], config: Object.assign({}, ...parents.map((p) => p.config), model.config),
      configUnknown: [...parents.flatMap((p) => p.configUnknown), ...model.configUnknown] };
    seen.set(entry, result);
    return result;
  };
  const enumOf = (file, name) => {
    const enums = file.python.pydantic.enums, own = Object.hasOwn(enums, name) ? enums[name] : undefined;
    if (own) return own;
    const full = localName(file, name), dot = full.lastIndexOf('.');
    const imported = modules.get(full.slice(0, dot))?.python.pydantic.enums, member = full.slice(dot + 1);
    return imported && Object.hasOwn(imported, member) ? imported[member] : undefined;
  };
  for (const file of files) {
    const schemas = [], errors = [];
    const originOf = (field) => ({ file: (owners.get(field) ?? file).path, line: field.line });
    const locationOf = (field, model) => {
      const origin = originOf(field);
      return { line: origin.file === file.path ? origin.line : model.line, origin };
    };
    for (const model of file.python.pydantic.classes) {
      const result = !model.nested && classes.get(`${file.python.module}.${model.name}`) === null ? null : resolve(entries.get(model));
      if (!result) {
        if (file.python.pydantic.imported && model.bases.length && model.fields.length && !model.bases.some((b) => b.startsWith('enum.'))) errors.push({
          path: file.path, name: model.name, line: model.line, kind: 'pydantic', state: 'UNKNOWN', reason: 'unresolved-model-base',
          problems: [{ path: model.name, message: 'A base class cannot be resolved to a model from static facts.' }] });
        continue;
      }
      schemas.push({ name: model.name, line: model.line, exported: !model.name.startsWith('_'), source: 'pydantic', language: 'python',
        fields: result.fields.map((f) => ({ ...fieldReport(f, enumOf(owners.get(f) ?? file, f.annotation), result.validators), ...locationOf(f, model) })) });
      if (result.kind === 'settings') file.env.push(...settingsReads(result, (field) => {
        const owner = owners.get(field) ?? file, entry = classes.get(localName(owner, field.annotation));
        return entry ? resolve(entry) : null;
      }, (field) => locationOf(field, model)));
    }
    file.models = schemas.length || errors.length ? { schemas, machines: [], errors } : null;
  }
}
