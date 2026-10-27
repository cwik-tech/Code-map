// Strict harness input checks. Project code never runs at this boundary.
import { isRelativePath } from '../adapters/run-manifest.mjs';
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const integer = (x, low, high) => Number.isSafeInteger(x) && x >= low && x <= high;
const fail = (path) => { throw new Error(`Invalid harness ${path}. See docs/harness.md.`); };
function fields(x, allowed, path) {
  if (!record(x)) fail(path);
  for (const key of Object.keys(x)) if (!allowed.includes(key)) fail(`${path}.${key}`);
}
function subject(x, path) {
  fields(x, ['file', 'export'], path);
  if (!isRelativePath(x.file) || typeof x.export !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(x.export)) fail(path);
}
function generator(x, depth = 0, budget = { nodes: 0 }) {
  if (depth > 6 || ++budget.nodes > 100) fail('generator depth or size');
  const keys = { integer: ['min', 'max'], string: ['minLength', 'maxLength', 'alphabet'], boolean: [], array: ['minLength', 'maxLength', 'items'], object: ['properties'] };
  if (!record(x) || !Object.hasOwn(keys, x.type)) fail('generator.type');
  fields(x, ['type', ...keys[x.type]], 'generator');
  if (x.type === 'integer' && (!integer(x.min, -1e9, 1e9) || !integer(x.max, x.min, 1e9))) fail('generator range');
  if (['array', 'string'].includes(x.type) && (!integer(x.minLength, 0, 100) || !integer(x.maxLength, x.minLength, 100))) fail('generator length');
  if (x.type === 'string' && (typeof x.alphabet !== 'string' || !x.alphabet.length || x.alphabet.length > 256)) fail('generator alphabet');
  if (x.type === 'array') generator(x.items, depth + 1, budget);
  if (x.type === 'object') {
    if (!record(x.properties) || Object.keys(x.properties).length > 20) fail('generator properties');
    for (const child of Object.values(x.properties)) generator(child, depth + 1, budget);
  }
}
function matchesGenerator(schema, value, budget = { nodes: 0 }) {
  if (++budget.nodes > 10000) return false;
  if (schema.type === 'integer') return integer(value, schema.min, schema.max);
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'string') return typeof value === 'string' && value.length >= schema.minLength && value.length <= schema.maxLength
    && value.split('').every((char) => schema.alphabet.includes(char));
  if (schema.type === 'array') return Array.isArray(value) && value.length >= schema.minLength && value.length <= schema.maxLength
    && Array.from(value).every((item) => matchesGenerator(schema.items, item, budget));
  return record(value) && Object.keys(value).length === Object.keys(schema.properties).length
    && Object.entries(schema.properties).every(([key, child]) => Object.hasOwn(value, key) && matchesGenerator(child, value[key], budget));
}
/** Returns a strict validated spec, with bounded defaults. Throws on every unknown field. */
export function validateSpec(value) {
  const modes = { migrate: ['base', 'fixture', 'package', 'assertions'], differential: ['base', 'inputs', 'ignoreFields'], property: ['generator', 'seed', 'count', 'invariant'],
    fuzz: ['generator', 'seed', 'timeBudgetMs', 'allowedErrors', 'corpus', 'invariant'], 'decision-table': ['table'], 'state-model': ['model'], route: ['contract', 'path'], 'zod-boundaries': [], 'json-boundaries': ['schema'], 'range-boundaries': [], fault: ['inputs', 'fault', 'status', 'mustHandle'] };
  if (!record(value) || !Object.hasOwn(modes, value.mode)) fail('mode');
  fields(value, ['harnessVersion', 'subject', 'mode', 'callTimeoutMs', ...modes[value.mode]], 'spec');
  if (value.harnessVersion !== 1) fail('harnessVersion');
  if (value.mode !== 'migrate') subject(value.subject, 'subject');
  else {
    if (value.subject !== undefined) fail('migrate subject');
    if (!isRelativePath(value.fixture)) fail('fixture');
    if (value.package !== undefined && value.package !== '' && !isRelativePath(value.package)) fail('package');
  }
  if (value.mode === 'migrate' && value.assertions !== undefined) {
    if (!Array.isArray(value.assertions) || !value.assertions.length || value.assertions.length > 100) fail('assertions');
    for (const assertion of value.assertions) {
      fields(assertion, ['query', 'rows'], 'assertion');
      if (typeof assertion.query !== 'string' || assertion.query.length > 10000 || !/^\s*SELECT\b/i.test(assertion.query)) fail('assertion query');
      if (!Array.isArray(assertion.rows) || assertion.rows.length > 1000 || !assertion.rows.every((row) => record(row)
        && Object.values(row).every((x) => x === null || typeof x === 'string' || typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x))))) fail('assertion rows');
    }
    if (Buffer.byteLength(JSON.stringify(value.assertions)) > 200000) fail('assertions size');
  }
  if (value.callTimeoutMs !== undefined && !integer(value.callTimeoutMs, 10, 30000)) fail('callTimeoutMs');
  if (['differential', 'migrate'].includes(value.mode)) {
    if (typeof value.base !== 'string' || !/^[\w/.-]{1,200}$/.test(value.base) || value.base.startsWith('-') || value.base.includes('..')) fail('base');
  }
  if (value.mode === 'differential') {
    if (!isRelativePath(value.inputs)) fail('inputs');
    if (value.ignoreFields !== undefined && (!Array.isArray(value.ignoreFields) || value.ignoreFields.length > 100 || !value.ignoreFields.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 200))) fail('ignoreFields');
  }
  if (['property', 'fuzz'].includes(value.mode)) {
    generator(value.generator);
    if (!integer(value.seed, 0, 0xffffffff)) fail('seed');
  }
  if (value.mode === 'property') {
    if (!integer(value.count, 1, 10000)) fail('count');
    subject(value.invariant, 'invariant');
  }
  if (value.mode === 'fuzz') {
    if (value.invariant !== undefined) subject(value.invariant, 'invariant');
    if (value.corpus !== undefined && (!Array.isArray(value.corpus) || value.corpus.length > 100
      || Buffer.byteLength(JSON.stringify(value.corpus)) > 262144
      || !Array.from(value.corpus).every((input) => matchesGenerator(value.generator, input)))) fail('corpus');
    if (!integer(value.timeBudgetMs, 10, 300000)) fail('timeBudgetMs');
    if (value.allowedErrors !== undefined && (!Array.isArray(value.allowedErrors) || value.allowedErrors.length > 100 || !value.allowedErrors.every((x) => typeof x === 'string' && /^[\w$]{1,100}$/.test(x)))) fail('allowedErrors');
  }
  if (value.mode === 'fault') {
    if (!isRelativePath(value.inputs)) fail('inputs');
    if (!['reject', 'hang', 'status'].includes(value.fault)) fail('fault');
    if (typeof value.mustHandle !== 'boolean') fail('mustHandle');
    if (value.status !== undefined && (value.fault !== 'status' || !integer(value.status, 400, 599))) fail('status');
  }
  if (value.mode === 'json-boundaries' && !isRelativePath(value.schema)) fail('schema');
  if (value.mode === 'decision-table' && !isRelativePath(value.table)) fail('table');
  if (value.mode === 'route' && (!isRelativePath(value.contract) || typeof value.path !== 'string' || !value.path.startsWith('/') || value.path.length > 2000)) fail('route contract or path');
  if (value.mode === 'state-model' && !isRelativePath(value.model)) fail('model');
  return { ...value, callTimeoutMs: value.callTimeoutMs ?? 1000 };
}
