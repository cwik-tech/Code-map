// Cognitive complexity totals for changed files and their containing folders. No thresholds.
import { compareSymbolSizes } from './complexity-size.mjs';
import { posix } from 'node:path';
import { functionList } from './complexity.mjs';

/** Changed source paths include additions, deletions and files whose text changed. */
export function changedSourcePaths(base, head) {
  const before = new Map(base.map((file) => [file.path, file.contentDigest ?? file.source]));
  const now = new Map(head.map((file) => [file.path, file.contentDigest ?? file.source]));
  return [...new Set([...before.keys(), ...now.keys()])].filter((path) => !before.has(path) || !now.has(path) || before.get(path) !== now.get(path)).sort();
}

/** Aggregates every function once, including nested functions and unchanged folder siblings. */
export function compareAreas(base, head, changed, renames = [], complete = true) {
  const confirmed = renames.filter((item) => item.similarity > 0);
  const previous = new Map(confirmed.map(({ from, to }) => [to, from]));
  const moved = new Set(confirmed.map(({ from }) => from));
  const known = new Set([...base.files, ...head.files].map((file) => file.path));
  const relevant = [...new Set(changed)].filter((path) => known.has(path));
  const paths = relevant.filter((path) => !moved.has(path) || head.files.some((file) => file.path === path)).sort();
  const folders = new Set();
  for (const path of relevant) for (let folder = posix.dirname(path); ; folder = posix.dirname(folder)) {
    folders.add(folder); if (folder === '.') break;
  }
  const aggregate = (analysis, path, folder) => {
    const files = analysis.files.filter((file) => folder ? path === '.' || file.path.startsWith(`${path}/`) : file.path === path);
    if (!files.length) return null;
    const values = functionList(files);
    const lines = files.every((file) => Number.isFinite(file.lines)) ? files.reduce((sum, file) => sum + file.lines, 0) : undefined;
    if (values.some((fn) => fn.cognitive === undefined)) return lines === undefined ? null : { sum: null, max: null, lines };
    return values.reduce((total, fn) => ({ ...(total.lines === undefined ? {} : { lines: total.lines }), sum: total.sum + fn.cognitive, max: Math.max(total.max, fn.cognitive) }), { sum: 0, max: 0, ...(lines === undefined ? {} : { lines }) });
  };
  const row = (path, folder) => {
    const before = aggregate(base, folder ? path : previous.get(path) ?? path, folder), after = aggregate(head, path, folder);
    return { path, base: before, head: after, delta: before && after ? { sum: before.sum === null || after.sum === null ? null : after.sum - before.sum, max: before.max === null || after.max === null ? null : after.max - before.max, ...(before.lines === undefined || after.lines === undefined ? {} : { lines: after.lines - before.lines }) } : null };
  };
  return { symbols: compareSymbolSizes(base, head, changed, renames, complete), files: paths.map((path) => row(path, false)), folders: [...folders].sort().map((path) => row(path, true)) };
}
