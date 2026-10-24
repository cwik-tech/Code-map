// API contracts (C20): the OpenAPI documents in JSON, their operations (method and path), and a comparison with the
// Next.js route handlers. The comparison is pure. contractInputs reads bounded files. Code-map has no YAML parser, so it lists
// a YAML document as not read. Each document is untrusted input: it has a size limit, and only own fields of objects count.
import { posix } from 'node:path';
import { parameter } from '../frameworks/next-routes.mjs';

/** A larger document is not read. */
const maxDocumentBytes = 5 * 1024 * 1024;
const operationMethods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const contractName = /^(?:openapi|swagger|.+\.openapi)\.(json|ya?ml)$/;
const specificity = { static: 0, dynamic: 1, 'catch-all': 2, 'optional-catch-all': 3 };
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const folderOf = (path) => posix.dirname(path);

/** 'json' or 'yaml' for a contract file (`openapi.json`, `swagger.json` or `*.openapi.json`, also with .yaml or .yml), else null. */
export function contractKind(path) {
  if (path.split('/').includes('node_modules')) return null;
  const match = contractName.exec(posix.basename(path).toLowerCase());
  return match ? (match[1] === 'json' ? 'json' : 'yaml') : null;
}

/** Read only regular JSON contracts within the size limit. Return skipped reasons before reading any content. */
export function contractInputs(paths, reader) {
  const wanted = paths.filter((path) => contractKind(path) === 'json'), info = reader.stat(wanted), skipped = new Map(), texts = new Map();
  for (const path of wanted) {
    const item = info.get(path);
    const reason = !item || (!item.link && !item.file) ? 'missing' : item.link ? 'symlink' : item.size > maxDocumentBytes ? 'too-large' : null;
    if (reason) { skipped.set(path, reason); continue; }
    try {
      const text = reader.read([path]).get(path);
      if (text === undefined) skipped.set(path, 'missing');
      else texts.set(path, text);
    } catch { skipped.set(path, 'missing'); }
  }
  return { texts, skipped };
}

/** A URL without repeated slashes and without a slash at the end. */
const normalUrl = (url) => `/${url.split('/').filter(Boolean).join('/')}`;

/**
 * The base path of the operations: the Swagger 2 `basePath`, or the path of the first OpenAPI 3 server when its URL is a
 * relative path. Server variables take their default values. An absolute URL gives no base path (''). A relative URL
 * without a leading slash, or a variable without a default, gives null: the base is unresolved.
 */
function basePath(json) {
  if (typeof json.swagger === 'string') return typeof json.basePath === 'string' && json.basePath.startsWith('/') ? normalUrl(json.basePath).replace(/^\/$/, '') : '';
  const server = Array.isArray(json.servers) ? json.servers[0] : undefined;
  if (!isRecord(server) || typeof server.url !== 'string') return '';
  const variables = isRecord(server.variables) ? server.variables : {};
  const url = server.url.replace(/\{([^{}]+)\}/g, (text, name) => (Object.hasOwn(variables, name) && isRecord(variables[name]) && typeof variables[name].default === 'string' ? variables[name].default : text));
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return '';
  return url.startsWith('/') && !url.includes('{') ? normalUrl(url).replace(/^\/$/, '') : null;
}

/** The line of the first key that starts with "/", for each such key: the path keys of the document, for evidence only. */
function keyLines(text) {
  const lines = new Map();
  let line = 1, at = 0;
  for (const match of text.matchAll(/"(\/[^"\\]*)"\s*:/g)) {
    for (; at < match.index; at++) if (text.charCodeAt(at) === 10) line++;
    if (!lines.has(match[1])) lines.set(match[1], line);
  }
  return lines;
}

/**
 * One contract file: state 'parsed' with its format, version, base path and operations, or 'invalid' or 'not-read' with a
 * reason. Each operation has its method, its path in the document, its URL below the base path (null when the base is
 * unresolved) and the line of its path key.
 */
export function documentOf(path, text) {
  if (text.length > maxDocumentBytes || Buffer.byteLength(text) > maxDocumentBytes) return { path, state: 'not-read', reason: 'too-large' };
  let json;
  try { json = JSON.parse(text); } catch { return { path, state: 'invalid', reason: 'invalid-json' }; }
  const format = !isRecord(json) ? null : typeof json.openapi === 'string' ? 'openapi' : typeof json.swagger === 'string' ? 'swagger' : null;
  if (!format) return { path, state: 'invalid', reason: 'not-openapi' };
  const base = basePath(json), lines = keyLines(text), operations = [];
  if (isRecord(json.paths)) for (const [key, item] of Object.entries(json.paths)) {
    if (!key.startsWith('/') || !isRecord(item)) continue;
    for (const method of operationMethods) if (Object.hasOwn(item, method) && isRecord(item[method])) {
      operations.push({ method: method.toUpperCase(), path: key, url: base === null ? null : normalUrl(base + key), line: lines.get(key) ?? null });
    }
  }
  return { path, state: 'parsed', format, version: json[format], base, operations };
}

