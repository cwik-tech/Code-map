// Syntax and self-import checks for fenced documentation examples. No snippet executes.
import ts from 'typescript';
import { posix } from 'node:path';
import { createResolver } from '../analyze.mjs';
import { packageEntryPoints } from '../api-surface.mjs';
import { surfaces } from '../api-compare.mjs';
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
/** Check supported fences against syntax and the package's declared public entry points. */
export function checkExamples(texts, manifests, api) {
  const packages = [], resolve = createResolver(new Set(Object.keys(api.files)), { aliases: [], baseUrl: null });
  for (const [path, text] of manifests) {
    if (posix.basename(path) !== 'package.json') continue;
    try {
      const value = JSON.parse(text);
      if (typeof value?.name !== 'string') continue;
      let entry = api.entryPoints;
      if (Object.hasOwn(value, 'exports')) {
        const exports = value.exports && typeof value.exports === 'object' && !Array.isArray(value.exports)
          && Object.keys(value.exports).some((x) => x.startsWith('.')) ? value.exports['.'] : value.exports;
        entry = packageEntryPoints(new Map([[path, JSON.stringify({ exports })]]), Object.keys(api.files), resolve);
      }
      packages.push({ path, name: value.name, entry });
    } catch { /* Invalid manifests give no package name. */ }
  }
  const surface = surfaces(api.files), issues = [], gaps = [];
  let blocks = 0;
  for (const [path, text] of texts) {
    const lines = text.split(/\r?\n/); let fence = null, code = [], start = 0;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index], match = /^ {0,3}(`{3,}|~{3,})\s*(\S*)[^\n]*$/.exec(line);
      if (!fence) {
        if (match) { fence = { mark: match[1][0], length: match[1].length, language: match[2], skip: /\bno-check\b/.test(line.slice(match[0].indexOf(match[2]) + match[2].length)) }; start = index + 2; code = []; }
        continue;
      }
      if (!new RegExp(`^ {0,3}${fence.mark}{${fence.length},}\\s*$`).test(line)) { code.push(line); continue; }
      if (Object.hasOwn(kinds, fence.language)) {
        blocks++;
        if (fence.skip || /^\s*\/\/\s*@ts-nocheck\b/m.test(code.join('\n'))) { fence = null; continue; }
        const source = ts.createSourceFile(`example.${fence.language}`, code.join('\n'), ts.ScriptTarget.Latest, true, kinds[fence.language]);
        for (const diagnostic of source.parseDiagnostics) issues.push({ path, block: blocks, line: start + source.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line,
          kind: 'syntax', code: diagnostic.code, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ') });
        for (const node of source.statements) {
          if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
          const pkg = packages.find((x) => x.name === node.moduleSpecifier.text);
          if (!pkg) continue;
          const entries = pkg.entry.files.filter((x) => x.package === pkg.path), names = new Set(entries.flatMap((x) => [...surface(x.path).keys()]));
          if (!entries.length || pkg.entry.unresolved.some((x) => x.package === pkg.path) || [...names].some((x) => x.startsWith('*:'))) {
            gaps.push({ path, line: start + source.getLineAndCharacterOfPosition(node.getStart(source)).line, reason: 'public-api-unresolved' }); continue;
          }
          const clause = node.importClause, bindings = clause?.namedBindings;
          const requested = [...(clause?.name ? ['default'] : []), ...(bindings && ts.isNamedImports(bindings) ? bindings.elements.map((x) => (x.propertyName ?? x.name).text) : [])];
          for (const name of requested) if (!names.has(name)) issues.push({ path, block: blocks, line: start + source.getLineAndCharacterOfPosition(node.getStart(source)).line, kind: 'missing-export', name, package: pkg.name });
        }
      }
      fence = null;
    }
    if (fence && Object.hasOwn(kinds, fence.language)) gaps.push({ path, line: start - 1, reason: 'unclosed-fence' });
  }
  return { blocks, issues, gaps, limits: 'Syntax and named self-import checks only. No typecheck or execution.' };
}
