// The declared signature of each export of one file, from the syntax only: the checker of one file cannot see imported types.
// The printer drops bodies, initializers, private class members and comments, and white space is normalized, so an edit
// inside a body keeps the signature. A missing return type or variable type is "inferred": the record then also holds a
// digest of the declaration source, because the type can change with it. Each declared record also tells whether a JSDoc
// comment documents it and, for a callable export, the range of argument counts (lib/impact/). No source is executed.
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { arityOf, hasJsDoc } from './impact/declaration-facts.mjs';

/** A stored signature text has at most this many characters. The digest covers the full text. */
export const signatureLimit = 300;
const printer = ts.createPrinter({ removeComments: true, omitTrailingSemicolon: true });
const { factory } = ts;
const K = ts.SyntaxKind;
const topModifiers = [K.ExportKeyword, K.DefaultKeyword, K.DeclareKeyword];
/** Sixteen hexadecimal characters of the SHA-256 of a text. */
export const digestOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);
/** White space becomes one space, except inside a string or template literal: `'a  b'` and `'a b'` are different types. */
const normal = (text) => text.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|\s+/g, (match) => /^\s/.test(match) ? ' ' : match).trim();
const has = (node, kind) => ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((item) => item.kind === kind) ?? false);
const words = (node, drop = []) => (ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : []).filter((item) => !drop.includes(item.kind))
  .map((item) => `${ts.tokenToString(item.kind)} `).join('');
const isFunctionLike = (node) => ts.isArrowFunction(node) || ts.isFunctionExpression(node);
const unwrap = (node) => { while (node && ts.isParenthesizedExpression(node)) node = node.expression; return node; };

