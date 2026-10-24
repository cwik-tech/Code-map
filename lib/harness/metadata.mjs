// Host preparation reads syntax and oracle data. It never imports project code.
import ts from 'typescript';
import { annotationRanges, jsonRanges } from '../models/ranges.mjs';
import { zodSchemas } from '../models/zod.mjs';
import { readOracles, oracleDigest } from '../oracles.mjs';
import { validateDecisionTable } from '../models/decision-table.mjs';
import { fileBytes, jsonFile } from './files.mjs';
/** Builds executable boundary cases only for complete scalar constraints and simple object fields. */
export function boundaryCases(root, subject, spec = { mode: 'zod-boundaries' }) {
  const source = ts.createSourceFile(subject.file, fileBytes(root, subject.file).toString('utf8'), ts.ScriptTarget.Latest, true);
  const schemas = spec.mode === 'json-boundaries' ? jsonRanges(spec.schema, fileBytes(root, spec.schema).toString('utf8'))
    : spec.mode === 'range-boundaries' ? annotationRanges(source) : zodSchemas(source);
  const schema = spec.mode === 'json-boundaries' ? schemas[0] : schemas.find((item) => item.exported && item.name === subject.export);
  if (!schema) throw new Error('No exported constrained schema or range annotation was found for the subject');
  const cases = [], unknown = [];
  const bounded = (field) => field.type !== 'string' || field.values.every((item) => Number.isSafeInteger(item.value) && item.value >= 0 && item.value <= 10000);
  const convert = (field, value) => field.type === 'string' ? 'x'.repeat(value) : value;
  for (const field of schema.fields) {
    if (field.state !== 'KNOWN' || field.type === 'array' || field.path.includes('[]') || field.values.some((item) => item.expected === null)) {
      unknown.push({ path: field.path, reason: 'Incomplete constraints or unsupported array construction' }); continue;
    }
    if (!bounded(field)) {
      unknown.push({ path: field.path, reason: 'String boundary construction exceeds 10000 characters' }); continue;
    }
    for (const item of field.values) {
      let input = convert(field, item.value);
      if (field.path) {
        const fields = schema.fields;
        if (fields.some((peer) => !bounded(peer) || peer.path.includes('.') || !peer.path || peer.type === 'array' || !peer.values.some((x) => x.expected === 'valid'))) {
          unknown.push({ path: field.path, reason: 'No complete scalar object baseline' }); break;
        }
        input = Object.fromEntries(fields.map((peer) => [peer.path, peer === field ? convert(field, item.value) : convert(peer, peer.values.find((x) => x.expected === 'valid').value)]));
      }
      cases.push({ input, path: field.path, boundary: item, expected: item.expected === 'valid' });
    }
  }
  if (Buffer.byteLength(JSON.stringify({ cases, unknown })) > 200000) throw new Error('Boundary metadata exceeds 200000 bytes');
  return { cases, unknown, source: spec.mode, subject, ...(spec.schema ? { schema: spec.schema } : {}) };
}
/** Resolves row oracle identities against the selected snapshot and exact test bytes. */
export function trustedRows(root, tablePath) {
  const checked = validateDecisionTable(jsonFile(root, tablePath));
  if (!checked.ok) throw new Error(`Invalid decision table: ${JSON.stringify(checked.problems)}`);
  const entries = readOracles(root)?.entries ?? [];
  return checked.table.rules.map((rule, index) => {
    const reference = rule.oracle;
    const entry = reference ? entries.find((item) => ['file', 'suite', 'name', 'criterion'].every((key) => item[key] === reference[key])) : null;
    let current = false;
    if (entry) {
      try { current = oracleDigest(fileBytes(root, entry.file, 1048576)) === entry.digest; }
      catch { /* Missing or unreadable test bytes leave the record stale. */ }
    }
    return { row: index, oracle: reference ?? null, confirmed: !!entry, current, record: entry ?? null };
  });
}
