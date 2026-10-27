// Supported JSON manifest shapes. No JavaScript manifest is evaluated.
import { isRelativePath } from './adapters/run-manifest.mjs';
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = (value) => {
  if (!Array.isArray(value) || !value.every((path) => isRelativePath(path) && path.startsWith('static/'))) {
    throw new Error('Build manifest assets must be an array of paths inside static/.');
  }
  return value;
};
const map = (value) => {
  if (!record(value)) throw new Error('Build manifest routes must be an object.');
  for (const [route, paths] of Object.entries(value)) {
    if (!route.startsWith('/') || route.length > 4096) throw new Error('Build manifest route must start with /.');
    list(paths);
  }
  return value;
};
const normalize = (path) => '/' + path.split('/').filter((part) => part && !part.startsWith('@') && !/^\(.*\)$/.test(part)).join('/');
const routeOf = (path) => normalize(path.replace(/\/page$/, ''));

/** Collects the union of initial assets for Pages Router and App Router page entries. */
export function manifestRoutes(manifests, urls = new Map()) {
  const build = Object.hasOwn(manifests, 'build-manifest.json') ? manifests['build-manifest.json'] : manifests['fallback-build-manifest.json'];
  const app = manifests['app-build-manifest.json'], routes = new Map();
  const add = (route, paths) => routes.set(route, new Set([...(routes.get(route) ?? []), ...paths]));
  let roots = [], polyfills = [], tree = {};
  if (build !== undefined) {
    if (!record(build)) throw new Error('Build manifest must be an object.');
    const pages = map(build.pages);
    roots = list(build.rootMainFiles === undefined ? [] : build.rootMainFiles);
    polyfills = list(build.polyfillFiles === undefined ? [] : build.polyfillFiles);
    tree = map(build.rootMainFilesTree === undefined ? {} : build.rootMainFilesTree);
    const lowPriority = list(build.lowPriorityFiles === undefined ? [] : build.lowPriorityFiles);
    for (const [route, paths] of Object.entries(pages)) {
      if (['/_app', '/_document', '/_error'].includes(route)) continue;
      add(route, [...polyfills, ...lowPriority, ...(pages['/_app'] ?? []), ...paths]);
    }
  }
  if (app !== undefined) {
    if (!record(app)) throw new Error('App build manifest must be an object.');
    const pages = map(app.pages);
    for (const [path, assets] of Object.entries(pages)) {
      if (!path.endsWith('/page')) continue;
      const ancestors = [], parts = path.split('/');
      for (let i = 1; i < parts.length; i++) {
        const prefix = parts.slice(0, i).join('/');
        for (const name of ['layout', 'template']) {
          const parent = `${prefix}/${name}`;
          if (Object.hasOwn(pages, parent)) ancestors.push(...pages[parent]);
        }
      }
      add(urls.get(path) ?? routeOf(path), [...(tree[path] ?? roots), ...polyfills, ...ancestors, ...assets]);
    }
  }
  for (const [path, paths] of Object.entries(tree)) {
    if (path.endsWith('/page')) add(urls.get(path) ?? routeOf(path), [...paths, ...polyfills]);
  }
  return routes;
}
