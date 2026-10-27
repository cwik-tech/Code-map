// Information from the bound test reports of a verification run (C19, C10). A flaky case passed in one head report and failed
// in another attempt of the same run: the same kind, command, working folder, tools and environment. A slower case takes more
// than twice its time in the base report of the same run, and more than 100 ms more. A discovery report gives the test files
// and cases that the runner found, and the results show which of them ran. No check of the rule set reads this information,
// and a passed attempt never replaces a failed one: each failed case of each head report stays a failure. Pure.

import { compareEnvironments, testRunIdentity as runOf } from './run-compatibility.mjs';
import { attestDiscovery, discoveryName, matchesDiscovery } from './test-discovery.mjs';

const shown = 50, slowFactor = 2, slowMs = 100;
const keyOf = (item, file = item.file) => JSON.stringify([file, item.suite ?? null, item.name]);
const failed = (item) => item.status === 'failed' || item.status === 'errored', ran = (item) => item.status !== 'skipped';
const listed = (entries) => ({ total: entries.length, entries: entries.slice(0, shown) });
const sorted = (entries) => entries.map((entry) => [keyOf(entry), entry]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, entry]) => entry);
const caseOf = (item, file = item.file) => ({ file, suite: item.suite ?? null, name: item.name });

/** Stable positions include skipped and untimed cases. */
function positioned(cases, rename = (file) => file) {
  const counts = new Map();
  return cases.map((item) => {
    const file = item.file === null ? null : rename(item.file), identity = keyOf(item, file), ordinal = counts.get(identity) ?? 0;
    counts.set(identity, ordinal + 1);
    return { item, file, key: `${identity}#${ordinal}` };
  });
}

/** The reports of each run identity. A report without a run has no other attempt. */
function runs(reports) {
  const groups = new Map();
  for (const report of reports) {
    const run = runOf(report) ?? Symbol('alone');
    groups.set(run, [...(groups.get(run) ?? []), report]);
  }
  return groups;
}

/**
 * The cases that passed in one head report and failed in another report of the same run. Two cases with the same file, suite
 * and name in a JSON report are separate cases. Repeated JUnit identities with mixed outcomes are conservatively flaky.
 */
function flakyCases(heads) {
  const entries = [];
  for (const group of runs(heads).values()) {
    const seen = new Map();
    for (const report of group) {
      for (const { item, key } of positioned(report.cases)) {
        if (!ran(item)) continue;
        const identity = report.kind === 'junit' ? keyOf(item) : key;
        const entry = seen.get(identity) ?? { ...caseOf(item), passed: 0, failed: 0, artifacts: new Set() };
        seen.set(identity, entry);
        entry[failed(item) ? 'failed' : 'passed']++;
        entry.artifacts.add(report.artifact);
      }
    }
    for (const entry of seen.values()) if (entry.passed && entry.failed) entries.push({ ...entry, artifacts: [...entry.artifacts].sort() });
  }
  return sorted(entries);
}

/** The fastest head attempt of a case against its slowest attempt in the base reports of the same run, in milliseconds. */
function slowerCases(heads, bases, rename) {
  const entries = [];
  for (const [run, group] of runs(heads)) {
    const others = typeof run === 'string' ? bases.filter((report) => runOf(report) === run) : [];
    if (!others.length) continue;
    const before = new Map(), after = new Map();
    for (const report of others) for (const { item, key } of positioned(report.cases, rename)) {
      if (!ran(item) || typeof item.duration !== 'number') continue;
      before.set(key, Math.max(before.get(key) ?? 0, item.duration));
    }
    for (const report of group) for (const { item, key } of positioned(report.cases)) {
      if (!ran(item) || typeof item.duration !== 'number' || item.duration >= (after.get(key)?.headMs ?? Infinity)) continue;
      after.set(key, { ...caseOf(item), headMs: item.duration });
    }
    for (const [key, entry] of after) {
      const baseMs = before.get(key);
      if (baseMs !== undefined && entry.headMs > slowFactor * baseMs && entry.headMs - baseMs > slowMs) entries.push({ ...caseOf(entry), baseMs, headMs: entry.headMs });
    }
  }
  return sorted(entries);
}

/** One outcome per case and run. Failures take priority over passes, and passes over skips across attempts. */
function caseOutcomes(reports, rename = (file) => file) {
  const cases = new Map(), priority = { skipped: 0, passed: 1, failed: 2 };
  for (const report of reports) for (const item of report.cases) {
    const file = item.file === null ? null : rename(item.file), key = keyOf(item, file);
    const status = failed(item) ? 'failed' : item.status;
    if (!cases.has(key) || priority[status] > priority[cases.get(key).status]) cases.set(key, { ...caseOf(item, file), status, originalFile: item.file });
  }
  return cases;
}

