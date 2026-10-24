// The API surface of one snapshot, stored in the analysis as `api`: the package entry points, the signature of each export
// of each source file, and the imports of test files, which the analysis does not keep elsewhere. lib/api-compare.mjs
// compares two of them. Pure: the collector gives the file texts and its import resolver.
import { posix } from 'node:path';

/** The package.json fields that name the files of a package that other packages can load. */
const entryFields = ['exports', 'main', 'module', 'types', 'typings', 'bin'];
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A real `exports` field nests a few levels. Code-map ignores deeper values, so a crafted package.json cannot overflow the stack. */
const maxNesting = 16;
/** Every string in a field: `exports` nests subpaths, conditions and arrays, and `bin` maps command names to files. */
const targetsOf = (value, depth = 0) => depth > maxNesting ? [] : typeof value === 'string' ? [value]
  : Array.isArray(value) ? value.flatMap((item) => targetsOf(item, depth + 1))
  : isRecord(value) ? Object.values(value).flatMap((item) => targetsOf(item, depth + 1)) : [];

/**
 * { files: [{ path, package, fields }], unresolved: [{ package, field, target, reason }] }. A file is an entry point when a field
 * names it (an import resolution with the same extension rules) and it is a mapped source file. A "*" pattern of `exports`
 * matches source files by their path without extension. `reason` is "not-mapped" for a file outside the source files, for
 * example build output, and "not-found" for a path that no file has.
 */
export function packageEntryPoints(texts, sources, resolve) {
  const mapped = new Set(sources), found = new Map(), unresolved = [];
  const manifests = [...texts.keys()].filter((path) => posix.basename(path) === 'package.json' && !path.split('/').includes('node_modules')).sort();
  for (const manifestPath of manifests) {
    let manifest;
    try { manifest = JSON.parse(texts.get(manifestPath)); } catch { continue; }
    if (!isRecord(manifest)) continue;
    const folder = posix.dirname(manifestPath);
    for (const field of entryFields) for (const target of [...new Set(targetsOf(manifest[field]))]) {
      const paths = target.includes('*') ? matches(folder, target, sources) : [resolve(manifestPath, target.startsWith('.') ? target : `./${target}`)].filter(Boolean);
      const kept = paths.filter((path) => mapped.has(path));
      if (!kept.length) unresolved.push({ package: manifestPath, field, target, reason: paths.length ? 'not-mapped' : 'not-found' });
      for (const path of kept) {
        const entry = found.get(path) ?? { path, package: manifestPath, fields: [] };
        if (!entry.fields.includes(field)) entry.fields.push(field);
        found.set(path, entry);
      }
    }
  }
  return { files: [...found.values()].sort((a, b) => a.path.localeCompare(b.path)), unresolved };
}

/** Source files that a pattern such as "./src/features/*.js" names, compared without extensions. */
function matches(folder, target, sources) {
  const full = posix.join(folder, target), star = full.indexOf('*');
  const before = full.slice(0, star), after = full.slice(star + 1).replace(/\.d(?=\.[cm]?ts$)/, '').replace(/\.[^./]+$/, '');
  const stem = (path) => path.replace(/\.[^./]+$/, '');
  return sources.filter((path) => path.startsWith(before) && stem(path).endsWith(after) && stem(path).length > before.length + after.length);
}

/**
 * The stored surface. `testImports` holds the imports of test files that resolve to a source file or a test file, that are
 * relative and resolve to no file, or that have a computed target, with their `kind` and `mode`. A comparison finds a test
 * that still imports a removed export, and the change impact (lib/impact/) walks from a changed file to the tests.
 * Schema version 2 adds `documented` and `arity` to the signature records. It also keeps the test imports of test files,
 * of side effects and of computed targets.
 */
export function apiSurface(files, testFacts, entryPoints = { files: [], unresolved: [] }) {
  const known = new Set([...files.map((file) => file.path), ...testFacts.map((test) => test.path)]);
  const testImports = testFacts.flatMap((test) => (test.edges ?? [])
    .filter((edge) => known.has(edge.target) || (edge.target === null && (edge.specifier === null || edge.specifier.startsWith('.'))))
    .map((edge) => ({ source: test.path, target: edge.target, specifier: edge.specifier, line: edge.line, names: [...new Set([...edge.typeNames, ...edge.valueNames])],
      kind: edge.kind, mode: edge.mode })));
  return { schemaVersion: 2, entryPoints, files: Object.fromEntries(files.map((file) => [file.path, file.signatures ?? []])), testImports };
}
