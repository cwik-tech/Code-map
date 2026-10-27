// The package import checks (C01) of the analyzed source and test files: imports of packages that the nearest package.json
// does not declare, production imports of development dependencies, declared packages without a folder in node_modules, and
// subpaths that the exports field of the installed package does not export. Pure except for the node_modules view.
import { posix } from 'node:path';
import { aliasMatcher } from './aliases.mjs';
import { exportsSubpath } from './installed.mjs';
import { byText, classify, dependencyFields } from './manifests.mjs';

// Electron supplies its module at runtime. electron-builder keeps this package in devDependencies.
const runtimeProvided = new Set(['electron']);

const skipReasons = ['absolute', 'loader', 'subpath-import', 'scheme', 'invalid-name', 'alias', 'no-package'];
/** Files that only development uses, besides tests: config files, Storybook stories and files in a scripts folder. */
const devFile = /(?:^|\/)scripts\/|(?:^|\/)[^/]+\.config\.[^/]+$|\.(?:stories|story)\.[cm]?[jt]sx?$/;
/** A type-only import, also one with only inline `type` names, is not part of the run-time code. */
const typeOnly = (edge) => edge.kind === 'type' || (edge.valueNames.length === 0 && edge.typeNames.length > 0);

/**
 * The leads of the four import rules, the imports whose exports field is unknown, and the skipped specifiers by reason.
 * `isTest(path)` tells a test file. Each lead groups the imports of one file and package (one file and specifier for a subpath
 * lead), with their lines. `test` in a lead is true for a test file.
 */
export function importLeads({ files, isTest, index, installed, aliases, paths }) {
  const leads = { undeclared: [], devOnly: [], unresolved: [], notExported: [] }, unknownExports = [], groups = new Map();
  const skipped = Object.fromEntries(skipReasons.map((reason) => [reason, 0])), aliased = aliasMatcher(aliases, paths);
  const lead = (list, key, base, specifier, line) => {
    if (!groups.has(key)) { const entry = { ...base, specifiers: [], lines: [] }; groups.set(key, entry); list.push(entry); }
    const entry = groups.get(key);
    if (!entry.specifiers.includes(specifier)) entry.specifiers.push(specifier);
    if (line !== null && !entry.lines.includes(line)) entry.lines.push(line);
  };
  for (const file of files) for (const edge of file.edges ?? []) {
    if (typeof edge.specifier !== 'string' || edge.target !== null || edge.specifier.startsWith('.')) continue;
    const found = classify(edge.specifier);
    if (found.kind === 'builtin') continue;
    if (found.kind === 'skip') { skipped[found.reason]++; continue; }
    if (aliased(file.path, edge.specifier)) { skipped.alias++; continue; }
    const manifest = index.nearest(file.path);
    if (!manifest) { skipped['no-package']++; continue; }
    const { name } = found, types = typeOnly(edge), test = isTest(file.path), dev = test || devFile.test(file.path);
    const fieldsIn = (owner) => dependencyFields.filter((field) => owner.fields[field].includes(name));
    const declaring = manifest, fields = fieldsIn(manifest);
    const ancestor = index.ancestors(manifest).find((owner) => fieldsIn(owner).length);
    if (name === manifest.name || index.names.has(name)) continue; // a self-reference or a workspace package of the repository
    const key = (rule) => `${rule}\0${file.path}\0${name}`, base = { path: file.path, package: name, manifest: manifest.path };
    if (!fields.length) {
      lead(leads.undeclared, key('undeclared'), { ...base, typeOnly: types, test, declaredBy: ancestor?.path ?? null }, edge.specifier, edge.line);
      groups.get(key('undeclared')).typeOnly &&= types;
      continue;
    }
    if (!dev && !types && !runtimeProvided.has(name) && fields.every((field) => field === 'devDependencies')) lead(leads.devOnly, key('dev'), { ...base, declaredBy: declaring.path }, edge.specifier, edge.line);
    const folder = posix.dirname(file.path);
    if (!installed.installed(folder)) continue;
    const location = installed.find(folder, name);
    if (!location) {
      lead(leads.unresolved, key('unresolved'), { ...base, declaredBy: declaring.path, fields }, edge.specifier, edge.line);
      continue;
    }
    const manifestExports = installed.exportsOf(location);
    if (manifestExports.state === 'none') continue;
    const result = manifestExports.state === 'read' ? exportsSubpath(manifestExports.exports, found.subpath) : { state: 'unknown', reason: 'unreadable-manifest' };
    const subpathBase = { path: file.path, package: name, specifier: edge.specifier, subpath: found.subpath, folder: location, manifest: manifest.path };
    if (result.state === 'not-exported') lead(leads.notExported, `subpath\0${file.path}\0${edge.specifier}`, subpathBase, edge.specifier, edge.line);
    if (result.state === 'unknown') lead(unknownExports, `unknown\0${file.path}\0${edge.specifier}`, { ...subpathBase, reason: result.reason }, edge.specifier, edge.line);
  }
  const tidy = (list) => list.map(({ specifiers, ...entry }) => ({ ...entry, ...(entry.specifier === undefined ? { specifiers } : {}), lines: entry.lines.sort((a, b) => a - b) }))
    .sort((a, b) => byText(a.path, b.path) || byText(a.specifier ?? a.package, b.specifier ?? b.package));
  return { leads: Object.fromEntries(Object.entries(leads).map(([kind, list]) => [kind, tidy(list)])), unknownExports: tidy(unknownExports), skipped };
}
