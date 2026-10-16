// Static facts about one TypeScript or JavaScript file: declarations, imports and exports.
// The TypeScript compiler only parses here; nothing is type-checked or executed.
import { dirname, posix } from 'node:path';
import ts from 'typescript';
import { codeExtensions } from './project.mjs';
import { lineCount } from './git.mjs';

function scriptKind(path) {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Turns an import specifier into a repository path, or null when it names a package. */
export function createResolver(files, aliasInfo) {
  const exists = (path) => files.has(path);
  const candidates = (base) => {
    const list = [base, ...codeExtensions.map((extension) => base + extension),
      ...codeExtensions.map((extension) => `${base}/index${extension}`)];
    const swapped = /\.([cm]?)jsx?$/.exec(base);
    if (swapped) {
      const stem = base.slice(0, -swapped[0].length);
      list.push(`${stem}.${swapped[1]}ts`, `${stem}.tsx`, `${stem}.ts`);
    }
    return list;
  };
  const first = (base) => candidates(posix.normalize(base)).find(exists) ?? null;
  return (from, specifier) => {
    if (specifier.startsWith('.')) return first(posix.join(dirname(from), specifier));
    for (const { pattern, target } of aliasInfo.aliases) {
      const star = pattern.indexOf('*');
      if (star < 0 ? specifier !== pattern : !(specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1)))) continue;
      const middle = star < 0 ? '' : specifier.slice(star, specifier.length - (pattern.length - star - 1));
      const found = first(target.replace('*', middle));
      if (found) return found;
    }
    if (aliasInfo.baseUrl !== null) return first(posix.join(aliasInfo.baseUrl || '.', specifier));
    return null;
  };
}

function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

export function analyzeFile(path, text, resolve) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path));
  const implementations = new Set(source.statements.filter(ts.isFunctionDeclaration)
    .filter((statement) => statement.body !== undefined).map((statement) => statement.name?.text ?? 'default'));
  const facts = { path, lines: lineCount(text), header: fileHeader(source), imports: [], externals: [], exports: [], declarations: [], uses: {}, valueUses: {} };
  // `uses` includes types for navigation; `valueUses` excludes explicit type-only names.
  // "*" is a possible namespace/re-export reference, never proof of calls.
  const reference = (specifier, names = ['*'], valueNames = names) => {
    const target = resolve(path, specifier);
    if (target) {
      facts.imports.push(target);
      if (target !== path) facts.uses[target] = [...new Set([...(facts.uses[target] ?? []), ...names])];
      if (target !== path) facts.valueUses[target] = [...new Set([...(facts.valueUses[target] ?? []), ...valueNames])];
    } else if (!specifier.startsWith('.')) facts.externals.push(packageName(specifier));
  };
  for (const statement of source.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
      && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) reference(statement.moduleSpecifier.text, importedNames(statement), importedNames(statement, true));
    if (ts.isExportDeclaration(statement)) facts.exports.push(...reexportedNames(statement));
    facts.declarations.push(...declarationsOf(source, statement, implementations));
  }
  dynamicReferences(source, reference);
  for (const declaration of facts.declarations) if (declaration.exported) facts.exports.push(declaration.name);
  facts.imports = [...new Set(facts.imports)].filter((target) => target !== path).sort();
  facts.externals = [...new Set(facts.externals)].sort();
  facts.exports = [...new Set(facts.exports)].sort();
  return facts;
}

/** `require('x')` and `import('x')` anywhere in the file. */
function dynamicReferences(source, reference) {
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      reference(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/** The names an import or re-export takes from its module. A bare `import 'x'` takes none. */
function importedNames(statement, valuesOnly = false) {
  if (ts.isExportDeclaration(statement)) {
    if (valuesOnly && statement.isTypeOnly) return [];
    const clause = statement.exportClause;
    if (clause === undefined || ts.isNamespaceExport(clause)) return ['*'];
    return clause.elements.filter((element) => !valuesOnly || !element.isTypeOnly).map((element) => (element.propertyName ?? element.name).text);
  }
  const clause = statement.importClause;
  if (clause === undefined) return [];
  if (valuesOnly && clause.isTypeOnly) return [];
  const names = clause.name ? ['default'] : [];
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) names.push('*');
  else if (bindings) names.push(...bindings.elements.filter((element) => !valuesOnly || !element.isTypeOnly).map((element) => (element.propertyName ?? element.name).text));
  return names;
}

function reexportedNames(statement) {
  const clause = statement.exportClause;
  if (clause === undefined) return ['*'];
  if (ts.isNamespaceExport(clause)) return [clause.name.text];
  return clause.elements.map((element) => element.name.text);
}

function hasModifier(node, kind) {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false);
}

