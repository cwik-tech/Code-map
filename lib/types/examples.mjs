// Virtual documentation modules use package compiler settings. No example executes.
import ts from 'typescript';
import { posix } from 'node:path';
import { examplePath } from '../contracts/inputs.mjs';
import { createResolver } from '../analyze.mjs';
import { packageEntryPoints } from '../api-surface.mjs';

/** Extract closed TypeScript fences with document coordinates and explicit opt-outs. */
export function exampleBlocks(texts) {
  const blocks = []; let ordinal = 0;
  for (const [path, text] of texts) {
    if (!examplePath(path)) continue;
    const lines = text.split(/\r?\n/); let fence = null;
    for (let index = 0; index < lines.length; index++) {
      if (!fence) {
        const match = /^ {0,3}(`{3,}|~{3,})\s*(\S*)(.*)$/.exec(lines[index]);
        if (match) fence = { mark: match[1][0], size: match[1].length, language: match[2], info: match[3], index };
      } else if (new RegExp(`^ {0,3}${fence.mark}{${fence.size},}\\s*$`).test(lines[index])) {
        if (['ts', 'tsx', 'js', 'jsx'].includes(fence.language)) ordinal++;
        if (['ts', 'tsx'].includes(fence.language)) {
          const code = lines.slice(fence.index + 1, index).join('\n');
          blocks.push({ path, block: ordinal, blockLine: fence.index + 1, line: fence.index + 2,
            language: fence.language, code, skip: /(?:^|\s)no-check(?:\s|$)/.test(fence.info) || /^\s*\/\/\s*@ts-nocheck\b/m.test(code) });
        }
        fence = null;
      }
    }
  }
  return blocks;
}

/** Resolve exact package self-imports to declared source entry points, with compiler fallback for other imports. */
export function exampleResolver(texts, host, options, virtualFiles) {
  const relative = new Map([...texts].filter(([path]) => path.startsWith('/snapshot/')).map(([path, text]) => [path.slice(10), text]));
  const sources = [...relative.keys()].filter((path) => /\.[cm]?[jt]sx?$/.test(path));
  const resolve = createResolver(new Set(sources), { aliases: [], baseUrl: null });
  const packages = [];
  for (const [path, text] of relative) {
    if (posix.basename(path) !== 'package.json') continue;
    let manifest;
    try { manifest = JSON.parse(text); } catch { continue; }
    if (typeof manifest?.name !== 'string') continue;
    const exports = manifest.exports && typeof manifest.exports === 'object' && !Array.isArray(manifest.exports)
      && Object.keys(manifest.exports).some((key) => key.startsWith('.')) ? manifest.exports['.'] : manifest.exports;
    const entry = packageEntryPoints(new Map([[path, JSON.stringify(Object.hasOwn(manifest, 'exports') ? { exports } : manifest)]]), sources, resolve);
    const target = entry.files.find((item) => item.fields.includes('types') || item.fields.includes('typings')) ?? entry.files[0];
    if (target) packages.push({ name: manifest.name, folder: posix.dirname(`/snapshot/${path}`), target: `/snapshot/${target.path}` });
  }
  return (literals, containingFile, redirectedReference, compilerOptions = options, source) => literals.map((literal) => {
    const { text } = literal;
    const pkg = virtualFiles.has(containingFile) ? packages.filter((item) => item.name === text && containingFile.startsWith(`${item.folder}/`)).sort((a, b) => b.folder.length - a.folder.length)[0] : undefined;
    return pkg ? { resolvedModule: { resolvedFileName: pkg.target, extension: ts.extensionFromPath(pkg.target), isExternalLibraryImport: false } }
      : ts.resolveModuleName(text, containingFile, compilerOptions, host, undefined, redirectedReference,
        source ? ts.getModeForUsageLocation(source, literal, compilerOptions) : undefined);
  });
}

/** Record diagnostics only for virtual modules. Project errors remain separate evidence. */
export function exampleDiagnostics(program, blocks, result) {
  for (const block of blocks) {
    const source = program.getSourceFile(block.virtual);
    if (!source) continue;
    result.checked++;
    for (const diagnostic of [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)]) {
      if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
      const location = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      result.issues.push({ path: block.path, block: block.block, blockLine: block.blockLine, line: block.line + location.line,
        column: location.character + 1, kind: 'type', code: diagnostic.code, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ') });
    }
  }
}
