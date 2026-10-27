// Cyclomatic complexity, cognitive complexity and nesting of functions from the TypeScript AST.
// A nested function has its own values. Its body does not add to the enclosing function. No threshold is applied.
// Each function record has the start and end lines of the function, so that code-map verify can join coverage to it.
import ts from 'typescript';
import { cognitiveOf } from './cognitive.mjs';

const functionKinds = new Set([
  ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.FunctionExpression, ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration, ts.SyntaxKind.Constructor, ts.SyntaxKind.GetAccessor, ts.SyntaxKind.SetAccessor,
]);

/** A function-like node with a body, so overload signatures and type-only signatures do not count. */
const isFunctionNode = (node) => !!node && functionKinds.has(node.kind) && node.body !== undefined;

/** The function-like node behind a declaration node: a function, a variable initializer, or a default or CommonJS export. */
export function functionNodeOf(node) {
  if (!node) return null;
  if (isFunctionNode(node)) return node;
  if (ts.isVariableStatement(node)) return functionNodeOf(node.declarationList.declarations[0]);
  if (ts.isVariableDeclaration(node)) return isFunctionNode(node.initializer) ? node.initializer : null;
  if (ts.isExportAssignment(node)) return isFunctionNode(node.expression) ? node.expression : null;
  if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression)
    && node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken && isFunctionNode(node.expression.right)) return node.expression.right;
  return null;
}

const shortCircuit = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/** A control structure that opens one nesting level for the code it contains. A try statement is handled separately. */
const opensLevel = (node) => ts.isIfStatement(node) || ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)
  || ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isSwitchStatement(node);

/** A decision point: plus one to the cyclomatic complexity. */
const isDecision = (node) => ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isCaseClause(node) || ts.isCatchClause(node)
  || ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)
  || (ts.isBinaryExpression(node) && shortCircuit.has(node.operatorToken.kind));

const textOf = (name) => name && (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) ? name.text : null;

const transparent = (node) => ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isAwaitExpression(node);
const outside = (node) => { while (node.parent && transparent(node.parent)) node = node.parent; return node; };
const calleeName = (node) => {
  while (transparent(node)) node = node.expression;
  return textOf(ts.isPropertyAccessExpression(node) ? node.name : node);
};

/** Keep existing bindings. Call arguments use the initialized variable or the callee and its call position. */
function nameOf(node, state) {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  const parent = node.parent;
  const bound = (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) && parent.initializer === node ? parent.name : null;
  const existing = textOf(node.name) ?? textOf(bound);
  if (existing !== null) return existing;
  const argument = outside(node), call = argument.parent;
  if (ts.isCallExpression(call) && call.arguments.includes(argument)) {
    const value = outside(call), binding = value.parent;
    if (ts.isVariableDeclaration(binding) && binding.initializer === value && textOf(binding.name)) return textOf(binding.name);
    const name = calleeName(call.expression);
    if (name) return `${name}#${state.calls.get(call)}`;
  }
  return `<anonymous ${++state.anonymous}>`;
}

/** The values of the code under `root`. `skip` leaves out nodes that have their own declaration record. */
function measure(source, root, skip = () => false) {
  const state = { cyclomatic: 1, nesting: 0, functions: [], anonymous: 0, calls: new Map(), callees: new Map() };
  const walk = (current, depth) => {
    if (!current || skip(current)) return;
    if (isFunctionNode(current)) {
      const name = nameOf(current, state);
      state.functions.push({ name, ...complexityOf(source, current) });
      return;
    }
    if (ts.isCallExpression(current)) {
      const name = calleeName(current.expression), ordinal = (state.callees.get(name) ?? 0) + 1;
      state.callees.set(name, ordinal);
      state.calls.set(current, ordinal);
    }
    if (isDecision(current)) state.cyclomatic++;
    if (ts.isTryStatement(current)) {
      // The try, catch and finally blocks are one level. The catch clause is not nested inside the try block.
      const inner = depth + 1;
      state.nesting = Math.max(state.nesting, inner);
      walk(current.tryBlock, inner); walk(current.catchClause, inner); walk(current.finallyBlock, inner);
      return;
    }
    if (!opensLevel(current)) { ts.forEachChild(current, (child) => walk(child, depth)); return; }
    const inner = depth + 1;
    state.nesting = Math.max(state.nesting, inner);
    // An `else if` continues its chain at the level of the first `if`. It does not nest one level deeper.
    ts.forEachChild(current, (child) => walk(child, ts.isIfStatement(current) && child === current.elseStatement && ts.isIfStatement(child) ? depth : inner));
  };
  walk(root, 0);
  return state;
}

const lineAt = (source, position) => source.getLineAndCharacterOfPosition(position).line + 1;

/**
 * Complexity of one function-like node: its start and end lines, its own values and, recursively, each nested function under it.
 * An empty `functions` list is left out.
 */
export function complexityOf(source, node) {
  const { cyclomatic, nesting, functions } = measure(source, node.body);
  return { column: source.getLineAndCharacterOfPosition((node.name ?? node).getStart(source)).character, start: lineAt(source, node.getStart(source)), end: lineAt(source, node.getEnd()), cyclomatic, nesting, cognitive: cognitiveOf(node), ...(functions.length ? { functions } : {}) };
}

/**
 * The complexity record of one declaration, or null. A function has its own values. Another declaration, such as a class,
 * an object or a wrapper call, records only the functions inside it. `children` are member declarations with their own record.
 */
