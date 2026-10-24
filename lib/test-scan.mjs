// Static facts about the test cases in one test file: names, status, assertions, failure checks and referenced source names.
// TypeScript parses and binds names; nothing runs. Failure checks are found by pattern, so a custom helper can hide one.
import ts from 'typescript';
import { importBindings, importedName, referenceSymbol } from './source-metrics.mjs';
import { assertionDetail, assertionOf } from './test-assertions.mjs';

const caseHeads = new Set(['it', 'test', 'specify', 'fit', 'xit', 'xtest', 'xspecify']);
const suiteHeads = new Set(['describe', 'context', 'suite', 'fdescribe', 'xdescribe']);
// Jasmine and Jest globals: an f prefix focuses a test, an x prefix skips it.
const headStatus = { fit: 'focused', fdescribe: 'focused', xit: 'skipped', xtest: 'skipped', xspecify: 'skipped', xdescribe: 'skipped' };
const modifierStatus = { only: 'focused', skip: 'skipped', fixme: 'skipped', todo: 'todo', skipIf: 'conditional', runIf: 'conditional', fails: 'expected-failure', failing: 'expected-failure' };
const modifiers = new Set(['only', 'skip', 'todo', 'fixme', 'concurrent', 'sequential', 'serial', 'parallel', 'fails', 'failing', 'shuffle', 'skipIf', 'runIf', 'each', 'for']);
const optionStatus = { skip: 'skipped', todo: 'todo', only: 'focused', fails: 'expected-failure', failing: 'expected-failure' };
const frameworkModule = /^(vitest|@jest\/globals|node:test|@playwright\/test|mocha|bun:test)$/;
const frameworks = [['@playwright/test', 'playwright'], ['cypress', 'cypress'], ['vitest', 'vitest'], ['@jest/globals', 'jest'], ['node:test', 'node:test'], ['mocha', 'mocha'], ['chai', 'mocha']];

