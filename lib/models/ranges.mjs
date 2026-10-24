// Integer boundaries from JSON Schema and the documented JSDoc range convention.
import ts from 'typescript';
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const keys = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'];
const annotations = ['title', 'description', '$schema', '$id', '$comment', 'examples'];
/** Generate adjacent integer cases. Unsupported constraints give unknown expectations. */
export function integerRange(value) {
  const limits = [], unknown = [];
  if (!record(value)) return { path: '', type: 'number', integer: true, state: 'UNKNOWN', limits, unknown: ['invalid-schema'], unread: [], values: [] };
  if (value.type !== 'integer') unknown.push('only-integer-ranges');
  for (const key of Object.keys(value)) if (!['type', ...keys, ...annotations].includes(key)) unknown.push(`unsupported:${key}`);
  for (const key of keys) {
    if (value[key] === undefined) continue;
    if (!Number.isSafeInteger(value[key]) || Math.abs(value[key]) > 1e9) { unknown.push(`invalid:${key}`); continue; }
    limits.push({ check: key, limit: value[key], inclusive: !key.startsWith('exclusive'), side: key.toLowerCase().includes('minimum') ? 'lower' : 'upper' });
  }
  if (!limits.length) unknown.push('no-integer-limits');
  const values = new Map();
  for (const limit of limits) for (const [position, delta] of [['below', -1], ['at', 0], ['above', 1]]) {
    const number = limit.limit + delta;
    if (!values.has(number)) values.set(number, { value: number, near: [], expected: null });
    values.get(number).near.push({ check: limit.check, limit: limit.limit, position });
  }
  const accepts = (number) => limits.every((x) => x.side === 'lower' ? x.inclusive ? number >= x.limit : number > x.limit : x.inclusive ? number <= x.limit : number < x.limit);
  return { path: '', type: 'number', integer: true, state: unknown.length ? 'UNKNOWN' : 'KNOWN', limits, unknown, unread: [],
    values: [...values.values()].sort((a, b) => a.value - b.value).map((x) => ({ ...x, expected: unknown.length ? null : accepts(x.value) ? 'valid' : 'invalid' })) };
}
/** One scalar schema per explicit JSON Schema file. */
export function jsonRanges(path, text) {
  let value;
  try { value = JSON.parse(text); } catch { value = null; }
  return [{ name: path, line: null, exported: false, source: 'json-schema', fields: [integerRange(value)] }];
}
/** @minimum, @maximum and exclusive variants on exported declarations describe one integer input. */
export function annotationRanges(source) {
  const schemas = [];
  for (const statement of source.statements) {
    const tags = ts.getJSDocTags(statement).filter((tag) => keys.includes(tag.tagName.text));
    if (!tags.length) continue;
    const declarations = ts.isVariableStatement(statement) ? statement.declarationList.declarations : [statement];
    const value = { type: 'integer' };
    for (const tag of tags) {
      const text = typeof tag.comment === 'string' ? tag.comment.trim() : '';
      value[tag.tagName.text] = /^-?\d+$/.test(text) && !Object.hasOwn(value, tag.tagName.text) ? Number(text) : null;
    }
    for (const declaration of declarations) if (declaration.name && ts.isIdentifier(declaration.name)) {
      schemas.push({ name: declaration.name.text, line: source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1,
        exported: statement.modifiers?.some((x) => x.kind === ts.SyntaxKind.ExportKeyword) ?? false, source: 'range-annotation', fields: [integerRange(value)] });
    }
  }
  return schemas;
}
