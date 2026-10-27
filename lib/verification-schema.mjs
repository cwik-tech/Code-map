// Validates the stored contract with the bundled JSON Schema. No remote reference is loaded.
import { readFileSync } from 'node:fs';
import { validateObligation, exitCode } from './ratings.mjs';

const resultsSchema = JSON.parse(readFileSync(new URL('../schemas/verification-results-v1.schema.json', import.meta.url), 'utf8'));
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const matches = (value, type) => type === 'null' ? value === null : type === 'array' ? Array.isArray(value)
  : type === 'object' ? record(value) : type === 'integer' ? Number.isInteger(value) : typeof value === type;

// This interpreter supports exactly the vocabulary used by the bundled schema.
function check(value, schema, path, errors) {
  const error = (message) => errors.push({ path, message });
  if (schema === false) { error('This field is forbidden.'); return; }
  if (schema.$ref) return check(value, resultsSchema.$defs[schema.$ref.slice('#/$defs/'.length)], path, errors);
  if (schema.const !== undefined && !equal(value, schema.const)) error(`Must equal ${JSON.stringify(schema.const)}.`);
  if (schema.enum && !schema.enum.some((item) => equal(value, item))) error('Invalid enum value.');
  if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).some((type) => matches(value, type))) {
    error(`Must have type ${schema.type}.`); return;
  }
  if (typeof value === 'number' && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) error('Number is outside the allowed range.');
  if (typeof value === 'string' && value.length < (schema.minLength ?? 0)) error('Text is empty.');
  if (Array.isArray(value) && schema.items) value.forEach((item, index) => check(item, schema.items, `${path}[${index}]`, errors));
  if (!record(value)) return;
  for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push({ path: `${path}.${key}`, message: 'Required field is missing.' });
  for (const [key, item] of Object.entries(value)) {
    if (Object.hasOwn(schema.properties ?? {}, key)) check(item, schema.properties[key], `${path}.${key}`, errors);
    else if (schema.additionalProperties === false) errors.push({ path: `${path}.${key}`, message: 'Unknown field.' });
    else if (record(schema.additionalProperties)) check(item, schema.additionalProperties, `${path}.${key}`, errors);
  }
}

/** Checks the JSON contract and the obligation and rating state invariants. */
export function validateResults(value) {
  const errors = [];
  check(value, resultsSchema, 'results', errors);
  if (errors.length) return { ok: false, errors };
  for (const [index, item] of value.obligations.entries()) {
    errors.push(...validateObligation(item).errors?.map((error) => ({ ...error, path: `results.obligations[${index}].${error.path}` })) ?? []);
  }
  for (const [category, rating] of Object.entries(value.ratings)) {
    if ((rating.state === 'RATED') !== (rating.value !== null)) errors.push({ path: `results.ratings.${category}`, message: 'Only RATED has a numeric band.' });
  }
  if (value.rubric && (value.rubric.profileId !== value.profileId || value.rubric.ratingRulesVersion !== value.ratingRulesVersion)) {
    errors.push({ path: 'results.rubric', message: 'Rubric identity differs from the results.' });
  }
  if (value.readiness.exitCode !== exitCode(value.readiness.state)) errors.push({ path: 'results.readiness.exitCode', message: 'Exit code differs from readiness.' });
  if (value.ratingComparison) for (const [id, item] of Object.entries(value.ratingComparison.categories)) {
    const compared = item.state === 'COMPARED', numeric = Number.isInteger(item.base) && Number.isInteger(item.head);
    const direction = item.head > item.base ? 'UP' : item.head < item.base ? 'DOWN' : 'SAME';
    if (compared && (value.ratingComparison.state !== 'COMPARABLE' || !numeric || item.direction !== direction)
      || !compared && (!item.reason || item.direction !== undefined)) {
      errors.push({ path: `results.ratingComparison.categories.${id}`, message: 'Comparison state, bands, direction and reason must agree.' });
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Refuses invalid persisted input before publication or use. */
export function requireResults(value) {
  const checked = validateResults(value);
  if (!checked.ok) throw new Error(`Invalid verification results schema: ${checked.errors.slice(0, 10).map((e) => `${e.path}: ${e.message}`).join(' ')}`);
  return value;
}
