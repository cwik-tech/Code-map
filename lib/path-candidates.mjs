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

/** Literal Python command targets in workflow, shell and tool configuration text, including JSON argv. */
export function pythonCommandCandidates(text) {
  const candidates = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    // JSON/Docker argv and JavaScript spawn arrays share the same literal token form.
    const words = line.replace(/["'\[\],]/g, ' ').trim().split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const command = words[i].replace(/^.*\//, '');
      if (/^python(?:3(?:\.\d+)?)?$/.test(command)) {
        let at = i + 1;
        while (['-u', '-B', '-I', '-S', '-E', '-s', '-O', '-OO'].includes(words[at])) at++;
        if (words[at] === '-m' && /^[A-Za-z_]\w*(?:\.\w+)*$/.test(words[at + 1] ?? '')) candidates.push({ module: words[at + 1], line: index + 1 });
        else if (/^[\w./-]+\.py$/.test(words[at] ?? '')) candidates.push({ target: words[at], line: index + 1 });
      } else if (command === 'uv' && words[i + 1] === 'run' && /^[\w./-]+\.py$/.test(words[i + 2] ?? '')) candidates.push({ target: words[i + 2], line: index + 1 });
      else if (command === 'pytest' && words[i + 1] === '-p' && /^[A-Za-z_]\w*(?:\.\w+)*$/.test(words[i + 2] ?? '')) candidates.push({ module: words[i + 2], line: index + 1 });
    }
  }
  return candidates;
}
