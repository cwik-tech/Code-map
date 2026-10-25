// Validate the complete new extractor boundary before facts enter the shared reports.
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strings = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');
const scalar = (v) => v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v);
const nullableString = (v) => v === null || typeof v === 'string';
const field = (v) => record(v) && typeof v.path === 'string' && Number.isInteger(v.line) && typeof v.type === 'string'
  && typeof v.integer === 'boolean' && typeof v.annotation === 'string' && strings(v.unknown) && strings(v.versions)
  && Array.isArray(v.members) && v.members.every(scalar) && nullableString(v.alias) && nullableString(v.validation_alias)
  && Array.isArray(v.limits) && v.limits.every((l) => record(l) && typeof l.check === 'string' && scalar(l.limit));
export const validPydantic = (v) => record(v) && typeof v.imported === 'boolean' && record(v.imports) && Object.values(v.imports).every((s) => typeof s === 'string')
  && record(v.enums) && Object.values(v.enums).every((e) => Array.isArray(e) && e.every(scalar)) && Array.isArray(v.classes)
  && v.classes.every((c) => record(c) && typeof c.name === 'string' && Number.isInteger(c.line) && strings(c.bases) && typeof c.dataclass === 'boolean'
    && (c.nested === undefined || typeof c.nested === 'boolean')
    && Array.isArray(c.fields) && c.fields.every(field) && record(c.config) && Object.values(c.config).every(scalar) && strings(c.configUnknown)
    && Array.isArray(c.validators) && c.validators.every((x) => record(x) && typeof x.name === 'string' && strings(x.fields)));
export const validSettings = (v) => record(v) && Array.isArray(v.reads) && v.reads.every((r) => record(r) && nullableString(r.name)
  && Number.isInteger(r.line) && typeof r.via === 'string' && typeof r.form === 'string') && record(v.literals)
  && (v.literals.booleans === undefined || Array.isArray(v.literals.booleans) && v.literals.booleans.every((x) => typeof x === 'boolean'))
  && (v.literals.nulls === undefined || Array.isArray(v.literals.nulls) && v.literals.nulls.every((x) => x === null))
  && ['numbers', 'strings', 'stringLengths', 'arrayLengths'].every((key) => Array.isArray(v.literals[key])
    && v.literals[key].every((x) => key === 'strings' ? typeof x === 'string' : typeof x === 'number' && Number.isFinite(x)));
