// The package.json files of a snapshot and the rules that the package checks share: the package name of a specifier, the
// Node.js built-in modules, the config files at a package root, and the search for a package name in a script or a config
// text. Pure: paths and texts in, plain values out.
import { builtinModules } from 'node:module';
import { posix } from 'node:path';
import { packageName } from '../analyze.mjs';
import { ignored } from '../project.mjs';
import { globFiles } from './reach.mjs';

/** The four fields that declare a package. */
export const dependencyFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const builtins = new Set(builtinModules.filter((name) => !name.startsWith('_')));
/** An npm package name: an optional scope and a name. Old packages can have capital letters. */
const validName = /^(?:@[a-z0-9][\w.~-]*\/)?[a-z0-9][\w.~-]*$/i;
export const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Code-point order, so a sort does not depend on the locale. */
export const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Config files at a package root that can name a package or a source file: `*.config.*`, `.*rc` files, JSON, TOML and YAML
 * files (for example tsconfig.json, angular.json or wrangler.toml) and index.html. The package.json has its own place. The rc
 * files of package managers are left out, because they can hold credentials, and so are the lockfiles, which name every package.
 */
const configName = /^(?:[^/]+\.config\.[^/.]+|\.[\w.-]*rc(?:\.\w+)?|[^/]+\.(?:jsonc?|toml|ya?ml)|index\.html)$/;
const leftOut = new Set(['package.json', '.npmrc', '.yarnrc', '.yarnrc.yml', '.pnpmrc', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml']);
export const isPackageConfig = (path) => { const name = posix.basename(path); return configName.test(name) && !leftOut.has(name); };
export const isDeclaration = (path) => /\.d\.[cm]?ts$/.test(path);

/**
 * Each readable package.json outside node_modules and the ignored folders, sorted by path, and the files that are not JSON.
 * Each valid package.json owns its folder, including a manifest with only a "type" field.
 */
export function readManifests(texts) {
  const manifests = [], unreadable = [];
  for (const [path, text] of texts) {
    if (posix.basename(path) !== 'package.json' || ignored(path)) continue;
    let json = null;
    try { json = JSON.parse(text); } catch { /* counted below */ }
    if (!isRecord(json)) { unreadable.push(path); continue; }
    const folder = posix.dirname(path), fields = {};
    const workspaces = Array.isArray(json.workspaces) ? json.workspaces : isRecord(json.workspaces) ? json.workspaces.packages : [];
    const workspacePatterns = Array.isArray(workspaces) ? workspaces.filter((item) => typeof item === 'string') : [];
    for (const field of dependencyFields) fields[field] = isRecord(json[field]) ? Object.keys(json[field]) : [];
    const scripts = isRecord(json.scripts) ? Object.values(json.scripts).filter((value) => typeof value === 'string') : [];
    // The other fields can name packages too, for example "prettier", "eslintConfig", "babel" or "jest".
    const other = JSON.stringify(Object.fromEntries(Object.entries(json).filter(([key]) => !dependencyFields.includes(key) && !['name', 'version', 'scripts'].includes(key))));
    manifests.push({ path, folder, text, name: typeof json.name === 'string' ? json.name : null, private: json.private === true, fields, scripts, other,
      workspacePatterns, hasEntry: json.main !== undefined || json.exports !== undefined,
      owner: true });
  }
  return { manifests: manifests.sort((a, b) => byText(a.path, b.path)), unreadable: unreadable.sort() };
}

/** Indexes nearest manifests, ancestor declarations, and names selected by workspace patterns. Unreadable manifests block owner lookup. */
export function manifestIndex(manifests, unreadable = []) {
  const owners = new Map(manifests.filter((item) => item.owner).map((item) => [item.folder, item]));
  for (const path of unreadable) owners.set(posix.dirname(path), null);
  const above = (folder) => {
    const list = [];
    for (let current = folder; ; current = posix.dirname(current)) {
      if (owners.has(current)) list.push(owners.get(current));
      if (current === '.') return list;
    }
  };
  return {
    nearest: (path) => above(posix.dirname(path))[0] ?? null,
    ancestors: (manifest) => (manifest.folder === '.' ? [] : above(posix.dirname(manifest.folder)).filter(Boolean)),
    owns: (manifest, path) => manifest.folder === '.' || path.startsWith(`${manifest.folder}/`),
    names: new Set(manifests.filter((item) => item.name && manifests.some((owner) => {
      const path = posix.relative(owner.folder, item.folder);
      if (!path || path.startsWith('../')) return false;
      const patterns = owner.workspacePatterns.map((pattern) => pattern.replace(/^\.\//, ''));
      return patterns.some((pattern) => !pattern.startsWith('!') && globFiles(pattern, [path]).length)
        && !patterns.some((pattern) => pattern.startsWith('!') && globFiles(pattern.slice(1), [path]).length);
    })).map((item) => item.name)),
  };
}

/**
 * What a bare specifier names. Node.js built-ins remain exempt when a manifest declares the same name.
 * Unsupported specifiers have a skip reason.
 */
export function classify(specifier) {
  if (specifier.startsWith('node:')) return { kind: 'builtin' };
  if (specifier.startsWith('/')) return { kind: 'skip', reason: 'absolute' };
  if (/[?!]/.test(specifier)) return { kind: 'skip', reason: 'loader' };
  if (specifier.startsWith('#')) return { kind: 'skip', reason: 'subpath-import' };
  if (specifier.includes(':')) return { kind: 'skip', reason: 'scheme' };
  const name = packageName(specifier);
  if (!validName.test(name)) return { kind: 'skip', reason: 'invalid-name' };
  if (builtins.has(specifier)) return { kind: 'builtin' };
  return { kind: 'package', name, subpath: specifier.length > name.length ? `.${specifier.slice(name.length)}` : '.' };
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** True when `text` names `word` as a whole name: not as a part of a longer name such as "react-dom" or "preact". */
export const mentions = (text, word) => new RegExp(`(?<![\\w@.-])${escape(word)}(?![\\w.-])`).test(text);
/** True when `text` names a path without its extension, for example "src/main" in "/src/main.tsx". */
export const mentionsPath = (text, stem) => new RegExp(`(?<![\\w-])${escape(stem)}(?![\\w-])`).test(text);

/** The command names of packages whose command has another name. A scoped package also has the name after its scope. */
const commands = { typescript: ['tsc', 'tsserver'], 'npm-run-all': ['run-s', 'run-p'], 'npm-run-all2': ['run-s', 'run-p'], '@angular/cli': ['ng'], '@nestjs/cli': ['nest'],
  'firebase-tools': ['firebase'], '@playwright/test': ['playwright'] };
export const scriptNames = (name) => [name, ...(name.startsWith('@') ? [name.split('/')[1]] : []), ...(commands[name] ?? [])];

/** The names that a config file can use for a package: ESLint and Babel know plugins, configs and presets by a short name. */
export function configNames(name) {
  const names = [name];
  const tool = /^(@[^/]+\/)?(?:eslint-plugin|eslint-config|babel-plugin|babel-preset)(?:-(.+))?$/.exec(name);
  if (tool) names.push(tool[1] ? (tool[2] ? tool[1] + tool[2] : tool[1].slice(0, -1)) : tool[2]);
  const babel = /^@babel\/(?:plugin|preset)-(.+)$/.exec(name);
  if (babel) names.push(`@babel/${babel[1]}`);
  return names.filter(Boolean);
}
