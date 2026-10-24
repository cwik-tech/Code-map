// Operational patterns in source files that are not tests (C35), and the syntax errors of each parsed file (C40).
// The patterns are syntax matches inside one file: a lead to check in the code, not proof of a defect. Nothing is executed.
import ts from 'typescript';
export { scanDeclaredPatterns } from './declared-patterns.mjs';
import { refOwnsHandle } from './effect-handles.mjs';
import { importBindings, unwrap } from './source-metrics.mjs';

/** The finding rule of each pattern kind (refer to docs/retrieval.md). */
const ruleOf = { 'fetch-no-signal': 'FETCH-NO-SIGNAL', 'interval-not-cleared': 'INTERVAL-NOT-CLEARED', 'empty-catch': 'CATCH-EMPTY', 'effect-no-cleanup': 'EFFECT-NO-CLEANUP' };
const globalObjects = new Set(['window', 'globalThis', 'self', 'global']);
const effectHooks = new Set(['useEffect', 'useLayoutEffect']);
const labelLimit = 60;
/** `=`, `??=` and `||=` keep the handle of a timer call in their left side. */
const assignments = new Set([ts.SyntaxKind.EqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.BarBarEqualsToken]);
const lineOf = (source, node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
const nameText = (name) => name && (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name)) ? name.text : null;
const compact = (source, node) => { const text = node.getText(source).replace(/\s+/g, ' '); return text.length > labelLimit ? `${text.slice(0, labelLimit)}...` : text; };
/** A call as the key and the text show it: the callee and its first argument, with `<function>` for an inline function. */
const callLabel = (source, call) => {
  const [first] = call.arguments;
  return `${compact(source, call.expression)}(${!first ? '' : ts.isFunctionLike(first) ? '<function>' : compact(source, first)})`;
};
const isStatic = (node) => ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) ?? false;
/** True when the code can run more than one time: in a function, or in the initializer of a class field that is not static (one run for each instance). */
const insideFunction = (node) => {
  for (let parent = node.parent; parent; parent = parent.parent) if (ts.isFunctionLike(parent) || (ts.isPropertyDeclaration(parent) && !isStatic(parent))) return true;
  return false;
};

/** The syntax errors that the TypeScript parser reports for a file: the count, and the line and message of the first one. */
export function syntaxErrors(source) {
  // `parseDiagnostics` is internal to TypeScript. It is the only list of parser errors alone: a program also adds its checks of JS files.
  const list = source.parseDiagnostics ?? [];
  if (!list.length) return { errors: 0, line: null, message: null };
  const first = list.reduce((best, item) => (item.start ?? 0) < (best.start ?? 0) ? item : best);
  return { errors: list.length, line: source.getLineAndCharacterOfPosition(first.start ?? 0).line + 1, message: ts.flattenDiagnosticMessageText(first.messageText, ' ') };
}

/** The name of a global function that a call runs (`fetch(…)`, `window.fetch(…)`), or null. A binding of this file with that name is not the global. */
function globalCall(call, checker) {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return checker.getSymbolAtLocation(callee) ? null : callee.text;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && globalObjects.has(callee.expression.text)
    && !checker.getSymbolAtLocation(callee.expression)) return callee.name.text;
  return null;
}

/**
 * What the code does with the handle that a timer call returns: `discarded`, kept in a `variable`, kept in a `member`
 * (a property or a class field), or `escapes` (returned, passed on, put in a list, or used in another way).
 * `.unref()`, `.ref()` and `.refresh()` return the same timer, so the use of that call counts.
 */
function handleUse(call) {
  let node = call;
  for (;;) {
    while (ts.isParenthesizedExpression(node.parent) || ts.isAsExpression(node.parent) || ts.isNonNullExpression(node.parent)) node = node.parent;
    const access = node.parent;
    if (!ts.isPropertyAccessExpression(access) || access.expression !== node || !['unref', 'ref', 'refresh'].includes(access.name.text)
      || !ts.isCallExpression(access.parent) || access.parent.expression !== access) break;
    node = access.parent;
  }
  const parent = node.parent;
  if (ts.isExpressionStatement(parent) || ts.isVoidExpression(parent)) return 'discarded';
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) return 'variable';
  if (ts.isBinaryExpression(parent) && assignments.has(parent.operatorToken.kind) && parent.right === node) return ts.isIdentifier(parent.left) ? 'variable' : 'member';
  if (ts.isPropertyDeclaration(parent) && parent.initializer === node) return 'member';
  return 'escapes';
}

