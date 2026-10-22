// Recognizes assertions in test code and classifies the failure that each one checks.
// A pattern match on Jest, Vitest, Playwright, chai and node:assert styles: a custom helper can hide a check.
import ts from 'typescript';
import { referenceSymbol, unwrap } from './source-metrics.mjs';

const assertModule = /^(node:)?assert(\/strict)?$|^chai$|^power-assert$/;
const absenceMatchers = new Set(['toBeUndefined', 'toBeNull', 'toBeFalsy', 'toBeHidden']);
const countMatchers = new Set(['toHaveLength', 'toHaveCount', 'toHaveBeenCalledTimes']);
const equalityMatchers = new Set(['toBe', 'toEqual', 'toStrictEqual', 'equal', 'equals', 'eql']);
const textMatchers = new Set(['toMatch', 'toContain', 'toHaveTextContent', 'toContainText', 'toHaveText', 'match', 'include', 'contain']);
const statusNames = new Set(['status', 'statusCode', 'code', 'exitCode']);
const okNames = new Set(['ok', 'success', 'succeeded', 'valid', 'isValid', 'passed', 'allowed', 'accepted']);
const errorName = /^(err|error|errors|exception|failure|failures|issues|stderr|rejection|violations|problems|errorMessage|errorCode|errorText)$|[a-z](Error|Errors|Failure|Failures|Issues|Violations)$/;
const failureStatus = /^(fail|failed|failure|error|errored|rejected|denied|forbidden|unauthori[sz]ed|invalid|blocked|cancell?ed|timeout|timed[_ -]?out|aborted|not[_ -]?found|conflict|refused)/i;
// Underscores and hyphens separate words here, so "invalid_request" and "not-found" match.
const failureText = /(?<![a-z])(error|errors|invalid|fail(s|ed|ure)?|denied|forbidden|unauthori[sz]ed|not[ _-]found|required|rejected|refused|cannot|can't|expired|alert)(?![a-z])/i;
// Expected text alone is weaker evidence than a message that the page shows, so it needs a stronger word than "cannot".
const strongFailureText = /(?<![a-z])(error|errors|invalid|fail(s|ed|ure)?|denied|forbidden|unauthori[sz]ed|not[ _-]found|rejected|refused|expired)(?![a-z])/i;
const lookup = /^((get|find|query)(All)?By[A-Z]\w*|locator)$/; // Testing Library and Playwright queries
const textLimit = 100; // longer text is a fixture, not a message

/** `null` for a call that is not an assertion; otherwise the failure kind that it checks, or null for a plain check. */
export function assertionOf(node, ctx) {
  const callee = node.expression, chain = [];
  let root = callee;
  while (ts.isPropertyAccessExpression(root) || ts.isNonNullExpression(root)) { if (ts.isPropertyAccessExpression(root)) chain.unshift(root.name.text); root = root.expression; }
  if (chain.length && ts.isCallExpression(root) && isExpect(root.expression)) return { failure: expectFailure(root.arguments[0], chain, node.arguments, ctx) };
  const fn = assertFunction(callee, chain, root, ctx);
  if (fn) return { failure: assertFailure(fn, [...node.arguments], ctx) };
  // Custom helpers such as expectError(result): counted, and helpers named after a failure count as failure checks.
  if (ts.isIdentifier(callee) && /^(assert|expect)[A-Z_]/.test(callee.text) && !ctx.helpers.has(referenceSymbol(ctx.checker, callee))) {
    return { failure: /Error|Fail|Throw|Reject|Invalid|Denied|Forbidden|Unauthori/.test(callee.text) ? 'helper' : null };
  }
  return null;
}

const isExpect = (node) => (ts.isIdentifier(node) && (node.text === 'expect' || node.text === 'expectTypeOf'))
  || (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'expect' && ['soft', 'poll'].includes(node.name.text));

function assertFunction(callee, chain, root, ctx) {
  const binding = ts.isIdentifier(root) ? ctx.bindings.get(ctx.checker.getSymbolAtLocation(root)) : undefined;
  const fromModule = binding && assertModule.test(binding.specifier);
  if (ts.isIdentifier(callee)) {
    if (callee.text === 'assert' && !binding) return 'ok';
    return fromModule ? (binding.imported === 'default' || binding.imported === '*' || binding.imported === 'assert' ? 'ok' : binding.imported) : null;
  }
  if (!chain.length) return null;
  if (ts.isIdentifier(root) && (fromModule || (root.text === 'assert' && !binding))) return chain.at(-1);
  const index = chain.indexOf('assert'); // t.assert.equal() in node:test
  return index >= 0 && index < chain.length - 1 ? chain.at(-1) : null;
}

function expectFailure(subject, chain, args, ctx) {
  const negated = chain.includes('not'), matcher = chain.at(-1), expected = args[0];
  if (chain.includes('rejects') || matcher === 'rejectedWith') return negated ? null : 'rejects';
  if (/^(toThrow|throw|throws)/.test(matcher)) return negated ? null : 'throws';
  const equality = equalityMatchers.has(matcher);
  let presence = !absenceMatchers.has(matcher) && !(countMatchers.has(matcher) && literalOf(expected) === 0) && !(equality && expected && isEmptyValue(expected));
  if (negated) presence = !presence;
  return (negated ? null : objectFailure(expected)) ?? valueFailure(subject, equality ? expected : undefined, presence, negated && equality, ctx)
    ?? (presence && textMatchers.has(matcher) ? expectedFailure(expected) : null);
}

function assertFailure(fn, args, ctx) {
  if (fn === 'throws' || fn === 'throw') return 'throws';
  if (fn === 'rejects' || fn === 'isRejected') return 'rejects';
  if (/^doesNot|^fail$|^ifError$/.test(fn)) return null;
  let [subject, expected] = args;
  if (subject && expected && literalOf(subject) !== undefined && literalOf(expected) === undefined) [subject, expected] = [expected, subject];
  if (['ok', 'isOk', 'isTrue', 'notOk', 'isNotOk', 'isFalse'].includes(fn)) {
    const bang = !!subject && ts.isPrefixUnaryExpression(subject) && subject.operator === ts.SyntaxKind.ExclamationToken;
    const positive = bang === ['notOk', 'isNotOk', 'isFalse'].includes(fn);
    return valueFailure(bang ? subject.operand : subject, undefined, positive, false, ctx);
  }
  if (/^(equal|strictEqual|deepEqual|deepStrictEqual|partialDeepStrictEqual|is|sameMembers)$/.test(fn)) {
    return objectFailure(expected) ?? valueFailure(subject, expected, !(expected && isEmptyValue(expected)), false, ctx);
  }
  if (/^not(Strict|Deep|DeepStrict)?Equal$/.test(fn)) return valueFailure(subject, expected, !!expected && isEmptyValue(expected), true, ctx);
  if (['match', 'include', 'includes'].includes(fn)) return valueFailure(subject, undefined, true, false, ctx) ?? expectedFailure(expected);
  return null;
}

/** Errors as values: an error property that exists, a failed status, or `ok: false`. `inverted` is a not-equal check. */
function valueFailure(subject, expected, presence, inverted, ctx) {
  if (!subject) return null;
  const { names, root } = pathOf(subject), last = names.at(-1) ?? '', value = literalOf(expected);
  if (statusNames.has(last) && (typeof value === 'number' || typeof value === 'string')) {
    const bad = typeof value === 'string' ? failureStatus.test(value) : value >= 400 || (value > 0 && value < 100);
    return bad !== inverted ? 'status' : null;
  }
  if (okNames.has(last)) return (value === false ? !inverted : value === true ? inverted : !presence) ? 'ok-false' : null;
  if (names.some((name) => errorName.test(name)) || (root && caughtError(root, ctx))) return presence ? 'error-value' : null;
  return presence ? shownFailure(subject) : null;
}

function objectFailure(node) {
  node = node && unwrap(node);
  if (!node || !ts.isObjectLiteralExpression(node)) return null;
  for (const property of node.properties) {
    const key = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : null;
    if (ts.isShorthandPropertyAssignment(property) && /^errors?$/.test(key)) return 'error-value';
    if (!key || !ts.isPropertyAssignment(property)) continue;
    const value = literalOf(property.initializer);
    if (/^errors?$/.test(key) && !isEmptyValue(property.initializer)) return 'error-value';
    if (okNames.has(key) && value === false) return 'ok-false';
    if ((key === 'status' || key === 'statusCode') && (typeof value === 'number' ? value >= 400 : typeof value === 'string' && failureStatus.test(value))) return 'status';
  }
  return null;
}

const isShortText = (node) => (ts.isStringLiteralLike(node) || ts.isRegularExpressionLiteral(node)) && node.text.length <= textLimit;

/** A failure message that the checked element is looked up by: `getByText(/invalid email/)`, `getByRole('alert')`. */
function shownFailure(node) {
  for (let current = node && unwrap(node); current;) {
    if (ts.isCallExpression(current)) {
      const name = ts.isPropertyAccessExpression(current.expression) ? current.expression.name.text : ts.isIdentifier(current.expression) ? current.expression.text : '';
      if (lookup.test(name) && current.arguments.some((arg) => isShortText(arg) && failureText.test(arg.text))) return 'error-message';
      current = current.expression;
    } else if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) current = unwrap(current.expression);
    else break;
  }
  return null;
}