const lineOf = (source, node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
const isFunction = (node) => ts.isArrowFunction(node) || ts.isFunctionExpression(node);
const label = (node) => ts.isStringLiteralLike(node) ? node.text : node.getText().replace(/\s+/g, ' ').slice(0, 160);

/**
 * The test cases of one test file. With `details`, each case also has `checks` (assertionDetail of each assertion, also in
 * the local helpers that it calls) and `plans` (the text of each expect.assertions() and expect.hasAssertions() call).
 * With `fullPlans`, plan text stays complete for identity hashing. Otherwise it has at most 160 characters.
 */
export function scanTests(source, checker, resolve, { details = false, fullPlans = false } = {}) {
  const helpers = localHelpers(source, checker);
  const ctx = { source, checker, bindings: importBindings(source, checker, resolve), mocks: mockedTargets(source, resolve), helpers, helperNodes: new Set(helpers.values()), memo: new Map(), active: new Set(), details, fullPlans };
  const cases = [], focused = [];
  const visit = (node, suite, inherited, inheritedExpected = false) => {
    const call = ts.isCallExpression(node) ? testCall(node, ctx) : null;
    if (!call) { ts.forEachChild(node, (child) => visit(child, suite, inherited, inheritedExpected)); return; }
    const line = lineOf(source, node);
    if (call.status === 'focused') focused.push({ line, name: call.name });
    const status = ['skipped', 'todo'].includes(inherited) ? inherited
      : ['skipped', 'todo'].includes(call.status) ? call.status
      : inherited === 'conditional' || call.status === 'conditional' ? 'conditional'
      : call.status === 'active' ? inherited : call.status;
    const expectedFailure = call.expectedFailure || inheritedExpected;
    if (call.role === 'case') {
      const facts = inspect(call.body, ctx);
      cases.push({ name: call.name, suite: suite.join(' > '), line, end: source.getLineAndCharacterOfPosition(node.end).line + 1, status, expectedFailure, each: call.each,
        ...facts, references: [...facts.references].sort(), smells: [...facts.smells].sort() });
    }
    if (call.body) visit(call.body, [...suite, call.name], status, expectedFailure); // suites, and node:test subtests inside a case
  };
  visit(source, [], 'active');
  return { framework: frameworkOf(source), mocks: [...ctx.mocks].sort(), focused, fetch: usesGlobal(source, checker, 'fetch'), cases };
}

/** A call that declares a test case or a suite, with its status from modifiers (`.only`, `.skip`) or node:test options. */
function testCall(node, ctx) {
  let callee = node.expression, status = 'active', each = false, expectedFailure = false;
  if (ts.isCallExpression(callee) && ts.isPropertyAccessExpression(callee.expression) && modifiers.has(callee.expression.name.text)) {
    const kind = callee.expression.name.text; // test.each(table)('name', fn), test.skipIf(condition)('name', fn)
    each = kind === 'each' || kind === 'for';
    status = modifierStatus[kind] ?? status;
    expectedFailure ||= kind === 'fails' || kind === 'failing';
    callee = callee.expression.expression;
  }
  const parts = [];
  while (ts.isPropertyAccessExpression(callee)) { parts.unshift(callee.name.text); callee = callee.expression; }
  if (!ts.isIdentifier(callee)) return null;
  // `import { test as check } from 'vitest'` and `import * as t from 'node:test'` resolve to the framework's own names.
  const binding = ctx.bindings.get(ctx.checker.getSymbolAtLocation(callee));
  const imported = binding && frameworkModule.test(binding.specifier) ? binding.imported : null;
  const head = imported === '*' ? parts.shift() ?? '' : imported === 'default' ? 'test' : imported ?? callee.text;
  let role = caseHeads.has(head) ? 'case' : suiteHeads.has(head) ? 'suite' : null;
  if (head === 'test' && parts[0] === 'describe') { role = 'suite'; parts.shift(); } // Playwright: test.describe()
  const subtest = !role && parts.length === 1 && parts[0] === 'test'; // node:test: t.test()
  if (subtest) { role = 'case'; parts.length = 0; }
  if (!role || !parts.every((part) => modifiers.has(part))) return null;
  const args = node.arguments;
  if (!args.length || isFunction(args[0])) return null;
  // The body is an inline function, or a local function passed by name: test('name', run).
  const named = (arg) => ts.isIdentifier(arg) ? ctx.helpers.get(ctx.checker.getSymbolAtLocation(arg)) : undefined;
  const last = [...args].slice(1).reverse().find((arg) => isFunction(arg) || named(arg));
  const body = !last ? null : isFunction(last) ? last : named(last).body ? named(last) : null;
  if (!body && (subtest || role === 'suite' || !ts.isStringLiteralLike(args[0]))) return null;
  status = headStatus[head] ?? status;
  for (const part of parts) { status = modifierStatus[part] ?? status; expectedFailure ||= part === 'fails' || part === 'failing'; }
  for (const option of args.filter(ts.isObjectLiteralExpression)) for (const property of option.properties) {
    const assignment = ts.isPropertyAssignment(property), named = assignment || ts.isShorthandPropertyAssignment(property);
    const name = named && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) ? property.name.text : null;
    const value = assignment ? property.initializer : null;
    if (!optionStatus[name] || value?.kind === ts.SyntaxKind.FalseKeyword) continue;
    expectedFailure ||= name === 'fails' || name === 'failing';
    status = value && (value.kind === ts.SyntaxKind.TrueKeyword || ts.isStringLiteralLike(value)) ? optionStatus[name] : 'conditional';
  }
  if (role === 'case' && !body && status === 'active') status = 'todo';
  return { role, status, expectedFailure, each, name: label(args[0]), body };
}

