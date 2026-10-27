// The installed packages of the working folder: which folders have a node_modules folder, which node_modules folder holds a
// package, and which subpaths the exports field of its package.json exports. Code-map reads nothing else inside node_modules.
// A commit analysis also reads the node_modules folders of the working folder, because Git does not hold them.
import { readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { isRecord } from './manifests.mjs';

/** A package.json in node_modules that is larger than this is not read: its exports are unknown. */
const maxManifestBytes = 1024 * 1024;
/** A real exports field nests a few levels. A deeper one is unknown, so a crafted file cannot overflow the stack. */
const maxNesting = 16;
const isDirectory = (path) => { try { return statSync(path).isDirectory(); } catch { return false; } };

/** The folders from `folder` up to the repository root, for example "a/b", "a" and ".". */
function upFolders(folder) {
  const list = [];
  for (let current = folder; ; current = posix.dirname(current)) { list.push(current); if (current === '.') return list; }
}

/** The view of the node_modules folders of `repository`. Each answer is cached, so each folder is checked once. */
export function installedPackages(repository) {
  const folders = new Map(), manifests = new Map();
  const exists = (path) => { if (!folders.has(path)) folders.set(path, isDirectory(join(repository, path))); return folders.get(path); };
  const hasModules = (folder) => exists(posix.join(folder, 'node_modules'));
  return {
    /** True when a folder from `folder` up to the repository root has a node_modules folder. */
    installed: (folder) => upFolders(folder).some(hasModules),
    /** The repository path of the folder of package `name` that Node.js finds from `folder`, or null. */
    find: (folder, name) => upFolders(folder).filter(hasModules).map((up) => posix.join(up, 'node_modules', name)).find(exists) ?? null,
    /** { state: 'none' } without an exports field, { state: 'read', exports }, or { state: 'unreadable' }. */
    exportsOf: (folder) => {
      if (!manifests.has(folder)) manifests.set(folder, readExports(join(repository, folder, 'package.json')));
      return manifests.get(folder);
    },
  };
}

function readExports(path) {
  try {
    if (statSync(path).size > maxManifestBytes) return { state: 'unreadable' };
    const json = JSON.parse(readFileSync(path, 'utf8'));
    if (!isRecord(json)) return { state: 'unreadable' };
    return json.exports === undefined ? { state: 'none' } : { state: 'read', exports: json.exports };
  } catch { return { state: 'unreadable' }; }
}

const exported = { state: 'exported' }, notExported = { state: 'not-exported' };
const unknown = (reason) => ({ state: 'unknown', reason });

/** Exported when one alternative or condition exports, unknown when one is unknown and none exports, else not exported. */
function anyOf(results) {
  return results.find((result) => result.state === 'exported') ?? results.find((result) => result.state === 'unknown') ?? notExported;
}

/** A target value of the exports field: a string, null, an array of fallbacks or an object of conditions. */
function target(value, depth) {
  if (depth > maxNesting) return unknown('too-deep');
  if (value === null) return notExported;
  if (typeof value === 'string') return exported;
  if (Array.isArray(value)) return anyOf(value.map((item) => target(item, depth + 1)));
  if (!isRecord(value) || Object.keys(value).some((key) => key.startsWith('.'))) return unknown('invalid-target');
  return anyOf(Object.values(value).map((item) => target(item, depth + 1)));
}

/** A pattern key that matches more of the subpath comes first: the longer part before "*", then the longer key (as in Node.js). */
const patternOrder = (a, b) => b.indexOf('*') - a.indexOf('*') || b.length - a.length;

/**
 * Whether an exports field exports one subpath ("." or "./x"): { state: 'exported' | 'not-exported' | 'unknown', reason }.
 * It supports the string, array, subpath, conditional and pattern ("./*") forms. A target is exported when one of its
 * conditions has a target, whatever the conditions of the import. A mix of subpath and condition keys, a folder mapping
 * ("./x/"), a key with two "*" and a target that is not a string, an array, an object or null are unknown.
 */
export function exportsSubpath(exports, subpath) {
  if (subpath.endsWith('/')) return unknown('folder-subpath');
  if (!isRecord(exports)) return subpath === '.' ? target(exports, 0) : typeof exports === 'string' || Array.isArray(exports) ? notExported : unknown('invalid-target');
  const keys = Object.keys(exports), subpaths = keys.filter((key) => key.startsWith('.'));
  if (subpaths.length && subpaths.length !== keys.length) return unknown('mixed-keys');
  if (!subpaths.length) return subpath === '.' ? target(exports, 0) : notExported;
  if (Object.hasOwn(exports, subpath) && !subpath.includes('*')) return target(exports[subpath], 0);
  let unsure = false;
  const patterns = keys.filter((key) => {
    const star = key.indexOf('*');
    if (key.endsWith('/') || (star >= 0 && key.indexOf('*', star + 1) >= 0)) { unsure ||= key.endsWith('/') ? subpath.startsWith(key) : true; return false; }
    return star >= 0 && subpath.length >= key.length && subpath.startsWith(key.slice(0, star)) && subpath.endsWith(key.slice(star + 1));
  }).sort(patternOrder);
  if (patterns.length) return target(exports[patterns[0]], 0);
  return unsure ? unknown('folder-mapping') : notExported;
}
