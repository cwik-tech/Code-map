// Coverage of the changed code for code-map verify: the changed lines of the head from a `git diff -U0` patch, and the records of
// the bound coverage reports of the head for those lines. Only the DA records of LCOV give line coverage, and only Istanbul JSON
// gives statement coverage. Both kinds give branches and functions. Pure: the caller runs Git and reads the files (C11 to C14).
import { isAbsolute, posix, relative, sep } from 'node:path';
import { parseIstanbul } from './adapters/istanbul.mjs';
import { parseLcov } from './coverage.mjs';
import { unquotePath } from './git.mjs';
import { remapEntry } from './source-map.mjs';
import { functionMatch } from './coverage-evidence.mjs';

/** The results keep the first 50 files and, for each file, the first 20 uncovered lines, branches and statements and the first 20 changed functions. */
const shownFiles = 50, shownItems = 20;
const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const byPath = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);
const istanbulKind = 'istanbul-json';

/** The head path of a "+++ " line: "b/<path>", C-quoted when Git quotes it, and with a tab after a name with a space. null for /dev/null. */
function headPath(text) {
  const name = unquotePath(text.endsWith('\t') ? text.slice(0, -1) : text);
  return name.startsWith('b/') ? name.slice(2) : null;
}

/**
 * Map(path -> head line numbers) of each file in a patch of `git diff -U0 --src-prefix=a/ --dst-prefix=b/`. Only a "+" line of a
 * hunk is a changed line. A context line (" ", or "" with diff.suppressBlankEmpty) is not, for example when the Git setting
 * diff.interHunkContext joins two hunks. The line counts of a hunk mark its end, so an added line that starts with "++ " is not
 * a file header. A file without a hunk, for example a pure rename, is not in the map.
 */
export function diffLines(patch) {
  const files = new Map();
  let path = null, numbers = null, next = 0, oldLeft = 0, newLeft = 0;
  for (const line of patch.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      const mark = line[0];
      if (mark === '\\') continue;
      if (mark === '+' && newLeft > 0) { numbers?.push(next); next++; newLeft--; continue; }
      if (mark === '-' && oldLeft > 0) { oldLeft--; continue; }
      if ((mark === ' ' || line === '') && oldLeft > 0 && newLeft > 0) { next++; oldLeft--; newLeft--; continue; }
      oldLeft = newLeft = 0;
    }
    if (line.startsWith('diff ')) path = null;
    else if (line.startsWith('+++ ')) path = headPath(line.slice(4));
    else {
      const match = hunk.exec(line);
      if (!match) continue;
      [oldLeft, next, newLeft] = [Number(match[1] ?? 1), Number(match[2]), Number(match[3] ?? 1)];
      numbers = path === null ? null : files.get(path) ?? [];
      if (numbers) files.set(path, numbers);
    }
  }
  return files;
}

/**
 * The places of the paths in a coverage report. A relative path is relative to the working directory of the run. An absolute one
 * is relative to `repository`, or else to it after `real` resolves its links. `place` gives null for a path outside the repository,
 * and `outside` counts those paths. An empty path is not a path outside the repository.
 */
function placer({ repository, workingDirectory = '.', real = (path) => path }) {
  const inside = (path) => (path === '.' || path === '..' || path.startsWith('../') || posix.isAbsolute(path) ? null : path);
  const fromRoot = (name) => inside(relative(repository, name).split(sep).join('/'));
  const paths = { outside: 0 };
  paths.place = (name) => {
    if (name.length === 0 || name.includes('\0')) return null;
    const windows = /^[A-Za-z]:[\\/]/.test(name) && !isAbsolute(name);
    const path = windows ? null : isAbsolute(name) ? fromRoot(name) ?? fromRoot(real(name)) : inside(posix.normalize(posix.join(workingDirectory, name.replaceAll('\\', '/'))));
    if (path === null) paths.outside++;
    return path;
  };
  return paths;
}

/** Keeps one item for each key. The item with the higher count wins, so two reports of one file cover what either one covers. */
const keep = (map, key, item) => { const old = map.get(key); if (!old || item.count > old.count) map.set(key, old ? { ...old, count: item.count } : item); };