/** Assertions, failure checks, referenced imports and smells in a case body, including local helpers that it calls. */
function inspect(body, ctx) {
  const result = { assertions: 0, failures: [], references: new Set(), smells: new Set(), plan: false, subtests: 0, ...(ctx.details ? { checks: [], plans: [] } : {}) };
  if (!body) return result;
  const walk = (node) => {
    if (node !== body && ts.isCallExpression(node) && testCall(node, ctx)) { result.subtests++; return; }
    if (node !== body && ctx.helperNodes.has(node)) return; // a nested helper counts only where it is called
    if (ts.isCallExpression(node)) {
      const assertion = assertionOf(node, ctx);
      if (assertion) {
        result.assertions++;
        if (ctx.details) result.checks.push(assertionDetail(node, ctx));
        if (assertion.failure) {
          const targets = checkTargets(assertion.subject, ctx, 0);
          const expectedTargets = [...referencesIn([node], ctx)].filter((reference) => !targets.has(reference)).sort();
          result.failures.push({ line: lineOf(ctx.source, node), kind: assertion.failure, targets: [...targets].sort(), expectedTargets });
        }
        if (insideCondition(node, body)) result.smells.add('conditional-assertion');
      }
      const name = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ts.isIdentifier(node.expression) ? node.expression.text : '';
      if (['plan', 'assertions', 'hasAssertions'].includes(name) && ts.isPropertyAccessExpression(node.expression)) {
        result.plan = true;
        if (ctx.details && name !== 'plan' && node.expression.expression.getText(ctx.source) === 'expect') result.plans.push(node.getText(ctx.source).replace(/\s+/g, ' ').slice(0, ctx.fullPlans ? undefined : 160));
      }
      if (fixedWait(node, name)) result.smells.add('fixed-wait');
    }
    if (ts.isTryStatement(node) && node.catchClause && hidesFailure(node.catchClause.block) && hasAssertion(node.tryBlock, ctx)) result.smells.add('swallowed-error');
    if (ts.isIdentifier(node)) {
      const symbol = referenceSymbol(ctx.checker, node);
      const binding = ctx.bindings.get(symbol);
      if (binding?.target && !binding.typeOnly && !ctx.mocks.has(binding.target)) result.references.add(`${binding.target}#${importedName(binding, node)}`);
      const helper = ctx.helpers.get(symbol);
      const declared = node.parent?.name === node && (ts.isFunctionDeclaration(node.parent) || ts.isVariableDeclaration(node.parent));
      // expectInvalid(() => parse(x)): a helper's untied failure checks are about the names in the call's arguments.
      const call = ts.isCallExpression(node.parent) && node.parent.expression === node ? node.parent : null;
      if (helper && !declared && helper !== body) merge(result, helperFacts(helper, ctx), call ? referencesIn(call.arguments, ctx) : new Set());
    }
    ts.forEachChild(node, walk);
  };
  walk(body);
  return result;
}

const noFacts = { assertions: 0, failures: [], references: new Set(), smells: new Set(), plan: false, subtests: 0 };
function helperFacts(helper, ctx) {
  if (ctx.memo.has(helper)) return ctx.memo.get(helper);
  if (ctx.active.has(helper)) return noFacts; // recursive helpers
  ctx.active.add(helper);
  const facts = inspect(helper.body, ctx);
  ctx.active.delete(helper);
  ctx.memo.set(helper, facts);
  return facts;
}

/** A helper's checks and calls count for the case; its smells do not, because cleanup helpers often catch on purpose. */
function merge(result, facts, bind) {
  result.assertions += facts.assertions;
  result.failures.push(...facts.failures.map((failure) => failure.targets.length || !bind.size ? failure : { ...failure, targets: [...bind].sort() }));
  for (const reference of facts.references) result.references.add(reference);
  result.plan ||= facts.plan;
  if (result.checks) { result.checks.push(...(facts.checks ?? [])); result.plans.push(...(facts.plans ?? [])); }
}

/** Imported source names referenced inside these nodes, including through local helpers. */
function referencesIn(nodes, ctx) {
  const found = new Set();
  const walk = (node) => {
    if (ts.isIdentifier(node)) {
      const symbol = referenceSymbol(ctx.checker, node), binding = ctx.bindings.get(symbol), helper = ctx.helpers.get(symbol);
      if (binding?.target && !binding.typeOnly && !ctx.mocks.has(binding.target)) found.add(`${binding.target}#${importedName(binding, node)}`);
      if (helper) for (const reference of helperFacts(helper, ctx).references) found.add(reference);
    }
    ts.forEachChild(node, walk);
  };
  for (const node of nodes) walk(node);
  return found;
}

/**
 * The source names that a failure check is about: names inside the checked subject, and, for a local variable in it, the
 * names in the value it holds (`const r = parse(x)`), or in the try block or promise that a caught error comes from.
 */
