// Compares the exported interface of two stored analyses (capabilities C03 and C04). Each export gets REMOVED, CHANGED,
// UNKNOWN or ADDED, or stays unchanged. A removed or changed export lists the head files that still import it, also files
// that the change did not touch. The public group holds the package entry points, with re-exports followed to the declaring
// file. The module group holds the own exports of the other files. Pure: the caller gives both analyses, the Git renames and
// the comparability verdict. A status compares declared signatures from the syntax: it is a lead, not a type-check result.
import { finishApi, typedChange } from './types/api.mjs';
import { digestOf } from './api-signatures.mjs';

export const apiStatuses = ['REMOVED', 'CHANGED', 'UNKNOWN', 'ADDED', 'RENAMED'];
export const apiGroups = ['public', 'module'];
const maxDepth = 20;
/** The strongest evidence first: a named import, an import that no longer resolves, a namespace import. */
const consumerKinds = ['name', 'unresolved', 'namespace'];
const push = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };

/**
 * The exports of a file through its re-exports: name -> record with `declaredIn`. A record that a re-export names also has
 * `declaredName`, its name in the declaring file. A re-export from a package keeps its own record. `files` is the `files`
 * map of a stored API surface.
 */
export function surfaces(files) {
  const cache = new Map();
  const surface = (path, depth = 0, open = new Set()) => {
    if (cache.has(path)) return cache.get(path);
    const map = new Map();
    if (open.has(path) || depth > maxDepth || !files[path]) return map;
    open.add(path);
    for (const record of files[path]) if (record.name !== '*') map.set(record.name, follow(record, path, depth, open));
    for (const record of files[path]) if (record.name === '*') {
      const target = record.from.target;
      if (target === null || !files[target]) { map.set(`*:${record.from.specifier}`, { ...record, declaredIn: path }); continue; }
      for (const [name, value] of surface(target, depth + 1, open)) if (name !== 'default' && !map.has(name)) map.set(name, value);
    }
    open.delete(path);
    cache.set(path, map);
    return map;
  };
  const follow = (record, path, depth, open) => {
    if (!record.from || record.from.target === null || !files[record.from.target]) return { ...record, declaredIn: path };
    const inner = surface(record.from.target, depth + 1, open);
    if (record.from.name !== '*') {
      const found = inner.get(record.from.name);
      return found ? { ...found, name: record.name, declaredName: found.declaredName ?? found.name }
        : { name: record.name, kind: 'unknown', text: record.text, digest: record.digest, inferred: true, declaredIn: path };
    }
    // A namespace re-export (`export * as ns`) changes when any name of its target changes.
    const entries = [...inner].sort(([a], [b]) => a.localeCompare(b)), inferred = entries.some(([, value]) => value.inferred);
    return { name: record.name, kind: 'namespace', text: record.text, digest: digestOf(entries.map(([name, value]) => `${name} ${value.kind} ${value.digest}`).join('\n')), inferred,
      ...(inferred ? { source: digestOf(entries.map(([name, value]) => `${name} ${value.source ?? ''}`).join('\n')) } : {}), declaredIn: record.from.target };
  };
  return surface;
}

/**
 * `passOn(file, name)`: the files of a surface that export `name` of `file` again (for example an index file), each with the
 * name that it exports. `export * as ns` makes a new object, so it does not pass a name on.
 */
export function passOnOf(files) {
  const reexports = new Map();
  for (const [file, records] of Object.entries(files)) for (const record of records) {
    if (record.from?.target && !(record.from.name === '*' && record.name !== '*')) push(reexports, record.from.target, { file, record });
  }
  return (file, name) => (reexports.get(file) ?? []).filter(({ record }) => record.name === '*' ? name !== 'default' : record.from.name === name)
    .map(({ file: next, record }) => [next, record.name === '*' ? name : record.name]);
}

/** The own records of a file by name. An `export *` is named by its target, after `rename` for a base file. */
const ownOf = (records, rename) => new Map(records.map((record) => [record.name !== '*' ? record.name
  : `*:${record.from.target !== null ? rename(record.from.target) : `package:${record.from.specifier}`}`, record]));

