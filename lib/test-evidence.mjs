// What a check in a test is about, and whether it runs: the source names that an assertion names directly, through a
// local variable, a caught error or a value passed to a function, and the conditions around it.
import ts from 'typescript';
import { importedName, referenceSymbol, unwrap } from './source-metrics.mjs';

const isFunction = (node) => ts.isArrowFunction(node) || ts.isFunctionExpression(node);

/** Imported source names referenced inside these nodes, including through local helpers. */
export function referencesIn(nodes, ctx) {
  const found = new Set();
  const walk = (node) => {
    if (ts.isIdentifier(node)) {
      const symbol = referenceSymbol(ctx.checker, node), binding = ctx.bindings.get(symbol), helper = ctx.helpers.get(symbol);
      if (binding?.target && !binding.typeOnly && !ctx.mocks.has(binding.target)) found.add(`${binding.target}#${importedName(binding, node)}`);
      if (helper) for (const reference of ctx.helperFacts(helper).references) found.add(reference);
    }
    ts.forEachChild(node, walk);
  };
  for (const node of nodes) walk(node);
  return found;
}

/**
 * The source names that a failure check is about: names inside the check itself, and, for a local variable in it, the
 * names in the value it holds (`const r = parse(x)`), or in the try block or promise that a caught error comes from.
 */
export function checkTargets(node, ctx, depth) {
  const found = referencesIn([node], ctx);
  if (depth >= 2) return found;
  const walk = (child) => {
    if (ts.isIdentifier(child)) {
      const symbol = referenceSymbol(ctx.checker, child), origin = valueOrigin(symbol);
      if (origin) for (const reference of checkTargets(origin, ctx, depth + 1)) found.add(reference);
      for (const callee of receivers(symbol, ctx)) for (const reference of referencesIn([callee], ctx)) found.add(reference);
    }
    ts.forEachChild(child, walk);
  };
  walk(node);
  return found;
}

/** Functions that a local value is passed to: a check on a spy or a mock response is about the function that received it. */
function receivers(symbol, ctx) {
  const declaration = symbol?.valueDeclaration;
  if (!declaration || !ts.isVariableDeclaration(declaration) || ts.isCatchClause(declaration.parent)) return [];
  let scope = declaration.parent;
  while (scope && !ts.isBlock(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
  const found = [];
  const walk = (node) => {
    if (ts.isCallExpression(node) && node.arguments.some((arg) => ts.isIdentifier(unwrap(arg)) && referenceSymbol(ctx.checker, unwrap(arg)) === symbol)) found.push(node.expression);
    ts.forEachChild(node, walk);
  };
  if (scope) walk(scope);
  return found;
}

function valueOrigin(symbol) {
  let declaration = symbol?.valueDeclaration;
  while (declaration && ts.isBindingElement(declaration)) declaration = declaration.parent.parent; // const { error } = parse(x)
  if (!declaration) return null;
  if (ts.isVariableDeclaration(declaration) && ts.isCatchClause(declaration.parent)) return declaration.parent.parent.tryBlock;
  if (ts.isVariableDeclaration(declaration)) return declaration.initializer && !isFunction(declaration.initializer) ? declaration.initializer : null;
  const owner = ts.isParameter(declaration) ? declaration.parent.parent : null; // promise.catch((error) => …)
  return owner && ts.isCallExpression(owner) && ts.isPropertyAccessExpression(owner.expression) && owner.expression.name.text === 'catch' ? owner.expression.expression : null;
}

/** A constant condition: true, false, null, 0, '' or undefined, also negated; null when the value is only known at run time. */
function constantTruth(node) {
  node = unwrap(node);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) { const value = constantTruth(node.operand); return value === null ? null : !value; }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === 'undefined')) return false;
  if (ts.isNumericLiteral(node)) return Number(node.text) !== 0;
  return ts.isStringLiteralLike(node) ? node.text.length > 0 : null;
}

/** Whether code in a test body runs: "unreachable" under a constant false branch, "conditional" under any other condition. */
export function conditionOf(node, body) {
  let state = null;
  for (let child = node, parent = node.parent; parent && child !== body; child = parent, parent = parent.parent) {
    const branch = ts.isIfStatement(parent) && child !== parent.expression ? [parent.expression, child === parent.thenStatement]
      : ts.isConditionalExpression(parent) && child !== parent.condition ? [parent.condition, child === parent.whenTrue] : null;
    if (branch) {
      const value = constantTruth(branch[0]);
      if (value !== null && value !== branch[1]) return 'unreachable';
      if (value === null) state = 'conditional';
    } else if (ts.isBinaryExpression(parent) && child === parent.right && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken].includes(parent.operatorToken.kind)) state = 'conditional';
  }
  return state;
}
