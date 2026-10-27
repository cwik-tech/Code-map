// Orphaned files (C32): source files that no other file imports and that are not entry points. A file that a computed
// dynamic import, a glob, file-based routing or an unmapped entry point can reach is unknown and gets no finding.
// Pure: the caller gives the parsed files, the texts, the package.json files and the import resolver of the analysis.
import { posix } from 'node:path';
import { mentionsPath } from './manifests.mjs';
import { buildSources, dynamicPrefixes, globFiles, globReferences, reachPrefix, scriptFiles, urlReferences } from './reach.mjs';

/**
 * Config files, Storybook stories, the setupTests and setupProxy files of Create React App, and files in a scripts or bin
 * folder: tools start them by their path or by their name.
 */
const toolFile = /(?:^|\/)(?:scripts|bin)\/|(?:^|\/)[^/]+\.config\.[^/]+$|(?:^|\/)\.[\w.-]*rc\.[cm]?[jt]s$|\.(?:stories|story)\.[cm]?[jt]sx?$|(?:^|\/)(?:setupTests|setupProxy)\.[cm]?[jt]sx?$/;
/** A target that can name a code file: a code or declaration extension, or no extension. */
const codeTarget = /(?:\.[cm]?[jt]sx?|\/[^/.]+)$|^[^/.]+$/;
/** Next.js files that the framework loads by their name, besides the routes of lib/frameworks/next-routes.mjs. */
const nextFiles = /(?:^|\/)(?:src\/)?app\/(?:.*\/)?(?:opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.[jt]sx?$|(?:^|\/)(?:src\/)?(?:instrumentation|instrumentation-client|mdx-components)\.[jt]sx?$/;
/** Packages of frameworks that load the files in their routes, pages or app folders by the file name. */
const routers = ['@remix-run/dev', '@react-router/dev', 'expo-router', 'gatsby', '@docusaurus/core', 'nuxt', '@sveltejs/kit', 'astro', '@tanstack/react-router',
  '@tanstack/router-plugin', '@tanstack/react-start', '@solidjs/start', '@builder.io/qwik-city', 'vite-plugin-pages', '@analogjs/platform'];
const routeFolder = /(?:^|\/)(?:routes|pages|app)\//;

/** The entry points that package.json names: its fields (also through build output), the default index file and its scripts. */
function packageEntries({ manifests, entryPoints, aliases, resolve, sources }) {
  const entries = new Set(entryPoints.files.map((item) => item.path)), unmapped = new Set(), byPath = new Map(manifests.map((item) => [item.path, item]));
  for (const item of entryPoints.unresolved) {
    const manifest = byPath.get(item.package);
    if (!manifest) continue;
    const found = buildSources(manifest, item.target, aliases, resolve, sources);
    for (const path of found) entries.add(path);
    // A target that names a file of the snapshot outside the source files is a real entry point, such as a script outside the
    // roots. A target that names a style or another file that is not code, or a file in a declared package, reaches no source file.
    const inPackage = !item.target.startsWith('.') && Object.values(manifest.fields).some((list) => list.some((name) => item.target.startsWith(`${name}/`)));
    if (!found.length && item.reason === 'not-found' && codeTarget.test(item.target) && !inPackage) unmapped.add(manifest.path);
  }
  for (const manifest of manifests) {
    const index = manifest.hasEntry ? null : resolve(manifest.path, './index');
    if (index) entries.add(index);
    for (const script of manifest.scripts) for (const path of scriptFiles(script, manifest, resolve, sources, aliases)) entries.add(path);
  }
  return { entries, unmapped };
}

/**
 * { orphaned: [{ path, manifest }], unknown: [{ path, manifest, reason, via }], unchecked, entries }. `unchecked` counts the
 * source files without a package.json above them, and `entries` the source files without an importer that are entry points.
 * `scanned` holds the other code files that Code-map read ({ path, specifiers }), so their relative imports count as importers.
 * `configTexts(manifest)` gives the text of the package.json and of the config files at the package root.
 */
export function orphanLeads({ sources, tests, scanned, texts, index, manifests, entryPoints, electron, nextjs, aliases, resolve, configTexts }) {
  const paths = sources.map((file) => file.path), importers = new Set(), parsed = [...sources, ...tests];
  for (const file of [...parsed, ...scanned]) for (const target of file.imports) importers.add(target);
  const reached = [], wide = new Map(), globbed = new Set();
  for (const file of [...parsed, ...scanned]) {
    const text = texts.get(file.path) ?? '', lines = text.split('\n');
    for (const target of urlReferences(file.path, text, resolve)) if (target !== file.path) importers.add(target);
    for (const glob of globReferences(file.path, text)) for (const path of globFiles(glob, paths)) globbed.add(path);
    for (const edge of file.edges ?? []) if (edge.specifier === null && edge.target === null) for (const prefix of dynamicPrefixes(lines[edge.line - 1] ?? '')) {
      const reach = reachPrefix(file.path, prefix), owner = index.nearest(file.path);
      if (reach === '' && owner && !wide.has(owner.path)) wide.set(owner.path, file.path);
      else if (reach) reached.push({ prefix: reach, via: file.path });
    }
  }
  const { entries, unmapped } = packageEntries({ manifests, entryPoints, aliases, resolve, sources: paths });
  for (const item of entryPoints.startedPaths?.entries ?? []) entries.add(item.path);
  for (const item of electron?.entries ?? []) entries.add(item.path);
  const routes = new Set(nextjs?.detected ? nextjs.routes.map((route) => route.path) : []);
  const routing = new Set(manifests.filter((manifest) => routers.some((name) => Object.values(manifest.fields).some((list) => list.includes(name)))).map((manifest) => manifest.path));
  const result = { orphaned: [], unknown: [], unchecked: 0, entries: 0 };
  for (const path of paths) {
    if (importers.has(path)) continue;
    const manifest = index.nearest(path);
    if (!manifest) { result.unchecked++; continue; }
    const rest = manifest.folder === '.' ? path : path.slice(manifest.folder.length + 1), stem = rest.replace(/\.[^./]+$/, '');
    const entry = entries.has(path) || toolFile.test(rest) || routes.has(path) || (nextjs?.detected && nextFiles.test(rest)) || configTexts(manifest).some((text) => mentionsPath(text, stem));
    if (entry) { result.entries++; continue; }
    const via = reached.find((item) => path.startsWith(item.prefix))?.via ?? wide.get(manifest.path) ?? null;
    const reason = via !== null ? 'dynamic-import' : globbed.has(path) ? 'glob-import' : unmapped.has(manifest.path) ? 'entry-not-mapped'
      : routing.has(manifest.path) && routeFolder.test(rest) ? 'file-routing' : null;
    if (reason) result.unknown.push({ path, manifest: manifest.path, reason, via });
    else result.orphaned.push({ path, manifest: manifest.path });
  }
  return result;
}
