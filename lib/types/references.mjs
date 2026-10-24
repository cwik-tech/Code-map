// Uses language-service binding references for named, default, and namespace imports in the head program.
import ts from 'typescript';

/** The deepest syntax node that contains a source position. */
export function nodeAt(source, position) {
  let found = source;
  const visit = (node) => {
    if (node.getStart(source) > position || node.end <= position) return;
    found = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
/** Records import-bound references even when the exported name no longer resolves. */
export function importReferences(program, service, source, node, result) {
  const named = ts.isImportSpecifier(node), namespace = ts.isNamespaceImport(node), defaultImport = ts.isImportClause(node) && node.name;
  if (!named && !namespace && !defaultImport) return;
  const declaration = named ? node.parent.parent.parent : namespace ? node.parent.parent : node.parent;
  if (!ts.isImportDeclaration(declaration) || !ts.isStringLiteral(declaration.moduleSpecifier)) return;
  const checker = program.getTypeChecker(), module = checker.getSymbolAtLocation(declaration.moduleSpecifier);
  const target = module?.declarations?.[0]?.getSourceFile().fileName;
  const refs = service.findReferences(source.fileName, node.name.getStart(source)) ?? [];
  for (const group of refs) for (const ref of group.references) {
    if (!ref.fileName.startsWith('/snapshot/') || ref.isDefinition) continue;
    const file = program.getSourceFile(ref.fileName);
    if (!file) continue;
    let name = named ? (node.propertyName ?? node.name).text : 'default';
    if (namespace) {
      const identifier = nodeAt(file, ref.textSpan.start), parent = identifier.parent;
      name = ts.isPropertyAccessExpression(parent) && parent.expression === identifier ? parent.name.text
        : ts.isElementAccessExpression(parent) && parent.expression === identifier && ts.isStringLiteralLike(parent.argumentExpression)
          ? parent.argumentExpression.text : '*';
      if (name === '*') continue;
    }
    const { line, character } = file.getLineAndCharacterOfPosition(ref.textSpan.start);
    result.references.push({ path: file.fileName.slice(10), line: line + 1, column: character + 1,
      target: target?.startsWith('/snapshot/') ? target.slice(10) : null, name,
      specifier: declaration.moduleSpecifier.text, evidence: 'language-service' });
  }
}