/** Changed outcomes across paired runs. A missing case is absent from every paired report of that side. */
function changedOutcomes(heads, bases, rename, deleted) {
  const entries = [], counts = {};
  let paired = false, hasCases = false;
  for (const [run, group] of runs(heads)) {
    const others = typeof run === 'string' ? bases.filter((report) => runOf(report) === run) : [];
    if (!others.length) continue;
    paired = true;
    const before = caseOutcomes(others, rename), after = caseOutcomes(group);
    hasCases ||= before.size > 0 || after.size > 0;
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const base = before.get(key), head = after.get(key), baseStatus = base?.status ?? 'missing', headStatus = head?.status ?? 'missing';
      if (baseStatus === headStatus) continue;
      const transition = `${baseStatus}>${headStatus}`;
      counts[transition] = (counts[transition] ?? 0) + 1;
      entries.push({ ...caseOf(head ?? base), baseStatus, headStatus, deleted: headStatus === 'missing' && deleted.has(base.originalFile) });
    }
  }
  return { state: hasCases ? 'COMPARED' : 'UNKNOWN', ...(!hasCases ? { reason: paired
    ? 'The paired reports have no test cases.' : 'No bound base and head reports have the same run identity.' } : {}),
    counts, ...listed(sorted(entries)), ...(paired ? { basePassesLost: listed(sorted(entries.filter((entry) =>
      entry.baseStatus === 'passed' && (entry.headStatus === 'skipped' || entry.headStatus === 'missing')))) } : {}) };
}

/**
 * The denominator of the head run: the union of the files of the discovery reports, and the cases of the vitest lists (a case
 * that two lists name counts once). A file or a case ran when a bound head test report has a case of it that is not skipped.
 * A head case without a file that is not skipped can be from any file, and `unnamedCases` counts these cases.
 */
function discovered(discovery, heads) {
  if (!discovery.length) return null;
  const files = [...new Set(discovery.flatMap((report) => report.files))].sort(), lists = discovery.filter((report) => report.cases !== null);
  const ranFiles = new Set(), ranCases = new Map();
  let unnamed = 0;
  for (const report of heads) {
    const matched = discovery.filter((list) => !list.run || matchesDiscovery(list, report));
    if (!matched.length) continue;
    const selectedFiles = new Set(matched.flatMap((list) => list.files));
    const selectedCases = new Set(matched.flatMap((list) => list.cases ?? []).map((item) => JSON.stringify([item.file, item.name])));
    const ordinals = new Map();
    for (const item of report.cases) {
      const names = [...new Set(matched.map((list) => discoveryName(item, list.kind)))];
      if (ran(item) && item.file === null) unnamed++;
      if (ran(item) && selectedFiles.has(item.file)) ranFiles.add(item.file);
      for (const name of names) {
        const key = JSON.stringify([item.file, name]), ordinal = ordinals.get(key) ?? 0;
        ordinals.set(key, ordinal + 1);
        if (!ran(item) || item.file === null || !selectedCases.has(key)) continue;
        const positions = ranCases.get(key) ?? new Set();
        positions.add(ordinal);
        ranCases.set(key, positions);
      }
    }
  }
  const counts = new Map();
  for (const report of lists) {
    const own = new Map();
    for (const item of report.cases) { const key = JSON.stringify([item.file, item.name]); own.set(key, (own.get(key) ?? 0) + 1); }
    for (const [key, count] of own) counts.set(key, Math.max(counts.get(key) ?? 0, count));
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const missed = [];
  for (const [key, count] of counts) for (let ordinal = 0; ordinal < count; ordinal++) {
    if (!ranCases.get(key)?.has(ordinal)) missed.push(JSON.parse(key).join(' > '));
  }
  const ranPaths = files.filter((path) => ranFiles.has(path)), notRanPaths = files.filter((path) => !ranFiles.has(path));
  return { reports: discovery.map((report) => report.artifact), filtered: discovery.some((report) => report.filtered),
    files: { total: files.length, ran: ranPaths.length, notRan: notRanPaths.length, ranPaths: ranPaths.slice(0, shown), notRanPaths: notRanPaths.slice(0, shown) },
    cases: lists.length ? { total, ran: total - missed.length, notRan: missed.length, notRanNames: missed.slice(0, shown) } : null, unnamedCases: unnamed };
}

/**
 * The changed outcomes, flaky cases, slower cases and discovered inventory of one verification run. `reports` are the eligible test
 * reports of loadReports, `discovery` its eligible discovery reports of the head, and `files` the changed files (for renames).
 * Each list keeps at most 50 entries, with the total.
 */
export function testRuns(reports, discovery, files) {
  const moves = new Map(files.filter((file) => file.status === 'R' && file.from).map((file) => [file.from, file.path]));
  const comparisons = reports.head.flatMap((head, index) => [
    ...reports.base.map((other) => ({ other, side: 'base' })),
    ...reports.head.slice(0, index).map((other) => ({ other, side: 'head' })),
  ].filter(({ other }) => head.kind === other.kind).map(({ other, side }) =>
    ({ head: head.artifact, other: other.artifact, side, ...compareEnvironments(head.run?.environment, other.run?.environment) })));
  const deleted = new Set(files.filter((file) => file.status === 'D').map((file) => file.path));
  const outcomes = changedOutcomes(reports.head, reports.base, (path) => moves.get(path) ?? path, deleted);
  return { outcomes, comparisons: listed(comparisons), flaky: listed(flakyCases(reports.head)), slower: listed(slowerCases(reports.head, reports.base, (path) => moves.get(path) ?? path)), discovery: discovered(discovery.filter((item) => !item.side || item.side === 'head'), reports.head),
    ...(discovery.length ? { discoveryAttestations: discovery.map((list) => attestDiscovery(list, reports)) } : {}) };
}
