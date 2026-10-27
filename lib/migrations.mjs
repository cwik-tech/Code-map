// Configured migration uses are syntax leads. No symbol resolution or project execution occurs here.
import ts from 'typescript';

/** Reject malformed migration entries before an analysis starts. */
export function migrationProblems(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return ['migrations: Must be a list of { "from", "to", "note" } objects.'];
  return value.flatMap((entry, index) => {
    const at = `migrations[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [`${at}: Must be an object.`];
    return [...['from', 'to', 'note'].filter((key) => typeof entry[key] !== 'string' || !entry[key].trim() || entry[key].length > 10000)
      .map((key) => `${at}.${key}: Must be nonempty text of at most 10000 characters.`),
    ...Object.keys(entry).filter((key) => !['from', 'to', 'note'].includes(key)).map((key) => `${at}.${key}: Unknown field.`)];
  });
}

/** Each syntactic import or call use has an ordinal identity that excludes line numbers. */
export function migrationUses(texts, patterns = []) {
  if (!patterns.length) return [];
  const uses = [];
  for (const [path, text] of texts) {
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true), ordinals = new Map();
    const add = (kind, name, node) => {
      for (const pattern of patterns.filter((item) => item.from === name)) {
        const key = JSON.stringify([kind, pattern.from, pattern.to, pattern.note]), ordinal = ordinals.get(key) ?? 0;
        ordinals.set(key, ordinal + 1);
        uses.push({ path, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, kind, ...pattern, ordinal });
      }
    };
    const visit = (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        add('import-path', node.moduleSpecifier.text, node);
        const clause = node.importClause;
        if (clause?.name) add('import-name', clause.name.text, clause.name);
        if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) add('import-name', clause.namedBindings.name.text, clause.namedBindings);
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const item of clause.namedBindings.elements) add('import-name', (item.propertyName ?? item.name).text, item);
        }
      }
      if (ts.isImportEqualsDeclaration(node)) {
        add('import-name', node.name.text, node.name);
        const reference = node.moduleReference;
        if (ts.isExternalModuleReference(reference) && reference.expression && ts.isStringLiteral(reference.expression)) add('import-path', reference.expression.text, node);
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        add('import-path', node.moduleSpecifier.text, node);
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const item of node.exportClause.elements) add('import-name', (item.propertyName ?? item.name).text, item);
        }
      }
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) add('import-path', node.argument.literal.text, node);
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (ts.isIdentifier(callee)) add('call', callee.text, node);
        if (ts.isPropertyAccessExpression(callee)) add('call', callee.name.text, node);
        if ((callee.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(callee) && callee.text === 'require')
          && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) add('import-path', node.arguments[0].text, node);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return uses;
}

/** Add addressable migration leads through the shared finding constructor. */
export function migrationFindings(analysis, add) {
  for (const item of analysis.migrations ?? []) add('MIGRATION-USE', [item.path, item.kind, item.from, item.to, item.note, item.ordinal], {
    text: `${item.from}: ${item.note} Replacement: ${item.to}.`, location: { path: item.path, line: item.line, symbol: item.from }, paths: [item.path],
    evidence: [{ path: item.path, line: item.line, text: `${item.kind}: ${item.from}` }], facts: item });
}

/** The complete migration finding list, with the standard comparison labels. */
export function migrationInformation(head, comparison) {
  const { result } = comparison;
  const items = head.findings.filter((item) => item.ruleId === 'MIGRATION-USE').map((item) => ({ ...item, baseline: result.statuses[item.id].baseline }));
  for (const entry of result.resolved) if (entry.finding.ruleId === 'MIGRATION-USE') items.push({ ...entry.finding, baseline: 'RESOLVED' });
  for (const entry of result.baseUnknown) if (entry.finding.ruleId === 'MIGRATION-USE') items.push({ ...entry.finding, baseline: 'UNKNOWN' });
  return { informationOnly: true, items };
}
