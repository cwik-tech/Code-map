// A virtual compiler program binds local names and cross-file imports. It never loads or runs project code.
import ts from 'typescript';
import { posix } from 'node:path';

export const unwrap = (node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
  return node;
};
export const walk = (node, visit) => { visit(node); ts.forEachChild(node, (child) => walk(child, visit)); };
export const location = (node) => ({ path: node.getSourceFile().fileName.slice('/snapshot/'.length), line: node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1 });

export function syntax(texts, files) {
  const sources = new Map(files.map(({ path }) => [`/snapshot/${path}`, ts.createSourceFile(`/snapshot/${path}`, texts.get(path) ?? '', ts.ScriptTarget.Latest, true)]));
  const host = {
    getSourceFile: (path) => sources.get(path), getDefaultLibFileName: () => '', writeFile: () => {},
    getCurrentDirectory: () => '/snapshot', getDirectories: () => [], fileExists: (path) => sources.has(path),
    readFile: (path) => sources.get(path)?.text, getCanonicalFileName: (path) => path, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
    resolveModuleNames: (names, from) => names.map((name) => {
      if (!name.startsWith('.')) return undefined;
      const base = posix.resolve(posix.dirname(from), name), stem = base.replace(/\.[cm]?jsx?$/, '');
      const found = [base, ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.js'].flatMap((ext) => [base + ext, stem + ext])].find((path) => sources.has(path));
      return found ? { resolvedFileName: found } : undefined;
    }),
  };
  const program = ts.createProgram([...sources.keys()], { noLib: true, allowJs: true, checkJs: true }, host), checker = program.getTypeChecker();
  const symbol = (node) => {
    const found = checker.getSymbolAtLocation(node);
    return found && (found.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(found) : found;
  };
  // Imported Electron APIs retain their import declaration even though Electron itself is deliberately not loaded.
  const electronName = (node) => {
    if (!node) return null;
    if (ts.isPropertyAccessExpression(node)) return electronName(node.expression) === '*' ? node.name.text : null;
    if (!ts.isIdentifier(node)) return null;
    const decl = checker.getSymbolAtLocation(node)?.declarations?.[0];
    if (decl && ts.isImportSpecifier(decl) && decl.parent.parent.parent.moduleSpecifier.text === 'electron') return (decl.propertyName ?? decl.name).text;
    if (decl && ts.isNamespaceImport(decl) && decl.parent.parent.moduleSpecifier.text === 'electron') return '*';
    if (decl && ts.isBindingElement(decl)) {
      const init = decl.parent.parent.initializer;
      if (init && ts.isCallExpression(init) && init.expression.getText() === 'require' && init.arguments[0]?.text === 'electron') return (decl.propertyName ?? decl.name).text;
    }
    return null;
  };
  const resolve = (input, seen = new Set()) => {
    const node = unwrap(input);
    if (!node || seen.has(node)) return null;
    const next = new Set(seen).add(node);
    if (ts.isStringLiteralLike(node)) return { value: node.text, pattern: false };
    if (ts.isTemplateExpression(node) && node.head.text) return { value: node.head.text, pattern: true };
    if (ts.isIdentifier(node)) {
      const sym = symbol(node);
      const decl = sym?.valueDeclaration;
      if (decl && ts.isVariableDeclaration(decl) && (decl.parent.flags & ts.NodeFlags.Const)) return resolve(decl.initializer, next);
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const decl = symbol(ts.isPropertyAccessExpression(node) ? node.name : node)?.valueDeclaration;
      if (decl && (ts.isPropertyAssignment(decl) || ts.isEnumMember(decl))) return resolve(decl.initializer, next);
      const owner = symbol(node.expression)?.valueDeclaration;
      const obj = owner && ts.isVariableDeclaration(owner) && (owner.parent.flags & ts.NodeFlags.Const) ? unwrap(owner.initializer) : null;
      const key = ts.isPropertyAccessExpression(node) ? node.name.text : resolve(node.argumentExpression, next)?.value;
      if (obj && ts.isObjectLiteralExpression(obj)) {
        const prop = obj.properties.find((p) => p.name && (p.name.text === key));
        if (prop && ts.isPropertyAssignment(prop)) return resolve(prop.initializer, next);
      }
    }
    return null;
  };
  return { sources: [...sources.values()], checker, symbol, electronName, resolve };
}
