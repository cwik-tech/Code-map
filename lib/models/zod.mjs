// Boundary values of Zod schemas (C22). A schema is a variable that holds a Zod call chain, for example
// `const Age = z.number().int().min(1).max(10)`, in a file that imports zod. For each limit with a literal value, Code-map
// derives the value just below the limit, the limit, and the value just above it. A limit that is not a literal is UNKNOWN.
// Syntax only: no type check, and no source runs.
import ts from 'typescript';

const zodModule = /^zod(?:\/v[34])?$/;
/** [side, inclusive, fixed limit]: the number checks, and the length checks of strings and arrays. */
const numberChecks = { min: ['lower', true], gte: ['lower', true], gt: ['lower', false], max: ['upper', true], lte: ['upper', true], lt: ['upper', false],
  positive: ['lower', false, 0], nonnegative: ['lower', true, 0], negative: ['upper', false, 0], nonpositive: ['upper', true, 0] };
const lengthChecks = { min: ['lower', true], max: ['upper', true], length: ['exact', true], nonempty: ['lower', true, 1] };
/** Methods that change no limit and no accepted value of the field itself. */
const neutral = new Set(['optional', 'nullable', 'nullish', 'default', 'prefault', 'describe', 'meta', 'catch', 'readonly', 'brand', 'finite', 'strict', 'strip', 'passthrough', 'loose', 'partial', 'required']);
const typeChanges = new Set(['or', 'and', 'pipe', 'transform', 'promise']);
const lineOf = (source, node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
const hasExport = (node) => (ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : []).some((item) => item.kind === ts.SyntaxKind.ExportKeyword);
const keyOf = (name) => (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name) ? name.text : null);
const join = (path, key) => (path ? `${path}.${key}` : key);

/** The local names of zod in a file: `import { z }`, `import * as z` and `import z`. */
function zodNames(source) {
  const names = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !zodModule.test(statement.moduleSpecifier.text)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) names.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
    else if (bindings) for (const element of bindings.elements) if (!element.isTypeOnly && (element.propertyName ?? element.name).text === 'z') names.add(element.name.text);
  }
  return names;
}

/** The value of a numeric literal, also with a minus sign, or null. */
function literalNumber(node) {
  if (node && ts.isNumericLiteral(node)) return Number(node.text);
  if (node && ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text) || 0;
  return null;
}

/** The calls of a chain such as `z.coerce.number().int().min(1)`, root call first, or null when the chain does not start at zod. */
function chainOf(node, names) {
  const calls = [];
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) current = current.expression;
  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    calls.unshift({ name: current.expression.name.text, args: current.arguments });
    current = current.expression.expression;
  }
  if (ts.isPropertyAccessExpression(current) && current.name.text === 'coerce') current = current.expression;
  return calls.length && ts.isIdentifier(current) && names.has(current.text) ? calls : null;
}

/** The constrained fields of one Zod expression. `path` is '' for the schema itself, `name` for a key, `[]` for an array element. */
function fieldsOf(source, node, names, path) {
  const calls = chainOf(node, names);
  return calls ? chainFields(source, node, names, calls, path) : [];
}

/** The fields of one chain. `.array()` splits it: the calls before it describe the element, and the calls after it the array. */
function chainFields(source, node, names, calls, path) {
  const split = calls.findIndex((call, index) => index > 0 && call.name === 'array');
  if (split > 0) return [...chainFields(source, node, names, [{ name: 'array', args: [] }, ...calls.slice(split + 1)], path), ...chainFields(source, node, names, calls.slice(0, split), `${path}[]`)];
  const [root, ...methods] = calls, line = lineOf(source, node);
  const unknown = (check, reason = 'not-literal') => ({ path, line, type: root.name, integer: false, state: 'UNKNOWN', limits: [], unknown: [{ check, line, reason }], unread: [], values: [] });
  if (root.name === 'object') {
    const shapes = [root.args[0], ...methods.filter((call) => call.name === 'extend').map((call) => call.args[0])];
    return shapes.flatMap((shape) => (shape && ts.isObjectLiteralExpression(shape) ? shapeFields(source, shape, names, path) : [unknown('object')]));
  }
  if (root.name === 'enum') {
    const list = root.args[0];
    const members = list && ts.isArrayLiteralExpression(list) && list.elements.every((item) => ts.isStringLiteralLike(item)) ? list.elements.map((item) => item.text) : null;
    if (!members) return [unknown('enum')];
    const unread = methods.map((call) => call.name).filter((name) => !neutral.has(name));
    return [{ path, line, type: 'enum', integer: false, state: unread.length ? 'PARTIAL' : 'KNOWN', limits: [], members, unknown: [], unread,
      values: members.map((value) => ({ value, near: [{ check: 'enum', limit: null, position: 'member' }], expected: unread.length ? null : 'valid' })) }];
  }
  const type = root.name === 'number' || root.name === 'int' ? 'number' : root.name === 'string' || root.name === 'array' ? root.name : null;
  if (type === null) return [];
  const element = root.name === 'array' && root.args[0] ? fieldsOf(source, root.args[0], names, `${path}[]`) : [];
  const field = { path, line, type, integer: type !== 'number' || root.name === 'int', state: 'KNOWN', limits: [], unknown: [], unread: [], values: [] };
  for (const call of methods) {
    if (neutral.has(call.name)) continue;
    if (call.name === 'int' && type === 'number') { field.integer = true; continue; }
    // A method that changes the type, such as transform or pipe, ends what Code-map reads of the chain.
    if (typeChanges.has(call.name)) { field.unread.push(call.name); break; }
    const checks = type === 'number' ? numberChecks : lengthChecks;
    const check = Object.hasOwn(checks, call.name) ? checks[call.name] : null;
    if (!check) { field.unread.push(call.name); continue; }
    const [side, inclusive, fixed] = check, limit = fixed ?? literalNumber(call.args[0]);
    if (limit === null || !Number.isFinite(limit)) field.unknown.push({ check: call.name, line: lineOf(source, call.args[0] ?? node), reason: 'not-literal' });
    else field.limits.push({ check: call.name, limit, inclusive, side });
  }
  const integerOnly = type === 'number' && field.integer && !field.limits.length && !field.unknown.length;
  if (!integerOnly && !field.limits.length && !field.unknown.length) return element;
  field.values = integerOnly ? integerValues(field) : boundaryValues(field);
  field.state = !field.values.length ? 'UNKNOWN' : field.unknown.length || field.unread.length ? 'PARTIAL' : 'KNOWN';
  field.limits = field.limits.map(({ check, limit, inclusive }) => ({ check, limit, inclusive }));
  return [field, ...element];
}

