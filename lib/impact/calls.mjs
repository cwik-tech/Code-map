// The call sites of each changed export in the head (capability C25): the lines where a consumer calls or uses the name,
// with the number of arguments of each call. A call outside the argument range of the head signature is a likely break.
// This is a static lead: the TypeScript compiler is the real check. Pure: the caller gives the texts of the consumers.
import ts from 'typescript';
import { passOnOf, surfaces } from '../api-compare.mjs';
import { importBindings, localChecker, referenceSymbol } from '../source-metrics.mjs';

const scriptKind = (path) => path.endsWith('.tsx') ? ts.ScriptKind.TSX : path.endsWith('.jsx') ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;

/** A namespace member with a static name, including a qualified type name and a literal element access. */
function memberOf(node) {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return { name: parent.name.text, node: parent };
  if (ts.isQualifiedName(parent) && parent.left === node) return { name: parent.right.text, node: parent };
  if (ts.isElementAccessExpression(parent) && parent.expression === node && ts.isStringLiteralLike(parent.argumentExpression)) {
    return { name: parent.argumentExpression.text, node: parent };
  }
  if (ts.isElementAccessExpression(parent) && parent.expression === node) return { name: '*', node: parent, dynamic: true };
  return { name: '*', node };
}

/** How a consumer uses the name at one place, with the argument count of a call or a `new` expression. */
function useOf(source, node) {
  const parent = node.parent, { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source)), at = { line: line + 1, column: character + 1 };
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node) {
    const args = parent.arguments ?? [];
    return { ...at, use: ts.isNewExpression(parent) ? 'new' : 'call', args: args.length, ...(args.some(ts.isSpreadElement) ? { spread: true } : {}) };
  }
  if ((ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) && parent.tagName === node) return { ...at, use: 'jsx', args: null };
  return { ...at, use: ts.isTypeReferenceNode(parent) || ts.isExpressionWithTypeArguments(parent) ? 'type' : 'reference', args: null };
}

/** Map(`target#name` -> uses) of the imported names in one file. `targets` maps each import specifier to its head file. */
function usesIn(path, text, targets) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path)), checker = localChecker(source);
  const bindings = importBindings(source, checker, (from, specifier) => targets.get(specifier) ?? null), uses = new Map();
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isIdentifier(node)) {
      const binding = bindings.get(referenceSymbol(checker, node));
      const member = binding?.imported === '*' ? memberOf(node) : { name: binding?.imported ?? '*', node };
      const name = binding?.target ? member.name : '*';
      if (binding?.target && (name !== '*' || member.dynamic)) {
        const key = `${binding.target}#${name}`;
        if (!uses.has(key)) uses.set(key, []);
        uses.get(key).push({ ...useOf(source, member.node), ...(member.dynamic ? { dynamic: true, compatibility: 'UNKNOWN', reason: 'computed-namespace-member' } : {}) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return uses;
}

/** True or false for a call or `new` without a spread argument when the range is known, else null. A class takes only `new`. */
const breaks = (site, arity, kind) => site.args === null || site.spread || !arity || (site.use === 'call' && kind.split('+').includes('class')) ? null
  : site.args < arity.min || (arity.max !== null && site.args > arity.max);

/**
 * The call sites of the CHANGED exports of an API comparison, in the declaring file of each export. `head` is the stored head
 * analysis, and `texts` holds the head texts of the consumers. A consumer can import the name directly, through a namespace
 * or through a re-export under another name. `sites` lists the likely breaks first. `unread` lists the consumers without a text.
 */
export function callSites(items, head, texts) {
  const { analysis } = head.data, api = analysis.api, passOn = passOnOf(api.files), surface = surfaces(api.files), targets = new Map(), parsed = new Map();
  for (const file of analysis.files) targets.set(file.path, new Map(file.imports.filter((edge) => edge.mode === 'static' && edge.target).map((edge) => [edge.specifier, edge.target])));
  for (const edge of api.testImports ?? []) if (edge.mode === 'static' && edge.target) {
    if (!targets.has(edge.source)) targets.set(edge.source, new Map());
    targets.get(edge.source).set(edge.specifier, edge.target);
  }
  const unread = new Set(), exports = [], sites = [];
  const usesOf = (path) => {
    if (!parsed.has(path)) parsed.set(path, texts.has(path) ? usesIn(path, texts.get(path), targets.get(path) ?? new Map()) : null);
    return parsed.get(path);
  };
  for (const item of items) {
    if (item.status !== 'CHANGED') continue;
    const record = surface(item.path).get(item.name), arity = record?.arity ?? null, kind = record?.kind ?? item.head?.kind ?? 'unknown';
    // The declaring export owns duplicate public changes. A redirected public export still needs its own consumer check.
    if (item.group === 'public' && record?.declaredIn !== item.path && items.some((other) => other !== item && other.status === 'CHANGED'
      && other.path === record?.declaredIn && other.name === (record?.declaredName ?? item.name))) continue;
    // Each file and name that exports this name again, through re-exports, also names the export.
    const aliases = new Set([`${item.path}#${item.name}`]), queue = [[item.path, item.name]];
    for (const [file, name] of queue) for (const [next, as] of passOn(file, name)) if (!aliases.has(`${next}#${as}`)) { aliases.add(`${next}#${as}`); queue.push([next, as]); }
    const consumers = (item.consumers?.items ?? []).filter((consumer) => consumer.via !== 'unresolved'), own = [];
    for (const consumer of consumers) {
      const uses = usesOf(consumer.path);
      if (uses === null) { unread.add(consumer.path); continue; }
      for (const [key, list] of uses) if (aliases.has(key) || (key.endsWith('#*') && [...aliases].some((alias) => alias.slice(0, alias.lastIndexOf('#')) === key.slice(0, -2)))) for (const use of list) own.push({ export: { path: item.path, name: item.name, kind }, arity, path: consumer.path, ...use, likelyBreak: use.dynamic ? null : breaks(use, arity, kind) });
    }
    exports.push({ path: item.path, name: item.name, kind, arity, consumers: consumers.length, sites: own.length, likelyBreaks: own.filter((site) => site.likelyBreak).length });
    sites.push(...own);
  }
  if (analysis.typed) for (const site of sites) {
    if (site.dynamic) continue;
    const typed = analysis.typed.calls.find((call) => call.path === site.path && call.line === site.line && call.column === site.column);
    site.compatibility = typed?.compatibility ?? 'UNKNOWN';
    if (typed) site.likelyBreak = typed.compatibility === 'UNKNOWN' ? null : typed.compatibility === 'INCOMPATIBLE';
  }
  if (analysis.typed) for (const item of exports) {
    item.likelyBreaks = sites.filter((site) => site.export.path === item.path && site.export.name === item.name && site.likelyBreak).length;
  }
  const rank = (site) => site.likelyBreak ? 0 : 1;
  sites.sort((a, b) => rank(a) - rank(b) || a.export.path.localeCompare(b.export.path) || a.export.name.localeCompare(b.export.name) || a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column);
  return { exports, sites, unread: [...unread].sort() };
}
