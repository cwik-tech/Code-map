// The package report of one snapshot, stored in the analysis as `packages`: the package.json files, the leads of the package
// import rules (C01), of unused dependencies and of orphaned files (C32), and what the checks cannot decide (C40).
// It reads the texts and the parsed files of the collector, and only the node_modules folders of the working folder.
import { posix } from 'node:path';
import ts from 'typescript';
import { completenessTable } from '../completeness.mjs';
import { expandPatterns } from '../dynamic-patterns.mjs';
import { analyzeFile } from '../analyze.mjs';
import { ignored, isCode } from '../project.mjs';
import { installedPackages } from './installed.mjs';
import { importLeads } from './imports.mjs';
import { classify, isDeclaration, isPackageConfig, manifestIndex, readManifests } from './manifests.mjs';
import { orphanLeads } from './orphans.mjs';
import { styleUses } from './styles.mjs';
import { unusedLeads, dynamicPackageSites } from './unused.mjs';

/**
 * The paths that the package checks read besides the source and test files in `read`: the code and declaration files outside
 * the source roots, and the config files at the root of each package.
 */
export function packageReadPaths(paths, read) {
  const folders = new Set(paths.filter((path) => posix.basename(path) === 'package.json' && !ignored(path)).map((path) => posix.dirname(path)));
  // The Yarn Plug'n'Play files are large generated code that names every package.
  return paths.filter((path) => !read.has(path) && !ignored(path) && !posix.basename(path).startsWith('.pnp.')
    && (isCode(path) || isDeclaration(path) || (isPackageConfig(path) && folders.has(posix.dirname(path)))));
}

/** The package of a bare specifier, or null for a relative path, a built-in module with `node:` or a specifier that Code-map skips. */
const nameOf = (specifier) => { if (specifier.startsWith('.')) return null; const found = classify(specifier); return found.kind === 'package' ? found.name : null; };
/** `require.resolve('x')` and `import.meta.resolve('x')` use a package without an import. */
const resolveCalls = (text) => [...text.matchAll(/\b(?:require|import\.meta)\.resolve\s*\(\s*(['"`])([^'"`]+)\1/g)].map((match) => match[2]);

/**
 * `inputs`: the repository folder, the texts and all paths of the snapshot, the parsed source and test files, the package entry
 * points (lib/api-surface.mjs), the Next.js report, the import resolver and the TypeScript projects (readAliases).
 */
export function analyzePackages({ repository, texts, paths, files, testFacts, entryPoints, electron, nextjs, resolve, aliases, auxiliaryFacts = [] }) {
  const { manifests, unreadable } = readManifests(texts), index = manifestIndex(manifests, unreadable), installed = installedPackages(repository);
  const parsed = [...files, ...testFacts], analyzed = new Set(parsed.map((file) => file.path)), tests = new Set(testFacts.map((file) => file.path));
  const cached = new Map(auxiliaryFacts.map((file) => [file.path, file]));
  const scanned = [...texts.keys()].filter((path) => !analyzed.has(path) && !ignored(path) && !posix.basename(path).startsWith('.pnp.') && (isCode(path) || isDeclaration(path))).sort().map((path) => {
    const info = ts.preProcessFile(texts.get(path), true, true);
    const facts = cached.get(path) ?? expandPatterns(analyzeFile(path, texts.get(path), resolve), paths);
    return { path, syntax: facts.syntax, edges: facts.edges, imports: facts.imports, specifiers: [...info.importedFiles, ...info.typeReferenceDirectives].map((item) => item.fileName) };
  });
  const configs = new Map();
  for (const [path, text] of texts) if (isPackageConfig(path) && !ignored(path)) configs.set(posix.dirname(path), [...(configs.get(posix.dirname(path)) ?? []), text]);
  const configTexts = (manifest) => configs.get(manifest.folder) ?? [];
  const jsx = (path) => /\.[cm]?[jt]sx$/.test(path);
  const dynamic = (file) => dynamicPackageSites(file, texts.get(file.path) ?? '');
  const uses = [...parsed.map((file) => ({ path: file.path, jsx: jsx(file.path), dynamic: dynamic(file),
    names: new Set([...(file.edges ?? []).filter((edge) => typeof edge.specifier === 'string' && edge.target === null).map((edge) => edge.specifier), ...resolveCalls(texts.get(file.path) ?? '')].map(nameOf).filter(Boolean)) })),
  ...scanned.map((file) => ({ path: file.path, jsx: jsx(file.path), dynamic: dynamic(file), names: new Set([...file.specifiers, ...resolveCalls(texts.get(file.path) ?? '')].map(nameOf).filter(Boolean)) }))];
  const imports = importLeads({ files: [...parsed, ...scanned], isTest: (path) => tests.has(path), index, installed, aliases, paths });
  const orphans = orphanLeads({ sources: files, tests: testFacts, scanned, texts, index, manifests, entryPoints, electron, nextjs, aliases, resolve, configTexts: (manifest) => [manifest.text, ...configTexts(manifest)] });
  const unused = unusedLeads({ manifests, index, uses: [...uses, ...styleUses(texts)], configTexts });
  const owners = manifests.filter((manifest) => manifest.owner && uses.some((file) => index.owns(manifest, file.path)));
  return {
    completeness: completenessTable({ paths, files: [...parsed, ...scanned], texts }),
    manifests: manifests.map((manifest) => ({ path: manifest.path, name: manifest.name, private: manifest.private, owner: manifest.owner, installed: installed.installed(manifest.folder) })),
    unreadable,
    leads: { ...imports.leads, unused: unused.unused, orphaned: orphans.orphaned },
    unknown: { unused: unused.unknown, exports: imports.unknownExports, orphans: orphans.unknown },
    skipped: imports.skipped,
    // The package.json files whose folders have no node_modules folder, those whose dependencies were not checked for use, and
    // the number of source files without a package.json above them.
    unchecked: { notInstalled: owners.filter((manifest) => !installed.installed(manifest.folder)).map((manifest) => manifest.path), unused: unused.unchecked, orphans: orphans.unchecked },
    entryFiles: orphans.entries,
  };
}