/** The segments of a documented URL: static text, a parameter `{name}`, or a mixed segment with a parameter inside other text. */
const documentSegments = (url) => url.split('/').filter(Boolean).map((text) => {
  const match = /^\{([^{}]+)\}$/.exec(text);
  return match ? { kind: 'param', name: match[1] } : text.includes('{') ? { kind: 'mixed', text } : { kind: 'static', text };
});
const routeCache = new WeakMap();
/** The segments of a Next.js URL pattern: static text, `[id]`, `[...slug]` or `[[...slug]]`. */
const routeSegments = (route) => {
  if (!routeCache.has(route)) routeCache.set(route, route.url.split('/').filter(Boolean).map((text) => { const found = parameter(text); return found ?? { kind: 'static', text }; }));
  return routeCache.get(route);
};

/** True when the route segments match the documented segments. A dynamic segment matches any one segment. */
function matches(route, document) {
  for (let index = 0; index < route.length; index++) {
    const segment = route[index];
    if (segment.kind === 'catch-all') return document.length > index;
    if (segment.kind === 'optional-catch-all') return document.length >= index;
    if (index >= document.length) return false;
    if (segment.kind === 'static' && (document[index].kind !== 'static' || document[index].text !== segment.text)) return false;
  }
  return document.length === route.length;
}

/** Lexical order of two specificity lists. A shorter list that is a prefix of the other one comes first. */
const compare = (a, b) => { for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index] - b[index]; return a.length - b.length; };

/** The route that Next.js picks for a documented URL: the most specific match. A static segment wins over a dynamic segment, which wins over a catch-all. */
export function matchRoute(url, routes) {
  const document = documentSegments(url);
  let best = null;
  for (const route of routes) {
    const segments = routeSegments(route);
    if (!matches(segments, document)) continue;
    const rank = segments.map((segment) => specificity[segment.kind]);
    if (!best || compare(rank, best.rank) < 0) best = { route, rank };
  }
  return best?.route ?? null;
}

/** The parameter pairs with other names, where a documented parameter `{name}` meets a dynamic route segment `[name]`. */
function renamedParameters(url, route) {
  const document = documentSegments(url), segments = routeSegments(route), pairs = [];
  for (let index = 0; index < Math.min(document.length, segments.length); index++) {
    if (segments[index].kind !== 'static' && document[index].kind === 'param' && document[index].name !== segments[index].name) pairs.push({ document: document[index].name, route: segments[index].name });
  }
  return pairs;
}

/** The state of a documented operation: Next.js answers HEAD from GET, and it answers OPTIONS for each route handler. */
function operationState(method, route) {
  if (!route) return 'no-route';
  if (route.methodState !== 'KNOWN') return 'unknown';
  return route.methods.includes(method) || (method === 'HEAD' && route.methods.includes('GET')) || method === 'OPTIONS' ? 'handled' : 'no-method';
}

/**
 * The contract report of one analysis. `paths` is every path of the snapshot, `texts` holds the JSON texts, `nextjs` is the
 * Next.js report with the methods of each route handler, and `files` gives the export lines. A document is compared with
 * the route handlers of the Next.js root that holds it, including documents with no matching operation.
 */
