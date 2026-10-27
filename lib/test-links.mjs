// Compare static test reachability with bound, single-test-file coverage. Information only.
// No execution count proves that a test asserted a result in the executed file.
const unavailable = 'No bound head coverage report names this single test file in its discovery filters or selection.';
const shownFiles = 50, shownLinks = 200;

/** Select only an exact known test path. Never infer it from a command, scope, case or covered path. */
function singleTest(discovery, tests) {
  if (!discovery) return null;
  const selected = discovery.selection;
  if (selected && selected.state !== 'KNOWN') return null;
  const files = [...new Set([...(selected?.files ?? []), ...discovery.filters])];
  return files.length === 1 && tests.has(files[0]) ? files[0] : null;
}

/** Static links include transitive imports through source files and test helpers. */
function reachable(start, graph, sources) {
  const seen = new Set([start]), queue = [start], links = new Set();
  for (let index = 0; index < queue.length; index++) {
    for (const target of graph.get(queue[index]) ?? []) {
      if (sources.has(target)) links.add(target);
      if (seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return links;
}

/** A test with no attributable trace stays UNKNOWN. Several traces of one test use the union of executed files. */
export function runtimeTestLinks(analysis, reports) {
  const sources = new Set(analysis.files.map((file) => file.path));
  const tests = new Set((analysis.tests?.testFiles ?? []).map((file) => file.path)), graph = new Map(), traces = new Map();
  const edges = [...analysis.files.flatMap((file) => file.imports.map((edge) => ({ ...edge, source: file.path }))), ...(analysis.api?.testImports ?? [])];
  for (const edge of edges) {
    if (!edge.target) continue;
    if (!graph.has(edge.source)) graph.set(edge.source, new Set());
    graph.get(edge.source).add(edge.target);
  }
  for (const report of reports) {
    const test = singleTest(report.discovery, tests);
    if (test === null) continue;
    const trace = traces.get(test) ?? { reports: [], executed: new Set() };
    traces.set(test, trace);
    trace.reports.push(report.artifact);
    for (const [path, counts] of report.files) {
      if (!sources.has(path)) continue;
      const executed = [...(counts.lines?.values() ?? [])].some((hits) => hits > 0)
        || [...(counts.statements?.values() ?? [])].some((statement) => statement.count > 0);
      if (executed) trace.executed.add(path);
    }
  }
  const counts = { confirmed: 0, 'not observed': 0, 'runtime only': 0 };
  const files = [...traces.keys()].sort().map((path) => {
    const trace = traces.get(path), linked = reachable(path, graph, sources);
    const links = [...new Set([...linked, ...trace.executed])].sort().map((source) => ({ path: source,
      state: linked.has(source) ? trace.executed.has(source) ? 'confirmed' : 'not observed' : 'runtime only' }));
    for (const link of links) counts[link.state] += 1;
    return { path, state: 'KNOWN', reason: null, reports: trace.reports, links: links.slice(0, shownLinks), linkTotal: links.length };
  });
  // Counts cover every traced test. The lists keep the first traced tests and links, as the other test lists do.
  return { state: traces.size ? 'KNOWN' : 'UNKNOWN', reason: traces.size ? null : unavailable, counts,
    untraced: tests.size - traces.size, total: files.length, files: files.slice(0, shownFiles) };
}
