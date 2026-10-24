// Informational views of bound coverage. These views never supply new rating conditions.
import { unquotePath } from './git.mjs';
const kinds = ['lines', 'statements', 'branches', 'functions'];
const sum = () => ({ covered: 0, total: 0 });
const page = (items, { offset = 0, limit = 50 } = {}) => {
  offset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  limit = Number.isSafeInteger(limit) && limit >= 0 ? Math.min(limit, 50) : 50;
  return { total: items.length, offset, limit, nextOffset: offset + limit < items.length && limit > 0 ? offset + limit : null, details: items.slice(offset, offset + limit) };
};
const merge = (maps) => {
  const result = new Map();
  for (const map of maps) for (const [key, value] of map ?? []) {
    const item = typeof value === 'number' ? { count: value } : value;
    if (!result.has(key) || item.count > result.get(key).count) result.set(key, item);
  }
  return result;
};

/** Merge reports by source location. Prefer Istanbul branches and functions, as changedCoverage does. */
export function measuredFiles(reports) {
  const paths = [...new Set(reports.flatMap((report) => [...report.files.keys()]))].sort();
  return new Map(paths.map((path) => {
    const json = reports.filter((r) => r.kind === 'istanbul-json').map((r) => r.files.get(path)).filter(Boolean);
    const lcov = reports.filter((r) => r.kind === 'lcov').map((r) => r.files.get(path)).filter(Boolean);
    const branches = json.length ? merge(json.map((r) => r.branches)) : merge(lcov.map((r) => new Map([...r.branches].map(([key, b]) => [key, { key, from: b.line, to: b.line, count: b.taken }]))));
    return [path, { lines: lcov.length ? merge(lcov.map((r) => r.lines)) : null, statements: json.length ? merge(json.map((r) => r.statements)) : null,
      branches, functions: json.length ? merge(json.map((r) => r.functions)) : lcov.some((r) => r.functions) ? merge(lcov.map((r) => r.functions)) : null }];
  }));
}

/** Whole-report totals and capped file pages. Null denotes an unavailable measure. */
export function projectCoverage(reports, options) {
  const totals = Object.fromEntries(kinds.map((kind) => [kind, null]));
  const files = [...measuredFiles(reports)].map(([path, data]) => {
    const item = { path };
    for (const kind of kinds) {
      item[kind] = data[kind] === null ? null : sum();
      for (const value of data[kind]?.values() ?? []) { item[kind].total++; if (value.count > 0) item[kind].covered++; }
      if (item[kind]) { totals[kind] ??= sum(); totals[kind].total += item[kind].total; totals[kind].covered += item[kind].covered; }
    }
    return item;
  });
  return { totals, files: page(files, options), coordinates: 'LCOV records are already in source coordinates.' };
}

/** Match function starts by column when both sources have columns. Name agreement alone does not resolve a collision. */
export function functionMatch(fn, candidates, siblings) {
  const sameLine = candidates.filter((item) => item.start === fn.line);
  const columns = Number.isInteger(fn.column) && sameLine.every((item) => Number.isInteger(item.column));
  const matches = columns ? sameLine.filter((item) => item.column === fn.column) : sameLine;
  const competing = siblings.filter((item) => item.line === fn.line && (!columns || !Number.isInteger(item.column) || item.column === fn.column));
  const join = !sameLine.length ? 'missing' : matches.length !== 1 || competing.length > 1 ? 'ambiguous' : 'exact';
  return { join, match: join === 'exact' ? matches[0] : null };
}

/** Exported functions with exact measured joins and zero hits. Missing counters never mean zero hits. */
export function executedExports(reports, functions, options) {
  const details = [];
  let measured = 0;
  for (const [path, file] of measuredFiles(reports)) {
    const siblings = [...(file.functions?.values() ?? [])], candidates = functions.filter((fn) => fn.path === path);
    for (const fn of siblings) {
      const { match } = functionMatch(fn, candidates, siblings);
      if (!match?.exported) continue;
      measured++;
      if (fn.count === 0) details.push({ path, name: match.name, line: fn.line });
    }
  }
  return { evidence: 'measured function hits', measured, ...page(details, options) };
}

