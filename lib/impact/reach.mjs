// The change impact of a comparison (capability C07): the head files that import a changed file, directly or through other
// files, up to a fixed depth and a fixed number of files. A type-only import counts apart from a value import. A computed
// dynamic import can reach any file, so it makes the walk incomplete. A removed file has no node in the head: the walk starts
// from its old path through the head imports that still name it. Pure: the caller gives the analyses and the paths.
import { expandPatterns } from '../dynamic-patterns.mjs';
import { isTest } from '../project.mjs';

/** The walk stops at this depth and at this number of affected files. The result says which limit applied. */
export const impactLimits = { depth: 10, files: 2000 };
/** A side-effect import runs the file, so it is a value edge. An edge without a classification is unknown. */
const kindOf = (edge) => edge.kind === 'type' ? 'type' : edge.kind === 'value' || edge.kind === 'side-effect' || edge.kind === 'dynamic-pattern' ? 'value' : 'unknown';
const strength = ['type', 'unknown', 'value'];

/** The import edges of a snapshot, from its source files and its test files. */
const edgesOf = (analysis) => [...analysis.files.flatMap((file) => file.imports.map((edge) => ({ ...edge, source: file.path }))), ...(analysis.api?.testImports ?? [])];

/**
 * The head imports that still name a removed or moved file, each with `target` set to the old path: a base file imported
 * the old path, and the same head file (after `renames`) keeps that specifier, which now resolves to no file.
 */
export function removedImports(base, head, oldPaths, renames = []) {
  const gone = new Set(oldPaths), forward = new Map(renames.map((item) => [item.from, item.to])), named = new Map();
  for (const edge of edgesOf(base)) if (gone.has(edge.target) && typeof edge.specifier === 'string') named.set(`${forward.get(edge.source) ?? edge.source}\0${edge.specifier}`, edge.target);
  return edgesOf(head).filter((edge) => edge.target === null && named.has(`${edge.source}\0${edge.specifier}`))
    .map((edge) => ({ ...edge, target: named.get(`${edge.source}\0${edge.specifier}`) }));
}

/** target -> Map(importer -> kind). Several imports between two files count once, with the strongest kind. */
function reverseGraph(edges) {
  const reverse = new Map();
  for (const edge of edges) {
    if (!edge.target || edge.target === edge.source) continue;
    if (!reverse.has(edge.target)) reverse.set(edge.target, new Map());
    const importers = reverse.get(edge.target), kind = kindOf(edge), known = importers.get(edge.source);
    if (known === undefined || strength.indexOf(kind) > strength.indexOf(known)) importers.set(edge.source, kind);
  }
  return reverse;
}

/** Breadth-first from the changed files. `follow(kind)` selects the edges. The walk ends at the limits. */
function walk(reverse, seeds, limits, follow) {
  const depth = new Map(seeds.map((path) => [path, 0])), from = new Map(), queue = [...seeds], edges = { value: 0, type: 0, unknown: 0 };
  let truncated = null;
  for (let index = 0; index < queue.length && truncated?.limit !== 'files'; index++) {
    const path = queue[index], level = depth.get(path), importers = [...(reverse.get(path) ?? [])].filter(([, kind]) => follow(kind)).sort(([a], [b]) => a.localeCompare(b));
    if (level === limits.depth) {
      if (importers.some(([source]) => !depth.has(source))) truncated = { limit: 'depth', value: limits.depth };
      continue;
    }
    for (const [source, kind] of importers) {
      if (depth.has(source)) { edges[kind]++; continue; }
      if (depth.size - seeds.length >= limits.files) { truncated = { limit: 'files', value: limits.files }; break; }
      edges[kind]++;
      depth.set(source, level + 1); from.set(source, path); queue.push(source);
    }
  }
  return { depth, from, edges, truncated };
}

