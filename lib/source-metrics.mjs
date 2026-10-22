// Binding-aware source evidence. This creates symbols, but does not typecheck or execute code.
import ts from 'typescript';

const modifier = (node, kind) => ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some(m => m.kind === kind) ?? false);
const lineOf = (source, node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

export function sourceMetrics(source, facts, resolve, checker = localChecker(source)) {
  const bindings = importBindings(source, checker, resolve);
  const locals = topLevelSymbols(source, checker);
  const references = new Map();
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isExportAssignment(node)) return;
    if (ts.isIdentifier(node) && (node.parent.name !== node || ts.isShorthandPropertyAssignment(node.parent))) {
      const symbol = referenceSymbol(checker, node);
      if (symbol) references.set(symbol, (references.get(symbol) ?? 0) + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const details = exportDetails(source, checker, references);
  const nodes = new Map();
  const index = (node) => { nodes.set(`${node.getStart(source)}:${node.getEnd()}`, node); ts.forEachChild(node, index); };
  index(source);
  const fill = (declaration) => {
    const node = nodes.get(`${declaration.startOffset}:${declaration.endOffset}`);
    declaration.metrics = metricsInRange(source, node, declaration, checker, bindings, locals);
    for (const child of declaration.children) fill(child);
  };
  for (const declaration of facts.declarations) fill(declaration);
  return details;
}

export function localChecker(source) {
  const options = { noLib: true, noResolve: true, allowJs: true, target: ts.ScriptTarget.Latest };
  const host = {
    getSourceFile: (path) => path === source.fileName ? source : undefined,
    getDefaultLibFileName: () => '', writeFile: () => undefined,
    getCurrentDirectory: () => '/', getDirectories: () => [],
    fileExists: (path) => path === source.fileName, readFile: () => undefined,
    getCanonicalFileName: (path) => path, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
  };
  return ts.createProgram([source.fileName], options, host).getTypeChecker();
}

export function importBindings(source, checker, resolve) {
  const bindings = new Map();
  for (const node of source.statements.filter(ts.isImportDeclaration)) {
    const clause = node.importClause;
    if (!clause || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const specifier = node.moduleSpecifier.text;
    const add = (name, imported, typeOnly) => {
      const symbol = checker.getSymbolAtLocation(name);
      if (symbol) bindings.set(symbol, { target: resolve(source.fileName, specifier), specifier, imported, typeOnly });
    };
    if (clause.name) add(clause.name, 'default', clause.isTypeOnly);
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) add(clause.namedBindings.name, '*', clause.isTypeOnly);
    else for (const item of clause.namedBindings?.elements ?? []) add(item.name, (item.propertyName ?? item.name).text, clause.isTypeOnly || item.isTypeOnly);
  }
  return bindings;
}

export function referenceSymbol(checker, node) {
  return ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
}

/** Top-level functions, classes and variables by symbol, so references between declarations of one file can be followed. */
function topLevelSymbols(source, checker) {
  const locals = new Map();
  const add = (name) => { const symbol = name && ts.isIdentifier(name) ? checker.getSymbolAtLocation(name) : undefined; if (symbol) locals.set(symbol, name.text); };
  for (const node of source.statements) {
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) add(node.name);
    else if (ts.isVariableStatement(node)) for (const item of node.declarationList.declarations) add(item.name);
  }
  return locals;
}

/** The name an imported binding references: namespace members name themselves, `ns.run` is `run`. */
export function importedName(binding, node) {
  if (binding.imported !== '*') return binding.imported;
  return ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node ? node.parent.name.text : '*';
}

function metricsInRange(source, root, declaration, checker, bindings, locals) {
  const internal = new Set(), hooks = [], references = new Set(), exits = new Map();
  const visit = (node) => {
    const line = lineOf(source, node);
    if (line > declaration.end || source.getLineAndCharacterOfPosition(node.end).line + 1 < declaration.start) return;
    if (ts.isIdentifier(node)) {
      const symbol = referenceSymbol(checker, node);
      const binding = bindings.get(symbol);
      if (binding?.target) internal.add(binding.target);
      if (binding?.target && !binding.typeOnly) references.add(`${binding.target}#${importedName(binding, node)}`);
      else if (locals.has(symbol) && locals.get(symbol) !== declaration.name) references.add(`${source.fileName}#${locals.get(symbol)}`);
    }
    const exit = failureExit(node);
    if (exit && !exits.has(line) && !insideCatch(node)) exits.set(line, { kind: exit, ...coverageProbe(source, node, line) });
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const name = ts.isIdentifier(expression) ? expression : ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) ? expression.expression : null;
      const binding = name ? bindings.get(checker.getSymbolAtLocation(name)) : undefined;
      const imported = binding?.imported === '*' || binding?.imported === 'default'
        ? (ts.isPropertyAccessExpression(expression) ? expression.name.text : '') : binding?.imported;
      if (binding && !binding.typeOnly && /^use[A-Z]/.test(imported ?? '')) hooks.push({ name: imported, line,
        origin: binding.specifier, classification: binding.specifier === 'react' ? 'react' : 'convention' });
    }
    ts.forEachChild(node, visit);
  };
  if (root) visit(root);
  return { lines: declaration.end - declaration.start + 1, internalDependencies: [...internal].sort(), hookCalls: hooks,
    failureExits: [...exits].map(([line, exit]) => ({ line, ...exit })), references: [...references].sort() };
}

/** A throw or error value inside a catch block belongs to the failure path that the catch already counts. */
export function insideCatch(node) {
  for (let parent = node.parent; parent && !ts.isFunctionLike(parent); parent = parent.parent) if (ts.isCatchClause(parent)) return true;
  return false;
}

