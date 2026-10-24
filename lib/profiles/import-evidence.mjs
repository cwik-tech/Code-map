// Import evidence for static-baseline-v0 beyond findings. Relative imports cover source, test and package-root config files.
// These functions compare the import edges of the base and the head for alias and
// package-path imports, find the test imports that the head no longer shows, and list the changed code files whose imports
// the analysis does not check. Pure: they read only the two analyses and the change list.
import { isCode } from '../project.mjs';

/** Loader syntax: a query such as "?raw" or an inline loader such as "!!raw-loader!" in any specifier (relative, alias or package). */
export const loaderSyntax = /[?!]/;

/** The alias or package part of a specifier, with a "/": "@/" for "@/x", "@scope/name/" for "@scope/name/x" and "name/" for "name/x". */
const prefixOf = (specifier) => { const parts = specifier.split('/'); return `${parts.slice(0, parts[0].length > 1 && parts[0].startsWith('@') ? 2 : 1).join('/')}/`; };
/** An alias, a package or a package path: a specifier that is not relative and has no loader syntax. */
const aliased = (specifier) => typeof specifier === 'string' && !specifier.startsWith('.') && !loaderSyntax.test(specifier);
const under = (specifier) => specifier.startsWith(prefixOf(specifier));
/** No extension, or the extension of a code file. A style or an image through an alias never resolves, so its import shows no break. */
const codeLike = (specifier) => !/\.[^./]+$/.test(specifier) || isCode(specifier);

/**
 * The broken imports through an alias or a package path, as { file, edge } entries of the head. `lost`: a head import that resolved
 * in the base and does not resolve now. `added`: a new import of a changed file that does not resolve, although another import with
 * the same prefix (such as "@/") resolves to a file of the repository. `back` maps a head path to its base path after a rename.
 */
export function aliasImports(head, base, back, changed) {
  const local = new Set([head, base].flatMap((side) => [...side.analysis.files, ...(side.analysis.importFiles ?? [])].flatMap((file) => file.imports))
    .filter((edge) => edge.target !== null && aliased(edge.specifier) && under(edge.specifier)).map((edge) => prefixOf(edge.specifier)));
  // One entry for each file and specifier: a static and a dynamic import of one module are one import.
  const seen = new Set(), once = (key) => !seen.has(key) && Boolean(seen.add(key)), baseFiles = new Map([...base.analysis.files, ...(base.analysis.importFiles ?? [])].map((file) => [file.path, file]));
  const broken = [...head.analysis.files, ...(head.analysis.importFiles ?? [])].flatMap((file) => file.imports.filter((edge) => edge.target === null && aliased(edge.specifier) && once(`${file.path}\0${edge.specifier}`))
    .map((edge) => ({ file, edge })));
  const before = ({ file, edge }) => (baseFiles.get(back.get(file.path) ?? file.path)?.imports ?? []).filter((old) => old.specifier === edge.specifier);
  return { lost: broken.filter((entry) => before(entry).some((old) => old.target !== null)),
    added: broken.filter((entry) => changed.has(entry.file.path) && !before(entry).length && under(entry.edge.specifier) && local.has(prefixOf(entry.edge.specifier)) && codeLike(entry.edge.specifier)) };
}

/**
 * [test, source] pairs: in the base, the test file imports a changed source file, and the head analysis does not show that import.
 * Older analyses omit unresolved test edges. Retained head edges let findings distinguish broken imports from removed imports.
 */
export function lostTestImports(head, base, rename, changed) {
  const headFiles = new Map(head.analysis.files.map((file) => [file.path, file])), baseFiles = new Set(base.analysis.files.map((file) => file.path));
  const checked = new Set((head.analysis.importFiles ?? []).map((file) => file.path));
  const tests = new Set((head.analysis.tests?.testFiles ?? []).map((file) => file.path));
  const users = (file, sources) => [...(file.tests?.direct ?? []), ...(file.exports ?? []).flatMap((item) => item.consumers ?? [])].filter((path) => !sources.has(path));
  return base.analysis.files.filter((file) => changed.has(file.path)).flatMap((file) => {
    const now = headFiles.get(rename(file.path)), kept = new Set(now ? users(now, headFiles) : []);
    return [...new Set(users(file, baseFiles).map(rename))].filter((path) => tests.has(path) && !checked.has(path) && !kept.has(path)).map((path) => [path, file.path]);
  });
}

/** Changed code and declaration files whose imports have no analysis evidence. */
export function uncheckedFiles(head, change) {
  const sources = new Set([...head.analysis.files, ...(head.analysis.importFiles ?? [])].map((file) => file.path)), declaration = (path) => /\.d\.[cm]?ts$/.test(path);
  return change.files.filter((file) => file.status !== 'D' && (isCode(file.path) || declaration(file.path)) && !sources.has(file.path)).map((file) => file.path);
}
