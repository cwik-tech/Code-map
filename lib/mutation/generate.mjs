// Parser-based edits with stable positions. The virtual checker reads only this source.
import { createHash } from 'node:crypto';
import ts from 'typescript';
const compare = new Map([[ts.SyntaxKind.LessThanToken, '<='], [ts.SyntaxKind.LessThanEqualsToken, '<'], [ts.SyntaxKind.EqualsEqualsEqualsToken, '!=='], [ts.SyntaxKind.ExclamationEqualsEqualsToken, '===']]);
/** Generates edits on changed token lines, in source order. Uncertain types are left unchanged. */
export function generateMutants(path, text, lines) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true), changed = new Set(lines), items = [];
  const options = { strict: true, noLib: true, allowJs: true, checkJs: true, noResolve: true };
  const host = { ...ts.createCompilerHost(options), getSourceFile: (name) => name === path ? source : undefined, fileExists: (name) => name === path, readFile: (name) => name === path ? text : undefined };
  const checker = ts.createProgram([path], options, host).getTypeChecker();
  const numeric = (node) => !!(checker.getTypeAtLocation(node).flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral));
  const add = (node, replacement, mutatorName) => {
    const start = node.getStart(source), end = node.end, a = source.getLineAndCharacterOfPosition(start), b = source.getLineAndCharacterOfPosition(end);
    if (!changed.has(a.line + 1) || text.slice(start, end) === replacement) return;
    items.push({ path, start, end, original: text.slice(start, end), replacement, mutatorName,
      location: { start: { line: a.line + 1, column: a.character }, end: { line: b.line + 1, column: b.character } } });
  };
  const visit = (node) => {
    if (ts.isTypeNode(node)) return;
    if (ts.isBinaryExpression(node)) {
      const kind = node.operatorToken.kind;
      if (compare.has(kind)) add(node.operatorToken, compare.get(kind), 'Comparison');
      if (kind === ts.SyntaxKind.AmpersandAmpersandToken) add(node.operatorToken, '||', 'LogicalOperator');
      if (kind === ts.SyntaxKind.PlusToken && numeric(node.left) && numeric(node.right)) add(node.operatorToken, '-', 'ArithmeticOperator');
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) add(node, node.kind === ts.SyntaxKind.TrueKeyword ? 'false' : 'true', 'BooleanLiteral');
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) add(node, node.operand.getText(source), 'UnaryNot');
    if (ts.isReturnStatement(node) && node.expression) {
      let parent = node.parent;
      while (parent && !ts.isFunctionLike(parent)) parent = parent.parent;
      const signature = parent && checker.getSignatureFromDeclaration(parent);
      const type = signature && checker.getReturnTypeOfSignature(signature);
      // Only a proven undefined constituent permits this edit. Any and unknown stay untouched.
      if (type && (type.flags & ts.TypeFlags.Undefined || type.isUnion() && type.types.some((part) => part.flags & ts.TypeFlags.Undefined))) add(node.expression, 'undefined', 'ReturnUndefined');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return items.sort((a, b) => a.start - b.start || a.end - b.end || (a.mutatorName < b.mutatorName ? -1 : 1));
}
/** Hash ranking gives the same sample for one seed and input. Returned edits keep canonical order. */
export function sampleMutants(items, max, seed) {
  const ranked = items.map((item, index) => ({ index, rank: createHash('sha256').update(`${seed}:${item.path}:${item.start}:${item.mutatorName}`).digest('hex') }));
  const selected = new Set(ranked.sort((a, b) => a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.index - b.index).slice(0, max).map((item) => item.index));
  return items.filter((_, index) => selected.has(index));
}

/** Compiler formatting normalizes whitespace without changing spaces inside literals. */
export function equivalentCandidate(path, text, edit) {
  // transpileModule cannot emit declaration files.
  if (/\.d\.[cm]?ts$/i.test(path)) return null;
  const emit = (content) => {
    const result = ts.transpileModule(content, { fileName: path, reportDiagnostics: true,
      compilerOptions: { removeComments: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.Preserve, newLine: ts.NewLineKind.LineFeed } });
    if (result.diagnostics?.some((item) => item.category === ts.DiagnosticCategory.Error)) return null;
    return result.outputText.trim();
  };
  const original = emit(text), mutated = emit(text.slice(0, edit.start) + edit.replacement + text.slice(edit.end));
  return original !== null && mutated !== null && original === mutated
    ? { reason: 'Identical JavaScript after TypeScript transpilation with comments removed and whitespace normalized. Human review is required.' } : null;
}

/** Detects new standalone compiler diagnostics. Project compiler checks remain the test command's responsibility. */
export function mutationCompileError(path, text, edit) {
  const diagnostics = (content) => {
    const options = { strict: true, noLib: true, noResolve: true, allowJs: true, checkJs: true, noEmit: true };
    const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
    const host = { ...ts.createCompilerHost(options), getSourceFile: (name) => name === path ? source : undefined,
      fileExists: (name) => name === path, readFile: (name) => name === path ? content : undefined };
    return ts.getPreEmitDiagnostics(ts.createProgram([path], options, host)).map((item) => `${item.code}:${ts.flattenDiagnosticMessageText(item.messageText, ' ')}`);
  };
  const before = diagnostics(text), after = diagnostics(text.slice(0, edit.start) + edit.replacement + text.slice(edit.end));
  const remaining = [...before];
  return after.some((item) => { const index = remaining.indexOf(item); if (index < 0) return true; remaining.splice(index, 1); return false; });
}
