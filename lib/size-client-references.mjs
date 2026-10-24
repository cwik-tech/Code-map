// Parses the JSON-only Next.js client reference wrapper without executing JavaScript.
import { isRelativePath } from './adapters/run-manifest.mjs';
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const asset = (value) => isRelativePath(value) && value.startsWith('static/');
const route = (value) => typeof value === 'string' && value.startsWith('/') && value.length <= 4096;

/** Reads page references through the caller's bounded, confined filesystem functions. */
export function clientReferenceRoutes(paths, { optional, read }) {
  if (!record(paths)) throw new Error('App path routes manifest must be an object.');
  const routes = new Map(), unsupported = [], pages = new Set();
  let loaded = false;
  for (const [entry, url] of Object.entries(paths)) {
    if (!route(entry) || !route(url) || !isRelativePath(entry.slice(1))) throw new Error('Invalid App path route entry or URL.');
    if (entry.endsWith('/route')) {
      if (!routes.has(url)) routes.set(url, new Set());
      continue;
    }
    if (!entry.endsWith('/page')) continue;
    const file = `server/app${entry}_client-reference-manifest.js`;
    if (!optional(file)) {
      unsupported.push({ route: url, reason: `Missing client reference manifest for ${entry}.` });
      continue;
    }
    // Next.js 16 writes the object without a final semicolon and without a final line break. Both forms are accepted.
    const text = read(file).toString('utf8');
    const match = /^\s*globalThis\.__RSC_MANIFEST = globalThis\.__RSC_MANIFEST \|\| \{\};\s*globalThis\.__RSC_MANIFEST\[("(?:[^"\\\r\n]|\\.)*")\] = (\{[\s\S]*\});?\s*$/.exec(text);
    if (!match) throw new Error(`Invalid client reference assignment form: ${file}.`);
    let key, value;
    try { key = JSON.parse(match[1]); value = JSON.parse(match[2]); }
    catch (error) { throw new Error(`Invalid client reference JSON: ${file}.`, { cause: error }); }
    if (key !== entry || !record(value) || !record(value.entryJSFiles) || !record(value.entryCSSFiles)) {
      throw new Error(`Invalid client reference entry or asset maps: ${file}.`);
    }
    const assets = new Set(routes.get(url) ?? []);
    for (const items of Object.values(value.entryJSFiles)) {
      if (!Array.isArray(items) || !items.every((item) => asset(item) && item.endsWith('.js'))) throw new Error('Invalid client reference JavaScript assets.');
      for (const item of items) assets.add(item);
    }
    for (const items of Object.values(value.entryCSSFiles)) {
      if (!Array.isArray(items) || !items.every((item) => record(item) && asset(item.path) && item.path.endsWith('.css') && typeof item.inlined === 'boolean')) {
        throw new Error('Invalid client reference CSS assets.');
      }
      for (const item of items) assets.add(item.path);
    }
    pages.add(url);
    routes.set(url, assets);
    loaded = true;
  }
  return { routes, unsupported, loaded, pages, urls: new Map(Object.entries(paths)) };
}
