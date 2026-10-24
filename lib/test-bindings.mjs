// Bounded syntax for test aliases and registrar parameters. No registrar executes.
import ts from 'typescript';
import { unwrap } from './source-metrics.mjs';

const framework = /^(vitest|@jest\/globals|node:test|@playwright\/test|mocha|bun:test)$/;
const heads = new Set(['it', 'test', 'specify', 'describe', 'context', 'suite', 'fit', 'xit', 'xtest', 'xspecify', 'fdescribe', 'xdescribe']);

/** Follow at most four const aliases. Both ternary arms must name the same test family. */
export function testBinding(node, ctx, depth = 0) {
  if (depth > 4) return null;
  node = unwrap(node);
  if (ts.isConditionalExpression(node)) {
    const left = testBinding(node.whenTrue, ctx, depth + 1), right = testBinding(node.whenFalse, ctx, depth + 1);
    return left && right && left.head === right.head ? { ...left, conditional: true } : null;
  }
  if (ts.isPropertyAccessExpression(node) && ['skip', 'only'].includes(node.name.text)) {
    const base = testBinding(node.expression, ctx, depth + 1);
    return base ? { ...base, status: node.name.text === 'skip' ? 'skipped' : 'focused' } : null;
  }
  if (!ts.isIdentifier(node)) return null;
  const symbol = ctx.checker.getSymbolAtLocation(node), binding = ctx.bindings.get(symbol);
  if (binding && framework.test(binding.specifier)) return { head: binding.imported === 'default' ? 'test' : binding.imported };
  const declaration = symbol?.valueDeclaration;
  if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer
    && (declaration.parent.flags & ts.NodeFlags.Const)) return testBinding(declaration.initializer, ctx, depth + 1);
  if (declaration && ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent)
    && ts.isParameter(declaration.parent.parent)) {
    const head = (declaration.propertyName ?? declaration.name).getText();
    return heads.has(head) ? { head, reason: 'Suite registrar receives the test functions as parameters.' } : null;
  }
  return heads.has(node.text) ? { head: node.text, ...(declaration && ts.isParameter(declaration) ? { reason: 'Suite registrar receives the test functions as parameters.' } : {}) } : null;
}

/** Which helper parameters occur in the checked operand. Expected operands are excluded. */
export function parameterIndices(node, ctx) {
  const indices = new Set();
  const visit = (child) => {
    if (ts.isIdentifier(child)) {
      const index = ctx.parameters?.get(ctx.checker.getSymbolAtLocation(child));
      if (index !== undefined) indices.add(index);
    }
    ts.forEachChild(child, visit);
  };
  if (node) visit(node);
  return [...indices];
}

export function localHelpers(source, checker) {
  const helpers = new Map();
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) helpers.set(checker.getSymbolAtLocation(node.name), node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) helpers.set(checker.getSymbolAtLocation(node.name), node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(source);
  helpers.delete(undefined);
  return helpers;
}

/** Select the actual exported helper, including aliases and named default functions. */
export function exportedHelper(source, checker, name) {
  const module = checker.getSymbolAtLocation(source);
  const exported = module && checker.getExportsOfModule(module).find((symbol) => symbol.name === name);
  const declaration = (exported?.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported)?.valueDeclaration;
  if (declaration && ts.isFunctionDeclaration(declaration)) return declaration;
  const value = declaration && ts.isVariableDeclaration(declaration) ? declaration.initializer : null;
  return value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) ? value : null;
}