export function declarationComplexity(source, root, children = []) {
  const fn = functionNodeOf(root);
  if (fn) return complexityOf(source, fn);
  if (!root) return null;
  const own = new Set(children.map((child) => `${child.startOffset}:${child.endOffset}`));
  const { functions } = measure(source, root, (node) => own.size > 0 && own.has(`${node.getStart(source)}:${node.getEnd()}`));
  return functions.length ? { functions } : null;
}

const anonymousName = /^<anonymous \d+>$/;

/**
 * Each function of `files` in source order. `group` is the name path with `<anonymous>` in place of the position, `parent` is the
 * name path of the enclosing function, and `anonymous` is true when the name path has a position in it. `start` and `end` are the
 * lines of the function, or null in a record of an earlier version.
 */
function entries(files) {
  const list = [];
  const add = (path, name, group, parent, anonymous, record) => {
    if (record.cyclomatic !== undefined) list.push({ path, name, group, parent, anonymous, start: record.start ?? null, end: record.end ?? null, cyclomatic: record.cyclomatic, nesting: record.nesting, ...(record.cognitive !== undefined ? { cognitive: record.cognitive } : {}) });
    for (const fn of record.functions ?? []) {
      const position = anonymousName.test(fn.name);
      add(path, `${name}/${fn.name}`, `${name}/${position ? '<anonymous>' : fn.name}`, name, anonymous || position, fn);
    }
  };
  for (const file of files) for (const declaration of file.declarations) if (declaration.complexity) add(file.path, declaration.name, declaration.name, null, false, declaration.complexity);
  return list;
}

/** A flat list of every function in `analysis.files`, with its name path and its lines. */
export const functionList = (files) => entries(files).map(({ path, name, start, end, ...values }) => ({ path, name, start, end, ...valuesOf(values) }));

const valuesOf = (fn) => ({ ...(fn.start != null && fn.end != null ? { lines: fn.end - fn.start + 1 } : {}), cyclomatic: fn.cyclomatic, nesting: fn.nesting, ...(fn.cognitive !== undefined ? { cognitive: fn.cognitive } : {}) });
const sum = (delta, pick) => pick(delta.lines ?? 0, 0) + pick(delta.cyclomatic, 0) + pick(delta.nesting, 0) + pick(delta.cognitive ?? 0, 0);

/**
 * Complexity change of the functions of two analyses. A function matches by its file (through Git renames) and its name path.
 * Functions that share one name path, such as a getter and a setter, or the anonymous functions of one parent, match by position
 * when the base and the head have the same number of them. Otherwise they are UNKNOWN, with the functions inside them.
 * `complete` is false when Git can have missed renames: a named function of a file that the base does not have is then UNKNOWN.
 */
export function compareComplexity(baseAnalysis, headAnalysis, renames = [], complete = true) {
  const reverse = new Map(renames.map(({ from, to }) => [to, from]));
  const guessed = new Set(renames.filter((item) => !item.similarity).map((item) => item.to));
  const baseFiles = new Set(baseAnalysis.files.map((file) => file.path));
  const grouped = (list, pathOf) => {
    const groups = new Map();
    for (const fn of list) { const key = `${pathOf(fn.path)}\0${fn.group}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(fn); }
    return groups;
  };
  const headList = entries(headAnalysis.files), from = (path) => reverse.get(path) ?? path;
  const baseGroups = grouped(entries(baseAnalysis.files), (path) => path), headGroups = grouped(headList, from);
  const grew = [], fresh = [], fell = [], unknown = [], unsure = new Set();
  for (const fn of headList) {
    const key = `${from(fn.path)}\0${fn.group}`, before = baseGroups.get(key) ?? [], now = headGroups.get(key);
    const entry = { path: fn.path, name: fn.name, base: null, head: valuesOf(fn), delta: null };
    const certain = !guessed.has(fn.path) && (complete || baseFiles.has(from(fn.path)));
    if (fn.parent === null || !unsure.has(`${fn.path}\0${fn.parent}`)) {
      if (before.length === now.length) {
        const prior = before[now.indexOf(fn)];
        entry.base = valuesOf(prior);
        entry.delta = { ...(fn.start != null && fn.end != null && prior.start != null && prior.end != null ? { lines: (fn.end - fn.start) - (prior.end - prior.start) } : {}), cyclomatic: fn.cyclomatic - prior.cyclomatic, nesting: fn.nesting - prior.nesting,
          ...(fn.cognitive !== undefined && prior.cognitive !== undefined ? { cognitive: fn.cognitive - prior.cognitive } : {}) };
        if (entry.delta.cyclomatic > 0 || entry.delta.nesting > 0 || entry.delta.cognitive > 0 || entry.delta.lines > 0) grew.push(entry);
        else if (entry.delta.cyclomatic < 0 || entry.delta.nesting < 0 || entry.delta.cognitive < 0 || entry.delta.lines < 0) fell.push(entry);
        continue;
      }
      if (before.length === 0 && !fn.anonymous && certain) { fresh.push(entry); continue; }
    }
    unsure.add(`${fn.path}\0${fn.name}`);
    unknown.push(entry);
  }
  // The sort is stable, so functions of one file keep their source order.
  const byPath = (a, b) => a.path.localeCompare(b.path);
  grew.sort((a, b) => sum(b.delta, Math.max) - sum(a.delta, Math.max) || b.delta.cyclomatic - a.delta.cyclomatic || byPath(a, b));
  fell.sort((a, b) => sum(a.delta, Math.min) - sum(b.delta, Math.min) || byPath(a, b));
  fresh.sort(byPath); unknown.sort(byPath);
  return { counts: { grew: grew.length, new: fresh.length, fell: fell.length, unknown: unknown.length }, grew, new: fresh, fell, unknown };
}
