// Static facts about the test cases in one test file: names, status, assertions, failure checks and referenced source names.
// TypeScript parses and binds names; nothing runs. Failure checks are found by pattern, so a custom helper can hide one.
import ts from 'typescript';
import { importBindings, importedName, referenceSymbol } from './source-metrics.mjs';
import { assertionOf } from './test-assertions.mjs';
import { checkTargets, conditionOf, referencesIn } from './test-evidence.mjs';

const caseHeads = new Set(['it', 'test', 'specify', 'fit', 'xit', 'xtest', 'xspecify']);
const suiteHeads = new Set(['describe', 'context', 'suite', 'fdescribe', 'xdescribe']);
// Jasmine and Jest globals: an f prefix focuses a test, an x prefix skips it.
const headStatus = { fit: 'focused', fdescribe: 'focused', xit: 'skipped', xtest: 'skipped', xspecify: 'skipped', xdescribe: 'skipped' };
const modifierStatus = { only: 'focused', skip: 'skipped', fixme: 'skipped', todo: 'todo', skipIf: 'conditional', runIf: 'conditional' };
const modifiers = new Set(['only', 'skip', 'todo', 'fixme', 'concurrent', 'sequential', 'serial', 'parallel', 'fails', 'failing', 'shuffle', 'skipIf', 'runIf', 'each', 'for']);
const optionStatus = { skip: 'skipped', todo: 'todo', only: 'focused' };
const frameworkModule = /^(vitest|@jest\/globals|node:test|@playwright\/test|mocha|bun:test)$/;
const frameworks = [['@playwright/test', 'playwright'], ['cypress', 'cypress'], ['vitest', 'vitest'], ['@jest/globals', 'jest'], ['node:test', 'node:test'], ['mocha', 'mocha'], ['chai', 'mocha']];

