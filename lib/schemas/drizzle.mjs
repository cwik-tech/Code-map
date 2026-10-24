// Reads Drizzle table definitions in one TypeScript or JavaScript file with the TypeScript parser: calls of pgTable,
// mysqlTable and sqliteTable with a table name and an object of columns, and pgEnum calls. It runs no code. A table whose
// columns are not an object literal of builder calls is UNKNOWN. A table without a literal name is unread (`lost`).
import ts from 'typescript';
import { digest } from './shared.mjs';

const tables = new Map([['pgTable', 'pg'], ['mysqlTable', 'mysql'], ['sqliteTable', 'sqlite']]);
const schemaCalls = new Set(['pgSchema', 'mysqlSchema']);

/** True when a file can hold a Drizzle table, so that only these files are parsed. */
export const mentionsDrizzle = (text) => /\b(?:pgTable|mysqlTable|sqliteTable|pgEnum|pgSchema|mysqlSchema)\b/.test(text);

const kindOf = (path) => path.endsWith('.tsx') ? ts.ScriptKind.TSX : path.endsWith('.jsx') ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
const literal = (node) => !!node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));

/** The tokens of a node joined by one space, without comments: a change of spaces or comments gives the same text. */
function tokens(node, source) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source.text.slice(node.getStart(source), node.getEnd()));
  const list = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) list.push(scanner.getTokenText());
  return list.join(' ');
}

/** The local names of the Drizzle functions that the file imports, and its namespace imports of Drizzle modules. */
function importsOf(source) {
  const names = new Map(), spaces = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !/^drizzle-orm(?:\/|$)/.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) spaces.add(bindings.name.text);
    else if (bindings) for (const element of bindings.elements) names.set(element.name.text, (element.propertyName ?? element.name).text);
  }
  return { names, spaces };
}

/** The Drizzle function that a call names: an imported name, its alias, a member of a namespace import, or a plain name. */
function calleeOf(expression, { names, spaces }) {
  if (ts.isIdentifier(expression)) return names.get(expression.text) ?? expression.text;
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && spaces.has(expression.expression.text)) return expression.name.text;
  return null;
}

const keyOf = (name) => ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name) ? name.text : null;
const dotted = (node) => ts.isIdentifier(node) || (ts.isPropertyAccessExpression(node) && dotted(node.expression));
const variableOf = (node) => ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name) ? node.parent.name.text : null;

/**
 * A column: the builder call at the start of a chain, such as `text('name')`, and the modifiers after it, such as
 * `.notNull().default(0)`. `column` is the database name (null when the key names the column). Modifier arguments are digests.
 */
function columnOf(expression, source) {
  const modifiers = [];
  let node = expression;
  while (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isCallExpression(node.expression.expression)) {
    const args = [...(node.typeArguments ?? []), ...node.arguments].map((item) => tokens(item, source)).join(' , ');
    modifiers.unshift({ name: node.expression.name.text, args: args ? digest(args) : null });
    node = node.expression.expression;
  }
  // The builder is a name such as `text` or `t.text`. Another callee, such as `(text('a')).notNull`, is not a builder.
  if (!ts.isCallExpression(node) || !dotted(node.expression)) return null;
  const callee = node.expression, builder = ts.isIdentifier(callee) ? callee.text : callee.name.text;
  const [first, ...rest] = node.arguments, named = literal(first);
  const args = (named ? rest : node.arguments).map((item) => tokens(item, source)).join(' , ');
  return { builder, column: named ? first.text : null, args: args || null, modifiers };
}

/** The tables and enums of one file, and the definitions that it cannot read. */
export function parseDrizzle(path, text) {
  const entities = [], unread = [];
  let source;
  try { source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kindOf(path)); } catch { return { entities, unread: [{ line: null, reason: 'parse-failed', lost: true }] }; }
  const scope = importsOf(source), lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const table = (node, dialect) => {
    const [name, columns, extra] = node.arguments, line = lineOf(node), variable = variableOf(node);
    if (!literal(name)) { unread.push({ line, entity: variable, reason: 'table-name-not-literal', lost: true }); return; }
    const entity = { type: 'table', name: name.text, dialect, variable, line, state: 'read', reason: null, digest: digest(tokens(node, source)), extra: extra ? digest(tokens(extra, source)) : null, columns: [] };
    const unknown = (reason, at = null) => entities.push({ ...entity, state: 'unknown', reason, ...(at ? { problemLine: lineOf(at) } : {}), columns: [] });
    if (!columns || !ts.isObjectLiteralExpression(columns)) return unknown('columns-not-object');
    for (const property of columns.properties) {
      if (ts.isSpreadAssignment(property)) return unknown('spread-columns', property);
      const key = ts.isPropertyAssignment(property) ? keyOf(property.name) : null, column = key === null ? null : columnOf(property.initializer, source);
      if (!column) return unknown('column-not-builder', property);
      if (entity.columns.some((item) => item.name === key)) return unknown('duplicate-column', property);
      entity.columns.push({ name: key, line: lineOf(property), ...column });
    }
    entities.push(entity);
  };
  const enumeration = (node) => {
    const [name, values] = node.arguments, line = lineOf(node), variable = variableOf(node);
    if (!literal(name)) { unread.push({ line, entity: variable, reason: 'enum-name-not-literal', lost: true }); return; }
    const entity = { type: 'enum', name: name.text, variable, line, state: 'read', reason: null, digest: digest(tokens(node, source)), values: [] };
    if (!values || !ts.isArrayLiteralExpression(values) || !values.elements.every(literal)) { entities.push({ ...entity, state: 'unknown', reason: 'values-not-literal' }); return; }
    entity.values = values.elements.map((element) => ({ name: element.text, line: lineOf(element) }));
    entities.push(entity);
  };
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeOf(node.expression, scope);
      if (tables.has(name)) table(node, tables.get(name));
      else if (name === 'pgEnum') enumeration(node);
      else if (schemaCalls.has(name)) unread.push({ line: lineOf(node), entity: variableOf(node), reason: 'schema-tables', lost: true });
    }
    ts.forEachChild(node, visit);
  };
  try { visit(source); } catch { return { entities: [], unread: [{ line: null, reason: 'parse-failed', lost: true }] }; }
  return { entities, unread };
}

/** The `out` field of a Drizzle configuration file: its text when it is a string literal. `problem` is set when it is something else. */
export function drizzleOut(path, text) {
  let found = null;
  try {
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kindOf(path));
    const visit = (node) => {
      if (found === null && ts.isPropertyAssignment(node) && keyOf(node.name) === 'out') found = node.initializer;
      if (found === null) ts.forEachChild(node, visit);
    };
    visit(source);
  } catch { return { out: null, problem: 'parse-failed' }; }
  if (found === null) return { out: null, problem: null };
  return literal(found) ? { out: found.text, problem: null } : { out: null, problem: 'out-not-literal' };
}
