// Mutants for a targeted mutation check: small changes to the failure exits and return values of selected functions.
// A test suite that still passes with a mutant did not detect that change. Text positions come from the TypeScript parser.
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { failureExit, httpStatusArgument, insideCatch, unwrap } from './source-metrics.mjs';

const returnsPerFunction = 3; // return-value mutants per function, after its failure exits
const clip = (text) => text.replace(/\s+/g, ' ').slice(0, 80);

function scriptKind(path) {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}
const parse = (path, text) => ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path));
const lineOf = (source, position) => source.getLineAndCharacterOfPosition(position).line + 1;

/** The top-level statements that declare these names: functions, classes and variables holding them. */
function declarationNodes(source, names) {
  const found = [];
  for (const statement of source.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && names.has(statement.name?.text ?? 'default')) found.push([statement.name?.text ?? 'default', statement]);
    if (ts.isVariableStatement(statement)) for (const item of statement.declarationList.declarations) if (ts.isIdentifier(item.name) && names.has(item.name.text)) found.push([item.name.text, item]);
    if (ts.isExportAssignment(statement) && names.has('default')) found.push(['default', statement]);
  }
  return found;
}

/** The change that removes a failure exit: drop a throw or an error return, rethrow in a catch, or turn an error status into 200. */
function exitMutant(source, node, kind) {
  if (ts.isThrowStatement(node)) return { kind: 'remove-throw', node, replacement: ';' };
  if (ts.isReturnStatement(node)) return { kind: 'remove-error-return', node, replacement: ';' };
  if (ts.isCatchClause(node)) {
    const name = node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name) ? node.variableDeclaration.name.text : null;
    return { kind: 'rethrow-in-catch', node: node.block, replacement: `{ throw ${name ?? "new Error('code-map mutant')"}; }` };
  }
  if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return null;
  if (kind === 'catch' && node.arguments?.[0]) return { kind: 'rethrow-in-catch', node: node.arguments[0], replacement: '(error) => { throw error; }' };
  if (kind === 'status') {
    const status = httpStatusArgument(node);
    if (status) return { kind: 'status-to-200', node: status, replacement: '200' };
  }
  return { kind: kind === 'reject' ? 'remove-reject' : kind === 'exit' ? 'remove-exit' : 'remove-call', node, replacement: 'undefined' };
}

const empty = (node) => !node || node.kind === ts.SyntaxKind.VoidExpression || (ts.isIdentifier(unwrap(node)) && unwrap(node).text === 'undefined');

/**
 * Mutants for the named top-level functions of one file, failure exits first. Each mutant replaces the text between
 * `start` and `end`; a mutant whose result does not parse is marked invalid and never run.
 */
export function mutantsFor(path, text, names) {
  const source = parse(path, text), mutants = [];
  for (const [unit, root] of declarationNodes(source, new Set(names))) {
    const exits = [], returns = [];
    const visit = (node, nested) => {
      const kind = failureExit(node);
      if (kind && !insideCatch(node)) { const mutant = exitMutant(source, node, kind); if (mutant) exits.push(mutant); }
      else if (!nested && ts.isReturnStatement(node) && !empty(node.expression) && !insideCatch(node)) returns.push({ kind: 'return-undefined', node: node.expression, replacement: 'undefined' });
      // Returns inside nested callbacks belong to those callbacks, not to the function's own result.
      ts.forEachChild(node, (child) => visit(child, nested || (node !== root && ts.isFunctionLike(node))));
    };
    visit(root, false);
    // A return whose value is a failure response (`return Response.json(…, { status: 400 })`) belongs to that failure path.
    // A returned promise chain with a .catch handler still returns the normal result, so it keeps its own mutant.
    const response = new Set(['status-to-200', 'remove-call', 'remove-reject']);
    const holdsExit = (mutant) => exits.some((exit) => response.has(exit.kind) && exit.node.getStart(source) >= mutant.node.getStart(source) && exit.node.getEnd() <= mutant.node.getEnd());
    const results = returns.filter((mutant) => !holdsExit(mutant)).slice(0, returnsPerFunction);
    for (const mutant of [...exits, ...results]) {
      const start = mutant.node.getStart(source), end = mutant.node.getEnd();
      const mutated = text.slice(0, start) + mutant.replacement + text.slice(end);
      mutants.push({ id: `${path}#${unit}:${mutants.length + 1}`, unit: `${path}#${unit}`, line: lineOf(source, start), kind: mutant.kind,
        original: clip(text.slice(start, end)), replacement: mutant.replacement, start, end, valid: parse(path, mutated).parseDiagnostics.length === 0 });
    }
  }
  return mutants;
}

/** Ties a report entry to the file content it was made from: a later edit makes that entry stale. */
export const fileHash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);

export const applyMutant = (text, mutant) => text.slice(0, mutant.start) + mutant.replacement + text.slice(mutant.end);

/** A module that fails as soon as it loads: when the tests still pass with it, they do not load this copy of the file. */
export function canary(path, text) {
  const cut = text.startsWith('#!') ? text.indexOf('\n') + 1 : 0; // a #! line must stay first
  return `${text.slice(0, cut)}throw new Error(${JSON.stringify(`code-map canary: ${path}`)});\n${text.slice(cut)}`;
}
