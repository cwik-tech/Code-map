// Per-file facts for the React and Next.js checks, read when the file is parsed: the file directives ('use client',
// 'use server'), process.env reads, event-handler properties on DOM elements, and the exports of a 'use server' file
// that are not async functions. Syntax only: no type check, and no source runs.
import ts from 'typescript';

const lineOf = (source, node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
const isAsync = (node) => (ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : []).some((item) => item.kind === ts.SyntaxKind.AsyncKeyword);
const hasModifier = (node, kind) => (ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : []).some((item) => item.kind === kind);
/** Expressions that are a value and never a function. Other expressions, such as a call, are not checked. */
const plainValues = new Set([ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NumericLiteral, ts.SyntaxKind.BigIntLiteral, ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.TemplateExpression, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.ObjectLiteralExpression, ts.SyntaxKind.ArrayLiteralExpression, ts.SyntaxKind.NewExpression, ts.SyntaxKind.PrefixUnaryExpression]);

/** The facts of one parsed file, or null when it has none of them. */
export function reactFacts(source) {
  const directives = [], env = [], handlers = [];
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    directives.push(statement.expression.text);
  }
  const visit = (node) => {
    const name = envName(node);
    if (name !== null) env.push({ name, line: lineOf(source, node) });
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && /^[a-z]/.test(node.tagName.text)) {
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name) && /^on[A-Z]/.test(attribute.name.text) && attribute.initializer && ts.isJsxExpression(attribute.initializer)) {
          handlers.push({ element: node.tagName.text, name: attribute.name.text, line: lineOf(source, attribute) });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const serverExports = directives.includes('use server') ? nonAsyncExports(source) : [];
  return directives.length || env.length || handlers.length || serverExports.length ? { directives, env, handlers, serverExports } : null;
}

/** `process.env.NAME` and `process.env['NAME']` give NAME. A computed name gives null. */
function envName(node) {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return null;
  const owner = node.expression;
  if (!ts.isPropertyAccessExpression(owner) || owner.name.text !== 'env' || !ts.isIdentifier(owner.expression) || owner.expression.text !== 'process') return null;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
}

/** The kind of a value that is not an async function: 'function', 'class' or 'value'. Null for an async function or an unknown value. */
function valueKind(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
  if (!node) return 'value';
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return isAsync(node) ? null : 'function';
  if (ts.isClassExpression(node)) return 'class';
  return plainValues.has(node.kind) ? 'value' : null;
}

/** The exports of a 'use server' file that are not async functions. Types, re-exports from other files and values from calls are not checked. */
function nonAsyncExports(source) {
  const locals = new Map(), list = [];
  const add = (name, kind, node) => { if (kind) list.push({ name, kind, line: lineOf(source, node) }); };
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) locals.set(statement.name.text, isAsync(statement) ? null : 'function');
    else if (ts.isClassDeclaration(statement) && statement.name) locals.set(statement.name.text, 'class');
    else if (ts.isEnumDeclaration(statement)) locals.set(statement.name.text, 'enum');
    else if (ts.isVariableStatement(statement)) for (const item of statement.declarationList.declarations) if (ts.isIdentifier(item.name)) locals.set(item.name.text, valueKind(item.initializer));
  }
  for (const statement of source.statements) {
    if (hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) continue;
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      add('default', ts.isIdentifier(statement.expression) ? locals.get(statement.expression.text) : valueKind(statement.expression), statement);
    } else if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && !statement.isTypeOnly && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const item of statement.exportClause.elements) if (!item.isTypeOnly) add(item.name.text, locals.get((item.propertyName ?? item.name).text), item);
    } else if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      const name = hasModifier(statement, ts.SyntaxKind.DefaultKeyword) ? 'default' : statement.name?.text;
      if (ts.isVariableStatement(statement)) for (const item of statement.declarationList.declarations) add(item.name.getText(source), ts.isIdentifier(item.name) ? valueKind(item.initializer) : null, item);
      else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) add(name, ts.isFunctionDeclaration(statement) ? (isAsync(statement) ? null : 'function') : ts.isClassDeclaration(statement) ? 'class' : 'enum', statement);
    }
  }
  return list;
}