/**
 * Where a coverage report can show that a failure exit ran. A one-line `if (bad) throw …` always runs its line, so the
 * branch taken on that line (`branch`: 0 = then, 1 = else) is the evidence. A catch block is probed at its first statement.
 */
function coverageProbe(source, node, line) {
  if (ts.isCatchClause(node)) return { probe: node.block.statements[0] ? lineOf(source, node.block.statements[0]) : null };
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'catch') {
    const handler = node.arguments[0], body = handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) ? handler.body : null;
    const first = body && ts.isBlock(body) ? body.statements[0] : null;
    return { probe: first && lineOf(source, first) !== line ? lineOf(source, first) : null };
  }
  for (let child = node, parent = node.parent; parent && !ts.isFunctionLike(parent); child = parent, parent = parent.parent) {
    if (ts.isIfStatement(parent) && child !== parent.expression) return lineOf(source, parent) === line ? { branch: child === parent.thenStatement ? 0 : 1 } : {};
  }
  return {};
}

const errorKeys = new Set(['error', 'errors']);
const successKeys = new Set(['ok', 'success']);
const statusCallees = new Set(['status', 'sendStatus', 'code', 'json', 'text', 'send', 'error']);
const failureCallees = new Set(['notFound', 'unauthorized', 'forbidden', 'createError']);
export const unwrap = (node) => {
  while (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
  return node;
};
const keyOf = (property) => property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : null;
const isErrorStatus = (node) => !!node && ts.isNumericLiteral(node) && Number(node.text) >= 400 && Number(node.text) < 600;
const isEmpty = (node) => node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.FalseKeyword || (ts.isIdentifier(node) && node.text === 'undefined');

/** An object literal that reports a failure as a value: `{ error }`, `{ ok: false }` or a 4xx/5xx `status`. */
function failureObject(node) {
  if (!node || !ts.isObjectLiteralExpression(node)) return false;
  return node.properties.some((property) => {
    const key = keyOf(property);
    if (ts.isShorthandPropertyAssignment(property)) return errorKeys.has(property.name.text);
    if (!key || !ts.isPropertyAssignment(property)) return false;
    const value = unwrap(property.initializer);
    if (errorKeys.has(key)) return !isEmpty(value);
    if (successKeys.has(key)) return value.kind === ts.SyntaxKind.FalseKeyword;
    return (key === 'status' || key === 'statusCode') && isErrorStatus(value);
  });
}

/**
 * Places where a function reports a failure: throw, reject, catch, an error value or status, or a nonzero exit.
 * A pattern match, not proof: other failure styles exist and are not counted.
 */
export function failureExit(node) {
  if (ts.isThrowStatement(node)) return 'throw';
  if (ts.isCatchClause(node)) return 'catch';
  if (ts.isReturnStatement(node) && node.expression) {
    const value = unwrap(node.expression);
    if (failureObject(value)) return 'error-return';
    if (ts.isCallExpression(value) && ts.isIdentifier(value.expression) && /^(err|Err|fail|failure|left)$/.test(value.expression.text)) return 'error-return';
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.left.getText() === 'process.exitCode'
    && ts.isNumericLiteral(node.right) && node.right.text !== '0') return 'exit';
  if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return null;
  const callee = node.expression, args = node.arguments ?? [];
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
  const owner = ts.isPropertyAccessExpression(callee) ? callee.expression.getText() : '';
  if (ts.isCallExpression(node) && (name === 'reject' && (owner === 'Promise' || ts.isIdentifier(callee)))) return 'reject';
  if (ts.isCallExpression(node) && name === 'catch' && owner && args.length) return 'catch';
  if (name === 'exit' && owner === 'process' && args.length && !(ts.isNumericLiteral(args[0]) && args[0].text === '0')) return 'exit';
  if (failureCallees.has(name) && ts.isCallExpression(node)) return 'status';
  if ((statusCallees.has(name) || name === 'Response') && args.some((arg) => isErrorStatus(arg) || failureObject(arg) && arg.properties.some((p) => /^status/.test(keyOf(p) ?? '')))) return 'status';
  return null;
}

function exportDetails(source, checker, references) {
  const result = [];
  const add = (name, category, local, node, typeOnly = category === 'type') => {
    const symbol = local ? checker.getSymbolAtLocation(local) : undefined;
    result.push({ name, category, localName: local?.text ?? null, typeOnly, line: lineOf(source, node), localReferences: references.get(symbol) ?? 0 });
  };
  for (const node of source.statements) {
    if (ts.isExportDeclaration(node)) {
      if (!node.exportClause) add('*', 'reexport', null, node, node.isTypeOnly);
      else if (ts.isNamespaceExport(node.exportClause)) add(node.exportClause.name.text, 'reexport', null, node, node.isTypeOnly);
      else for (const item of node.exportClause.elements) add(item.name.text, 'reexport',
        node.moduleSpecifier ? null : (item.propertyName ?? item.name), node, node.isTypeOnly || item.isTypeOnly);
    } else if (ts.isExportAssignment(node)) {
      add('default', ts.isIdentifier(node.expression) ? 'reexport' : 'value', ts.isIdentifier(node.expression) ? node.expression : null, node);
    } else if (modifier(node, ts.SyntaxKind.ExportKeyword)) {
      const category = ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ? 'type' : 'value';
      if (ts.isVariableStatement(node)) for (const item of node.declarationList.declarations) add(item.name.getText(source), category, ts.isIdentifier(item.name) ? item.name : null, node);
      else if (node.name || modifier(node, ts.SyntaxKind.DefaultKeyword)) add(modifier(node, ts.SyntaxKind.DefaultKeyword) ? 'default' : node.name.text, category, node.name, node);
    }
  }
  return [...new Map(result.map(item => [item.name, item])).values()];
}
