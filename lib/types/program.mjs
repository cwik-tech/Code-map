// Records checker types, argument compatibility, and language-service references from one snapshot program.
import ts from 'typescript';
import { typeShape } from './shape.mjs';
import { importReferences, nodeAt } from './references.mjs';

const pathOf = (source) => source.fileName.slice(10);
const where = (source, node) => {
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { path: pathOf(source), line: line + 1, column: character + 1 };
};
/** Collects all module exports. Package entry points select the public subset during comparison. */
export function compilerFacts(program, service, files, result) {
  const checker = program.getTypeChecker(), publicSymbols = new Map();
  for (const source of files) {
    const module = checker.getSymbolAtLocation(source);
    if (!module) continue;
    const records = result.exports[pathOf(source)] ??= Object.create(null);
    for (const symbol of checker.getExportsOfModule(module)) {
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      const declaration = target.valueDeclaration ?? target.declarations?.[0];
      if (!declaration) continue;
      const type = target.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)
        ? checker.getDeclaredTypeOfSymbol(target) : checker.getTypeOfSymbolAtLocation(target, declaration);
      const record = typeShape(checker, type, declaration);
      if (records[symbol.name] && (records[symbol.name].shapeDigest !== record.shapeDigest || records[symbol.name].state === 'UNKNOWN')) record.state = 'UNKNOWN';
      records[symbol.name] = record;
      if (!publicSymbols.has(target)) publicSymbols.set(target, { path: pathOf(source), name: symbol.name });
    }
  }
  for (const source of files) {
    const semantic = program.getSemanticDiagnostics(source);
    const visit = (node) => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const expression = ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
        let symbol = checker.getSymbolAtLocation(expression);
        if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
        const exported = publicSymbols.get(symbol);
        if (exported) {
          const type = checker.getTypeAtLocation(node.expression), signatures = ts.isNewExpression(node)
            ? type.getConstructSignatures() : type.getCallSignatures();
          const args = node.arguments ?? [], signature = checker.getResolvedSignature(node);
          let compatibility = 'UNKNOWN';
          if (signature && signatures.length && !args.some(ts.isSpreadElement)) {
            const parameters = signature.getParameters();
            const values = args.map((arg, index) => {
              const parameter = parameters[index] ?? parameters.at(-1);
              if (!parameter) return false;
              const declaration = parameter.valueDeclaration;
              if (declaration && ts.isParameter(declaration) && declaration.dotDotDotToken) return null;
              const argument = checker.getTypeAtLocation(arg), expected = checker.getTypeOfSymbolAtLocation(parameter, node);
              return typeShape(checker, argument, arg).state === 'UNKNOWN' || typeShape(checker, expected, node).state === 'UNKNOWN' ? null : checker.isTypeAssignableTo(argument, expected);
            });
            const errors = semantic.filter((diagnostic) => {
              if (diagnostic.start < node.getStart(source) || diagnostic.start >= node.end || ![2345, 2554, 2555, 2769].includes(diagnostic.code)) return false;
              let owner = nodeAt(source, diagnostic.start);
              while (owner && !ts.isCallExpression(owner) && !ts.isNewExpression(owner)) owner = owner.parent;
              return owner === node;
            });
            compatibility = errors.length || values.includes(false) ? 'INCOMPATIBLE' : values.includes(null) ? 'UNKNOWN' : 'COMPATIBLE';
          }
          result.calls.push({ ...where(source, node.expression), export: exported, compatibility });
        }
      }
      importReferences(program, service, source, node, result);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}