/** A failure word in the expected text of a match, for example `toContain('invalid_request')`. */
function expectedFailure(node) {
  node = node && unwrap(node);
  return node && isShortText(node) && strongFailureText.test(node.text) ? 'error-message' : null;
}

function pathOf(node) {
  const names = [];
  let root = null;
  const walk = (current) => {
    current = unwrap(current);
    if (ts.isIdentifier(current)) { root = current; names.push(current.text); }
    else if (ts.isPropertyAccessExpression(current)) { walk(current.expression); names.push(current.name.text); }
    else if (ts.isElementAccessExpression(current)) { walk(current.expression); if (ts.isStringLiteralLike(current.argumentExpression)) names.push(current.argumentExpression.text); }
    else if (ts.isCallExpression(current)) walk(current.expression);
    else if (ts.isPrefixUnaryExpression(current)) walk(current.operand);
  };
  walk(node);
  return { names, root };
}

/** A variable bound by `catch (error)` or a `.catch((error) => …)` callback holds a failure even with a short name. */
function caughtError(identifier, ctx) {
  const declaration = ctx.checker.getSymbolAtLocation(identifier)?.valueDeclaration;
  if (!declaration) return false;
  if (ts.isVariableDeclaration(declaration) && ts.isCatchClause(declaration.parent)) return true;
  const owner = ts.isParameter(declaration) ? declaration.parent.parent : null;
  return !!owner && ts.isCallExpression(owner) && ts.isPropertyAccessExpression(owner.expression) && owner.expression.name.text === 'catch';
}

function literalOf(node) {
  if (!node) return undefined;
  node = unwrap(node);
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === 'undefined')) return null;
  return undefined;
}

function isEmptyValue(node) {
  const value = literalOf(node);
  if (value === null || value === false || value === 0 || value === '') return true;
  node = unwrap(node);
  return (ts.isArrayLiteralExpression(node) && node.elements.length === 0) || (ts.isObjectLiteralExpression(node) && node.properties.length === 0);
}
