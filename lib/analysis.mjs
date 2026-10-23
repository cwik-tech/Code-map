// Shared structural analysis for the CLI and offline viewer. No I/O or source execution.
import { missingImportNames } from './import-names.mjs';
import { ruleViolations } from './rules.mjs';
import { analyzeTests } from './test-quality.mjs';
const sorted = (values) => [...new Set(values)].sort();
const runnable = (path) => /\.(test|spec|e2e)\.[cm]?[jt]sx?$/.test(path);
const valueEdge = (edge) => edge.kind === 'value' || edge.kind === 'side-effect';

/** `extra.coverageLines` holds LCOV line hits for the test-quality check; they are not part of the result. */
export function analyzeProject(data, extra = {}) {
  const sources = new Map(data.files.map(file => [file.path, file]));
  const all = [...data.files, ...(data.testFiles ?? [])];
  const importers = new Map(), users = new Map();
  for (const file of all) {
    for (const target of file.imports) {
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target).add(file.path);
    }
    for (const [target, names] of Object.entries(file.uses ?? {})) for (const name of names) {
      const key = JSON.stringify([target, name]);
      if (!users.has(key)) users.set(key, new Set());
      users.get(key).add(file.path);
    }
  }
  const edges = data.files.flatMap(file => normalizedEdges(file));
  const internal = edges.filter(edge => sources.has(edge.target));
  const files = data.files.map(file => fileAnalysis(file, data, sources, importers, users, edges));
  const cycles = { all: cycleGroups([...sources.keys()], internal), value: cycleGroups([...sources.keys()], internal.filter(valueEdge)) };
  const hotspots = files.filter(file => file.hotspotScore > 0).map(file => ({ path: file.path, lines: file.lines, commits: file.commits, score: file.hotspotScore }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return { schemaVersion: 1, files, cycles, sharedTypes: sharedTypes(files, internal), hotspots, tests: analyzeTests(data, files, extra),
    rules: ruleViolations(data.files, data.rules ?? []), importNames: missingImportNames(data.files, data.testFiles ?? []), unsupportedFiles: data.unsupportedFiles ?? {},
    unclassifiedEdges: internal.filter(edge => edge.kind === 'unknown').length,
    limits: ['Structural signals are candidates for inspection, not observed runtime defects.',
      'Value dependencies include side effects and literal dynamic imports; calls and execution order are unproven.',
      'Nonliteral dynamic imports and dynamic wiring are unresolved. Test imports do not prove assertions or execution.',
      'Hook metrics count imported React hooks and useX-named custom hook candidates, including nested callbacks.',
      'Primitive/vendor classification is a path heuristic for components/ui and components/ai-elements.',
      'Test quality finds missing failure tests by pattern; it cannot judge whether an existing test checks the correct behavior.'] };
}

function normalizedEdges(file) {
  const edges = (file.edges ?? []).map(edge => ({ source: file.path, ...edge }));
  for (const target of file.imports) if (!edges.some(edge => edge.target === target)) edges.push({
    source: file.path, target, specifier: null, kind: 'unknown', mode: 'unknown', line: null, typeNames: [], valueNames: [],
  });
  return edges;
}

function fileAnalysis(file, data, sources, importers, users, edges) {
  const sourceImporters = sorted([...(importers.get(file.path) ?? [])].filter(path => sources.has(path)));
  const exportDetails = file.exportDetails ?? file.exports.map(name => ({ name, category: 'unknown', line: null, localReferences: null }));
  const exports = exportDetails.map(item => {
    const consumers = sorted([...(users.get(JSON.stringify([file.path, item.name])) ?? []), ...(users.get(JSON.stringify([file.path, '*'])) ?? [])]);
    return { ...item, consumers, usage: item.name === '*' ? 'unknown' : consumers.some(path => sources.has(path)) ? 'source' : consumers.length ? 'test-only'
      : (importers.get(file.path)?.size ?? 0) ? 'unreferenced' : 'entry-point' };
  });
  // References between declarations feed the test-quality links only; reports keep the compact metrics.
  const metricsOf = (d) => { const { references, ...metrics } = d.metrics ?? { lines: d.end - d.start + 1, internalDependencies: [], hookCalls: [], failureExits: [] }; return metrics; };
  const flatten = (list, parent = '') => list.flatMap(d => [{ name: parent + d.name, kind: d.kind, start: d.start, end: d.end,
    planned: d.planned, exported: d.exported, ...metricsOf(d) },
    ...flatten(d.children ?? [], parent + d.name + '.')]);
  const commits = data.coChanges?.changes?.[file.path] ?? 0;
  return { path: file.path, lines: file.lines, commits, hotspotScore: commits * file.lines,
    vendorCandidate: /(?:^|\/)components\/(?:ui|ai-elements)\//.test(file.path),
    imports: edges.filter(edge => edge.source === file.path), importers: sourceImporters,
    tests: reachableTests(file.path, data.testFiles ?? [], importers), exports, declarations: flatten(file.declarations),
    coChanges: (data.coChanges?.partners?.[file.path] ?? []).filter(([path]) => sources.has(path)).map(([path, shared]) => ({
      path, shared, own: commits, linked: file.imports.includes(path) || sources.get(path).imports.includes(file.path),
    })) };
}

function reachableTests(start, tests, importers) {
  const named = tests.filter(test => runnable(test.path));
  const known = new Set((named.length ? named : tests).map(test => test.path));
  const distances = new Map([[start, 0]]), queue = [start];
  for (let index = 0; index < queue.length; index++) for (const path of importers.get(queue[index]) ?? []) {
    if (distances.has(path)) continue;
    distances.set(path, distances.get(queue[index]) + 1); queue.push(path);
  }
  return { direct: [...distances].filter(([path, distance]) => known.has(path) && distance === 1).map(([path]) => path).sort(),
    transitive: [...distances].filter(([path, distance]) => known.has(path) && distance > 1).map(([path]) => path).sort() };
}

// Iterative Kosaraju traversal also handles long chains without overflowing the JS call stack.
function cycleGroups(paths, edges) {
  const out = new Map(paths.map(path => [path, new Set()])), incoming = new Map(paths.map(path => [path, new Set()]));
  for (const edge of edges) { out.get(edge.source).add(edge.target); incoming.get(edge.target).add(edge.source); }
  const seen = new Set(), order = [];
  for (const path of [...paths].sort()) {
    const stack = [[path, false]];
    while (stack.length) {
      const [current, finished] = stack.pop();
      if (finished) { order.push(current); continue; }
      if (seen.has(current)) continue;
      seen.add(current); stack.push([current, true]);
      for (const next of out.get(current)) if (!seen.has(next)) stack.push([next, false]);
    }
  }
  seen.clear();
  const groups = [];
  for (const path of order.reverse()) {
    if (seen.has(path)) continue;
    const group = [], stack = [path]; seen.add(path);
    while (stack.length) {
      const current = stack.pop(); group.push(current);
      for (const next of incoming.get(current)) if (!seen.has(next)) { seen.add(next); stack.push(next); }
    }
    if (group.length > 1 || out.get(path).has(path)) {
      const members = new Set(group);
      groups.push({ files: group.sort(), edges: edges.filter(edge => members.has(edge.source) && members.has(edge.target)) });
    }
  }
  return groups.sort((a, b) => a.files[0].localeCompare(b.files[0]));
}

function sharedTypes(files, edges) {
  const byPath = new Map(files.map(file => [file.path, file])), candidates = new Map();
  for (const edge of edges) {
    const reverse = edges.find(other => other.source === edge.target && other.target === edge.source && valueEdge(other));
    if (!reverse) continue;
    for (const name of edge.typeNames) {
      const declaration = byPath.get(edge.target).exports.find(item => item.name === name && (item.category === 'type' || item.typeOnly));
      if (!declaration) continue;
      const key = JSON.stringify([edge.target, name]);
      if (!candidates.has(key)) candidates.set(key, { owner: edge.target, name, line: declaration.line, consumers: [] });
      const consumers = candidates.get(key).consumers;
      if (!consumers.some(item => item.path === edge.source && item.line === edge.line)) consumers.push({ path: edge.source, line: edge.line, parentImportLine: reverse.line });
    }
  }
  return [...candidates.values()].sort((a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name));
}

// This self-contained selector is also embedded in the offline HTML; analysis runs only in Node.
// `summarize` (summarizeTests) summarizes a scoped selection; without it a report keeps the project summary.
export function createReport(data, selection = {}, summarize = null) {
  const analysis = data.analysis;
  if (!analysis) throw new Error('Analysis is missing from this map');
  const requested = [...(selection.files ?? [])];
  if (selection.change) {
    const changes = { latest: data.changes?.commits?.[0]?.files, branch: data.changes?.base?.files, uncommitted: data.changes?.uncommitted };
    if (!Object.hasOwn(changes, selection.change)) throw new Error('Unknown change selection: ' + selection.change);
    if (!changes[selection.change]) throw new Error('Change selection is unavailable in this snapshot: ' + selection.change);
    requested.push(...changes[selection.change]);
  }
  const selected = new Set(requested), scoped = !!selection.change || requested.length > 0;
  const known = new Set(analysis.files.map(file => file.path));
  const missing = [...selected].filter(path => !known.has(path)).sort();
  const invalid = (selection.files ?? []).filter(path => !known.has(path));
  if (invalid.length) throw new Error('Files are not mapped source files: ' + invalid.join(', '));
  const files = analysis.files.filter(file => (!scoped || selected.has(file.path)) && (selection.includeVendors !== false || !file.vendorCandidate));
  const paths = new Set(files.map(file => file.path));
  const relevant = (group) => !scoped || group.files.some(path => paths.has(path));
  const tests = analysis.tests;
  const units = tests ? tests.units.filter(unit => !scoped || paths.has(unit.path)) : [];
  const caseIds = new Set(units.flatMap(unit => [...unit.direct, ...unit.viaCases.map(item => item.id)]));
  const cases = tests ? tests.cases.filter(item => !scoped || caseIds.has(item.id)) : [];
  const casePaths = new Set(cases.map(item => item.path));
  const rules = analysis.rules ?? { declared: [], invalid: [], violations: [] };
  return { schemaVersion: analysis.schemaVersion,
    snapshot: { project: data.project, ref: data.ref, sha: data.sha, generatedAt: data.generatedAt ?? null, workingTree: data.coverageSnapshot === 'working-tree' },
    selection: { files: [...paths].sort(), change: selection.change ?? null, missing },
    summary: { sourceFiles: analysis.files.length, selectedFiles: files.length, cycles: { all: analysis.cycles.all.length, value: analysis.cycles.value.length },
      sharedTypes: analysis.sharedTypes.length, unclassifiedEdges: analysis.unclassifiedEdges, ruleViolations: rules.violations.length },
    files, cycles: { all: analysis.cycles.all.filter(relevant), value: analysis.cycles.value.filter(relevant) },
    sharedTypes: analysis.sharedTypes.filter(item => !scoped || paths.has(item.owner) || item.consumers.some(consumer => paths.has(consumer.path))),
    hotspots: analysis.hotspots.filter(item => !scoped || paths.has(item.path)).slice(0, 10),
    rules: { declared: rules.declared, invalid: rules.invalid, violations: rules.violations.filter(item => !scoped || paths.has(item.from) || paths.has(item.to)) },
    testSummary: !tests ? null : scoped && summarize ? summarize(tests, { paths: [...paths].sort(), label: 'selection' }) : tests.summary,
    tests: !tests ? null : { units, cases, testFiles: tests.testFiles.filter(file => !scoped || casePaths.has(file.path)), fixCommits: tests.fixCommits,
      unreadable: scoped ? [] : tests.unreadable, coverage: tests.coverage, labels: tests.labels },
    limits: analysis.limits };
}