const lineOf = (source, node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
const isFunction = (node) => ts.isArrowFunction(node) || ts.isFunctionExpression(node);
const label = (node) => ts.isStringLiteralLike(node) ? node.text : node.getText().replace(/\s+/g, ' ').slice(0, 160);

export function scanTests(source, checker, resolve) {
  const helpers = localHelpers(source, checker);
  const ctx = { source, checker, bindings: importBindings(source, checker, resolve), mocks: mockedTargets(source, resolve), helpers, helperNodes: new Set(helpers.values()), memo: new Map(), active: new Set() };
  ctx.helperFacts = (helper) => helperFacts(helper, ctx);
  const cases = [], focused = [];
  // The effective status: a skipped or todo suite dominates a child's .only or condition, and a condition dominates a focus.
  // A .only marker is kept separately, because it can stop other tests from running even inside a skipped suite.
  const rank = { active: 0, focused: 1, conditional: 2, skipped: 3, todo: 3 };
  const visit = (node, suite, inherited, focusedAbove) => {
    const call = ts.isCallExpression(node) ? testCall(node, ctx) : null;
    if (!call) { ts.forEachChild(node, (child) => visit(child, suite, inherited, focusedAbove)); return; }
    const line = lineOf(source, node), focus = focusedAbove || call.status === 'focused';
    if (call.status === 'focused') focused.push({ line, name: call.name });
    const status = rank[call.status] >= rank[inherited] ? call.status : inherited;
    if (call.role === 'case') {
      const facts = inspect(call.body, ctx);
      cases.push({ name: call.name, suite: suite.join(' > '), line, end: source.getLineAndCharacterOfPosition(node.end).line + 1, status, focus, each: call.each,
        ...facts, references: [...facts.references].sort(), smells: [...facts.smells].sort() });
    }
    if (call.body) visit(call.body, [...suite, call.name], status, focus); // suites, and node:test subtests inside a case
  };
  visit(source, [], 'active', false);
  return { framework: frameworkOf(source), mocks: [...ctx.mocks].sort(), focused, fetch: usesGlobal(source, checker, 'fetch'), cases };
}

/** A call that declares a test case or a suite, with its status from modifiers (`.only`, `.skip`) or node:test options. */
function testCall(node, ctx) {
  let callee = node.expression, status = 'active', each = false;
  if (ts.isCallExpression(callee) && ts.isPropertyAccessExpression(callee.expression) && modifiers.has(callee.expression.name.text)) {
    const kind = callee.expression.name.text; // test.each(table)('name', fn), test.skipIf(condition)('name', fn)
    each = kind === 'each' || kind === 'for';
    status = modifierStatus[kind] ?? status;
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
  for (const part of parts) status = modifierStatus[part] ?? status;
  for (const option of args.filter(ts.isObjectLiteralExpression)) for (const property of option.properties) {
    const key = ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) ? property.name.text : null;
    if (!optionStatus[key] || property.initializer.kind === ts.SyntaxKind.FalseKeyword) continue;
    status = property.initializer.kind === ts.SyntaxKind.TrueKeyword || ts.isStringLiteralLike(property.initializer) ? optionStatus[key] : 'conditional';
  }
  if (role === 'case' && !body && status === 'active') status = 'todo';
  return { role, status, each, name: label(args[0]), body };
}

/** Assertions, failure checks, referenced imports and smells in a case body, including local helpers that it calls. */
function inspect(body, ctx) {
  const result = { assertions: 0, failures: [], checks: [], references: new Set(), smells: new Set(), plan: false, subtests: 0 };
  if (!body) return result;
  const walk = (node) => {
    if (node !== body && ts.isCallExpression(node) && testCall(node, ctx)) { result.subtests++; return; }
    if (node !== body && ctx.helperNodes.has(node)) return; // a nested helper counts only where it is called
    if (ts.isCallExpression(node)) {
      const assertion = assertionOf(node, ctx);
      const reach = assertion ? conditionOf(node, body) : null;
      if (reach) result.smells.add('conditional-assertion');
      if (assertion && reach !== 'unreachable') { // a check under `if (false)` can never run, so it is not counted
        result.assertions++;
        const line = lineOf(ctx.source, node), targets = [...checkTargets(node, ctx, 0)].sort(), when = reach ? { conditional: true } : {};
        result.checks.push({ line, strength: assertion.strength, targets, ...when });
        if (assertion.failure) result.failures.push({ line, kind: assertion.failure, targets, ...when });
      }
      const name = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ts.isIdentifier(node.expression) ? node.expression.text : '';
      if (['plan', 'assertions', 'hasAssertions'].includes(name) && ts.isPropertyAccessExpression(node.expression)) result.plan = true;
      if (fixedWait(node, name)) result.smells.add('fixed-wait');
    }
    if (ts.isTryStatement(node) && node.catchClause && hidesFailure(node.catchClause.block) && hasAssertion(node.tryBlock, ctx)) result.smells.add('swallowed-error');
    if (ts.isIdentifier(node)) {
      const symbol = referenceSymbol(ctx.checker, node);
      const binding = ctx.bindings.get(symbol);
      if (binding?.target && !binding.typeOnly && !ctx.mocks.has(binding.target)) result.references.add(`${binding.target}#${importedName(binding, node)}`);
      const helper = ctx.helpers.get(symbol);
      const declared = node.parent?.name === node && (ts.isFunctionDeclaration(node.parent) || ts.isVariableDeclaration(node.parent));
      if (helper && !declared && helper !== body) {
        const facts = helperFacts(helper, ctx), parent = node.parent;
        // A helper's checks count where it runs: called, or passed to a known callback consumer such as forEach or test.step.
        // expectInvalid(() => parse(x)): its untied checks are about the names in the call's arguments.
        const call = ts.isCallExpression(parent) && parent.expression === node ? parent : null;
        const consumer = !call && ts.isCallExpression(parent) && parent.arguments.includes(node) && callbackConsumers.has(calleeName(parent));
        const reach = call || consumer ? conditionOf(node, body) : 'unreachable';
        if (reach !== 'unreachable') merge(result, facts, call ? referencesIn(call.arguments, ctx) : new Set(), reach === 'conditional');
        else for (const reference of facts.references) result.references.add(reference); // a bare reference: possible reach, no check
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(body);
  return result;
}

const noFacts = { assertions: 0, failures: [], checks: [], references: new Set(), smells: new Set(), plan: false, subtests: 0 };
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
function merge(result, facts, bind, conditional) {
  result.assertions += facts.assertions;
  const tie = (item) => {
    const tied = item.targets.length || !bind.size ? item : { ...item, targets: [...bind].sort() };
    return conditional && !tied.conditional ? { ...tied, conditional: true } : tied;
  };
  result.failures.push(...facts.failures.map(tie));
  result.checks.push(...facts.checks.map(tie));
  for (const reference of facts.references) result.references.add(reference);
  result.plan ||= facts.plan;
}

function hasAssertion(node, ctx) {
  let found = false;
  const walk = (child) => { if (found) return; if (ts.isCallExpression(child) && assertionOf(child, ctx)) found = true; else ts.forEachChild(child, walk); };
  walk(node);
  return found;
}

const callbackConsumers = new Set(['forEach', 'map', 'flatMap', 'filter', 'some', 'every', 'reduce', 'then', 'step']);
const calleeName = (call) => ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : ts.isIdentifier(call.expression) ? call.expression.text : '';

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