/** One record for each exported name of `facts.exports`, and one for each `export *` statement. */
export function exportSignatures(source, exportNames, resolve) {
  const print = (node) => normal(printer.printNode(ts.EmitHint.Unspecified, node, source));
  const bare = (name) => ts.isIdentifier(name) ? name : ts.isObjectBindingPattern(name)
    ? factory.updateObjectBindingPattern(name, name.elements.map(element))
    : factory.updateArrayBindingPattern(name, name.elements.map((item) => ts.isOmittedExpression(item) ? item : element(item)));
  const element = (item) => factory.updateBindingElement(item, item.dotDotDotToken, item.propertyName, bare(item.name), undefined);
  // A parameter with a default value is optional for the caller, so the default becomes "?".
  const parameter = (item) => print(factory.updateParameterDeclaration(item, item.modifiers, item.dotDotDotToken, bare(item.name),
    item.questionToken ?? (item.initializer ? factory.createToken(K.QuestionToken) : undefined), item.type, undefined));
  const generics = (node) => node.typeParameters?.length ? `<${node.typeParameters.map(print).join(', ')}>` : '';
  const callable = (node) => `${generics(node)}(${node.parameters.map(parameter).join(', ')})${node.type ? `: ${print(node.type)}` : ''}`;
  const declaration = (node) => normal(print(node).replace(/^(?:(?:export|default|declare) )+/, ''));

  const classText = (node) => {
    const visible = node.members.filter((member) => !has(member, K.PrivateKeyword) && !(member.name && ts.isPrivateIdentifier(member.name))
      && !ts.isClassStaticBlockDeclaration(member) && !ts.isSemicolonClassElement(member));
    const key = (member) => `${member.kind}:${has(member, K.StaticKeyword)}:${member.name ? print(member.name) : 'constructor'}`;
    const callableMember = (member) => ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member);
    const overloaded = new Set(visible.filter((member) => callableMember(member) && !member.body).map(key));
    const parts = visible.filter((member) => !(callableMember(member) && member.body && overloaded.has(key(member)))).map(memberText);
    const heritage = node.heritageClauses?.length ? ` ${node.heritageClauses.map(print).join(' ')}` : '';
    return { text: `${words(node, topModifiers)}class${node.name ? ` ${node.name.text}` : ''}${generics(node)}${heritage} ${parts.length ? `{ ${parts.map((part) => part.text).join('; ')} }` : '{}'}`,
      inferred: parts.some((part) => part.inferred) };
  };
  const memberText = (member) => {
    const head = `${words(member)}${member.name ? print(member.name) : ''}${member.questionToken ? '?' : ''}`;
    if (ts.isPropertyDeclaration(member)) return { text: `${head}${member.exclamationToken ? '!' : ''}${member.type ? `: ${print(member.type)}` : ''}`, inferred: !member.type && !!member.initializer };
    if (ts.isMethodDeclaration(member)) return { text: `${words(member)}${member.asteriskToken ? '*' : ''}${print(member.name)}${member.questionToken ? '?' : ''}${callable(member)}`, inferred: !member.type && !!member.body };
    if (ts.isConstructorDeclaration(member)) return { text: `${words(member)}constructor${callable(member)}`, inferred: false };
    if (ts.isGetAccessorDeclaration(member)) return { text: `${words(member)}get ${print(member.name)}${callable(member)}`, inferred: !member.type && !!member.body };
    if (ts.isSetAccessorDeclaration(member)) return { text: `${words(member)}set ${print(member.name)}${callable(member)}`, inferred: false };
    return { text: print(member), inferred: false };
  };
  /** The signature of a value: a function or a class shows its shape, any other value only its declared type. */
  const valueText = (prefix, value) => {
    if (value && isFunctionLike(value)) return { kind: 'function', text: `${prefix}${has(value, K.AsyncKeyword) ? 'async ' : ''}${callable(value)}`, inferred: !value.type };
    if (value && ts.isClassExpression(value)) { const shape = classText(value); return { kind: 'class', text: `${prefix}${shape.text}`, inferred: shape.inferred }; }
    if (value && ts.isAsExpression(value) && !(ts.isTypeReferenceNode(value.type) && value.type.typeName.getText(source) === 'const')) return { kind: 'value', text: `${prefix}… as ${print(value.type)}`, inferred: false };
    return { kind: 'value', text: prefix.replace(/ = $/, ''), inferred: value !== undefined };
  };
  const partOf = (node, name) => {
    if (ts.isFunctionDeclaration(node)) return { kind: 'function', text: `${words(node, topModifiers)}function${node.asteriskToken ? '*' : ''}${node.name ? ` ${node.name.text}` : ''}${callable(node)}`, inferred: !node.type && !!node.body };
    if (ts.isClassDeclaration(node)) return { kind: 'class', ...classText(node) };
    if (ts.isInterfaceDeclaration(node)) return { kind: 'interface', text: declaration(node), inferred: false };
    if (ts.isTypeAliasDeclaration(node)) return { kind: 'type', text: declaration(node), inferred: false };
    if (ts.isEnumDeclaration(node)) return { kind: 'enum', text: declaration(node), inferred: false };
    if (ts.isModuleDeclaration(node)) return { kind: 'namespace', text: `namespace ${print(node.name)}`, inferred: true };
    if (ts.isVariableDeclaration(node)) {
      const flags = node.parent.flags, keyword = flags & ts.NodeFlags.Const ? 'const' : flags & ts.NodeFlags.Let ? 'let' : 'var', name = print(bare(node.name));
      if (node.type) return { kind: keyword, text: `${keyword} ${name}: ${print(node.type)}`, inferred: false };
      return { ...valueText(`${keyword} ${name} = `, unwrap(node.initializer)), kind: keyword };
    }
    if (ts.isImportEqualsDeclaration(node)) return { kind: 'alias', text: declaration(node), inferred: true };
    return valueText(`${name} = `, unwrap(node)); // the expression of `export default …`, `export =` or a CommonJS export
  };
  const fullText = (node) => ts.isVariableDeclaration(node) ? print(node) : declaration(node);

  // Top-level declarations and import bindings by local name, for `export { a as b }`, `export default a` and `module.exports = a`.
  const locals = new Map(), imports = new Map(), entries = new Map(), stars = [];
  const local = (name, node) => locals.set(name, [...(locals.get(name) ?? []), node]);
  // `const { a, b } = value` declares a and b, so `export { a }` gets the signature of that declaration.
  const bound = (name) => ts.isIdentifier(name) ? [name.text] : name.elements.flatMap((item) => ts.isOmittedExpression(item) ? [] : bound(item.name));
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) for (const item of statement.declarationList.declarations) for (const name of bound(item.name)) local(name, item);
    else if (statement.name && ts.isIdentifier(statement.name) && !ts.isExpressionStatement(statement)) local(statement.name.text, statement);
    if (!ts.isImportDeclaration(statement) || !statement.importClause || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause, specifier = statement.moduleSpecifier.text;
    if (clause.name) imports.set(clause.name.text, { specifier, name: 'default' });
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) imports.set(clause.namedBindings.name.text, { specifier, name: '*' });
    else for (const item of clause.namedBindings?.elements ?? []) imports.set(item.name.text, { specifier, name: (item.propertyName ?? item.name).text });
  }
  const add = (name, entry) => { const known = entries.get(name); if (known?.nodes && entry.nodes) known.nodes.push(...entry.nodes); else if (!known) entries.set(name, entry); };
  const byName = (name) => locals.has(name) ? { nodes: [...locals.get(name)] } : imports.has(name) ? { from: imports.get(name) } : { unknown: true };
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null, clause = statement.exportClause;
      if (specifier !== null && clause === undefined) stars.push({ specifier, name: '*' });
      else if (specifier !== null && ts.isNamespaceExport(clause)) add(clause.name.text, { from: { specifier, name: '*' } });
      else for (const item of clause?.elements ?? []) {
        const imported = (item.propertyName ?? item.name).text;
        add(item.name.text, specifier !== null ? { from: { specifier, name: imported } } : byName(imported));
      }
    } else if (ts.isExportAssignment(statement)) {
      add('default', ts.isIdentifier(statement.expression) ? byName(statement.expression.text) : { nodes: [statement.expression] });
    } else if (ts.isExpressionStatement(statement)) {
      const expression = statement.expression;
      if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== K.EqualsToken) continue;
      const target = expression.left.getText(source), match = /^(?:module\.)?exports(?:\.(\w+))?$/.exec(target);
      if (!match || (!match[1] && !target.startsWith('module.'))) continue;
      const value = unwrap(expression.right);
      add(match[1] ?? 'module.exports', ts.isIdentifier(value) ? byName(value.text) : { nodes: [value] });
    } else if (has(statement, K.ExportKeyword)) {
      if (ts.isVariableStatement(statement)) for (const item of statement.declarationList.declarations) add(item.name.getText(source), { nodes: [item] });
      else if (statement.name || has(statement, K.DefaultKeyword)) add(has(statement, K.DefaultKeyword) ? 'default' : statement.name.text, { nodes: [statement] });
    }
  }

  const reexport = (name, from) => {
    const text = from.name === '*' ? (name === '*' ? `export * from '${from.specifier}'` : `export * as ${name} from '${from.specifier}'`)
      : `export { ${from.name === name ? name : `${from.name} as ${name}`} } from '${from.specifier}'`;
    return { name, kind: 'reexport', from: { target: resolve(source.fileName, from.specifier), specifier: from.specifier, name: from.name }, text, digest: digestOf(text) };
  };
  const unknown = (name) => ({ name, kind: 'unknown', text: name, digest: digestOf(name), inferred: true });
  const record = (name, entry) => {
    if (entry.from) return reexport(name, entry.from);
    if (entry.unknown) return unknown(name);
    // The implementation signature of overloads is not callable from outside, so only the overload signatures count.
    const overloads = entry.nodes.filter((node) => ts.isFunctionDeclaration(node) && !node.body).length;
    const nodes = entry.nodes.filter((node) => !(ts.isFunctionDeclaration(node) && node.body && overloads > 0));
    const parts = nodes.map((node) => partOf(node, name)), text = parts.map((part) => part.text).join('\n'), inferred = parts.some((part) => part.inferred);
    const arity = arityOf(source, nodes);
    return { name, kind: [...new Set(parts.map((part) => part.kind))].join('+'), text: text.slice(0, signatureLimit), digest: digestOf(text), inferred,
      ...(inferred ? { source: digestOf(entry.nodes.map(fullText).join('\n')) } : {}), ...(overloads > 1 ? { overloads } : {}), ...(text.length > signatureLimit ? { truncated: true } : {}),
      documented: hasJsDoc(source, entry.nodes), ...(arity ? { arity } : {}) };
  };
  // A syntax form that the printer cannot print gives an unknown signature, never a failed analysis.
  const safe = (name, entry) => { try { return record(name, entry); } catch { return unknown(name); } };
  return [...exportNames.filter((name) => name !== '*').map((name) => safe(name, entries.get(name) ?? { unknown: true })),
    ...stars.map((from) => reexport('*', from))];
}
