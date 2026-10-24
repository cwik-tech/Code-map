// Bind injected object properties by symbol, never by a property's spelling alone.
import ts from 'typescript';
import { unwrap } from './electron-ipc-syntax.mjs';

const MAX_CALL_SITES = 10000;
const MAX_DEPTH = 3;

export function injectedFunctions({ functions, nodes, symbol, checker }) {
  const bindings = new Map();
  const property = (owner, key) => bindings.get(symbol(owner) ?? owner)?.get(key) ?? [];
  const targets = (input) => {
    const node = unwrap(input);
    if (!node) return [];
    const fn = functions.get(symbol(node));
    if (fn) return [{ fn, depth: 0 }];
    if (ts.isPropertyAccessExpression(node)) return property(node.expression, node.name.text);
    const decl = symbol(node)?.valueDeclaration;
    if (!decl || !ts.isBindingElement(decl) || decl.dotDotDotToken) return [];
    const owner = decl.parent.parent, key = (decl.propertyName ?? decl.name).text;
    if (ts.isParameter(owner)) return property(owner.name, key);
    if (ts.isVariableDeclaration(owner) && owner.initializer) return property(unwrap(owner.initializer), key);
    return [];
  };
  // Each pass crosses one injected parameter boundary. All call-site work is capped.
  for (let pass = 0; pass < MAX_DEPTH; pass++) {
    const pending = [];
    for (const call of nodes.slice(0, MAX_CALL_SITES)) {
      const fn = functions.get(symbol(call.expression));
      if (!fn) continue;
      call.arguments.forEach((input, index) => {
        const object = unwrap(input), param = fn.parameters[index];
        if (!param || !object || !ts.isObjectLiteralExpression(object)) return;
        for (const prop of object.properties) {
          if (!prop.name || ts.isComputedPropertyName(prop.name)) continue;
          const shorthand = ts.isShorthandPropertyAssignment(prop) ? checker.getShorthandAssignmentValueSymbol(prop) : null;
          const value = shorthand && (shorthand.flags & ts.SymbolFlags.Alias)
            ? checker.getAliasedSymbol(shorthand).valueDeclaration : shorthand?.valueDeclaration;
          const expression = ts.isPropertyAssignment(prop) ? prop.initializer
            : value && (ts.isFunctionDeclaration(value) || ts.isVariableDeclaration(value) || ts.isBindingElement(value)) ? value.name : null;
          for (const target of targets(expression)) if (target.depth + 1 < MAX_DEPTH) {
            pending.push({ owner: symbol(param.name) ?? param.name, key: prop.name.text, fn: target.fn, depth: target.depth + 1 });
          }
        }
      });
    }
    for (const item of pending) {
      const props = bindings.get(item.owner) ?? new Map(), list = props.get(item.key) ?? [];
      if (!list.some((entry) => entry.fn === item.fn && entry.depth <= item.depth)) list.push({ fn: item.fn, depth: item.depth });
      props.set(item.key, list.filter((entry) => entry.fn !== item.fn || entry.depth <= item.depth));
      bindings.set(item.owner, props);
    }
  }
  return targets;
}
