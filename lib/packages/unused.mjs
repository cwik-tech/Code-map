// Unused dependencies (C32): packages in `dependencies` that no code file below the package folder imports, and that no
// script, config file or other package.json field names. devDependencies are not checked, and @types packages are skipped.
// Pure: the caller gives the package names that each code file uses and the config texts of each package root.
import ts from 'typescript';
import { configNames, mentions, scriptNames } from './manifests.mjs';

/** Computed loader sites use AST prefixes, including calls split across lines. */
export function dynamicPackageSites(file, text) {
  const sites = [];
  const lines = new Set((file.edges ?? []).filter((edge) => edge.specifier === null && edge.target === null).map((edge) => edge.line));
  if (!lines.size) return sites;
  const source = ts.createSourceFile(file.path, text, ts.ScriptTarget.Latest, true);
  const prefixOf = (node) => {
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
    return ts.isTemplateExpression(node) ? node.head.text
    : ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken
      ? ts.isStringLiteralLike(node.left) ? node.left.text : prefixOf(node.left) : '';
  };
  const visit = (node) => {
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || ts.isIdentifier(node.expression) && node.expression.text === 'require') && node.arguments.length) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, argument = node.arguments[0];
      if (lines.has(line) && !ts.isStringLiteralLike(argument)) {
        const prefix = prefixOf(argument);
        if (!prefix.startsWith('.') && !prefix.startsWith('/') && !prefix.startsWith('node:')) sites.push({ path: file.path, line, prefix });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source); return sites;
}

/** Packages that a framework loads for the code, so that the code does not import them. */
const peers = { next: ['react', 'react-dom', 'sharp'], 'react-dom': ['react'] };

/** The line of `name` in the dependencies object of a package.json text, or null. */
function lineOf(text, name) {
  const start = text.indexOf('"dependencies"'), at = start < 0 ? -1 : text.indexOf(JSON.stringify(name), start);
  return at < 0 ? null : text.slice(0, at).split('\n').length;
}

/**
 * { unused: [{ manifest, package, line }], unchecked: [manifest paths] }. `uses` lists each code file that Code-map read, with
 * the package names that it imports and whether it has JSX. A package.json that owns no code file is unchecked.
 * `configTexts(manifest)` gives the texts of the config files at the package root.
 */
export function unusedLeads({ manifests, index, uses, configTexts }) {
  const unused = [], unchecked = [], unknown = [];
  for (const manifest of manifests.filter((item) => item.owner && item.fields.dependencies.length)) {
    const owned = uses.filter((file) => index.owns(manifest, file.path));
    if (!owned.length) { unchecked.push(manifest.path); continue; }
    const used = new Set(owned.flatMap((file) => [...file.names]));
    const declared = new Set(Object.values(manifest.fields).flat());
    if (owned.some((file) => file.jsx)) used.add('react'); // the automatic JSX runtime imports react/jsx-runtime
    for (const [framework, list] of Object.entries(peers)) if (declared.has(framework)) for (const name of list) used.add(name);
    const scripts = manifest.scripts.join('\n'), config = [manifest.other, ...configTexts(manifest)].join('\n');
    for (const name of manifest.fields.dependencies) {
      if (name.startsWith('@types/') || used.has(name)) continue;
      if (scriptNames(name).some((word) => mentions(scripts, word)) || configNames(name).some((word) => mentions(config, word))) continue;
      const sites = owned.flatMap((file) => file.dynamic ?? []).filter((site) => !site.prefix || name.startsWith(site.prefix) || site.prefix.startsWith(`${name}/`));
      if (sites.length) { unknown.push({ manifest: manifest.path, package: name, state: 'UNKNOWN', reason: 'computed-package-load', sites }); continue; }
      unused.push({ manifest: manifest.path, package: name, line: lineOf(manifest.text, name) });
    }
  }
  return { unused, unchecked, unknown };
}
