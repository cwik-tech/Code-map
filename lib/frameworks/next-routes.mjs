// Next.js detection and the route inventory: the package.json files that list next, and the App Router, Pages Router and
// middleware and proxy files below each Next.js root, with the URL pattern of each route. Pure: texts and paths in, lists out.
import { posix } from 'node:path';

/** The default page extensions of Next.js. Code-map does not read a custom pageExtensions setting. */
const extension = /\.(?:jsx?|tsx?)$/;
const configName = /(?:^|\/)next\.config\.(?:js|cjs|mjs|ts|mts)$/;
const declaration = /\.d\.[cm]?ts$/, testName = /\.(?:test|spec|e2e)\.[jt]sx?$/;
const appKinds = new Set(['page', 'layout', 'template', 'loading', 'error', 'global-error', 'not-found', 'default', 'route']);
const pagesSpecial = { _app: 'app', _document: 'document', _error: 'error' };
const dependencyFields = ['dependencies', 'devDependencies'];
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The package.json files that list next, with the declared version text, the names of their dependencies and the files that are not JSON. */
export function nextPackages(texts) {
  const packages = [], unreadable = [], dependencies = new Set();
  for (const [path, text] of texts) {
    if (posix.basename(path) !== 'package.json' || path.split('/').includes('node_modules')) continue;
    let json = null;
    try { json = JSON.parse(text); } catch { /* counted below */ }
    if (json === null || typeof json !== 'object' || Array.isArray(json)) { unreadable.push(path); continue; }
    const fields = dependencyFields.filter((name) => json[name] !== null && typeof json[name] === 'object');
    const field = fields.find((name) => typeof json[name].next === 'string');
    if (!field) continue;
    packages.push({ path, field, version: json[field].next });
    for (const name of fields) for (const dependency of Object.keys(json[name])) dependencies.add(dependency);
  }
  return { packages: packages.sort(byPath), unreadable: unreadable.sort(), dependencies: [...dependencies].sort() };
}

/** The HTTP methods that an App Router route file can export, one function for each method. */
export const handlerMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** `[id]`, `[...slug]` and `[[...slug]]` name a parameter of the URL. */
export function parameter(segment) {
  const match = /^\[\[\.\.\.([^\]]+)\]\]$|^\[\.\.\.([^\]]+)\]$|^\[([^\]]+)\]$/.exec(segment);
  if (!match) return null;
  return match[1] ? { name: match[1], kind: 'optional-catch-all' } : match[2] ? { name: match[2], kind: 'catch-all' } : { name: match[3], kind: 'dynamic' };
}

/**
 * The route of a file below an app folder (`rest` starts below it), or null. A route group `(name)` and a slot `@name` are
 * not part of the URL. An intercepting segment `(.)x`, `(..)x`, `(..)(..)x` or `(...)x` gives the URL that it intercepts:
 * the levels count URL segments, not folders. A private folder `_name` holds no routes.
 */
export function appRoute(rest) {
  const folders = rest.split('/'), file = folders.pop(), kind = file.replace(extension, '');
  if (!extension.test(file) || declaration.test(file) || !appKinds.has(kind) || folders.some((folder) => folder.startsWith('_'))) return null;
  const url = [], groups = [], slots = [], params = [];
  let intercepts = null;
  for (const folder of folders) {
    const marker = /^(\(\.\.\.\)|(?:\(\.\.\))+|\(\.\))(.+)$/.exec(folder);
    const segment = marker ? marker[2] : folder;
    if (marker) {
      intercepts = { marker: marker[1], from: `/${url.join('/')}` };
      const levels = marker[1] === '(...)' ? url.length : marker[1] === '(.)' ? 0 : marker[1].length / 4;
      url.splice(Math.max(0, url.length - levels));
    } else if (/^\(.+\)$/.test(folder)) { groups.push(folder); continue; }
    else if (folder.startsWith('@')) { slots.push(folder); continue; }
    url.push(segment);
    const found = parameter(segment);
    if (found) params.push(found);
  }
  return { kind, url: `/${url.join('/')}`, groups, slots, params, intercepts };
}

/**
 * The route of a file below a pages folder, or null. An `index` file names its folder. The files in the folder `api` are
 * API routes. A file `api.tsx` is a page.
 */
export function pagesRoute(rest) {
  if (!extension.test(rest) || declaration.test(rest) || testName.test(rest)) return null;
  const segments = rest.replace(extension, '').split('/'), last = segments.at(-1);
  const plain = { groups: [], slots: [], params: segments.map(parameter).filter(Boolean), intercepts: null };
  if (segments.length === 1 && Object.hasOwn(pagesSpecial, last)) return { kind: pagesSpecial[last], url: null, ...plain };
  if (last === 'index') segments.pop();
  return { kind: rest.startsWith('api/') ? 'api' : 'page', url: `/${segments.join('/')}`, ...plain };
}

/** The route of a path below one Next.js folder (`rest` starts at that folder), or null. */
function routeIn(rest) {
  for (const prefix of ['', 'src/']) {
    if (!rest.startsWith(prefix)) continue;
    const inner = rest.slice(prefix.length);
    if (inner.startsWith('app/')) { const found = appRoute(inner.slice(4)); return found && { router: 'app', ...found }; }
    if (inner.startsWith('pages/')) { const found = pagesRoute(inner.slice(6)); return found && { router: 'pages', ...found }; }
    const entry = /^(middleware|proxy)\.(?:jsx?|tsx?)$/.exec(inner);
    if (entry) return { router: entry[1], kind: entry[1], url: null, groups: [], slots: [], params: [], intercepts: null };
  }
  return null;
}

/**
 * Every App Router, Pages Router, middleware and proxy file below the Next.js roots, sorted by path. A Next.js root is the folder
 * of a package.json that lists next. When a package lists next, the folder of each next.config file is also a root. Thus
 * a monorepo that lists next only in its top package.json still gets the routes of its apps.
 */
export function nextRoutes(paths, packages) {
  const configs = packages.length ? paths.filter((path) => configName.test(path) && !path.split('/').includes('node_modules')) : [];
  // The deepest folder first, so a nested Next.js package owns its own files.
  const roots = [...new Set([...packages.map((item) => item.path), ...configs].map((path) => posix.dirname(path)))]
    .map((folder) => (folder === '.' ? '' : `${folder}/`)).sort((a, b) => b.length - a.length);
  const routes = [];
  for (const path of paths) {
    const root = roots.find((folder) => path.startsWith(folder));
    const found = root === undefined ? null : routeIn(path.slice(root.length));
    if (found) routes.push({ path, root: root.slice(0, -1) || '.', ...found });
  }
  return routes.sort(byPath);
}
