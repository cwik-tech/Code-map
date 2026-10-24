// Collect path starts with a cheap text filter and a checker created on demand.
import ts from 'typescript';
import { localChecker, unwrap } from './source-metrics.mjs';

const possibleStart = /Worker|spawn|fork|execFile|\bimport\s*(?:\(|\/)|\\u/;

export function pathCandidates(source, getChecker) {
  if (!possibleStart.test(source.text)) return [];
  const candidates = [];
  const nameOf = (node) => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (!ts.isIdentifier(node)) return '';
    const declaration = getChecker().getSymbolAtLocation(node)?.declarations?.[0];
    return declaration && ts.isImportSpecifier(declaration) ? (declaration.propertyName ?? declaration.name).text : node.text;
  };
  const literalPath = (node, depth = 0) => {
    if (!node || depth > 4) return null;
    node = unwrap(node);
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isIdentifier(node)) {
      const declaration = getChecker().getSymbolAtLocation(node)?.valueDeclaration;
      return declaration && ts.isVariableDeclaration(declaration) && (declaration.parent.flags & ts.NodeFlags.Const)
        ? literalPath(declaration.initializer, depth + 1) : null;
    }
    if (ts.isNewExpression(node) && nameOf(node.expression) === 'URL' && node.arguments?.[1]?.getText(source) === 'import.meta.url') return literalPath(node.arguments[0], depth + 1);
    if (ts.isCallExpression(node) && nameOf(node.expression) === 'join' && node.arguments[0]?.getText(source) === '__dirname'
      && node.arguments.length > 1 && node.arguments.slice(1).every(ts.isStringLiteralLike)) return './' + node.arguments.slice(1).map((arg) => arg.text).join('/');
    return null;
  };
  const visit = (node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = node.expression.kind === ts.SyntaxKind.ImportKeyword ? 'import' : nameOf(node.expression);
      if (['Worker', 'spawn', 'fork', 'execFile', 'import'].includes(name)) {
        const args = node.arguments ?? [], operands = [...args.slice(0, 1)];
        if (['spawn', 'execFile'].includes(name) && args[1] && ts.isArrayLiteralExpression(args[1])) operands.push(...args[1].elements);
        const literals = [];
        for (const arg of operands) {
          const literal = literalPath(arg);
          if (literal && !literal.startsWith('/')) literals.push(literal);
        }
        candidates.push({ name, literals, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return candidates;
}

export function scanPathCandidates(path, text) {
  if (!possibleStart.test(text)) return [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  let checker;
  return pathCandidates(source, () => checker ??= localChecker(source));
}