function checkTargets(node, ctx, depth) {
  if (!node) return new Set();
  const found = referencesIn([node], ctx);
  if (depth >= 2) return found;
  const walk = (child) => {
    if (ts.isIdentifier(child)) {
      const origin = valueOrigin(referenceSymbol(ctx.checker, child));
      if (origin) for (const reference of checkTargets(origin, ctx, depth + 1)) found.add(reference);
    }
    ts.forEachChild(child, walk);
  };
  walk(node);
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

function hasAssertion(node, ctx) {
  let found = false;
  const walk = (child) => { if (found) return; if (ts.isCallExpression(child) && assertionOf(child, ctx)) found = true; else ts.forEachChild(child, walk); };
  walk(node);
  return found;
}

function insideCondition(node, body) {
  for (let parent = node.parent; parent && parent !== body; parent = parent.parent) if (ts.isIfStatement(parent) || ts.isConditionalExpression(parent)) return true;
  return false;
}

/**
 * A fixed wait: `new Promise((resolve) => setTimeout(resolve, 100))`, `sleep(100)` or Playwright's `waitForTimeout`.
 * A timer that rejects is a time limit for another promise, not a wait.
 */
function fixedWait(node, name) {
  if (['sleep', 'delay', 'waitForTimeout'].includes(name)) return node.arguments.some(ts.isNumericLiteral);
  if (name === 'wait') return ts.isIdentifier(node.expression) && node.arguments.length === 1 && ts.isNumericLiteral(node.arguments[0]); // not wait(condition, timeout)
  if (name !== 'setTimeout' || !node.arguments.length) return false;
  for (let parent = node.parent, depth = 0; parent && depth < 4; parent = parent.parent, depth++) {
    if (!ts.isNewExpression(parent) || parent.expression.getText() !== 'Promise') continue;
    const executor = parent.arguments?.[0], first = executor && isFunction(executor) ? executor.parameters[0]?.name : null;
    const resolve = first && ts.isIdentifier(first) ? first.text : null;
    const callback = node.arguments[0];
    if (!resolve) return false;
    return ts.isIdentifier(callback) ? callback.text === resolve : isFunction(callback) && new RegExp(`\\b${resolve}\\s*\\(`).test(callback.body.getText());
  }
  return false;
}

/** An empty catch block, or one that only logs: a failure inside the try block can pass unnoticed. */
function hidesFailure(block) {
  return block.statements.every((statement) => ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)
    && ts.isPropertyAccessExpression(statement.expression.expression) && statement.expression.expression.expression.getText() === 'console');
}

/** Functions declared anywhere in the file, so a case that calls a local helper also gets the helper's assertions and calls. */
function localHelpers(source, checker) {
  const helpers = new Map();
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) helpers.set(checker.getSymbolAtLocation(node.name), node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isFunction(node.initializer)) helpers.set(checker.getSymbolAtLocation(node.name), node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(source);
  helpers.delete(undefined);
  return helpers;
}

/** Modules replaced with `vi.mock`, `jest.mock` or node:test `mock.module`: references to them do not reach real code. */
function mockedTargets(source, resolve) {
  const targets = new Set();
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.arguments.length && ts.isStringLiteralLike(node.arguments[0])) {
      const name = node.expression.name.text, owner = node.expression.expression.getText();
      if ((/^(vi|jest)$/.test(owner) && /^(mock|doMock|unstable_mockModule)$/.test(name)) || (name === 'module' && /(^|\.)mock$/.test(owner))) {
        const target = resolve(source.fileName, node.arguments[0].text);
        if (target) targets.add(target);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return targets;
}

function frameworkOf(source) {
  const specifiers = source.statements.filter((node) => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)).map((node) => node.moduleSpecifier.text);
  const found = frameworks.find(([specifier]) => specifiers.includes(specifier));
  if (found) return found[1];
  if (/\bvi\.(fn|mock|spyOn|useFakeTimers)\b/.test(source.text)) return 'vitest';
  if (/\bjest\.(fn|mock|spyOn|useFakeTimers)\b/.test(source.text)) return 'jest';
  return /\bcy\.[a-z]/.test(source.text) ? 'cypress' : 'unknown';
}

/** A call to a global such as `fetch` that the file does not declare or import. */
function usesGlobal(source, checker, name) {
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name && !checker.getSymbolAtLocation(node.expression)?.valueDeclaration) found = true;
    else ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
