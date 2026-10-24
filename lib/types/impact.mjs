// Bounded symbol propagation follows only imports of the affected name and named re-exports.
import { passOnOf } from '../api-compare.mjs';

/** Reports importers by affected name. Depth and file limits produce an explicit truncation marker. */
export function symbolImpact(changes, analysis, { depth = 8, files = 1000, base = null, renames = [] } = {}) {
  const forward = new Map(renames.map((item) => [item.from, item.to])), backward = new Map(renames.map((item) => [item.to, item.from]));
  const previous = (path, specifier) => base?.files.find((file) => file.path === (backward.get(path) ?? path))?.imports.find((edge) => edge.specifier === specifier)?.target;
  const targetOf = (path, edge) => edge.target ?? forward.get(previous(path, edge.specifier)) ?? previous(path, edge.specifier) ?? null;
  const surface = Object.fromEntries(Object.entries(analysis.api?.files ?? {}).map(([path, records]) => [path, records.map((record) => record.from
    ? { ...record, from: { ...record.from, target: targetOf(path, record.from) } } : record)]));
  const passOn = passOnOf(surface), items = [], seen = new Set();
  const edges = [...analysis.files.flatMap((file) => file.imports.map((edge) => ({ ...edge, target: targetOf(file.path, edge), source: file.path,
    names: [...(edge.typeNames ?? []), ...(edge.valueNames ?? [])] }))), ...(analysis.api?.testImports ?? [])];
  let truncated = false;
  for (const change of changes.filter((item) => ['REMOVED', 'RENAMED', 'CHANGED'].includes(item.status))) {
    const name = change.pair?.from ?? change.name, queue = [[change.path, name, 0], ...(change.pair ? [[change.path, change.pair.to, 0]] : [])], visited = new Set();
    for (const [path, name, level] of queue) {
      const key = `${path}#${name}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const imports = edges.filter((edge) => edge.target === path && (edge.names.includes(name) || edge.names.includes('*')));
      if (level >= depth) { if (imports.length) truncated = true; continue; }
      for (const edge of imports) {
        const id = `${change.path}#${change.name}:${edge.source}:${name}`;
        if (seen.has(id)) continue;
        if (items.length >= files) { truncated = true; break; }
        seen.add(id);
        items.push({ export: { path: change.path, name: change.name }, path: edge.source, name, depth: level + 1, line: edge.line });
      }
      if (items.length >= files) { truncated = true; break; }
      for (const [file, symbols] of Object.entries(analysis.api?.symbols ?? {})) {
        for (const symbol of symbols) if (symbol.references.includes(`${path}#${name}`)) queue.push([file, symbol.name, level + 1]);
      }
      for (const [next, alias] of passOn(path, name)) queue.push([next, alias, level + 1]);
    }
  }
  return { items, truncated, limits: { depth, files } };
}
