// Binding-aware source evidence. This creates symbols, but does not typecheck or execute code.
import ts from 'typescript';

const modifier = (node, kind) => ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some(m => m.kind === kind) ?? false);
const lineOf = (source, node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

export function sourceMetrics(source, facts, resolve) {
  const checker = localChecker(source);
  const bindings = importBindings(source, checker, resolve);
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
    declaration.metrics = metricsInRange(source, node, declaration, checker, bindings);
    for (const child of declaration.children) fill(child);
  };
  for (const declaration of facts.declarations) fill(declaration);
  return details;
}

function localChecker(source) {
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

function importBindings(source, checker, resolve) {
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

function referenceSymbol(checker, node) {
  return ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
}

function metricsInRange(source, root, declaration, checker, bindings) {
  const internal = new Set(), hooks = [];
  const visit = (node) => {
    const line = lineOf(source, node);
    if (line > declaration.end || source.getLineAndCharacterOfPosition(node.end).line + 1 < declaration.start) return;
    if (ts.isIdentifier(node)) {
      const binding = bindings.get(referenceSymbol(checker, node));
      if (binding?.target) internal.add(binding.target);
    }
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
  return { lines: declaration.end - declaration.start + 1, internalDependencies: [...internal].sort(), hookCalls: hooks };
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