/**
 * The records of an untrusted LCOV report by repository-relative path: Map(path -> { lines: Map(line -> hits), branches:
 * Map("line:block:branch" -> { line, taken }), functions }). The paths are placed as `placer` says, and a path outside the repository
 * is left out. Two records of one file merge: the higher count wins. `functions` is Map("line:name" -> { name, line, from, to, count })
 * from the FN and FNDA records, or null when no record of the file has an FN, FNDA or FNF record. `to` is null when FN gives no end line.
 * Two FN records with one name take the FNDA records of that name in their order, and an FN record without one ran 0 times.
 */
export function lcovCoverage(text, options) {
  const paths = placer(options), { records, ignored } = parseLcov(text, paths.place), files = new Map();
  for (const record of records) {
    const file = files.get(record.path) ?? { lines: new Map(), branches: new Map(), functions: null };
    files.set(record.path, file);
    for (const [line, hits] of record.lines) file.lines.set(line, Math.max(hits, file.lines.get(line) ?? 0));
    for (const [line, block, branch, taken] of record.branches) {
      const key = `${line}:${block}:${branch}`;
      file.branches.set(key, { line, taken: Math.max(taken, file.branches.get(key)?.taken ?? 0) });
    }
    if (!record.functions.length && !record.calls.length && record.functionsFound === undefined) continue;
    const calls = new Map(), functions = (file.functions ??= new Map());
    for (const [name, hits] of record.calls) { if (!calls.has(name)) calls.set(name, []); calls.get(name).push(hits); }
    for (const [line, end, name] of record.functions) {
      const key = `${line}:${name}`, old = functions.get(key), count = calls.get(name)?.shift() ?? 0;
      functions.set(key, { name, line, from: line, to: Math.max(end ?? 0, old?.to ?? 0) || null, count: Math.max(count, old?.count ?? 0) });
    }
  }
  return { kind: 'lcov', files, outside: paths.outside, records: records.length + ignored };
}

/**
 * The entries of an untrusted Istanbul JSON report by repository-relative path, placed as in lcovCoverage: Map(path -> { statements,
 * functions, branches }), each a Map by source location. Two entries of one file merge by location, and the higher count wins.
 * An entry with an input source map is remapped to original coordinates. Unsupported maps and unmapped ranges are counted explicitly.
 * A function spans its declaration and body. A branch path without a location uses its branch location. `error`
 * is the reason when the adapter refuses the report.
 */
export function istanbulCoverage(text, { maxBytes, remap = true, ...options }) {
  const parsed = parseIstanbul(text, { maxBytes });
  if (!parsed.ok) return { error: parsed.error };
  const paths = placer(options), files = new Map(), spot = ({ start, end }) => `${start.line}:${start.column}-${end.line}:${end.column}`;
  let sourceMapped = 0, unmapped = 0;
  const mappingErrors = [];
  const entries = parsed.report.files.flatMap((entry) => {
    if (!entry.sourceMap) return [entry];
    sourceMapped++;
    if (!remap) return [];
    const mapped = remapEntry(entry);
    unmapped += mapped.unmapped;
    if (mapped.error) mappingErrors.push({ path: entry.path, error: mapped.error });
    return mapped.files;
  });
  for (const entry of entries) {
    const path = paths.place(entry.path);
    if (path === null) continue;
    const file = files.get(path) ?? { statements: new Map(), functions: new Map(), branches: new Map() };
    files.set(path, file);
    for (const { start, end, count } of entry.statements) keep(file.statements, spot({ start, end }), { from: start.line, to: end.line, count });
    for (const { name, decl, loc, count } of entry.functions) {
      keep(file.functions, `${spot(decl)}:${name}`, { name, line: decl.start.line, column: decl.start.column, from: Math.min(decl.start.line, loc.start.line), to: Math.max(decl.end.line, loc.end.line), count });
    }
    for (const { id, type, loc, paths: arms } of entry.branches) arms.forEach(({ location, count, index: originalIndex }, index) => keep(file.branches, `${spot(loc)}:${type}:${originalIndex ?? index}`,
      { key: `${loc.start.line}:${id}:${originalIndex ?? index}`, from: (location ?? loc).start.line, to: (location ?? loc).end.line, count }));
  }
  return { kind: istanbulKind, files, outside: paths.outside, sourceMapped, unmapped, mappingErrors, records: parsed.report.files.length };
}