export function analyzeContracts({ paths = [], texts = new Map(), nextjs = null, files = [], skipped = new Map() } = {}) {
  const documents = [], operations = [], handlers = [], leads = { noHandler: [], paramName: [], undocumented: [] };
  const detected = nextjs?.detected === true, routes = (nextjs?.routes ?? []).filter((route) => route.methodState !== undefined);
  const roots = [...new Set([...(nextjs?.packages ?? []).map((item) => folderOf(item.path)), ...(nextjs?.routes ?? []).map((route) => route.root)])]
    .sort((a, b) => Number(a === '.') - Number(b === '.') || b.length - a.length);
  const rootOf = (path) => roots.find((root) => root === '.' || path.startsWith(`${root}/`)) ?? null;
  const exportLines = new Map(files.map((file) => [file.path, new Map(file.exports.map((item) => [item.name, item.line ?? null]))]));
  for (const path of paths.filter(contractKind).sort()) {
    const parsed = skipped.has(path) ? { state: 'not-read', reason: skipped.get(path) } : contractKind(path) === 'yaml' ? { state: 'not-read', reason: 'yaml' } : texts.has(path) ? documentOf(path, texts.get(path)) : { state: 'not-read', reason: 'missing' };
    if (parsed.state !== 'parsed') { documents.push({ path, state: parsed.state, reason: parsed.reason, format: null, version: null, base: null, root: null, operations: 0 }); continue; }
    const root = detected ? rootOf(path) : null, own = routes.filter((route) => route.root === root);
    const resolved = parsed.operations.map((operation) => ({ operation, route: root === null || operation.url === null ? null : matchRoute(operation.url, own) }));
    const reason = !detected ? 'no-nextjs' : root === null ? 'outside-next-roots' : parsed.base === null ? 'base-unresolved' : null;
    documents.push({ path, state: reason ? 'not-compared' : 'compared', reason, format: parsed.format, version: parsed.version, base: parsed.base, root, operations: parsed.operations.length });
    const renamed = new Map();
    for (const { operation, route } of resolved) {
      const state = reason ? 'not-compared' : operationState(operation.method, route);
      operations.push({ document: path, method: operation.method, path: operation.path, url: operation.url, line: operation.line, route: reason ? null : route?.path ?? null, state });
      if (state === 'no-route' || state === 'no-method') leads.noHandler.push({ document: path, method: operation.method, path: operation.path, url: operation.url, root, route: route?.path ?? null, reason: state, line: operation.line });
      const pairs = !reason && route ? renamedParameters(operation.url, route) : [];
      const key = `${operation.path}\n${route?.path}`;
      if (pairs.length && !renamed.has(key)) renamed.set(key, { document: path, path: operation.path, url: operation.url, route: route.path, routeUrl: route.url, pairs, line: operation.line });
    }
    leads.paramName.push(...renamed.values());
  }
  const compared = documents.filter((item) => item.state === 'compared');
  const inScope = (url, base) => !base || url === base || url.startsWith(`${base}/`);
  for (const route of [...routes].sort(byPath)) {
    const own = compared.filter((item) => item.root === route.root && inScope(route.url, item.base)).map((item) => item.path);
    if (route.methodState !== 'KNOWN') { handlers.push({ path: route.path, url: route.url, root: route.root, method: null, state: 'unknown', line: null }); continue; }
    for (const method of route.methods) {
      const line = exportLines.get(route.path)?.get(method) ?? null;
      const documented = operations.some((item) => item.route === route.path && item.method === method && own.includes(item.document));
      const state = !own.length ? 'not-compared' : documented ? 'documented' : 'undocumented';
      handlers.push({ path: route.path, url: route.url, root: route.root, method, state, line });
      if (state === 'undocumented') leads.undocumented.push({ path: route.path, method, url: route.url, root: route.root, documents: own, line });
    }
  }
  return { documents, operations, handlers, leads };
}

/** The shape of a URL for a comparison: each parameter becomes `{}`, a catch-all `{...}` and an optional catch-all `{...?}`. */
const documentShape = (url) => `/${documentSegments(url).map((item) => (item.kind === 'static' ? item.text : item.kind === 'mixed' ? item.text.replace(/\{[^{}]*\}/g, '{}') : '{}')).join('/')}`;
const routeShape = (url) => `/${routeSegments({ url }).map((item) => ({ static: item.text, dynamic: '{}', 'catch-all': '{...}', 'optional-catch-all': '{...?}' })[item.kind]).join('/')}`;
/** Code-point order, so the order does not depend on the locale. A null value comes first. */
const order = (a, b) => { const [x, y] = [a ?? '', b ?? '']; return x < y ? -1 : x > y ? 1 : 0; };
const byUrl = (a, b) => order(a.url, b.url) || order(a.method, b.method) || order(a.path, b.path);

/**
 * The operations that a change removed, from two contract reports. `documented`: the base documents an operation that no head
 * document has. `handlers`: a base route exports a method that no head route with the same URL pattern exports. A head route
 * with UNKNOWN methods covers every method of its URL. A base route with UNKNOWN methods counts once, with the method null.
 */
export function removedOperations(base, head) {
  const documentKey = (item) => `${item.method} ${documentShape(item.url)}`, routeKey = (method, url) => `${method ?? '*'} ${routeShape(url)}`;
  const documented = new Set(head.operations.filter((item) => item.url !== null).map(documentKey)), removed = new Map();
  for (const item of base.operations) if (item.url !== null && !documented.has(documentKey(item)) && !removed.has(documentKey(item))) removed.set(documentKey(item), item);
  const removedDocumented = [...removed.values()].map(({ method, url, path, document }) => ({ method, url, path, document })).sort(byUrl);
  const handled = new Set(head.handlers.map((item) => routeKey(item.method, item.url))), urls = new Set(head.handlers.map((item) => routeShape(item.url)));
  const covered = (item) => (item.method === null ? urls.has(routeShape(item.url)) : handled.has(routeKey(item.method, item.url)) || handled.has(routeKey(null, item.url)));
  const removedHandlers = base.handlers.filter((item) => !covered(item)).map(({ method, url, path }) => ({ method, url, path })).sort(byUrl);
  return { documented: removedDocumented, handlers: removedHandlers };
}