/** null when the export is unchanged, else its status and reasons. */
function change(before, after, rename) {
  if (before.from || after.from) {
    if (!before.from || !after.from) return { status: 'CHANGED', reasons: ['kind'] };
    const same = before.from.name === after.from.name && (before.from.target === null
      ? after.from.target === null && before.from.specifier === after.from.specifier : rename(before.from.target) === after.from.target);
    return same ? null : { status: 'CHANGED', reasons: ['reexport-target'] };
  }
  if (before.kind !== after.kind) return { status: 'CHANGED', reasons: ['kind'] };
  if (before.digest !== after.digest) return { status: 'CHANGED', reasons: [before.overloads || after.overloads ? 'overloads' : 'signature'] };
  if (before.kind === 'unknown') return { status: 'UNKNOWN', reasons: ['not-declared'] };
  // An inferred type can change when its source changes, and the analysis has no type checker to tell.
  if (before.inferred && after.inferred && before.source !== after.source) return { status: 'UNKNOWN', reasons: ['inferred'] };
  return null;
}

const view = (record, group) => !record ? null : { kind: record.kind, text: record.text, digest: record.digest, inferred: record.inferred ?? false,
  ...(record.truncated ? { truncated: true } : {}), ...(record.overloads ? { overloads: record.overloads } : {}), ...(record.from ? { from: record.from } : {}),
  ...(group === 'public' ? { declaredIn: record.declaredIn } : {}) };

/** The import edges of a snapshot by target and by importer: source files from the analysis, test files from the API surface. */
function importIndex(stored) {
  const byTarget = new Map(), bySource = new Map();
  const add = (edge) => { if (edge.target) push(byTarget, edge.target, edge); push(bySource, edge.source, edge); };
  for (const file of stored.data.analysis.files) for (const edge of file.imports) {
    add({ source: file.path, target: edge.target, specifier: edge.specifier, line: edge.line, names: [...(edge.typeNames ?? []), ...(edge.valueNames ?? [])] });
  }
  for (const edge of stored.data.analysis.api?.testImports ?? []) add(edge);
  return { byTarget, bySource };
}

/**
 * { state, reasons, complete, entryPoints, items, unchanged }. Each item has `group`, `status`, `path` (the head path),
 * `basePath` after a rename, `name`, `reasons`, the `base` and `head` records and `consumers` (null for an added export).
 * `complete` false: Git did not look for every rename, so an export of a removed or added file is UNKNOWN.
 */
