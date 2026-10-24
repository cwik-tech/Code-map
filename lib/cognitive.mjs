// Cognitive complexity from Campbell (2017). Nested functions keep separate totals.
import ts from 'typescript';

const logical = new Set([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken]);
const isLogical = (node) => ts.isBinaryExpression(node) && logical.has(node.operatorToken.kind);
const loop = (node) => ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)
  || ts.isWhileStatement(node) || ts.isDoStatement(node);
const structural = (node) => ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isSwitchStatement(node)
  || loop(node) || ts.isCatchClause(node);
const elseIf = (node) => ts.isIfStatement(node) && ts.isIfStatement(node.parent) && node.parent.elseStatement === node;
const functionBody = (node) => ts.isFunctionLike(node) && node.body !== undefined;
const transparent = (node) => ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
  || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node);
const unwrap = (node) => { while (transparent(node)) node = node.expression; return node; };
const nameText = (node) => node && (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteral(node)) ? node.text : null;

/** Lexical nesting includes enclosing functions and controls, with an else-if chain at one level. */
function enclosingDepth(node) {
  let depth = 0;
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (functionBody(parent)) depth++;
    if (structural(parent) && !(ts.isIfStatement(parent) && parent.elseStatement === child && ts.isIfStatement(child))) depth++;
  }
  return depth;
}

/** Direct calls use the function name, its variable binding, or this.method for a method. */
function recursiveCall(call, fn) {
  const callee = unwrap(call.expression);
  let value = fn;
  while (transparent(value.parent)) value = value.parent;
  const parent = value.parent;
  const binding = ts.isVariableDeclaration(parent) && parent.initializer === value ? parent.name : null;
  const name = nameText(fn.name) ?? nameText(binding);
  if (name === null) return false;
  if (ts.isMethodDeclaration(fn)) return ts.isPropertyAccessExpression(callee)
    && callee.expression.kind === ts.SyntaxKind.ThisKeyword && nameText(callee.name) === name;
  return ts.isIdentifier(callee) && callee.text === name;
}

/** Count one function body without adding the totals of nested functions. */
export function cognitiveOf(fn) {
  let total = 0;
  const walk = (node, depth) => {
    if (!node || functionBody(node)) return;
    if (isLogical(node)) {
      let previous;
      const sequence = (part) => {
        part = unwrap(part);
        if (!isLogical(part)) { walk(part, depth); return; }
        sequence(part.left);
        const operator = part.operatorToken.kind;
        if (operator !== previous) total++;
        previous = operator;
        sequence(part.right);
      };
      sequence(node);
      return;
    }
    if (ts.isIfStatement(node)) {
      total += elseIf(node) ? 1 : 1 + depth;
      walk(node.expression, depth + 1);
      walk(node.thenStatement, depth + 1);
      if (node.elseStatement) {
        if (ts.isIfStatement(node.elseStatement)) walk(node.elseStatement, depth);
        else { total++; walk(node.elseStatement, depth + 1); }
      }
      return;
    }
    if (structural(node)) {
      total += 1 + depth;
      ts.forEachChild(node, (child) => walk(child, depth + 1));
      return;
    }
    if (ts.isBreakOrContinueStatement(node) && node.label) total++;
    if (ts.isCallExpression(node) && recursiveCall(node, fn)) total++;
    ts.forEachChild(node, (child) => walk(child, depth));
  };
  walk(fn.body, enclosingDepth(fn));
  return total;
}
