// Bounded syntax observations for declared retry and logging policies. No execution verdicts.
import ts from 'typescript';
const calleeOf = (node) => ts.isIdentifier(node) ? node.text : ts.isPropertyAccessExpression(node)
  ? `${calleeOf(node.expression)}.${node.name.text}` : '';
const functionsOf = (source) => {
  const list = [];
  const visit = (node) => {
    if (ts.isFunctionLike(node) && node.body) {
      const name = node.name?.getText(source) ?? (ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(source) : null);
      if (name) list.push({ name, node });
    }
    ts.forEachChild(node, visit);
  };
  visit(source); return list;
};
const ownNodes = (root) => {
  const list = [];
  const visit = (node) => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    list.push(node); ts.forEachChild(node, visit);
  };
  visit(root); return list;
};
function retryResult(call, policy) {
  const options = call.arguments[1];
  if (!options) return { state: 'FAIL', reason: 'The declared retry call has no maxAttempts option.' };
  if (!ts.isObjectLiteralExpression(options) || options.properties.some((p) => ts.isSpreadAssignment(p) || p.name && ts.isComputedPropertyName(p.name))) {
    return { state: 'UNKNOWN', reason: 'Retry options need a plain object without computed keys or spreads.' };
  }
  const properties = options.properties.filter((p) => p.name && ['maxAttempts', "'maxAttempts'", '"maxAttempts"'].includes(p.name.getText()));
  if (!properties.length) return { state: 'FAIL', reason: 'The declared retry call has no maxAttempts option.' };
  const value = properties.at(-1).initializer;
  if (!value || !ts.isNumericLiteral(value)) return { state: 'UNKNOWN', reason: 'The maxAttempts value is not a numeric literal.' };
  const count = Number(value.text);
  return Number.isInteger(count) && count > 0 && count <= policy.maxAttempts
    ? { state: 'OBSERVED', reason: 'The literal maxAttempts satisfies the declared limit. Runtime enforcement is unmeasured.' }
    : { state: 'FAIL', reason: `The maxAttempts value exceeds the declared limit or is not positive: ${count}.` };
}
function loggingResult(clause, policy) {
  const statements = clause.block.statements;
  const logs = ownNodes(clause.block).filter((n) => ts.isCallExpression(n) && calleeOf(n.expression) === policy.callee);
  if (!logs.length) return { state: 'FAIL', reason: 'The catch block has no call to the declared logger.' };
  const error = clause.variableDeclaration?.name;
  const direct = statements.some((s) => ts.isExpressionStatement(s) && ts.isCallExpression(s.expression)
    && calleeOf(s.expression.expression) === policy.callee && error && ts.isIdentifier(error)
    && s.expression.arguments.some((arg) => ts.isIdentifier(arg) && arg.text === error.text));
  return direct ? { state: 'OBSERVED', reason: 'A direct logger call names the caught error. Runtime emission is unmeasured.' }
    : { state: 'UNKNOWN', reason: 'Logging is conditional or does not directly name the caught error.' };
}
/** Inspect declared functions only. Missing functions and unsupported syntax retain reasons and UNKNOWN states. */
export function scanDeclaredPatterns(texts, policies = []) {
  const items = [], ordinals = new Map();
  for (const policy of policies) {
    const text = texts.get(policy.path);
    const source = text === undefined ? null : ts.createSourceFile(policy.path, text, ts.ScriptTarget.Latest, true);
    const matches = source ? functionsOf(source).filter((f) => f.name === policy.symbol) : [];
    for (const kind of ['retry', 'logging']) {
      if (!policy[kind]) continue;
      const base = { path: policy.path, scope: policy.symbol, kind: `${kind}-policy`, call: policy[kind].callee };
      const add = (node, result) => {
        const key = JSON.stringify([base.path, base.scope, base.kind, base.call]), ordinal = ordinals.get(key) ?? 0;
        ordinals.set(key, ordinal + 1);
        items.push({ ...base, ordinal, line: node ? source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 : null, ...result });
      };
      if (matches.length !== 1 || source.parseDiagnostics?.length) {
        add(null, { state: 'UNKNOWN', reason: 'The declared function is missing, ambiguous or has syntax errors.' }); continue;
      }
      const nodes = ownNodes(matches[0].node.body);
      const sites = kind === 'retry' ? nodes.filter((n) => ts.isCallExpression(n) && calleeOf(n.expression) === policy.retry.callee)
        : nodes.filter(ts.isCatchClause);
      if (!sites.length) { add(matches[0].node, { state: 'UNKNOWN', reason: 'The function has no supported site for this declared policy.' }); continue; }
      for (const site of sites) add(site, kind === 'retry' ? retryResult(site, policy.retry) : loggingResult(site, policy.logging));
    }
  }
  return items;
}

/** Validate the finite policy inventory before snapshot analysis. */
export function safeguardProblems(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) return ['safeguards: Must be a list of at most 100 policies.'];
  const problems = [], record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const callee = (v) => typeof v === 'string' && /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(v) && v.length <= 200;
  value.forEach((p, index) => {
    const bad = (message) => problems.push(`safeguards[${index}]: ${message}`);
    if (!record(p)) { bad('Must be a policy object.'); return; }
    if (Object.keys(p).some((k) => !['path', 'symbol', 'retry', 'logging'].includes(k))) bad('Unknown policy field.');
    if (typeof p.path !== 'string' || !p.path || p.path.startsWith('/') || /^[A-Za-z]:/.test(p.path)
      || /[\\\0]/.test(p.path) || p.path.split('/').some((s) => !s || s === '.' || s === '..')) bad('Use a repository-relative path.');
    if (!callee(p.symbol) || p.symbol.includes('.')) bad('Use one function or method name.');
    if (!p.retry && !p.logging) bad('Declare a retry or logging policy.');
    if (p.retry !== undefined && (!record(p.retry) || !callee(p.retry.callee) || !Number.isInteger(p.retry.maxAttempts)
      || p.retry.maxAttempts < 1 || p.retry.maxAttempts > 100 || Object.keys(p.retry).some((k) => !['callee', 'maxAttempts'].includes(k)))) bad('Retry needs a callee and maxAttempts from 1 to 100.');
    if (p.logging !== undefined && (!record(p.logging) || !callee(p.logging.callee) || Object.keys(p.logging).some((k) => k !== 'callee'))) bad('Logging needs a callee.');
  });
  return problems;
}
