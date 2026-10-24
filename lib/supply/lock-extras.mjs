// Additional lockfile readers. Only the generated mapping subset of pnpm YAML is accepted.
import ts from 'typescript';
import { integrityHashes } from './sbom.mjs';
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const unquote = (v) => v.startsWith('"') ? JSON.parse(v) : v.startsWith("'") && v.endsWith("'") ? v.slice(1, -1).replaceAll("''", "'") : v;
const identity = (v) => /^(@[^/]+\/[^@]+|[^@/][^@]*)@([^()]+)(?:\(.*\))?$/.exec(v.replace(/^\//, ''));
/** Shared package shape. Unknown lockfile fields remain null. */
function item(name, version, data = {}) {
  if (/[a-z][a-z0-9+.-]*:\/\/[^/?#\s]*@/i.test(`${name}@${version}`)) throw new Error('Credential-bearing lockfile identities are not supported.');
  let host = null;
  try { host = new URL(data.resolved).host; } catch { /* No registry URL is recorded. */ }
  return { path: `${name}@${version}`, name, version, kind: /^(file:|link:|workspace:)/.test(version) ? 'local' : host ? 'remote' : 'unknown', host,
    integrity: typeof data.integrity === 'string' && data.integrity.length > 0, hashes: integrityHashes(data.integrity), installScript: data.requiresBuild === true ? true : null,
    license: typeof data.license === 'string' ? data.license : null, dev: data.dev === true, optional: data.optional === true, peer: null, line: null,
    selectors: data.selectors ?? [], requires: data.dependencies ?? {} };
}
/** Resolve exact lockfile identities and Yarn selectors. */
function edges(entries, bunPaths = false) {
  const unique = new Map();
  for (const p of entries) {
    if (/[a-z][a-z0-9+.-]*:\/\/[^/?#\s]*@/i.test(p.path)) throw new Error('Credential-bearing lockfile paths are not supported.');
    if (p.name.length > 214 || p.version.length > 256 || p.path.length > 4096) throw new Error('Lockfile identity exceeds its limit.');
    if (!record(p.requires) || !Object.values(p.requires).every((v) => typeof v === 'string')) throw new Error('Unsupported dependency mapping.');
    const old = unique.get(p.path);
    if (old) { old.selectors.push(...p.selectors); Object.assign(old.requires, p.requires); }
    else unique.set(p.path, p);
  }
  const packages = [...unique.values()], index = new Map();
  for (const p of packages) { index.set(`${p.name}@${p.version}`, p.path); index.set(p.path, p.path); for (const selector of p.selectors) index.set(selector, p.path); }
  for (const p of packages) {
    p.dependencies = Object.entries(p.requires).flatMap(([name, version]) => {
      const target = bunPaths ? bunTarget(p.path, name, unique) : index.get(`${name}@${version}`) ?? index.get(version)
        ?? index.get(`${name}@${version.replace(/\(.*$/, '')}`);
      return target ? [target] : [];
    });
    delete p.selectors; delete p.requires;
  }
  return packages.sort((a, b) => a.path.localeCompare(b.path));
}
/** Bun keys describe the installed nesting. Resolve declared ranges through that nesting. */
function bunTarget(path, name, packages) {
  let folder = path;
  while (true) {
    const target = `${folder ? `${folder}/` : ''}${name}`;
    if (packages.has(target)) return target;
    if (!folder) return null;
    const at = folder.lastIndexOf('/');
    folder = at < 0 ? '' : folder.slice(0, at);
  }
}
function yarn(text) {
  if (!/^# yarn lockfile v1\s*$/m.test(text)) throw new Error('Only Yarn classic lockfile version 1 is supported.');
  const packages = [], selectors = new Set(); let current = null, section = null;
  for (const row of text.split(/\r?\n/)) {
    if (!row.trim() || row.startsWith('#')) continue;
    if (!row.startsWith(' ')) {
      if (!row.endsWith(':')) throw new Error('Unsupported Yarn classic entry.');
      const keys = row.slice(0, -1).split(/,\s+(?=(?:"|@|[\w]))/).map(unquote);
      if (keys.some((key) => !identity(key) || selectors.has(key))) throw new Error('Invalid or duplicate Yarn selector.');
      keys.forEach((key) => selectors.add(key));
      current = { keys, dependencies: {} }; packages.push(current); section = null;
    } else if (/^  [\w]+:$/.test(row)) section = row.trim().slice(0, -1);
    else {
      const match = /^( {2}| {4})("[^"\n]+"|\S+) (.+)$/.exec(row);
      if (!match || !current) throw new Error('Unsupported Yarn classic field.');
      const key = unquote(match[2]), value = unquote(match[3]);
      if (match[1].length === 2) { current[key] = value; section = null; }
      else if (section === 'dependencies' || section === 'optionalDependencies') current.dependencies[key] = value;
      else throw new Error('Unsupported Yarn classic section.');
    }
  }
  return { version: 1, packages: edges(packages.map((p) => {
    const id = identity(p.keys[0]);
    if (typeof p.version !== 'string') throw new Error('Yarn package has no version.');
    const alias = /@npm:((?:@[^/]+\/)?[^@]+)@/.exec(p.keys[0]);
    return item(alias?.[1] ?? id[1], p.version, { ...p, selectors: p.keys });
  })) };
}
function scalar(text) {
  const value = text.trim();
  if (value === '{}') return Object.create(null);
  if (value.startsWith('{') && value.endsWith('}')) {
    const result = Object.create(null);
    for (const pair of value.slice(1, -1).split(/,\s*/)) {
      const match = /^([^:]+):\s*(.+)$/.exec(pair);
      if (!match) throw new Error('Unsupported YAML inline mapping.');
      const key = unquote(match[1].trim());
      if (Object.hasOwn(result, key) || /^[&*!?]|^<<$/.test(key)) throw new Error('Unsupported YAML inline key or duplicate.');
      result[key] = scalar(match[2]);
    }
    return result;
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    const entries = value.slice(1, -1).trim();
    if (!entries) return [];
    const values = entries.split(/,\s*/).map(scalar);
    if (values.some((v) => typeof v !== 'string' && typeof v !== 'boolean')) throw new Error('Unsupported YAML scalar array.');
    return values;
  }
  if (/^[&*!>|]|\s[&*!]/.test(value) || /[{}\[\]]/.test(value)) throw new Error('Unsupported YAML value.');
  if (value === 'true' || value === 'false') return value === 'true';
  return unquote(value);
}
function yaml(text) {
  const root = Object.create(null), stack = [{ indent: -2, value: root }];
  for (const row of text.split(/\r?\n/)) {
    if (!row.trim() || /^\s*#/.test(row)) continue;
    const match = /^( *)(.+?):(?:\s+(.*))?$/.exec(row);
    if (!match || match[1].length % 2 || row.includes('\t')) throw new Error('Unsupported YAML mapping.');
    const indent = match[1].length;
    while (stack.length > 1 && stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1);
    if (indent !== parent.indent + 2) throw new Error('Unsupported YAML indentation.');
    const key = unquote(match[2]);
    if (/^[&*!?]|^<<$/.test(key) || Object.hasOwn(parent.value, key)) throw new Error('Unsupported YAML key or duplicate.');
    const value = match[3] === undefined ? Object.create(null) : scalar(match[3]);
    parent.value[key] = value;
    if (match[3] === undefined) stack.push({ indent, value });
  }
  return root;
}
function dependencyMap(data) {
  const maps = [data.dependencies, data.optionalDependencies].filter((v) => v !== undefined);
  if (!maps.every((v) => record(v) && Object.values(v).every((x) => typeof x === 'string'))) throw new Error('Unsupported dependency mapping.');
  return Object.assign(Object.create(null), ...maps);
}
function pnpm(text) {
  const root = yaml(text), version = Number(root.lockfileVersion);
  if (version !== 6 && version !== 9) throw new Error('Only pnpm lockfile versions 6 and 9 are supported.');
  if (root.packages !== undefined && !record(root.packages)) throw new Error('Unsupported YAML packages mapping.');
  if (root.snapshots !== undefined && !record(root.snapshots)) throw new Error('Unsupported pnpm snapshots mapping.');
  const groups = new Map();
  for (const [key, value] of Object.entries(root.snapshots ?? {})) {
    const id = identity(key);
    if (!id || !record(value)) throw new Error('Unsupported pnpm snapshot.');
    const base = `${id[1]}@${id[2]}`;
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push([key, value]);
  }
  const packages = [];
  for (const [key, value] of Object.entries(root.packages ?? {})) {
    const id = identity(key);
    if (!id || !record(value)) throw new Error('Unsupported pnpm package key or value.');
    const snapshots = version === 9 && record(root.snapshots)
      ? groups.get(`${id[1]}@${id[2]}`) ?? [] : [[key, value]];
    for (const [name, snapshot] of snapshots.length ? snapshots : [[key, value]]) {
      if (!record(snapshot)) throw new Error('Unsupported pnpm snapshot.');
      const p = item(id[1], id[2], { ...value, integrity: value.resolution?.integrity,
        resolved: value.resolution?.tarball, dependencies: dependencyMap(snapshot) });
      p.path = name.replace(/^\//, ''); packages.push(p);
    }
  }
  return { version, packages: edges(packages) };
}
function bun(text) {
  const parsed = ts.parseConfigFileTextToJson('bun.lock', text);
  if (parsed.error || !record(parsed.config)) throw new Error('The Bun lockfile is not valid JSON with comments.');
  const root = parsed.config;
  if (![0, 1].includes(root.lockfileVersion) || !record(root.packages)) throw new Error('Unsupported Bun lockfile version or packages.');
  const packages = [];
  for (const [key, value] of Object.entries(root.packages)) {
    if (!Array.isArray(value) || typeof value[0] !== 'string' || !record(value[2])) throw new Error('Unsupported Bun package tuple.');
    const id = identity(value[0]);
    if (!id) throw new Error('Unsupported Bun package identity.');
    const p = item(id[1], id[2], { ...value[2], resolved: value[1], integrity: value[3], dependencies: dependencyMap(value[2]) });
    p.path = key; packages.push(p);
  }
  return { version: root.lockfileVersion, packages: edges(packages, true) };
}
/** Return an inventory or a refusal. Byte and package limits match the npm reader. */
export function readExtra(path, text, limits) {
  try {
    if (typeof text !== 'string') throw new Error('Code-map cannot read the lockfile as text.');
    if (Buffer.byteLength(text) > limits.bytes) throw new Error(`The lockfile exceeds ${limits.bytes} bytes.`);
    if (path === 'bun.lockb') throw new Error('Binary Bun lockfiles are not supported.');
    const result = path === 'yarn.lock' ? yarn(text) : path === 'pnpm-lock.yaml' ? pnpm(text) : bun(text);
    if (result.packages.length > limits.packages) throw new Error(`The lockfile exceeds ${limits.packages} packages.`);
    return { state: 'read', ...result };
  } catch (error) { return { state: 'invalid', error: error.message }; }
}