/** Candidate walks stay separate from definite impact and test selection. Each loader retains its own evidence. */
function computedCandidates(computed, all, reverse, nodes, limits, testPath) {
  const candidates = [], candidateTruncation = [];
  for (const edge of computed) {
    const pattern = edge.pattern ?? edge.candidatePattern;
    const expanded = pattern ? expandPatterns({ path: edge.source, edges: [{ ...edge, pattern }], imports: [], uses: {}, valueUses: {} }, [...nodes]).edges : [];
    const targets = expanded.map((item) => item.target).filter(Boolean);
    const seeds = targets.length ? targets : [edge.source];
    const graph = targets.length ? reverseGraph([...all, ...expanded]) : reverse;
    const result = walk(graph, seeds, limits, () => true);
    if (result.truncated) candidateTruncation.push({ loader: edge.source, line: edge.line, ...result.truncated });
    const rows = [...result.depth].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    for (const [path, depth] of rows) candidates.push({ path, depth, test: testPath(path), imports: result.from.get(path) ?? null,
      loader: edge.source, line: edge.line, mode: edge.mode, reason: targets.length ? 'computed-loader-pattern' : 'unresolved-computed-loader', compatibility: 'UNKNOWN' });
  }
  return { candidates, candidateTruncation };
}

/**
 * The impact of the changed head paths. `files`: the affected files (depth 1 and more), each with `depth`, `kind` (`value`
 * when a chain of value or unclassified imports reaches a changed file, else `type`), `test` and `imports` (the file that it
 * imports on a shortest chain). `tests`: the changed and affected test files. A changed one has depth 0 and kind `changed`.
 * `edges` counts the import edges that the walk followed. `changed` counts the paths by kind: other paths are not mapped.
 * `removed` (from removedImports) adds the old path of each removed file that a head file still imports as a start.
 */
export function changeImpact(analysis, paths, limits = impactLimits, removed = []) {
  const pythonTests = new Set((analysis.tests?.testFiles ?? []).filter((f) => f.path.endsWith('.py')).map((f) => f.path));
  const testPath = (path) => pythonTests.has(path) || isTest(path);
  const own = edgesOf(analysis), all = [...own, ...removed], reverse = reverseGraph(all);
  const nodes = new Set([...analysis.files.map((file) => file.path), ...(analysis.tests?.testFiles ?? []).map((file) => file.path), ...own.map((edge) => edge.source)]);
  const mapped = [...new Set(paths)].filter((path) => nodes.has(path)), starts = new Set(mapped);
  const seeds = [...new Set([...mapped, ...removed.map((edge) => edge.target)])].sort();
  const { depth, from, edges, truncated } = walk(reverse, seeds, limits, () => true);
  // A file is affected at run time when a chain without a type-only import reaches it. That walk stays inside the first one.
  const values = walk(reverse, seeds, limits, (kind) => kind !== 'type').depth;
  const item = ([path, level]) => ({ path, depth: level, kind: level === 0 ? 'changed' : values.has(path) ? 'value' : 'type', test: testPath(path), imports: from.get(path) ?? null });
  const order = (a, b) => a.depth - b.depth || a.path.localeCompare(b.path);
  const files = [...depth].filter(([, level]) => level > 0).map(item).sort(order);
  const byDepth = [];
  for (const file of files) {
    if (byDepth.at(-1)?.depth !== file.depth) byDepth.push({ depth: file.depth, files: 0, tests: 0 });
    byDepth.at(-1).files++;
    if (file.test) byDepth.at(-1).tests++;
  }
  const computed = own.filter((edge) => edge.specifier === null && edge.target === null), sources = mapped.filter((path) => !testPath(path)).length;
  return { limits, truncated, complete: truncated === null && computed.length === 0, total: files.length, byDepth,
    kinds: { value: files.filter((file) => file.kind === 'value').length, type: files.filter((file) => file.kind === 'type').length }, edges,
    ...computedCandidates(computed, all, reverse, nodes, limits, testPath),
    dynamicImports: { files: new Set(computed.map((edge) => edge.source)).size, sites: computed.length },
    changed: { sources, tests: mapped.length - sources, other: new Set(paths).size - mapped.length },
    // A removed test file is no test to run, so only a changed test file that still exists has depth 0 here.
    files, tests: [...depth].filter(([path, level]) => testPath(path) && (level > 0 || starts.has(path))).map(item).sort(order) };
}