/**
 * False only when the options are an object literal with no `signal`, no spread and no computed key,
 * or when one argument that is not a `new Request(…)` is the only one.
 */
function mayHaveSignal(call) {
  const [input, options] = call.arguments;
  if (!input) return true;
  if (!options) return ts.isNewExpression(unwrap(input));
  const literal = unwrap(options);
  return !ts.isObjectLiteralExpression(literal) || literal.properties.some((property) => ts.isSpreadAssignment(property)
    || (property.name && ts.isComputedPropertyName(property.name)) || nameText(property.name) === 'signal');
}

/** The name path of the named declarations around a node: `Panel`, `Poller.start` or `start/poll`. Anonymous functions add nothing. */
function scopeOf(node) {
  let path = '';
  for (let current = node.parent; current && !ts.isSourceFile(current); current = current.parent) {
    if (!ts.isFunctionLike(current) && !ts.isClassLike(current)) continue;
    let host = current.parent;
    if (ts.isCallExpression(host) && host.arguments.includes(current)) host = host.parent; // memo(() => …), useCallback(() => …)
    const bound = ts.isVariableDeclaration(host) || ts.isPropertyAssignment(host) || ts.isPropertyDeclaration(host) ? host.name : null;
    const name = ts.isConstructorDeclaration(current) ? 'constructor' : nameText(current.name) ?? nameText(bound)
      ?? (ts.isFunctionDeclaration(current) || ts.isClassDeclaration(current) ? 'default' : null);
    if (name) path = path ? `${name}${ts.isClassLike(current) ? '.' : '/'}${path}` : name;
  }
  return path;
}

/** The React effect hook that a call runs (`useEffect`, an alias of it, `React.useLayoutEffect`), or null. */
function effectHook(call, checker, bindings) {
  const callee = call.expression;
  const local = ts.isIdentifier(callee) ? callee : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? callee.expression : null;
  const binding = local ? bindings.get(checker.getSymbolAtLocation(local)) : undefined;
  if (!binding || binding.specifier !== 'react' || binding.typeOnly) return null;
  const name = ts.isIdentifier(callee) ? binding.imported : binding.imported === 'default' || binding.imported === '*' ? callee.name.text : null;
  return effectHooks.has(name) ? name : null;
}

/** The label of a call that subscribes and needs a cleanup, or null. `concise`: the call is the whole body, so its value is returned. */
function subscription(source, call, checker, concise) {
  const callee = call.expression, global = globalCall(call, checker), args = call.arguments;
  const name = global ?? (ts.isPropertyAccessExpression(callee) ? callee.name.text : null);
  const once = (options) => !!options && ts.isObjectLiteralExpression(options) && options.properties.some((property) => nameText(property.name) === 'once'
    && ts.isPropertyAssignment(property) && property.initializer.kind === ts.SyntaxKind.TrueKeyword);
  if (name === 'addEventListener' && args.length >= 2 && !once(args[2])) return callLabel(source, call);
  if (global === 'setInterval' && (concise || ['discarded', 'variable'].includes(handleUse(call)))) return callLabel(source, call);
  if (global === 'setTimeout' && !concise && handleUse(call) === 'variable') return callLabel(source, call);
  // A concise body returns the value of subscribe() or on(), which can be the cleanup function.
  if (!global && !concise && ts.isPropertyAccessExpression(callee) && (name === 'subscribe' || (name === 'on' && args.length >= 2))) return callLabel(source, call);
  return null;
}

/** The subscriptions of an effect callback that returns no cleanup function. Code in nested functions does not count. */
function uncleaned(source, callback, checker) {
  if (!callback || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) return [];
  const found = [], async = ts.getModifiers(callback)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
  if (!ts.isBlock(callback.body)) {
    const value = unwrap(callback.body), call = ts.isCallExpression(value) ? subscription(source, value, checker, true) : null;
    return call ? [{ call, line: lineOf(source, value) }] : [];
  }
  let cleanup = false;
  const nothing = (node) => node.kind === ts.SyntaxKind.NullKeyword || ts.isVoidExpression(node) || (ts.isIdentifier(node) && node.text === 'undefined');
  const visit = (node) => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression && !nothing(unwrap(node.expression))) cleanup = true;
    const call = ts.isCallExpression(node) ? subscription(source, node, checker, false) : null;
    if (call && !refOwnsHandle(node, callback, checker)) found.push({ call, line: lineOf(source, node) });
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(callback.body, visit);
  // An async callback returns a promise, and React does not run a promise as a cleanup.
  return cleanup && !async ? [] : found;
}

