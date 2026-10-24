import { readExtra } from './lock-extras.mjs';
import { integrityHashes } from './sbom.mjs';
// The root lockfile inventory of one snapshot. The caller supplies snapshot paths and text.
// npm, Yarn classic, pnpm and text Bun share one inventory shape and bounded input limits.
import { posix } from 'node:path';

/** npm uses npm-shrinkwrap.json when both files exist, so it comes first. */
const npmFiles = ['npm-shrinkwrap.json', 'package-lock.json'];
const otherFiles = { 'pnpm-lock.yaml': 'pnpm', 'yarn.lock': 'yarn', 'bun.lock': 'bun', 'bun.lockb': 'bun' };
const names = new Set([...npmFiles, ...Object.keys(otherFiles)]);
/** The default limits: a larger lockfile, or one with more packages, gives no inventory. */
const defaults = { bytes: 64 * 1024 * 1024, packages: 200000 };
/** npm names have at most 214 characters. Longer values are cut, so a planted lockfile cannot make the store large. */
const max = { name: 214, version: 256, license: 256, host: 255, path: 4096 };
const nestedShown = 10;
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const clip = (value, length) => (typeof value === 'string' ? value.slice(0, length) : null);
/** A version 1 lockfile gives a Git or tarball dependency a URL as its version. The URL loses its user name and password, as the host does. */
const versionOf = (value) => clip(typeof value === 'string' ? value.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, '$1') : value, max.version);
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** Git hosts that npm writes as a short prefix, for example "github:owner/name#commit". */
const shortcuts = { 'github:': 'github.com', 'gitlab:': 'gitlab.com', 'bitbucket:': 'bitbucket.org', 'gist:': 'gist.github.com' };

/** True for a package that npm downloads: from a URL, or from a source that the lockfile does not give as a URL. These need an integrity value. */
export const downloaded = (item) => item.kind === 'remote' || item.kind === 'unknown';

/**
 * The inventory of the lockfiles at the root of the snapshot, or null when the snapshot has no lockfile. `policy` is the
 * validated supplyChain policy (refer to policy.mjs). Each package has its path in the lockfile, name, version, kind of source
 * (remote, git, local, bundled or unknown), the host of its resolved URL without credentials, whether it has an integrity
 * value and an install script, its license and the flags dev, optional and peer. A value that the lockfile does not record is null.
 */
export function readSupply(paths, texts, policy = null, limits = defaults) {
  const present = new Set(paths), lockfiles = [];
  const nested = paths.filter((path) => path.includes('/') && names.has(posix.basename(path)) && !path.split('/').includes('node_modules')).sort();
  let read = null;
  for (const path of npmFiles) {
    if (!present.has(path)) continue;
    if (lockfiles.length) { lockfiles.push({ path, manager: 'npm', state: 'ignored' }); continue; }
    const result = parseLockfile(texts.get(path), limits);
    lockfiles.push({ path, manager: 'npm', state: result.state, lockfileVersion: result.version ?? null, packages: result.packages?.length ?? null, ...(result.error ? { error: result.error } : {}) });
    if (result.state === 'read') read = { path, ...result };
  }
  for (const [path, manager] of Object.entries(otherFiles)) if (present.has(path)) {
    if (lockfiles.length) { lockfiles.push({ path, manager, state: 'ignored' }); continue; }
    const result = readExtra(path, texts.get(path), limits);
    lockfiles.push({ path, manager, state: result.state, lockfileVersion: result.version ?? null, packages: result.packages?.length ?? null,
      ...(result.error ? { error: result.error } : {}) });
    if (result.state === 'read') read = { path, ...result };
  }
  if (!lockfiles.length && !nested.length) return null;
  return { lockfile: read?.path ?? null, lockfileVersion: read?.version ?? null, lockfiles, nested: { count: nested.length, paths: nested.slice(0, nestedShown) },
    packages: read?.packages ?? [], policy };
}

