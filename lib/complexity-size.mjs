// Declaration size changes include non-function symbols. Uncertain matches stay UNKNOWN.
/** Compare declaration line counts through confirmed file renames and unique name paths. */
export function compareSymbolSizes(base, head, changed, renames = [], complete = true) {
  const confirmed = renames.filter((item) => item.similarity > 0), forward = new Map(confirmed.map((item) => [item.from, item.to]));
  const uncertain = new Set(renames.filter((item) => !item.similarity).flatMap((item) => [item.from, item.to]));
  const basePaths = new Set(base.files.map((file) => forward.get(file.path) ?? file.path)), headPaths = new Set(head.files.map((file) => file.path));
  const paths = new Set(changed), groups = (analysis, move) => {
    const result = new Map();
    for (const file of analysis.files) for (const declaration of file.declarations) {
      const path = move.get(file.path) ?? file.path;
      if (!paths.has(path) && !paths.has(file.path)) continue;
      const key = JSON.stringify([path, declaration.name]), list = result.get(key) ?? [];
      list.push({ path, name: declaration.name, lines: declaration.lines ?? (Number.isFinite(declaration.start) && Number.isFinite(declaration.end)
        ? declaration.end - declaration.start + 1 : null) }); result.set(key, list);
    }
    return result;
  };
  const before = groups(base, forward), after = groups(head, new Map()), rows = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(key) ?? [], now = after.get(key) ?? [], item = now[0] ?? old[0];
    const known = !uncertain.has(item.path) && old.length <= 1 && now.length <= 1
      && (complete || basePaths.has(item.path) && headPaths.has(item.path));
    const a = old[0]?.lines ?? null, b = now[0]?.lines ?? null;
    if (known && a !== null && b !== null && a === b) continue;
    rows.push({ path: item.path, name: item.name, base: known ? a : null, head: known ? b : null,
      delta: known && a !== null && b !== null ? b - a : null,
      state: !known || old.length && a === null || now.length && b === null ? 'UNKNOWN' : !old.length ? 'ADDED' : !now.length ? 'REMOVED' : 'CHANGED' });
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name));
}
