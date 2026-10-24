// Stale references after a change (capability C29): head text that still names a removed export, or the old path of a
// removed or renamed file. The search reads code, Markdown, JSON and YAML files as text, so it also finds a string in a
// dynamic import, a mock path in a test or a name in a config file. Each hit is a lead. Pure: the caller gives the texts.
import { posix } from 'node:path';
import { surfaces } from '../api-compare.mjs';
import { isCode, isTest } from '../project.mjs';

/** A shorter export name gives too many false hits, so the search skips it. */
export const shortestName = 4;
/** The search keeps at most this many hits for one term. */
export const hitsPerTerm = 100;
/** Dependency folders are excluded. Generated consumers use the same bounded reads as source files. */
const skippedFolders = new Set(['node_modules', 'bower_components', '.git']);
const generatedFolders = new Set(['dist', 'build', 'out', 'coverage', 'storybook-static', '.next', '.nuxt', '.output', '.svelte-kit', '.turbo', '.vercel']);
const lockfiles = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']);
const codeExtension = /\.(?:d\.)?[cm]?[jt]sx?$/;
const identifier = /^[A-Za-z_$][\w$]*$/;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The kind of place of a path: code, test, config (a code file such as vitest.config.ts), markdown, json or yaml. null: not searched. */
export function placeOf(path) {
  const parts = path.split('/'), name = parts.at(-1);
  if (parts.slice(0, -1).some((part) => skippedFolders.has(part)) || lockfiles.has(name)) return null;
  if (parts.slice(0, -1).some((part) => generatedFolders.has(part)) && codeExtension.test(name)) return 'generated';
  if (/\.(?:md|mdx|markdown)$/i.test(name)) return 'markdown';
  if (/\.(?:json|jsonc|json5)$/i.test(name)) return 'json';
  if (/\.ya?ml$/i.test(name)) return 'yaml';
  if (!isCode(path) && !/\.d\.[cm]?ts$/.test(path)) return null;
  return isTest(path) ? 'test' : /\.config\.[cm]?[jt]s$|^\.[\w-]+rc\.[cm]?js$/.test(name) ? 'config' : 'code';
}

/** The path without a code extension. An index file also stands for its folder, because `import './lib'` loads it. */
const keysOf = (path) => { const stem = path.replace(codeExtension, ''); return posix.basename(stem) === 'index' ? [stem, posix.dirname(stem)] : [stem]; };

/**
 * name -> the head files that use a live export with that name: a file whose exports (also through re-exports) have the
 * name, and a file that imports the name from such a file. After a move of an export, these files use the new place.
 */
function liveUsers(analysis) {
  const files = analysis?.api?.files ?? {}, surface = surfaces(files), users = new Map();
  const add = (name, path) => { if (!users.has(name)) users.set(name, new Set()); users.get(name).add(path); };
  for (const path of Object.keys(files)) for (const name of surface(path).keys()) add(name, path);
  const edges = [...(analysis?.files ?? []).flatMap((file) => file.imports.map((edge) => ({ ...edge, source: file.path }))), ...(analysis?.api?.testImports ?? [])];
  for (const edge of edges) if (edge.target && files[edge.target]) {
    for (const name of edge.names ?? [...(edge.typeNames ?? []), ...(edge.valueNames ?? [])]) if (surface(edge.target).has(name)) add(name, edge.source);
  }
  return (name) => users.get(name) ?? [];
}

/**
 * The search terms of a change. `names`: each removed export name, with the files that exported it, and the files to leave
 * out: its own file, the head files that import it, which the API comparison lists, and the head files that use a live
 * export with the same name (`head` is the head analysis). `paths`: the old path of each removed or renamed file (`files`
 * is the changed-file list of lib/verify-change.mjs). `skipped`: names that the search cannot use.
 */
