// Named imports that the imported file does not export: a stale consumer after a rename or a removal, or a typing error.
// Only targets inside the snapshot are checked. `export * from` re-exports of local files are followed. A target whose
// names are not all known is skipped and counted, because a check there could report a false break: a re-export from a
// package, CommonJS, a destructured export (the parser records the pattern, not the names), `export =`, or no export at all.
export function missingImportNames(files, testFiles = []) {
  const byPath = new Map(files.map((file) => [file.path, file])), cache = new Map();
  const unchecked = { exportStar: 0, commonJs: 0, bindingPattern: 0, exportAssignment: 0, noExports: 0 };
  /** The exported names of a file, or the reason why they are not known. */
  const exportsOf = (path, open = new Set()) => {
    if (cache.has(path)) return cache.get(path);
    if (open.has(path)) return new Set(); // an export-star loop adds no names
    open.add(path);
    const file = byPath.get(path), names = file.exports ?? [], details = file.exportDetails ?? [];
    let result = !names.length ? 'noExports' : names.includes('module.exports') ? 'commonJs' : names.some((name) => /^[{[]/.test(name)) ? 'bindingPattern'
      : names.length === 1 && names[0] === 'default' && details[0]?.category === 'reexport' ? 'exportAssignment' : null;
    if (result === null) {
      const own = new Set(names.filter((name) => name !== '*'));
      if (names.includes('*')) {
        // `export * from` and `import * as` both give a "*" edge. Following an `import * as` edge only adds names, so it cannot report a false break.
        const stars = (file.edges ?? []).filter((edge) => edge.mode === 'static' && edge.valueNames?.includes('*'));
        for (const edge of stars) {
          const inner = edge.target && byPath.has(edge.target) ? exportsOf(edge.target, open) : 'exportStar';
          if (typeof inner === 'string') { result = 'exportStar'; break; }
          for (const name of inner) if (name !== 'default') own.add(name);
        }
        if (!stars.length) result = 'exportStar';
      }
      result ??= own;
    }
    open.delete(path);
    cache.set(path, result);
    return result;
  };
  const missing = [];
  for (const file of [...files, ...testFiles]) for (const edge of file.edges ?? []) {
    if (!edge.target || edge.target === file.path || !byPath.has(edge.target)) continue;
    const names = [...new Set([...(edge.typeNames ?? []), ...(edge.valueNames ?? [])])].filter((name) => name !== '*');
    if (!names.length) continue;
    const exported = exportsOf(edge.target);
    if (typeof exported === 'string') { unchecked[exported]++; continue; }
    for (const name of names) if (!exported.has(name)) missing.push({ source: file.path, target: edge.target, name, line: edge.line, kind: edge.kind, mode: edge.mode });
  }
  return { missing, unchecked };
}
