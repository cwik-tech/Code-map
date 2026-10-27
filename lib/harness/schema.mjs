// Bounded JSON contract checks. Unsupported rules always retain UNKNOWN evidence.
import { isDeepStrictEqual } from 'node:util';
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const annotations = ['title', 'description', 'example', 'examples', 'default', '$schema', '$id', 'deprecated', 'readOnly', 'writeOnly'];
const supported = ['type', 'nullable', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'items', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems'];
const bounds = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems'];
const types = ['object', 'array', 'integer', 'number', 'string', 'boolean', 'null'];
const matches = (value, type) => type === 'object' ? record(value) : type === 'array' ? Array.isArray(value)
  : type === 'integer' ? Number.isInteger(value) : type === 'null' ? value === null : typeof value === type;
const equal = isDeepStrictEqual;
function unsupported(schema, depth = 0, budget = { nodes: 0 }) {
  if (!record(schema) || depth > 20 || ++budget.nodes > 2000) return true;
  if (Object.keys(schema).some((key) => !supported.includes(key) && !annotations.includes(key))) return true;
  if (schema.type !== undefined && !types.includes(schema.type)) return true;
  if (schema.nullable !== undefined && typeof schema.nullable !== 'boolean') return true;
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length)) return true;
  if (schema.required !== undefined && (!Array.isArray(schema.required) || !schema.required.every((x) => typeof x === 'string'))) return true;
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') return true;
  for (const key of bounds) {
    if (schema[key] === undefined) continue;
    if (typeof schema[key] !== 'number' || !Number.isFinite(schema[key])
      || (/^(min|max)(Length|Items)$/.test(key) && (!Number.isSafeInteger(schema[key]) || schema[key] < 0))) return true;
  }
  if (schema.properties !== undefined && (!record(schema.properties) || Object.values(schema.properties).some((x) => unsupported(x, depth + 1, budget)))) return true;
  return schema.items !== undefined && unsupported(schema.items, depth + 1, budget);
}
/** Validate supported scalar and nested JSON rules with a fixed traversal budget. */
export function schemaProblems(schema, value, path = '', depth = 0, budget = { nodes: 0 }) {
  const unknown = 'UNKNOWN:unsupported-response-schema';
  if (depth > 20 || ++budget.nodes > 2000 || !record(schema)) return [unknown];
  const problems = unsupported(schema) ? [unknown] : [];
  if (Object.keys(schema).some((key) => !supported.includes(key) && !annotations.includes(key))) problems.push(unknown);
  if (schema.type !== undefined && !types.includes(schema.type)) return [...problems, unknown];
  if (schema.nullable !== undefined && typeof schema.nullable !== 'boolean') problems.push(unknown);
  if (schema.type && !(schema.nullable && value === null) && !matches(value, schema.type)) return [...problems, `field-type:${path}`];
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum)) problems.push(unknown);
    else if (!schema.enum.some((item) => equal(item, value))) problems.push(`enum:${path}`);
  }
  if (Object.hasOwn(schema, 'const') && !equal(schema.const, value)) problems.push(`const:${path}`);
  for (const key of bounds) {
    if (schema[key] === undefined) continue;
    const limit = schema[key];
    if (typeof limit !== 'number' || !Number.isFinite(limit) || (/^(min|max)(Length|Items)$/.test(key) && (!Number.isSafeInteger(limit) || limit < 0))) { problems.push(unknown); continue; }
    const measure = key.endsWith('Length') ? (typeof value === 'string' ? [...value].length : null) : key.endsWith('Items') ? (Array.isArray(value) ? value.length : null) : typeof value === 'number' ? value : null;
    if (measure !== null && (key === 'exclusiveMinimum' ? measure <= limit : key === 'exclusiveMaximum' ? measure >= limit : key.startsWith('min') ? measure < limit : measure > limit)) problems.push(`${key}:${path}`);
  }
  if (schema.properties !== undefined && !record(schema.properties)) problems.push(unknown);
  if (schema.required !== undefined && (!Array.isArray(schema.required) || !schema.required.every((x) => typeof x === 'string'))) problems.push(unknown);
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') problems.push(unknown);
  if (record(value)) {
    if (Array.isArray(schema.required)) for (const name of schema.required) if (!Object.hasOwn(value, name)) problems.push(`missing-field:${path ? path + '.' : ''}${name}`);
    if (record(schema.properties)) for (const [name, field] of Object.entries(schema.properties)) {
      if (Object.hasOwn(value, name)) problems.push(...schemaProblems(field, value[name], path ? `${path}.${name}` : name, depth + 1, budget));
    }
    if (schema.additionalProperties === false) for (const name of Object.keys(value)) if (!Object.hasOwn(schema.properties ?? {}, name)) problems.push(`extra-field:${path ? path + '.' : ''}${name}`);
  }
  if (Array.isArray(value) && schema.items !== undefined) for (const item of value) problems.push(...schemaProblems(schema.items, item, `${path}[]`, depth + 1, budget));
  return [...new Set(problems)];
}