export function referenceTerms(items, files, renames, head = null) {
  const forward = new Map(renames.map((item) => [item.from, item.to])), names = new Map(), skipped = [], live = liveUsers(head);
  for (const item of items) {
    if (!['REMOVED', 'RENAMED'].includes(item.status)) continue;
    if (!identifier.test(item.name) || item.name === 'default') { skipped.push({ name: item.name, path: item.path, reason: 'not-a-name' }); continue; }
    if (item.name.length < shortestName) { skipped.push({ name: item.name, path: item.path, reason: 'short' }); continue; }
    const term = names.get(item.name) ?? { name: item.name, files: new Set(), exclude: new Set() };
    term.files.add(item.path);
    term.exclude.add(item.path);
    if (item.base?.declaredIn) term.exclude.add(forward.get(item.base.declaredIn) ?? item.base.declaredIn);
    for (const consumer of item.consumers?.items ?? []) term.exclude.add(consumer.path);
    for (const path of live(item.name)) term.exclude.add(path);
    names.set(item.name, term);
  }
  const gone = files.filter((file) => file.status === 'D' || file.status === 'R').map((file) => ({ path: file.from ?? file.path, to: file.status === 'R' ? file.path : null }))
    .filter((term) => !term.path.split('/').slice(0, -1).some((part) => skippedFolders.has(part)) && !lockfiles.has(posix.basename(term.path)));
  return { names: [...names.values()].map((term) => ({ ...term, files: [...term.files].sort(), exclude: [...term.exclude] })).sort((a, b) => a.name.localeCompare(b.name)),
    paths: gone.map((term) => ({ ...term, keys: keysOf(term.path) })).sort((a, b) => a.path.localeCompare(b.path)), skipped };
}

/**
 * The hits of the terms in `texts` (Map(path -> text)), sorted by path, line and column. A file with a static import of an
 * old path is left out for that path: the import graph already reports that import. `edges` are the head import edges.
 * Each hit has `path`, `line`, `column`, `place`, `term`, `match` (`name`, `path` or `specifier`) and `text` (the line, cut).
 */
export function findReferences(texts, terms, edges, limit = hitsPerTerm) {
  const byKey = new Map(terms.paths.flatMap((term) => term.keys.map((key) => [key, term]))), byName = new Map(terms.names.map((term) => [term.name, term]));
  const resolveIn = (file, specifier) => posix.normalize(posix.join(posix.dirname(file), specifier)).replace(codeExtension, '');
  const importers = new Set();
  for (const edge of edges) if (edge.mode === 'static' && edge.target === null && edge.specifier?.startsWith('.')) {
    const term = byKey.get(resolveIn(edge.source, edge.specifier));
    if (term) importers.add(`${term.path}\0${edge.source}`);
  }
  const patterns = [
    // A name inside a path or a kebab-case word (old-helper, src/helper) is not a reference to the name.
    terms.names.length && { match: 'name', regex: new RegExp(`(?<![\\w$/-])(?:${terms.names.map((term) => escape(term.name)).join('|')})(?![\\w$-])`, 'g'), term: (found) => byName.get(found[0]) },
    byKey.size && { match: 'specifier', regex: /(['"`])(\.\.?\/[^'"`\r\n]{0,300}?)\1/g, term: (found, file) => byKey.get(resolveIn(file, found[2])) },
    terms.paths.length && { match: 'path', regex: new RegExp(`(?<![\\w/-])(?:\\.{1,2}/)*(${terms.paths.map((term) => escape(term.keys[0])).join('|')})(?:\\.[A-Za-z0-9]+)?(?![\\w/-])`, 'g'),
      term: (found) => byKey.get(found[1]) }].filter(Boolean);
  const hits = [], counts = new Map(), seen = new Set(), full = new Set();
  for (const [path, text] of [...texts].sort(([a], [b]) => a.localeCompare(b))) {
    const place = placeOf(path), starts = [0];
    if (place === null) continue;
    for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) starts.push(index + 1);
    const lineOf = (offset) => { let low = 0, high = starts.length - 1; while (low < high) { const mid = (low + high + 1) >> 1; if (starts[mid] <= offset) low = mid; else high = mid - 1; } return low; };
    for (const pattern of patterns) for (const found of text.matchAll(pattern.regex)) {
      const term = pattern.term(found, path);
      if (!term) continue;
      const kind = term.keys ? 'path' : 'export', id = kind === 'path' ? term.path : term.name;
      if (kind === 'export' ? term.exclude.includes(path) : importers.has(`${term.path}\0${path}`)) continue;
      const index = lineOf(found.index), key = `${kind}\0${id}\0${path}\0${index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if ((counts.get(`${kind}\0${id}`) ?? 0) >= limit) { full.add(`${kind}\0${id}`); continue; }
      counts.set(`${kind}\0${id}`, (counts.get(`${kind}\0${id}`) ?? 0) + 1);
      const line = text.slice(starts[index], (starts[index + 1] ?? text.length + 1) - 1).replace(/\r$/, ''), column = found.index - starts[index];
      hits.push({ path, line: index + 1, column: column + 1, place, term: kind === 'path' ? { kind, path: term.path, to: term.to } : { kind, name: term.name, files: term.files },
        match: pattern.match, text: line.slice(Math.max(0, column - 80), column + 120).trim() });
    }
  }
  hits.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column);
  return { hits, truncated: full.size ? { limit: 'hits-per-term', value: limit, terms: full.size } : null };
}