/** Whether a changed line (a sorted list) is in the range from `from` to `to`. */
function touches(lines, from, to) {
  let low = 0, high = lines.length;
  while (low < high) { const middle = (low + high) >> 1; if (lines[middle] < from) low = middle + 1; else high = middle; }
  return low < lines.length && lines[low] <= to;
}

/** One map with the items of each map of `maps`, by key. */
function union(maps) {
  const all = new Map();
  for (const map of maps) for (const [key, item] of map) keep(all, key, item);
  return all;
}

/**
 * The coverage of the changed code. `changed` is Map(path -> changed line numbers) of the changed code files of the head, `reports`
 * are the bound coverage reports of the head ({ artifact, kind, files, outside } from lcovCoverage or istanbulCoverage), and `functions`
 * are the functions of the head analysis with their lines ({ path, name, start, end }, from functionList).
 * - A changed line is executable when an LCOV report has a DA record for it, and covered when a count is more than 0.
 * - A statement of an Istanbul JSON report, a function or a branch path counts when its source range touches a changed line, and it
 *   ran when its count is more than 0. An LCOV branch is a BRDA record on a changed line.
 * - When an Istanbul JSON report measures a file, its branches and functions are those of the file (`source`). The LCOV branches and
 *   functions of that file do not count, so Code-map never adds the two kinds together.
 * - A changed function joins the function of the analysis with the same file and start line. The join is "ambiguous" when the analysis
 *   or the report has more than one function that starts on that line, and "missing" when the analysis has none. An LCOV FN record
 *   without an end line ends where its exactly joined function ends, or else on its start line.
 * A file with changed lines and no LCOV record is in `unmeasured`, never covered. `unmeasuredBy` gives the files that no report measures
 * for branches, statements and functions. `changedStatements` is null without an Istanbul JSON report, and `changedFunctions` is null when
 * no report gives functions of a changed file.
 */
export function changedCoverage(changed, reports, functions = []) {
  const sum = () => ({ covered: 0, total: 0 }), totals = { lines: sum(), branches: sum(), statements: sum(), functions: sum() }, joins = { exact: 0, ambiguous: 0, missing: 0 };
  const lcov = reports.filter((report) => report.kind !== istanbulKind), json = reports.filter((report) => report.kind === istanbulKind), starts = new Map();
  for (const fn of functions) if (Number.isInteger(fn.start)) { const file = starts.get(fn.path) ?? new Map(); starts.set(fn.path, file); file.set(fn.start, [...(file.get(fn.start) ?? []), fn]); }
  const count = (part, ran, onMiss) => { part.total++; if (ran) part.covered++; else onMiss?.(); };
  const files = [], unmeasured = [], unmeasuredBy = { branches: [], statements: [], functions: [] };
  let total = 0, functionData = json.length > 0;
  for (const [path, numbers] of [...changed].sort(byPath)) {
    if (!numbers.length) continue;
    total++;
    const records = lcov.map((report) => report.files.get(path)).filter(Boolean), entries = json.map((report) => report.files.get(path)).filter(Boolean);
    const wanted = [...new Set(numbers)].sort((a, b) => a - b), source = entries.length ? istanbulKind : records.length ? 'lcov' : null;
    if (!records.length) unmeasured.push(path);
    if (!entries.length) unmeasuredBy.statements.push(path);
    if (!source) { unmeasuredBy.branches.push(path); unmeasuredBy.functions.push(path); continue; }
    const file = { path, source, lines: records.length ? sum() : null, branches: sum(), statements: entries.length ? sum() : null, functions: null,
      uncoveredLines: [], uncoveredBranches: [], uncoveredStatements: [], functionJoins: [] };
    for (const number of records.length ? wanted : []) {
      const counts = records.map((record) => record.lines.get(number)).filter((hits) => hits !== undefined);
      if (counts.length) count(file.lines, counts.some((hits) => hits > 0), () => file.uncoveredLines.push(number));
    }
    const missed = new Set();
    for (const { from, to, count: ran } of union(entries.map((entry) => entry.statements)).values()) if (touches(wanted, from, to)) count(file.statements, ran > 0, () => missed.add(from));
    file.uncoveredStatements = [...missed].sort((a, b) => a - b);
    const branches = entries.length ? entries.map((entry) => entry.branches)
      : records.map((record) => new Map([...record.branches].map(([key, { line, taken }]) => [key, { key, from: line, to: line, count: taken }])));
    for (const { key, from, to, count: ran } of union(branches).values()) if (touches(wanted, from, to)) count(file.branches, ran > 0, () => file.uncoveredBranches.push(key));
    const own = entries.length ? entries.map((entry) => entry.functions) : records.map((record) => record.functions).filter(Boolean);
    if (own.length) { file.functions = sum(); functionData = true; } else unmeasuredBy.functions.push(path);
    const list = [...union(own).values()];
    for (const fn of list) {
      const { join, match } = functionMatch(fn, starts.get(path)?.get(fn.line) ?? [], list);
      if (!touches(wanted, fn.from, fn.to ?? (join === 'exact' ? Math.max(fn.line, match.end ?? fn.line) : fn.line))) continue;
      count(file.functions, fn.count > 0);
      joins[join]++;
      file.functionJoins.push({ name: fn.name, line: fn.line, covered: fn.count > 0, join, analysis: join === 'exact' ? match.name : null });
    }
    for (const kind of Object.keys(totals)) if (file[kind]) { totals[kind].covered += file[kind].covered; totals[kind].total += file[kind].total; }
    files.push(file);
  }
  return { reports: reports.map((report) => report.artifact), lineReports: lcov.map((report) => report.artifact), total, changedLines: totals.lines, changedBranches: totals.branches,
    changedStatements: json.length ? totals.statements : null, changedFunctions: functionData ? totals.functions : null, joins, files, unmeasured, unmeasuredBy,
    outside: reports.reduce((sum, report) => sum + report.outside, 0) };
}