/** { state: 'read', version, packages } or { state, version, error } for a lockfile that Code-map cannot use. */
function parseLockfile(text, limits) {
  if (typeof text !== 'string') return { state: 'invalid', error: 'Code-map cannot read the file as text.' };
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > limits.bytes) return { state: 'too-large', error: `The file has ${bytes} bytes. Code-map reads at most ${limits.bytes} bytes.` };
  let value;
  try { value = JSON.parse(text); } catch { return { state: 'invalid', error: 'The file is not valid JSON.' }; }
  if (!isRecord(value)) return { state: 'invalid', error: 'The lockfile must be a JSON object.' };
  const version = value.lockfileVersion;
  if (![1, 2, 3].includes(version)) {
    return { state: 'unsupported-version', version: Number.isInteger(version) ? version : null, error: `Code-map reads lockfile versions 1, 2 and 3, not ${JSON.stringify(version ?? null).slice(0, 20)}.` };
  }
  // Version 2 keeps a copy of the tree in "dependencies" for npm 6. Code-map reads "packages", the form of npm 7 and later.
  const section = version === 1 || (value.packages === undefined && value.dependencies !== undefined) ? 'dependencies' : 'packages';
  const lines = keyLines(text, section);
  const result = section === 'packages' ? fromPackages(value.packages, lines, limits) : fromDependencies(value.dependencies, lines, limits);
  if (result.error) return { state: result.tooMany ? 'too-large' : 'invalid', version, error: result.error };
  resolveNpmEdges(result.packages);
  return { state: 'read', version, packages: result.packages.sort((a, b) => order(a.name, b.name) || order(a.version ?? '', b.version ?? '') || order(a.path, b.path)) };
}

/** The "packages" object of version 2 and 3, keyed by install folder. The root project ("") and links to folders are not packages. */
function fromPackages(packages, lines, limits) {
  if (packages === undefined) return { packages: [] };
  if (!isRecord(packages)) return { error: 'The field "packages" must be an object.' };
  const list = [];
  for (const [key, entry] of Object.entries(packages)) {
    if (key === '') continue;
    if (!isRecord(entry)) return { error: 'An entry in "packages" is not an object.' };
    if (entry.link === true) continue; // the folder that the link names is an entry of its own
    if (list.length === limits.packages) return { tooMany: true, error: `The lockfile has more than ${limits.packages} packages.` };
    const at = key.lastIndexOf('node_modules/'), local = at === -1;
    const name = clip(entry.name, max.name) ?? clip(local ? posix.basename(key) : key.slice(at + 'node_modules/'.length), max.name);
    const source = local ? { kind: 'local', host: null } : entry.inBundle === true ? { kind: 'bundled', host: null } : origin(entry.resolved, entry.version);
    list.push({ path: clip(key, max.path), name, version: versionOf(entry.version), ...source, integrity: typeof entry.integrity === 'string' && entry.integrity.length > 0,
      installScript: entry.hasInstallScript === true, license: licenseOf(entry.license), dev: entry.dev === true || entry.devOptional === true,
      optional: entry.optional === true || entry.devOptional === true, peer: entry.peer === true, line: lines.get(key) ?? null, hashes: integrityHashes(entry.integrity), requires: dependencyNames(entry.dependencies, entry.optionalDependencies, entry.peerDependencies) });
  }
  return { packages: list };
}

/**
 * The nested "dependencies" of version 1. It records no install scripts, no licenses and no peer flags, so these are null.
 * Code-map makes the path of each package from the names of its parents. Thus a deep tree can give paths that are much longer
 * than the lockfile. Each path is cut before its children use it, and all paths together have the byte limit of the lockfile.
 */
