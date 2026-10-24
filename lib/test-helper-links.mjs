// Resolve cached helper calls without parsing source files.
import ts from 'typescript';

export function bindPending(pending, call, ctx, targets, indices) {
  if (!call) return pending;
  let fallback = pending.fallback;
  if (fallback) {
    const inputs = fallback.parameters ? fallback.parameters.map((index) => call.arguments[index]).filter(Boolean) : [...call.arguments];
    fallback = { ...fallback, smells: [], targets: fallback.targets.length ? fallback.targets : [...new Set(inputs.flatMap((arg) => [...targets(arg, ctx, 0)]))].sort(),
      expectedTargets: [...new Set([...fallback.expectedTargets, ...call.arguments.filter((arg) => !inputs.includes(arg)).flatMap((arg) => [...targets(arg, ctx, 0)])])].sort(),
      parameters: ctx.parameters ? inputs.flatMap((arg) => indices(arg, ctx)) : null };
  }
  return { ...pending, fallback, arguments: pending.arguments.map((arg) => {
    const inputs = arg.parameters.map((index) => call.arguments[index]).filter(Boolean);
    return { references: [...new Set([...arg.references, ...inputs.flatMap((node) => [...targets(node, ctx, 0)])])],
      parameters: inputs.flatMap((node) => indices(node, ctx)) };
  }) };
}

function resolved(pending, helpers) {
  const exported = helpers.get(pending.target);
  const facts = exported && Object.hasOwn(exported, pending.imported) ? exported[pending.imported] : null;
  if (exported === undefined) {
    if (!pending.fallback) return null;
    const { failure, smells, parameters, ...fallback } = pending.fallback;
    return { assertions: 1, smells, plan: false, references: [], failures: failure ? [{ ...fallback, kind: failure }] : [] };
  }
  if (!facts || pending.mocks.includes(pending.target)) return null;
  const keep = (reference) => !pending.mocks.includes(reference.slice(0, reference.lastIndexOf('#')));
  return { ...facts, smells: [], references: facts.references.filter(keep), failures: facts.failures.map(({ parameters, ...failure }) => {
    const args = parameters ? parameters.map((index) => pending.arguments[index]).filter(Boolean) : pending.arguments;
    const targets = failure.targets.filter(keep);
    return { ...failure, targets: targets.length ? targets : [...new Set(args.flatMap((arg) => arg.references))].sort(),
      expectedTargets: [...new Set([...failure.expectedTargets.filter(keep), ...pending.arguments.filter((arg) => !args.includes(arg)).flatMap((arg) => arg.references)])].sort() };
  }) };
}

export function resolveHelpers(scan, helpers) {
  const { helperOrder = [], ...inventory } = scan, memo = new Set(), allowed = new Set();
  for (const call of helperOrder) {
    const key = `${call.target}#${call.imported}`;
    if (!helpers.has(call.target)) { allowed.add(call.order); continue; }
    if (call.typeOnly || call.mocks.includes(call.target) || helpers.get(call.target) === false) continue;
    if (memo.has(key)) allowed.add(call.order);
    else if (memo.size + call.localCount < 32) { memo.add(key); allowed.add(call.order); }
  }
  const expand = (references) => [...new Set(references.flatMap((reference) => reference.startsWith('\0helper:')
    ? allowed.has(Number(reference.slice(8))) ? resolved(helperOrder[Number(reference.slice(8))], helpers)?.references ?? [] : [] : [reference]))].sort();
  const link = (call) => allowed.has(call.order) ? resolved({ ...call,
    arguments: call.arguments.map((arg) => ({ ...arg, references: expand(arg.references) })),
    fallback: call.fallback ? { ...call.fallback, targets: expand(call.fallback.targets), expectedTargets: expand(call.fallback.expectedTargets) } : null }, helpers) : null;
  return { ...inventory, cases: scan.cases.map(({ pending = [], ...item }) => {
    const contributions = pending.map(link).filter(Boolean);
    return { ...item, assertions: item.assertions + contributions.reduce((sum, facts) => sum + facts.assertions, 0),
      smells: [...new Set([...item.smells, ...contributions.flatMap((facts) => facts.smells ?? [])])].sort(),
      plan: item.plan || contributions.some((facts) => facts.plan),
      references: expand([...item.references, ...contributions.flatMap((facts) => facts.references)]),
      failures: item.failures.flatMap((failure) => failure.pending ? link(failure.pending)?.failures ?? [] : [{ ...failure, targets: expand(failure.targets), expectedTargets: expand(failure.expectedTargets) }]) };
  }) };
}

export function frameworkOf(source) {
  const specifiers = source.statements.filter((node) => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)).map((node) => node.moduleSpecifier.text);
  const frameworks = [['@playwright/test', 'playwright'], ['cypress', 'cypress'], ['vitest', 'vitest'], ['@jest/globals', 'jest'], ['node:test', 'node:test'], ['mocha', 'mocha'], ['chai', 'mocha']];
  const found = frameworks.find(([specifier]) => specifiers.includes(specifier));
  if (found) return found[1];
  if (/\bvi\.(fn|mock|spyOn|useFakeTimers)\b/.test(source.text)) return 'vitest';
  if (/\bjest\.(fn|mock|spyOn|useFakeTimers)\b/.test(source.text)) return 'jest';
  return /\bcy\.[a-z]/.test(source.text) ? 'cypress' : 'unknown';
}

/** A call to a global such as `fetch` that the file does not declare or import. */
export function usesGlobal(source, checker, name) {
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name && !checker.getSymbolAtLocation(node.expression)?.valueDeclaration) found = true;
    else ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

export function customFallback(node, call, body, ctx, targets, references, indices, conditional, hides) {
  if (!/^(assert|expect)[A-Z_]/.test(node.text)) return null;
  const checked = targets(call.arguments[0], ctx, 0), smells = [];
  if (conditional(call, body)) smells.push('conditional-assertion');
  for (let child = call, parent = call.parent; parent && parent !== body; child = parent, parent = parent.parent) {
    if (ts.isTryStatement(parent) && child === parent.tryBlock && parent.catchClause && hides(parent.catchClause.block)) smells.push('swallowed-error');
  }
  return { failure: /Error|Fail|Throw|Reject|Invalid|Denied|Forbidden|Unauthori/.test(node.text) ? 'helper' : null,
    line: ctx.source.getLineAndCharacterOfPosition(call.getStart(ctx.source)).line + 1, smells,
    targets: [...checked].sort(), parameters: ctx.parameters ? indices(call.arguments[0], ctx) : null,
    expectedTargets: [...references([call], ctx)].filter((ref) => !checked.has(ref)).sort() };
}
