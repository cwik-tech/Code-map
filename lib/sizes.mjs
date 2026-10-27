// Reads existing Next.js build assets. It runs no build and confines all reads to the build folder.
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { isRelativePath } from './adapters/run-manifest.mjs';
import { manifestRoutes } from './size-manifests.mjs';
import { mapSources } from './bundle-evidence.mjs';
import { clientReferenceRoutes } from './size-client-references.mjs';

/** Bounds include manifests, metadata and assets. Entries also bound directory traversal. */
export const sizeLimits = { files: 20000, entries: 40000, bytes: 512 * 1024 * 1024, fileBytes: 64 * 1024 * 1024 };
const inside = (root, path) => { const part = relative(root, path); return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`)); };

/** Reads a build into a deterministic JSON report. Smaller limits support constrained callers. */
export function readSizes(directory, limits = {}) {
  const bound = { ...sizeLimits, ...limits }, root = realpathSync(resolve(directory));
  for (const value of Object.values(bound)) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Each size limit must be a positive safe integer.');
  let count = 0, bytesRead = 0, entries = 0;
  const pathOf = (path) => {
    if (!isRelativePath(path)) throw new Error(`Build path is outside the build folder: ${JSON.stringify(path)}.`);
    const full = resolve(root, path);
    if (!inside(root, full) || !inside(root, realpathSync(full))) throw new Error(`Build path is outside the build folder: ${JSON.stringify(path)}.`);
    return full;
  };
  const read = (path) => {
    if (++count > bound.files) throw new Error('Build file count exceeds the size limit.');
    const descriptor = openSync(pathOf(path), constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const info = fstatSync(descriptor), maximum = Math.min(bound.fileBytes, bound.bytes - bytesRead);
      if (!info.isFile()) throw new Error(`Build input is not a regular file: ${JSON.stringify(path)}.`);
      if (info.size > maximum) throw new Error(`Build input is larger than the size limit: ${JSON.stringify(path)}.`);
      const buffer = Buffer.alloc(info.size), extra = Buffer.alloc(1);
      let offset = 0;
      while (offset < buffer.length) {
        const got = readSync(descriptor, buffer, offset, buffer.length - offset, null);
        if (got === 0) throw new Error('Build input changed during the read.');
        offset += got;
      }
      if (readSync(descriptor, extra, 0, 1, null)) throw new Error('Build input changed during the read.');
      bytesRead += buffer.length;
      return buffer;
    } finally { closeSync(descriptor); }
  };
  const optional = (path) => { try { lstatSync(resolve(root, path)); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
  const json = (path) => {
    try { return JSON.parse(read(path).toString('utf8')); } catch (error) { throw new Error(`Cannot read build manifest ${path}: ${error.message}`, { cause: error }); }
  };
  const formats = [], manifests = {};
  for (const name of ['build-manifest.json', 'app-build-manifest.json', 'fallback-build-manifest.json']) {
    if (name === 'fallback-build-manifest.json' && Object.hasOwn(manifests, 'build-manifest.json')) continue;
    if (optional(name)) { manifests[name] = json(name); formats.push(name); }
  }
  if (!formats.length) throw new Error('No supported Next.js build manifest exists in the build folder.');
  const references = optional('app-path-routes-manifest.json')
    ? clientReferenceRoutes(json('app-path-routes-manifest.json'), { optional, read }) : null;
  const routes = manifestRoutes(manifests, references?.urls);
  let unsupported = [];
  if (references) {
    formats.push('app-path-routes-manifest.json');
    if (references.loaded) formats.push('page_client-reference-manifest.js');
    const build = manifests['build-manifest.json'] ?? manifests['fallback-build-manifest.json'];
    const roots = [...(build?.rootMainFiles ?? []), ...(build?.polyfillFiles ?? [])];
    for (const [url, paths] of references.routes) {
      const assets = new Set([...(routes.get(url) ?? []), ...paths]);
      if (references.pages.has(url)) for (const path of roots) assets.add(path);
      routes.set(url, assets);
    }
    unsupported = references.unsupported.filter((item) => !routes.has(item.route));
  }
  const buildId = read('BUILD_ID').toString('utf8').trim();
  if (!buildId || buildId.length > 4096) throw new Error('BUILD_ID must contain 1 to 4096 characters.');
  let nextVersion = null;
  if (optional('diagnostics/framework.json')) {
    const framework = json('diagnostics/framework.json');
    if (framework?.name !== 'Next.js' || typeof framework.version !== 'string' || !framework.version || framework.version.length > 100) throw new Error('Invalid Next.js framework metadata.');
    nextVersion = framework.version;
  }
  const files = [], visited = new Set();
  const walk = (path) => {
    if (++entries > bound.entries) throw new Error('Build entry count exceeds the size limit.');
    const full = pathOf(path), info = lstatSync(full);
    if (info.isDirectory()) {
      const real = realpathSync(full);
      if (visited.has(real)) throw new Error('Build directory cycle exceeds the size limit.');
      visited.add(real);
      const dir = opendirSync(full);
      try { let entry; while ((entry = dir.readSync()) !== null) walk(`${path}/${entry.name}`); } finally { dir.closeSync(); }
    } else if (info.isSymbolicLink() && !fstatFile(full)) {
      throw new Error('Build directory symlinks are not supported.');
    } else {
      const bytes = read(path);
      files.push({ path, bytes: bytes.length, gzipBytes: gzipSync(bytes).length });
    }
  };
  if (optional('static')) walk('static');
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const assets = new Map(files.map((file) => [file.path, file]));
  for (const file of files.filter((file) => /\.js\.map$/.test(file.path))) {
    const chunk = assets.get(file.path.slice(0, -4));
    if (!chunk) continue;
    try { chunk.sources = mapSources(JSON.parse(read(file.path).toString('utf8'))); }
    catch (error) { throw new Error(`Cannot read source map ${file.path}: ${error.message}`, { cause: error }); }
  }
  const byPath = new Map(files.map((file) => [file.path, file]));
  const sum = (paths) => paths.reduce((total, path) => {
    const file = byPath.get(path);
    if (!file) throw new Error(`Manifest asset is missing from static/: ${JSON.stringify(path)}.`);
    return { bytes: total.bytes + file.bytes, gzipBytes: total.gzipBytes + file.gzipBytes };
  }, { bytes: 0, gzipBytes: 0 });
  const measured = [...routes].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([route, paths]) => {
    // Validate every referenced asset, including CSS, before selecting JavaScript.
    for (const path of paths) { pathOf(path); if (!path.startsWith('static/')) throw new Error('Manifest assets must be under static/.'); }
    sum([...paths]);
    const js = [...paths].filter((path) => path.endsWith('.js')).sort();
    const css = [...paths].filter((path) => path.endsWith('.css')).sort();
    const row = { route, files: js, ...sum(js) };
    return references?.loaded ? { ...row, css: { files: css, ...sum(css) } } : row;
  });
  const totals = Object.fromEntries(['chunks', 'css', 'media'].map((name) => {
    const paths = files.filter((file) => name === 'css' ? file.path.endsWith('.css') : file.path.startsWith(`static/${name}/`)).map((file) => file.path);
    return [name, { files: paths.length, ...sum(paths) }];
  }));
  return { reportType: 'code-map-sizes', schemaVersion: 1, buildId, nextVersion, formats, files, routes: measured, totals, unsupported };
}

function fstatFile(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try { return fstatSync(fd).isFile(); } finally { closeSync(fd); }
}
