// The Next.js report of one analysis: detection, the route inventory, the client and server modules, and the leads of the
// Next.js finding rules. Pure: it reads the analysis, the paths and texts of the snapshot and the per-file React facts.
// A 'use client' file is a client module, and so is a module that only client code reaches. An App Router file, the
// middleware, a 'use server' file and each module that they reach without a 'use client' boundary are server modules.
// A module that both kinds reach counts as a server module. Pages Router modules have no boundary and stay unclassified.
import { builtinModules } from 'node:module';
import { isCode, underRoots } from '../project.mjs';
import { handlerMethods, nextPackages, nextRoutes } from './next-routes.mjs';

/** The React hooks that work only in client components. */
export const clientHooks = new Set(['useState', 'useEffect', 'useLayoutEffect', 'useReducer', 'useRef', 'useContext', 'useTransition', 'useOptimistic',
  'useActionState', 'useSyncExternalStore', 'useImperativeHandle', 'useInsertionEffect', 'useDeferredValue']);
const builtins = new Set(builtinModules.filter((name) => !name.startsWith('_')));
const serverPackages = { 'server-only': 'server-only', 'next/headers': 'next-headers', 'next/server': 'next-server' };
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
/** A type-only import, also one with only inline `type` names, is not part of a bundle. */
const bundled = (edge) => edge.kind !== 'type' && !(edge.valueNames.length === 0 && edge.typeNames.length > 0);
const emptyLeads = () => ({ clientApiInServer: [], serverImportInClient: [], clientPrivateEnv: [], serverActionExports: [] });

/** `inputs`: every path of the snapshot, the file texts, the parsed source files (with their `react` facts) and the source roots. */
export function analyzeFrameworks(analysis, { paths = [], texts = new Map(), files = [], roots = [] } = {}) {
  const found = nextPackages(texts);
  if (!found.packages.length) return { nextjs: { detected: false, packages: [], unreadable: found.unreadable, routes: [], modules: [], unclassified: [], leads: emptyLeads() } };
  const sources = new Map(analysis.files.map((file) => [file.path, file])), react = new Map(files.map((file) => [file.path, file.react ?? null]));
  const has = (path, directive) => react.get(path)?.directives.includes(directive) ?? false;
  const routes = nextRoutes(paths, found.packages).map((route) => ({ ...route, analyzed: sources.has(route.path), ...methodsOf(route, sources.get(route.path)) }));
  /** Breadth-first reach over bundled imports of mapped files. Each reached path keeps the importer that reached it first. */
  const reach = (seeds, stop) => {
    const via = new Map(seeds.map((path) => [path, null])), queue = [...via.keys()];
    for (let index = 0; index < queue.length; index++) for (const edge of sources.get(queue[index]).imports) {
      if (!bundled(edge) || !sources.has(edge.target) || via.has(edge.target) || stop(edge.target)) continue;
      via.set(edge.target, queue[index]); queue.push(edge.target);
    }
    return via;
  };
  const all = [...sources.keys()].sort(), client = (path) => has(path, 'use client'), action = (path) => has(path, 'use server') && !client(path);
  const server = reach([...routes.filter((route) => route.router !== 'pages' && route.analyzed && !client(route.path)).map((route) => route.path), ...all.filter(action)], client);
  const browser = reach(all.filter(client), (path) => has(path, 'use server'));
  const entryOf = (map, path) => { let current = path; while (map.get(current)) current = map.get(current); return current; };
  const routeFiles = new Set(routes.filter((route) => route.router !== 'pages').map((route) => route.path)), modules = [], unclassified = [];
  for (const path of all) {
    const side = client(path) ? 'client' : action(path) || server.has(path) ? 'server' : browser.has(path) ? 'client' : null;
    if (side === null) continue;
    const reason = client(path) ? 'use-client' : action(path) ? 'use-server' : routeFiles.has(path) ? 'route' : 'imported', map = side === 'server' ? server : browser;
    modules.push({ path, side, reason, via: reason === 'imported' ? map.get(path) : null, entry: reason === 'imported' ? entryOf(map, path) : null });
  }
  const classes = new Map(modules.map((item) => [item.path, item]));
  const pages = reach(routes.filter((route) => route.router === 'pages' && route.analyzed).map((route) => route.path), () => false);
  for (const path of all) if (!classes.has(path)) unclassified.push({ path, reason: pages.has(path) ? 'pages-router' : 'not-reached', line: null });
  const unread = new Set(routes.filter((route) => !route.analyzed).map((route) => route.path));
  // A code file that a classified module imports, but that Code-map did not read: outside the source roots or in an ignored folder.
  for (const item of modules) for (const edge of sources.get(item.path).imports) {
    if (bundled(edge) && edge.target !== null && !sources.has(edge.target) && isCode(edge.target)) unread.add(edge.target);
  }
  for (const path of [...unread].sort()) unclassified.push({ path, reason: underRoots(path, roots) ? 'not-read' : 'outside-roots', line: null });
  unclassified.sort(byPath);
  for (const item of modules) for (const edge of sources.get(item.path).imports) if (edge.specifier === null && edge.target === null) unclassified.push({ path: item.path, reason: 'dynamic-import', line: edge.line });
  return { nextjs: { detected: true, packages: found.packages, unreadable: found.unreadable, routes, modules, unclassified,
    leads: leadsOf(modules, sources, react, new Set(found.dependencies)) } };
}