export function compareApi(base, head, { renames = [], complete = true, state, reasons = [] }) {
  const before = base.data.analysis.api, after = head.data.analysis.api;
  if (state !== 'COMPARABLE') return { state, reasons, complete: null, entryPoints: null, items: [], unchanged: null };
  if (!before || !after) return { state: 'NOT_COMPARABLE', reasons: ['api-missing'], complete: null, entryPoints: null, items: [], unchanged: null };
  const moves = new Map(renames.map((item) => [item.from, item.to])), back = new Map(renames.map((item) => [item.to, item.from]));
  const rename = (path) => moves.get(path) ?? path, same = (path) => path;
  /** The base path of a head path, or null when the base file at that path moved away. */
  const origin = (path) => back.get(path) ?? (moves.has(path) ? null : path);
  const baseEntries = new Set(before.entryPoints.files.map((entry) => entry.path)), headEntries = new Set(after.entryPoints.files.map((entry) => entry.path));
  const baseSurface = surfaces(before.files), headSurface = surfaces(after.files), baseIndex = importIndex(base), headIndex = importIndex(head);
  const passOn = passOnOf(after.files);
  const consumersOf = (path, old, name) => {
    const found = new Map();
    // A direct import is stronger evidence than one through a re-export, and the first line counts.
    const keep = (source, line, kind, through = null) => {
      const known = found.get(source), rank = consumerKinds.indexOf(kind), was = known ? consumerKinds.indexOf(known.via) : Infinity;
      const better = rank < was || (rank === was && (!through && !!known.through || !through === !known.through && (line ?? 0) < (known.line ?? 0)));
      if (better) found.set(source, { path: source, line, via: kind, ...(through ? { through } : {}) });
    };
    if (after.files[path]) {
      // A file that imports the name through a re-export also uses it. `through` names the file that it imports.
      const queue = [[path, name]], seen = new Set([`${path}#${name}`]);
      for (const [file, exported] of queue) {
        for (const edge of headIndex.byTarget.get(file) ?? []) {
          const kind = edge.source === path || edge.source === file ? null : edge.names.includes(exported) ? 'name' : edge.names.includes('*') ? 'namespace' : null;
          if (kind) keep(edge.source, edge.line, kind, file === path ? null : file);
        }
        for (const [next, as] of passOn(file, exported)) if (!seen.has(`${next}#${as}`)) { seen.add(`${next}#${as}`); queue.push([next, as]); }
      }
    }
    if (old !== null && (old !== path || !after.files[path])) {
      // The file is gone or moved: a head file that keeps the import of the base, and the import reaches no file that exports the name.
      for (const edge of baseIndex.byTarget.get(old) ?? []) {
        if (!edge.names.includes(name) && !edge.names.includes('*')) continue;
        const source = rename(edge.source);
        if (source === path) continue;
        for (const now of headIndex.bySource.get(source) ?? []) if (now.specifier === edge.specifier && now.target !== path) {
          if (now.target === null) keep(source, now.line, 'unresolved');
          else if (edge.names.includes(name) && !headSurface(now.target).has(name)) keep(source, now.line, 'name');
        }
      }
    }
    const items = [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
    return { total: items.length, items };
  };
  let items = [];
  const unchanged = { public: 0, module: 0 };
  const compare = (group, path, old, was, now, why) => {
    for (const key of new Set([...was.keys(), ...now.keys()])) {
      const a = was.get(key) ?? null, b = now.get(key) ?? null;
      const typed = a && b ? typedChange(base, head, path, old, a, b) : undefined;
      let result = a && b ? (typed === undefined ? change(a, b, rename) : typed) : a ? { status: 'REMOVED', reasons: why.removed ? [why.removed] : [] } : { status: 'ADDED', reasons: why.added ? [why.added] : [] };
      if (result === null) { unchanged[group]++; continue; }
      if (!complete && result.reasons.some((reason) => reason === 'file-removed' || reason === 'file-added')) result = { status: 'UNKNOWN', reasons: [...result.reasons, 'renames-incomplete'] };
      const name = (b ?? a).name;
      items.push({ group, status: result.status, path, ...(old !== null && old !== path ? { basePath: old } : {}), name, reasons: result.reasons,
        base: view(a, group), head: view(b, group), consumers: result.status === 'ADDED' ? null : consumersOf(path, old, name) });
    }
  };
  for (const path of [...new Set([...headEntries, ...[...baseEntries].map(rename)])].sort()) {
    const old = origin(path), baseFile = old !== null && !!before.files[old], wasEntry = old !== null && baseEntries.has(old), isEntry = headEntries.has(path);
    compare('public', path, old, wasEntry ? baseSurface(old) : new Map(), isEntry ? headSurface(path) : new Map(),
      { removed: !after.files[path] ? 'file-removed' : !isEntry ? 'entry-removed' : null, added: !baseFile ? 'file-added' : !wasEntry ? 'entry-added' : null });
  }
  // A file that is an entry point on one side only is also in the module group, so a change of the entry points hides no change.
  for (const path of [...new Set([...Object.keys(after.files), ...Object.keys(before.files).map(rename)])].sort()) {
    const old = origin(path), baseFile = old !== null && !!before.files[old];
    if (headEntries.has(path) && baseFile && baseEntries.has(old)) continue;
    compare('module', path, old, baseFile ? ownOf(before.files[old], rename) : new Map(), after.files[path] ? ownOf(after.files[path], same) : new Map(),
      { removed: !after.files[path] ? 'file-removed' : null, added: !baseFile ? 'file-added' : null });
  }
  items = finishApi(items, base, head);
  const order = (item) => apiGroups.indexOf(item.group) * 10 + apiStatuses.indexOf(item.status);
  items.sort((a, b) => order(a) - order(b) || (b.consumers?.total ?? 0) - (a.consumers?.total ?? 0) || a.path.localeCompare(b.path) || a.name.localeCompare(b.name));
  const entryPoints = { base: before.entryPoints.files.length, head: after.entryPoints, added: [...headEntries].filter((path) => { const old = origin(path); return old === null || !baseEntries.has(old); }).sort(),
    removed: [...baseEntries].filter((path) => !headEntries.has(rename(path))).sort() };
  return { state: 'COMPARABLE', reasons: [], complete, entryPoints, items, unchanged };
}
