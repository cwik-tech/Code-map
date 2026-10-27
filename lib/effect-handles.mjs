// Ref-owned handles have cleanup outside the effect that creates them. Match symbols, not identifier text.
import ts from 'typescript';
import { unwrap } from './source-metrics.mjs';

/** An access path that starts with an identifier and its current property. */
function refMember(node) {
  node = unwrap(node);
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
  const base = unwrap(node.expression);
  if (ts.isIdentifier(base)) return ts.isPropertyAccessExpression(node) ? node.name.text === 'current'
    : ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'current';
  return refMember(base);
}

/** A value stored by assignment or by a collection mutator on a ref member. */
function stored(node) {
  let value = node;
  while (ts.isParenthesizedExpression(value.parent) || ts.isAsExpression(value.parent)) value = value.parent;
  const parent = value.parent;
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.right === value) return refMember(parent.left);
  if (!ts.isCallExpression(parent)) return false;
  const callee = parent.expression;
  if (!ts.isPropertyAccessExpression(callee) || !refMember(callee.expression)) return false;
  if (callee.name.text === 'set') return parent.arguments[1] === value;
  return ['add', 'push', 'unshift'].includes(callee.name.text) && parent.arguments.includes(value);
}

/** True when the call result, or its local binding, is stored in a ref within this effect. */
export function refOwnsHandle(call, callback, checker) {
  if (stored(call)) return true;
  let value = call;
  while (ts.isParenthesizedExpression(value.parent) || ts.isAsExpression(value.parent)) value = value.parent;
  const parent = value.parent;
  const binding = ts.isVariableDeclaration(parent) ? parent.name
    : ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.right === value ? parent.left : null;
  if (!binding || !ts.isIdentifier(binding)) return false;
  const symbol = checker.getSymbolAtLocation(binding);
  if (!symbol) return false;
  let found = false, reassigned = false;
  const visit = (node) => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === symbol) {
      const host = node.parent;
      if (host !== parent && ts.isBinaryExpression(host) && host.left === node
        && (host.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && host.operatorToken.kind <= ts.SyntaxKind.LastAssignment)) reassigned = true;
      if (host !== parent && (ts.isPostfixUnaryExpression(host) || ts.isPrefixUnaryExpression(host))
        && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(host.operator)) reassigned = true;
      if (node.pos >= call.end && stored(node)) found = true;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(callback.body, visit);
  return found && !reassigned;
}