function fromDependencies(dependencies, lines, limits) {
  if (dependencies === undefined) return { packages: [] };
  const list = [], stack = [[dependencies, '']];
  let characters = 0;
  while (stack.length) {
    const [map, parent] = stack.pop();
    if (!isRecord(map)) return { error: 'A "dependencies" field must be an object.' };
    for (const [name, entry] of Object.entries(map)) {
      if (!isRecord(entry)) return { error: 'An entry in "dependencies" is not an object.' };
      if (list.length === limits.packages) return { tooMany: true, error: `The lockfile has more than ${limits.packages} packages.` };
      const path = clip(`${parent}node_modules/${name}`, max.path), source = entry.bundled === true ? { kind: 'bundled', host: null } : origin(entry.resolved, entry.version);
      characters += path.length;
      if (characters > limits.bytes) return { tooMany: true, error: `The package paths of the lockfile have more than ${limits.bytes} characters together.` };
      list.push({ path, name: clip(name, max.name), version: versionOf(entry.version), ...source,
        integrity: typeof entry.integrity === 'string' && entry.integrity.length > 0, installScript: null, license: null, dev: entry.dev === true,
        optional: entry.optional === true, peer: null, line: parent === '' ? lines.get(name) ?? null : null, hashes: integrityHashes(entry.integrity), requires: dependencyNames(entry.requires) });
      if (entry.dependencies !== undefined) stack.push([entry.dependencies, `${path}/`]);
    }
  }
  return { packages: list };
}

/**
 * The kind of source and the host of a package. The resolved URL decides. Without one, a version that is not a plain version
 * (a Git or file spec in version 1) decides. The host never keeps a user name or a password from the URL. Only a file: spec
 * is local. npm writes a path without "file:" only for a link, and a link is not a package. Thus another spec without a
 * scheme is unknown, and the rules do not leave it out as the project's own code.
 */
function origin(resolved, version) {
  const spec = typeof resolved === 'string' ? resolved : typeof version === 'string' && !/^\d/.test(version) ? version : null;
  if (spec === null) return { kind: 'unknown', host: null };
  if (/^file:/i.test(spec)) return { kind: 'local', host: null };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(spec)) return { kind: 'unknown', host: null };
  const shortcut = Object.keys(shortcuts).find((prefix) => spec.toLowerCase().startsWith(prefix));
  if (shortcut) return { kind: 'git', host: shortcuts[shortcut] };
  const git = /^git(?:\+|:)/i.test(spec);
  let url;
  try { url = new URL(spec.replace(/^git\+/i, '')); } catch { return { kind: git ? 'git' : 'unknown', host: null }; }
  const host = clip(url.host.toLowerCase(), max.host) || null;
  return { kind: git ? 'git' : /^https?:$/.test(url.protocol) && host ? 'remote' : 'unknown', host };
}

/** The license text of a lockfile entry. Old packages give an object with a "type". */
function licenseOf(value) {
  if (typeof value === 'string') return clip(value.trim(), max.license) || null;
  return isRecord(value) ? clip(value.type, max.license) : null;
}

/** The line of each entry key of a section, for npm's own layout with two spaces. Another layout gives no lines. */
function keyLines(text, section) {
  const lines = new Map(), start = `  ${JSON.stringify(section)}: {`;
  let inside = false;
  for (let offset = 0, line = 1; offset < text.length; line++) {
    const next = text.indexOf('\n', offset), end = next === -1 ? text.length : next, row = text.slice(offset, end).replace(/\r$/, '');
    offset = end + 1;
    if (!inside) { inside = row === start; continue; }
    if (row.startsWith('  }')) break;
    const match = /^ {4}("(?:[^"\\]|\\.)*"): \{/.exec(row);
    if (match) { try { lines.set(JSON.parse(match[1]), line); } catch { /* not a JSON string */ } }
  }
  return lines;
}

/** Keep only declared dependency names from lockfile maps. */
function dependencyNames(...maps) {
  return [...new Set(maps.filter(isRecord).flatMap((map) => Object.keys(map)))];
}
/** Resolve npm's nested install paths from the package towards the root. */
function resolveNpmEdges(packages) {
  const paths = new Set(packages.map((p) => p.path));
  for (const p of packages) {
    p.dependencies = p.requires.flatMap((name) => {
      let folder = p.path;
      while (true) {
        const target = `${folder ? `${folder}/` : ''}node_modules/${name}`;
        if (paths.has(target)) return [target];
        if (!folder) return [];
        const at = folder.lastIndexOf('/node_modules/');
        folder = at < 0 ? '' : folder.slice(0, at);
      }
    });
    delete p.requires;
  }
}
