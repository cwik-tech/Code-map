// The facts of a test file that can name a modeled case (C22, C23): its literals and the events that it sends. This is a weak
// static signal: a literal or a sent event in a test file is not proof that a test checks the case. Syntax only.
import ts from 'typescript';

const scriptKind = (path) => (path.endsWith('.tsx') ? ts.ScriptKind.TSX : path.endsWith('.jsx') ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS);

/** The literal of a sent event: `send('NAME')` or `send({ type: 'NAME' })`, also as `actor.send(...)`. */
function sentEvent(node) {
  const callee = node.expression;
  if (!(ts.isIdentifier(callee) && callee.text === 'send') && !(ts.isPropertyAccessExpression(callee) && callee.name.text === 'send')) return null;
  const [argument] = node.arguments;
  if (argument && ts.isStringLiteralLike(argument)) return argument.text;
  if (!argument || !ts.isObjectLiteralExpression(argument)) return null;
  let event = null;
  for (const property of argument.properties) {
    if (ts.isSpreadAssignment(property) || (property.name && ts.isComputedPropertyName(property.name))) { event = null; continue; }
    const name = property.name;
    if (!name || !(ts.isIdentifier(name) || ts.isStringLiteralLike(name)) || name.text !== 'type') continue;
    event = ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.initializer) ? property.initializer.text : null;
  }
  return event;
}

/**
 * The numbers (a minus sign counts), the strings and their lengths, the lengths of array literals and the sent events of one
 * test file. Module specifiers do not count.
 */
export function testModelFacts(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path));
  const facts = { numbers: new Set(), strings: new Set(), stringLengths: new Set(), arrayLengths: new Set(), sends: new Set() };
  const visit = (node) => {
    if (ts.isNumericLiteral(node)) {
      const negative = ts.isPrefixUnaryExpression(node.parent) && node.parent.operator === ts.SyntaxKind.MinusToken;
      facts.numbers.add(negative ? -Number(node.text) || 0 : Number(node.text));
    } else if (ts.isStringLiteralLike(node) && !ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent) && !ts.isExternalModuleReference(node.parent)
      && !(ts.isCallExpression(node.parent) && (node.parent.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.parent.expression) && node.parent.expression.text === 'require')))) {
      facts.strings.add(node.text);
      facts.stringLengths.add(node.text.length);
    } else if (ts.isArrayLiteralExpression(node) && !node.elements.some((element) => ts.isSpreadElement(element))) facts.arrayLengths.add(node.elements.length);
    if (ts.isCallExpression(node)) { const event = sentEvent(node); if (event !== null) facts.sends.add(event); }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return facts;
}