/** Parse zero-context diff hunks into adjusted line maps, including rename paths. */
function adjustments(patch) {
  const files = [];
  let file = null, oldLeft = 0, newLeft = 0;
  const path = (text) => { const name = unquotePath(text.endsWith('\t') ? text.slice(0, -1) : text); return /^[ab]\//.test(name) ? name.slice(2) : null; };
  for (const line of patch.split('\n')) {
    if (oldLeft || newLeft) {
      if (line[0] === '\\') continue;
      if (line[0] === '-') { oldLeft--; continue; }
      if (line[0] === '+') { newLeft--; continue; }
      if (line[0] === ' ' || line === '') { oldLeft--; newLeft--; continue; }
      oldLeft = newLeft = 0;
    }
    if (line.startsWith('diff ')) { file = { base: null, head: null, hunks: [] }; files.push(file); }
    else if (file && line.startsWith('rename from ')) file.base = unquotePath(line.slice(12));
    else if (file && line.startsWith('rename to ')) file.head = unquotePath(line.slice(10));
    else if (file && line.startsWith('--- ')) file.base = path(line.slice(4));
    else if (file && line.startsWith('+++ ')) file.head = path(line.slice(4));
    else {
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (file && hunk) { oldLeft = Number(hunk[2] ?? 1); newLeft = Number(hunk[4] ?? 1); file.hunks.push({ old: Number(hunk[1]), count: oldLeft, head: Number(hunk[3]), added: newLeft }); }
    }
  }
  return files;
}
function adjusted(line, hunks) {
  let delta = 0;
  for (const h of hunks) {
    if (h.count === 0) { if (line > h.old) delta += h.added; continue; }
    if (line < h.old) break;
    if (line < h.old + h.count) return null;
    delta += h.added - h.count;
  }
  return line + delta;
}


function unchanged(from, to, hunks) {
  return !hunks.some((h) => h.count === 0 ? h.old >= from && h.old < to : h.old <= to && h.old + h.count > from);
}
function branchKey(key, value, hunks) {
  const match = /^(\d+):[^-]+-(\d+):/.exec(key);
  const from = match ? Number(match[1]) : value.from, to = match ? Number(match[2]) : value.to;
  if (!unchanged(Math.min(from, value.from), Math.max(to, value.to), hunks)) return null;
  const start = adjusted(from, hunks), end = adjusted(to, hunks);
  if (start === null || end === null) return null;
  return key.replace(/^\d+:/, `${start}:`).replace(/-(\d+):/, `-${end}:`);
}

/** Coverage lost on unchanged lines. Absent head counters remain unmeasured, never lost coverage. */
export function coverageLoss(patch, baseReports, headReports, options) {
  const base = measuredFiles(baseReports), head = measuredFiles(headReports), details = [], totals = { lines: 0, branches: 0 };
  for (const file of adjustments(patch)) {
    const before = base.get(file.base), after = head.get(file.head);
    if (!before || !after) continue;
    const lines = [], branches = [];
    for (const [line, value] of before.lines ?? []) {
      const mapped = adjusted(line, file.hunks);
      if (value.count > 0 && mapped !== null && after.lines?.get(mapped)?.count === 0) lines.push({ base: line, head: mapped });
    }
    for (const [key, value] of before.branches) {
      const mapped = adjusted(value.from, file.hunks);
      // LCOV IDs are matched only within an unchanged source line. Istanbul keys include source columns.
      const mappedKey = branchKey(key, value, file.hunks);
      if (mapped !== null && mappedKey !== null && value.count > 0 && after.branches.get(mappedKey)?.count === 0) branches.push({ base: value.from, head: mapped, key: mappedKey });
    }
    totals.lines += lines.length; totals.branches += branches.length;
    if (lines.length || branches.length) details.push({ path: file.head, lines: lines.slice(0, 20), branches: branches.slice(0, 20), lineTotal: lines.length, branchTotal: branches.length });
  }
  return { label: 'coverage lost on unchanged lines', totals, files: page(details, options), comparable: baseReports.length > 0 && headReports.length > 0 };
}

/** Functions from analysis records, with declaration export flags and instrumenter start columns. */
export function coverageFunctions(files) {
  const functions = [];
  const add = (path, name, record, exported = false) => {
    if (record.cyclomatic !== undefined) functions.push({ path, name, start: record.start, end: record.end, column: record.column, exported });
    for (const child of record.functions ?? []) add(path, `${name}/${child.name}`, child);
  };
  for (const file of files) {
    const exported = new Set((file.exports ?? []).filter((item) => !item.typeOnly).map((item) => item.localName ?? item.name));
    const publicDeclaration = (declaration) => declaration.exported === true || exported.has(declaration.name);
    for (const declaration of file.declarations) {
      const parent = file.declarations.find((item) => declaration.name.startsWith(`${item.name}.`));
      const visible = publicDeclaration(declaration) && (!parent || publicDeclaration(parent));
      if (declaration.complexity) add(file.path, declaration.name, declaration.complexity, visible);
    }
  }
  return functions;
}