/** Integer membership cases when no numeric limit supplies boundary values. */
function integerValues(field) {
  return [-0.5, 0, 0.5].map((value) => ({ value,
    near: [{ check: 'int', limit: 0, position: value < 0 ? 'below' : value > 0 ? 'above' : 'at' }],
    expected: field.unread.length ? null : Number.isInteger(value) ? 'valid' : 'invalid' }));
}

/** The fields of an object literal shape. A spread, a computed key or a shorthand property hides fields, so it is UNKNOWN. */
function shapeFields(source, shape, names, path) {
  return shape.properties.flatMap((property) => {
    const key = ts.isPropertyAssignment(property) ? keyOf(property.name) : null;
    if (key !== null) return fieldsOf(source, property.initializer, names, join(path, key));
    const line = lineOf(source, property);
    return [{ path, line, type: 'object', integer: false, state: 'UNKNOWN', limits: [], unknown: [{ check: 'object', line, reason: 'not-literal' }], unread: [], values: [] }];
  });
}

/** The number of decimal places of a number, also in exponent form (1e-7). */
function decimals(value) {
  const [mantissa, exponent = '0'] = String(Math.abs(value)).split('e');
  return Math.max(0, (mantissa.split('.')[1] ?? '').length - Number(exponent));
}

/**
 * The values near each limit, sorted, one entry for each value. An integer (and every length) steps by 1. Another number
 * steps by one decimal place more than its limit: 1 gives 0.9 and 1.1. A length below 0 is left out. `expected` comes from
 * every limit of the field, and it is null when a check is UNKNOWN or unread, because that check can also refuse the value.
 */
function boundaryValues(field) {
  const entries = new Map();
  for (const { check, limit } of field.limits) {
    const places = field.integer ? 0 : decimals(limit) + 1, step = 10 ** -places;
    const near = (value) => (places ? Number(places <= 100 ? value.toFixed(places) : value.toPrecision(15)) : value) || 0;
    for (const [position, value] of [['below', near(limit - step)], ['at', limit || 0], ['above', near(limit + step)]]) {
      if ((field.type !== 'number' && value < 0) || (position !== 'at' && value === limit)) continue;
      if (!entries.has(value)) entries.set(value, { value, near: [], expected: null });
      entries.get(value).near.push({ check, limit, position });
    }
  }
  const accepts = (value) => (!field.integer || Number.isInteger(value)) && field.limits.every(({ limit, inclusive, side }) =>
    side === 'exact' ? value === limit : side === 'lower' ? (inclusive ? value >= limit : value > limit) : (inclusive ? value <= limit : value < limit));
  const known = !field.unknown.length && !field.unread.length;
  return [...entries.values()].sort((a, b) => a.value - b.value).map((entry) => ({ ...entry, expected: known ? (accepts(entry.value) ? 'valid' : 'invalid') : null }));
}

/** The Zod schemas of a parsed source file: each variable that holds a Zod chain with at least one constrained field. */
export function zodSchemas(source) {
  const names = zodNames(source), schemas = [];
  if (!names.size) return schemas;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const fields = fieldsOf(source, node.initializer, names, '');
      const statement = node.parent?.parent;
      if (fields.length) schemas.push({ name: node.name.text, line: lineOf(source, node), exported: !!statement && ts.isVariableStatement(statement) && hasExport(statement), fields });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return schemas;
}
