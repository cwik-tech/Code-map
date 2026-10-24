// Expands snapshot-owned type members so a named return type cannot hide an inferred shape change.
import ts from 'typescript';
import { digestOf } from '../api-signatures.mjs';

const flags = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;
/** A bounded checker shape. Recursive types use stable reference text. Exhausted expansion stays UNKNOWN. */
export function typeShape(checker, root, at) {
  const seen = new Set();
  let unknown = false;
  const visit = (type, depth) => {
    const text = checker.typeToString(type, at, flags);
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) unknown = true;
    if (seen.has(type)) return { reference: text };
    if (depth >= 8) { unknown = true; return { truncated: text }; }
    seen.add(type);
    const shape = { text };
    if (type.isUnionOrIntersection()) shape.parts = type.types.map((part) => visit(part, depth + 1));
    if (type.flags & ts.TypeFlags.TypeParameter) {
      const constraint = checker.getBaseConstraintOfType(type);
      if (constraint && constraint !== type) shape.constraint = visit(constraint, depth + 1);
    }
    if (type.flags & ts.TypeFlags.Object) {
      if (type.objectFlags & ts.ObjectFlags.Reference) shape.arguments = checker.getTypeArguments(type).map((arg) => visit(arg, depth + 1));
      const local = type.getSymbol()?.declarations?.some((node) => node.getSourceFile().fileName.startsWith('/snapshot/'));
      if (local || type.objectFlags & ts.ObjectFlags.Anonymous) {
        shape.members = checker.getPropertiesOfType(type).filter((symbol) => !symbol.declarations?.some((node) =>
          ts.getCombinedModifierFlags(node) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)
          || node.name && ts.isPrivateIdentifier(node.name))).sort((a, b) => a.name.localeCompare(b.name))
          .map((symbol) => ({ name: symbol.name, optional: !!(symbol.flags & ts.SymbolFlags.Optional),
            type: visit(checker.getTypeOfSymbolAtLocation(symbol, at), depth + 1) }));
      }
    }
    const signatures = [...type.getCallSignatures(), ...type.getConstructSignatures()];
    if (signatures.length) shape.signatures = signatures.map((signature) => ({ text: checker.signatureToString(signature, at, flags),
      parameters: signature.getParameters().map((parameter) => visit(checker.getTypeOfSymbolAtLocation(parameter, at), depth + 1)),
      returns: visit(checker.getReturnTypeOfSignature(signature), depth + 1) }));
    return shape;
  };
  const shape = visit(root, 0);
  return { text: checker.typeToString(root, at, flags), shapeDigest: digestOf(JSON.stringify(shape)), state: unknown ? 'UNKNOWN' : 'KNOWN' };
}
