// Every file key is required. Register each new extractor key here.
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strings = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');
const definition = (v) => record(v) && typeof v.name === 'string' && ['class', 'function', 'method'].includes(v.kind)
  && typeof v.async === 'boolean' && Number.isInteger(v.start) && Number.isInteger(v.end) && strings(v.decorators)
  && (v.complexity === null || record(v.complexity) && Number.isInteger(v.complexity.cyclomatic) && Number.isInteger(v.complexity.nesting))
  && Array.isArray(v.children) && v.children.every(definition);
const imports = (v) => Array.isArray(v) && v.every((i) => record(i)
  && Number.isInteger(i.level) && (i.module === null || typeof i.module === 'string') && strings(i.names) && Number.isInteger(i.line) && typeof i.dynamic === 'boolean' && typeof i.optional === 'boolean');
const errors = (v) => Array.isArray(v) && v.every((e) => record(e) && Number.isInteger(e.line) && typeof e.message === 'string');
const cases = (v) => Array.isArray(v) && v.every((c) => record(c) && typeof c.name === 'string' && typeof c.suite === 'string'
  && Number.isInteger(c.line) && ['active', 'skipped', 'conditional', 'expected-failure'].includes(c.status)
  && typeof c.expectedFailure === 'boolean' && (c.each === null || Number.isInteger(c.each)) && Number.isInteger(c.assertions)
  && Array.isArray(c.failures) && c.failures.length === 0 && Array.isArray(c.references) && c.references.length === 0 && strings(c.smells));
const validators = {
  path: (v) => typeof v === 'string',
  imports,
  definitions: (v) => Array.isArray(v) && v.every(definition),
  all: (v) => v === null || strings(v),
  names: strings,
  cases,
  errors,
};

export function validFile(value) {
  return record(value) && Object.keys(value).length === Object.keys(validators).length
    && Object.entries(validators).every(([key, validate]) => Object.hasOwn(value, key) && validate(value[key]));
}