/**
 * The coverage section of verification-results.json: covered, total, share and threshold for the changed lines and branches, the
 * changed statements and functions, which kind of report gave the branches, the files that each measure does not measure, and
 * the files. The share is a percentage with one decimal, rounded down, so that it never shows a threshold that is not met.
 * Statement coverage and function coverage have no threshold: they are information only.
 */
export function coverageSection(measure, thresholds) {
  const share = ({ covered, total }) => (total > 0 ? Math.floor((covered * 1000) / total) / 10 : null);
  const part = (sum, threshold) => ({ ...sum, share: share(sum), threshold: threshold ?? null });
  const files = (unmeasured) => ({ measured: measure.total - unmeasured.length, unmeasured: unmeasured.slice(0, shownFiles) });
  const info = (name, sum, unmeasured, extra = {}) => sum && { measure: name, ...sum, share: share(sum), files: files(unmeasured), ...extra };
  const sources = { lcov: 0, [istanbulKind]: 0 };
  for (const file of measure.files) sources[file.source]++;
  const details = measure.files.slice(0, shownFiles).map((file) => ({ ...file, uncoveredLines: file.uncoveredLines.slice(0, shownItems), uncoveredBranches: file.uncoveredBranches.slice(0, shownItems),
    uncoveredStatements: file.uncoveredStatements.slice(0, shownItems), functionJoins: file.functionJoins.slice(0, shownItems) }));
  return { measure: 'line coverage', reports: measure.reports, lineReports: measure.lineReports, changedLines: part(measure.changedLines, thresholds?.changedLines),
    changedBranches: { ...part(measure.changedBranches, thresholds?.changedBranches), sources, files: files(measure.unmeasuredBy.branches) },
    changedStatements: info('statement coverage', measure.changedStatements, measure.unmeasuredBy.statements),
    changedFunctions: info('function coverage', measure.changedFunctions, measure.unmeasuredBy.functions, { join: measure.joins }),
    files: { total: measure.total, measured: measure.total - measure.unmeasured.length, unmeasured: measure.unmeasured.slice(0, shownFiles), details }, outsideRepository: measure.outside };
}
