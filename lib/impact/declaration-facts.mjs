// Two facts about the declaration of an export, from the syntax: whether a JSDoc comment documents it (C33), and how many
// arguments a call can pass to it (C25). lib/api-signatures.mjs stores them in the signature record of each export.
import ts from 'typescript';

const unwrap = (node) => { while (node && ts.isParenthesizedExpression(node)) node = node.expression; return node; };
/** The top-level statement that holds a node. A JSDoc comment is written before that statement. */
const statementOf = (node) => { while (node.parent && !ts.isSourceFile(node.parent)) node = node.parent; return node; };

/** True when a JSDoc comment with text (an empty one does not count) is above the statement of one of the nodes. */
export function hasJsDoc(source, nodes) {
  return nodes.some((node) => (ts.getLeadingCommentRanges(source.text, statementOf(node).getFullStart()) ?? []).some((range) => {
    const text = source.text.slice(range.pos, range.end);
    return text.startsWith('/**') && /[^\s*/]/.test(text.slice(3, -2));
  }));
}

/** The constructors that a caller can use, or one empty signature. null for a class that inherits an unknown constructor. */
function constructors(node) {
  const all = node.members.filter(ts.isConstructorDeclaration), overloads = all.filter((member) => !member.body);
  if (all.length) return overloads.length ? overloads : all;
  return node.heritageClauses?.some((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword) ? null : [{ parameters: [] }];
}

/** The signatures of a callable declaration node, or null when the node is not callable or its type is not known. */
function signaturesOf(node) {
  if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return [node];
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return constructors(node);
  if (!ts.isVariableDeclaration(node)) return null;
  // A declared type decides what a caller can pass. Only a written function type is known here.
  if (node.type) return ts.isFunctionTypeNode(node.type) ? [node.type] : null;
  const value = unwrap(node.initializer);
  return value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value) || ts.isClassExpression(value)) ? signaturesOf(value) : null;
}

/**
 * { min, max } of one signature. A `this` parameter does not count, and a rest parameter makes max null. In a JavaScript
 * file each parameter is optional, and a body that reads `arguments` takes any number, as the TypeScript checker allows.
 */
function rangeOf(signature, script) {
  const list = signature.parameters.filter((item) => !(ts.isIdentifier(item.name) && item.name.text === 'this'));
  let min = 0;
  list.forEach((item, index) => { if (!item.dotDotDotToken && !item.questionToken && !item.initializer) min = index + 1; });
  const any = list.some((item) => item.dotDotDotToken) || (script && !!signature.body && /\barguments\b/.test(signature.body.getText()));
  return { min: script ? 0 : min, max: any ? null : list.length };
}

/** The range of argument counts that the declaration nodes of one export accept, over all overloads, or null. */
export function arityOf(source, nodes) {
  const script = /\.[cm]?jsx?$/.test(source.fileName), ranges = [];
  for (const node of nodes) {
    // A merged namespace or interface adds no call signature.
    if (ts.isModuleDeclaration(node) || ts.isInterfaceDeclaration(node)) continue;
    const signatures = signaturesOf(node);
    if (signatures === null) return null;
    ranges.push(...signatures.map((signature) => rangeOf(signature, script)));
  }
  if (!ranges.length) return null;
  return { min: Math.min(...ranges.map((range) => range.min)), max: ranges.some((range) => range.max === null) ? null : Math.max(...ranges.map((range) => range.max)) };
}