/** The operational patterns of one source file, in source order. `checker` binds the names of this file only. */
export function scanPatterns(source, checker) {
  const found = [], ordinals = new Map(), intervals = [], bindings = importBindings(source, checker, () => null);
  const react = [...bindings.values()].some((binding) => binding.specifier === 'react');
  let clears = false;
  const add = (kind, node, call, extra = {}) => {
    const scope = scopeOf(node), name = JSON.stringify([kind, scope, call]), ordinal = ordinals.get(name) ?? 0;
    ordinals.set(name, ordinal + 1);
    found.push({ kind, line: lineOf(source, node), scope, call, ordinal, ...extra });
  };
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === 'clearInterval') clears = true;
    if (ts.isCatchClause(node) && node.block.statements.every(ts.isEmptyStatement)
      && !/\/[/*]/.test(source.text.slice(node.block.getStart(source) + 1, node.block.end - 1))) {
      const [first] = node.parent.tryBlock.statements;
      add('empty-catch', node, first ? compact(source, first) : '');
    }
    if (ts.isCallExpression(node)) {
      const global = globalCall(node, checker), hook = global || !react ? null : effectHook(node, checker, bindings);
      if (global === 'fetch' && !mayHaveSignal(node)) add('fetch-no-signal', node, callLabel(source, node));
      if (global === 'setInterval' && insideFunction(node)) intervals.push(node);
      const subscriptions = hook ? uncleaned(source, node.arguments[0], checker) : [];
      if (subscriptions.length) add('effect-no-cleanup', node, subscriptions[0].call, { hook, subscriptions });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const node of intervals) {
    const use = handleUse(node);
    if (use === 'discarded' || (use !== 'escapes' && !clears)) add('interval-not-cleared', node, callLabel(source, node), { reason: use === 'discarded' ? 'not-stored' : 'never-cleared' });
  }
  return found.sort((a, b) => a.line - b.line);
}

const at = (path, line, text) => ({ path, line, text });
const texts = {
  'fetch-no-signal': (item, where) => `${item.call} ${where} passes no signal, so the request has no timeout and nothing can cancel it. A wrapper, an agent or the platform can still set a timeout.`,
  'interval-not-cleared': (item, where) => item.reason === 'not-stored' ? `${item.call} ${where} keeps no handle, so nothing can clear the interval. Each run of ${item.scope || 'this code'} starts one more interval.`
    : `${item.call} ${where} starts an interval, but the file never calls clearInterval. Another file can still clear it.`,
  'empty-catch': (item, where) => `An empty catch block ${where} ignores every error of its try block, and no comment says why.`,
  'effect-no-cleanup': (item, where) => `A ${item.hook} callback ${where} subscribes with ${item.call} but returns no cleanup function. The subscription stays after the component unmounts, and each new run adds one more.`,
};

/** The findings of the pattern facts and the syntax errors of an analysis. `add` is the registry function of deriveFindings. */
export function patternFindings(analysis, add) {
  for (const file of analysis.files) for (const item of file.patterns ?? []) {
    const { kind, line, ordinal, ...facts } = item, where = item.scope ? `in ${item.scope}` : 'at the top level';
    add(ruleOf[kind], [file.path, item.scope, item.call, ordinal], { text: texts[kind](item, where), location: { path: file.path, line, symbol: item.scope || null }, paths: [file.path], facts,
      evidence: item.subscriptions ? item.subscriptions.slice(0, 3).map((entry) => at(file.path, entry.line, entry.call)) : [at(file.path, line, kind === 'empty-catch' ? `try { ${item.call} } catch {}` : item.call)] });
  }
  for (const item of analysis.safeguards?.items ?? []) if (item.state === 'FAIL') add(item.kind === 'retry-policy' ? 'RETRY-POLICY' : 'LOGGING-POLICY', [item.path, item.scope, item.kind, item.call, item.ordinal ?? 0], {
    text: item.reason, location: { path: item.path, line: item.line, symbol: item.scope }, paths: [item.path], facts: item,
    evidence: [at(item.path, item.line, item.call)] });
  for (const item of analysis.syntaxErrors ?? []) add('SYNTAX-ERROR', [item.path], { location: { path: item.path, line: item.line, symbol: null }, paths: [item.path],
    facts: { errors: item.errors, message: item.message, test: item.test }, evidence: [at(item.path, item.line, item.message)],
    text: `The TypeScript parser reports ${item.errors === 1 ? '1 syntax error' : `${item.errors} syntax errors`} in ${item.path}. The first is at line ${item.line}: ${item.message} The imports, exports, declarations${item.test ? ' and test cases' : ''} of this file can be incomplete.` });
}
