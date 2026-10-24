// What can reach a source file without a static import: the files that package.json scripts name, the source files of
// entry points in build output, and the static start of dynamic imports, globs and URL references in the source text.
// Pure: the caller gives the texts, the source paths and the import resolver of the analysis.
import { posix } from 'node:path';

/** The usual folders of build output. An entry point in them maps to the same path below `src` or below the package. */
const buildFolders = new Set(['dist', 'lib', 'build', 'out', 'esm', 'cjs', 'es', 'umd', 'types', 'typings']);
const escape = (text) => text.replace(/[.+^${}()|[\]\\]/g, '\\$&');

/** The source files that a glob such as "test/**\/*.ts" names. The glob is relative to the repository root. */
export function globFiles(glob, sources) {
  const pattern = escape(glob).replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '(?:.*/)?');
  const regex = new RegExp(`^${pattern}$`);
  return sources.filter((path) => regex.test(path));
}

/**
 * The source files that one package.json script names, as a path or as a glob. Words that name a command are skipped. A path
 * in build output, such as "node dist/main.js", maps to its source file as an entry point does.
 */
export function scriptFiles(script, manifest, resolve, sources, aliases) {
  const files = [], known = new Set(sources);
  for (const word of script.split(/[\s;&|()<>]+/)) {
    const token = word.replace(/^['"]|['"]$/g, '').replace(/^--?[\w-]+=/, '');
    if (!token || token.startsWith('-') || token.startsWith('/') || token.includes('$') || !/[/.]/.test(token)) continue;
    if (token.includes('*')) { files.push(...globFiles(posix.join(manifest.folder, token), sources)); continue; }
    if (!token.includes('/') && !/\.[cm]?[jt]sx?$/.test(token)) continue;
    const target = resolve(manifest.path, token.startsWith('.') ? token : `./${token}`);
    files.push(...(target && known.has(target) ? [target] : token.includes('/') ? buildSources(manifest, token, aliases, resolve, sources) : []));
  }
  return files;
}

/** Source files whose path without extension matches a pattern with one "*", as in lib/api-surface.mjs. */
function patternFiles(full, sources) {
  const star = full.indexOf('*'), stem = (path) => path.replace(/\.[^./]+$/, '');
  const before = full.slice(0, star), after = stem(full.slice(star + 1));
  return sources.filter((path) => path.startsWith(before) && stem(path).endsWith(after) && stem(path).length > before.length + after.length);
}

/**
 * The source files of one entry-point target that names build output, such as "dist/index.js" or "./dist/*.d.ts". The
 * outDir and rootDir of a TypeScript project map it first. Then the usual build folders are replaced with `src`, or left out.
 * An empty list means that Code-map cannot map the target.
 */
export function buildSources(manifest, target, { projects = [] }, resolve, sources) {
  const full = posix.normalize(posix.join(manifest.folder, target)).replace(/\.d(\.[cm]?ts)$/, '$1');
  const candidates = [];
  for (const project of projects) {
    const { outDir, rootDir } = project.options;
    if (typeof outDir !== 'string') continue;
    const out = posix.relative('/', outDir), into = posix.relative('/', typeof rootDir === 'string' ? rootDir : project.directory);
    if (full.startsWith(`${out}/`)) candidates.push(posix.join(into, full.slice(out.length + 1)));
  }
  const parts = posix.relative(manifest.folder, full).split('/');
  let skip = 0;
  while (skip < parts.length - 1 && buildFolders.has(parts[skip])) skip++;
  if (skip) candidates.push(posix.join(manifest.folder, 'src', ...parts.slice(skip)), posix.join(manifest.folder, ...parts.slice(skip)));
  const known = new Set(sources), found = new Set();
  for (const candidate of candidates) {
    if (candidate.includes('*')) { for (const path of patternFiles(candidate, sources)) found.add(path); continue; }
    const path = resolve(manifest.path, `./${posix.relative(manifest.folder, candidate)}`);
    if (path && known.has(path)) found.add(path);
  }
  return [...found];
}

/**
 * The static start of each computed `import()` or `require()` on one source line: the text before the first `${` of a template,
 * or the string before a "+". It is "" when the target has no static start, or when Code-map cannot read the line.
 */
export function dynamicPrefixes(line) {
  const list = [];
  for (const match of line.matchAll(/\b(?:import|require)\s*\(\s*(?:`([^`$]*)|(['"])([^'"]*)\2\s*\+|)/g)) list.push(match[1] ?? match[3] ?? '');
  return list.length ? list : [''];
}

/** A relative computed target gives a path prefix. A bare target can be an alias, so its reach is unknown. */
export function reachPrefix(from, prefix) {
  if (prefix.startsWith('.')) { const joined = posix.join(posix.dirname(from), prefix); return joined === './' || joined === '.' ? '' : joined.replace(/^\.\//, ''); }
  return '';
}

/** Vite `import.meta.glob` patterns and webpack `require.context` folders, as globs relative to the repository root. */
export function globReferences(from, text) {
  const globs = [], folder = posix.dirname(from);
  for (const match of text.matchAll(/import\.meta\.glob(?:Eager)?\s*\(\s*\[?\s*(['"`])(\.{1,2}\/[^'"`]+)\1|require\.context\s*\(\s*(['"`])(\.{1,2}\/?[^'"`]*)\3/g)) {
    if (match[2]) globs.push(posix.join(folder, match[2]));
    else globs.push(`${posix.join(folder, match[4]).replace(/\/$/, '')}/**`);
  }
  return globs;
}

/** The files that `new URL('./x', import.meta.url)` names, for example a web worker or a module that a loader starts. */
export function urlReferences(from, text, resolve) {
  const files = [];
  for (const match of text.matchAll(/new\s+URL\s*\(\s*(['"`])(\.{1,2}\/[^'"`]+)\1\s*,\s*import\.meta\.url/g)) {
    const target = resolve(from, match[2]);
    if (target) files.push(target);
  }
  return files;
}