/**
 * The HTTP methods of a route handler. An App Router route file exports one function for each method: KNOWN, unless Code-map
 * did not read the file, or it has an `export *` or a destructured export (`export const { GET, POST } = handlers`), which
 * has no plain export name. A Pages Router API route handles every method, so its methods are UNKNOWN.
 * Other routes get no method fields.
 */
function methodsOf(route, file) {
  if (route.router === 'pages' && route.kind === 'api') return { methods: null, methodState: 'UNKNOWN' };
  if (route.router !== 'app' || route.kind !== 'route') return {};
  if (!file) return { methods: null, methodState: 'UNKNOWN' };
  const names = file.exports.filter((item) => !item.typeOnly).map((item) => item.name);
  const plain = names.every((name) => /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u.test(name));
  return { methods: handlerMethods.filter((method) => names.includes(method)), methodState: plain ? 'KNOWN' : 'UNKNOWN' };
}

/** `node:fs` and `fs` are Node.js built-ins. A bare name that a Next.js package.json lists as a dependency is that package. */
const builtin = (specifier, dependencies) => specifier.startsWith('node:')
  || ((builtins.has(specifier) || builtins.has(specifier.split('/')[0])) && !dependencies.has(specifier.split('/')[0]));

/** The leads of the four Next.js rules, each sorted by path and name. */
function leadsOf(modules, sources, react, dependencies) {
  const leads = emptyLeads(), classes = new Map(modules.map((item) => [item.path, item]));
  const factsOf = (path) => react.get(path) ?? { directives: [], env: [], handlers: [], serverExports: [] };
  const importsServerOnly = (path) => sources.get(path).imports.some((edge) => edge.specifier === 'server-only' && bundled(edge));
  for (const item of modules) {
    const file = sources.get(item.path), facts = factsOf(item.path);
    if (item.side === 'server') {
      // A class and its methods both count the calls of a method, so each call appears once.
      const calls = file.declarations.flatMap((declaration) => declaration.hookCalls ?? []).filter((call) => call.classification === 'react' && clientHooks.has(call.name));
      const hooks = [...new Map(calls.map(({ name, line }) => [`${name}:${line}`, { name, line }])).values()].sort((a, b) => a.line - b.line || (a.name < b.name ? -1 : 1));
      if (hooks.length || facts.handlers.length) leads.clientApiInServer.push({ path: item.path, hooks, handlers: facts.handlers });
      if (item.reason === 'use-server') for (const entry of facts.serverExports) leads.serverActionExports.push({ path: item.path, ...entry });
      continue;
    }
    const imports = new Map();
    for (const edge of file.imports) {
      if (!bundled(edge) || typeof edge.specifier !== 'string') continue;
      const target = edge.target !== null && sources.has(edge.target) && classes.get(edge.target)?.side !== 'client' && !factsOf(edge.target).directives.includes('use server')
        && importsServerOnly(edge.target) ? edge.target : null;
      const kind = target ? 'imports-server-only' : edge.target === null ? serverPackages[edge.specifier] ?? (builtin(edge.specifier, dependencies) ? 'node-builtin' : null) : null;
      if (!kind) continue;
      const key = `${kind}\n${target ?? edge.specifier}`;
      if (!imports.has(key)) imports.set(key, { path: item.path, kind, module: target ?? edge.specifier, lines: [] });
      if (edge.line !== null && !imports.get(key).lines.includes(edge.line)) imports.get(key).lines.push(edge.line);
    }
    leads.serverImportInClient.push(...imports.values());
    const names = new Map();
    for (const read of facts.env) if (!read.name.startsWith('NEXT_PUBLIC_') && read.name !== 'NODE_ENV') names.set(read.name, [...new Set([...(names.get(read.name) ?? []), read.line])]);
    for (const [name, lines] of [...names].sort(([a], [b]) => (a < b ? -1 : 1))) leads.clientPrivateEnv.push({ path: item.path, name, lines });
  }
  for (const list of Object.values(leads)) for (const lead of list) lead.lines?.sort((a, b) => a - b);
  return leads;
}