function declarationsOf(source, statement, implementations) {
  const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
  const planned = hasModifier(statement, ts.SyntaxKind.DeclareKeyword);
  const base = (name, kind, node, children = []) =>
    ({ name, kind, exported, planned, children, note: commentBefore(source, node), ...lineRange(source, node) });
  if (ts.isFunctionDeclaration(statement)) {
    const declaration = base(statement.name?.text ?? 'default', 'function', statement);
    // Overload signatures share the implementation in this same top-level scope.
    declaration.planned = !implementations.has(declaration.name);
    return [declaration];
  }
  if (ts.isClassDeclaration(statement)) return [base(statement.name?.text ?? 'default', 'class', statement, membersOf(source, statement))];
  if (ts.isInterfaceDeclaration(statement)) return [base(statement.name.text, 'interface', statement)];
  if (ts.isTypeAliasDeclaration(statement)) return [base(statement.name.text, 'type', statement)];
  if (ts.isEnumDeclaration(statement)) return [base(statement.name.text, 'enum', statement)];
  if (ts.isExportAssignment(statement)) return [{ ...base('default', valueKind(statement.expression), statement), exported: true }];
  if (ts.isExpressionStatement(statement)) return commonJsExport(source, statement, base);
  if (!ts.isVariableStatement(statement)) return [];
  const list = statement.declarationList.declarations;
  return list.map((item) => base(item.name.getText(source), variableKind(item), list.length === 1 ? statement : item));
}

/** `module.exports = …` and `exports.name = …` in CommonJS files. */
function commonJsExport(source, statement, base) {
  const expression = statement.expression;
  if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return [];
  const target = expression.left.getText(source);
  const match = /^(?:module\.)?exports(?:\.(\w+))?$/.exec(target);
  if (!match || (!match[1] && !target.startsWith('module.'))) return [];
  return [{ ...base(match[1] ?? 'module.exports', valueKind(expression.right), statement), exported: true }];
}

function valueKind(node) {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return 'function';
  if (ts.isClassExpression(node)) return 'class';
  return 'value';
}

function membersOf(source, node) {
  const result = [];
  const members = node.members.filter((member) => ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)
    || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member));
  const nameOf = (member) => ts.isConstructorDeclaration(member) ? 'constructor' : member.name.getText(source);
  // A static body cannot implement an instance signature; accessors also stay separate.
  const key = (member) => `${member.kind}:${hasModifier(member, ts.SyntaxKind.StaticKeyword)}:${nameOf(member)}`;
  const implementations = new Set(members.filter((member) => member.body !== undefined).map(key));
  for (const member of members) {
    const name = nameOf(member);
    const isPrivate = hasModifier(member, ts.SyntaxKind.PrivateKeyword) || name.startsWith('#');
    result.push({ name, kind: 'method', exported: !isPrivate,
      planned: hasModifier(member, ts.SyntaxKind.AbstractKeyword) || !implementations.has(key(member)),
      note: commentBefore(source, member), children: [], ...lineRange(source, member) });
  }
  return result;
}

function variableKind(item) {
  const value = item.initializer;
  if (value !== undefined && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) return 'function';
  if (item.name.getText().endsWith('Schema')) return 'schema';
  return 'value';
}

function lineRange(source, node) {
  return { start: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    end: source.getLineAndCharacterOfPosition(node.getEnd()).line + 1 };
}

/** Comments written directly above a declaration, without comment markers. */
function commentBefore(source, node) {
  const ranges = ts.getLeadingCommentRanges(source.text, node.getFullStart()) ?? [];
  return ranges.map((range) => cleanComment(source.text.slice(range.pos, range.end))).join('\n').trim();
}

function cleanComment(raw) {
  return raw.replace(/^\/\*\*?/, '').replace(/\*\/$/, '').split('\n')
    .map((line) => line.replace(/^\s*(\/\/+|\*)\s?/, '').trimEnd()).join('\n').trim();
}

/** Comments above the first import usually describe the whole file. */
function fileHeader(source) {
  const first = source.statements[0];
  if (first === undefined || !ts.isImportDeclaration(first)) return '';
  return commentBefore(source, first).replace(/^#!.*\n?/, '');
}
