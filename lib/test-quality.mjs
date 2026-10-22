// Test quality: links test cases to the source functions they reference, then compares failure exits with failure checks.
// No I/O or execution. A reference is a possible call, and a pattern-matched failure check is evidence, not proof.
import { strengthRank } from './test-assertions.mjs';
import { summarizeTests } from './test-summary.mjs';

const declaredTypes = [['e2e', /^(e2e|end-to-end|playwright|cypress)$/], ['integration', /^(integration|integrations|int)$/], ['api', /^api$/],
  ['contract', /^contracts?$/], ['smoke', /^smoke$/], ['live', /^live$/], ['performance', /^(perf|performance|load|bench|benchmarks?)$/], ['unit', /^unit$/]];
const testFolder = /^(__tests__|tests?|spec|specs|e2e|cypress|playwright)$/;
const effects = {
  browser: ['@playwright/test', 'playwright', 'playwright-core', 'puppeteer', 'puppeteer-core', 'cypress', 'selenium-webdriver', 'webdriverio'],
  process: ['node:child_process', 'child_process', 'execa', 'cross-spawn', 'zx'],
  network: ['node:http', 'http', 'node:https', 'https', 'node:net', 'net', 'supertest', 'undici', 'axios', 'got', 'ws', 'node-fetch'],
  database: ['pg', 'postgres', '@prisma/client', 'mysql2', 'better-sqlite3', 'sqlite3', 'node:sqlite', 'mongodb', 'mongoose', 'redis', 'ioredis',
    '@neondatabase/serverless', 'drizzle-orm', 'kysely', '@upstash/redis', 'testcontainers'],
  filesystem: ['node:fs', 'fs', 'fs-extra', 'tmp'],
  dom: ['@testing-library/react', '@testing-library/dom', '@testing-library/vue', '@testing-library/svelte', '@testing-library/user-event', 'jsdom', 'happy-dom'],
};
const heavy = ['browser', 'process', 'network', 'database'];
const callDepth = 3, viaShown = 5;
const exitKinds = new Set(['remove-throw', 'remove-error-return', 'rethrow-in-catch', 'status-to-200', 'remove-reject', 'remove-exit', 'remove-call']);
const runnable = /\.(test|spec|e2e)\.[cm]?[jt]sx?$/;
// A name that describes a failure, unless it says the failure does not happen ("does not throw").
const failureName = /\b(fail(s|ed|ure|ing)?|errors?|throws?|thrown|rejects?|rejected|rejection|invalid|malformed|unauthori[sz]ed|forbidden|denied|refuses?|timeouts?|times? out|timed out|not found|cannot|can't|unable|wrong|bad|corrupt(ed)?|conflicts?|abort(s|ed)?|exceed(s|ed)?|unsupported|disallow(s|ed)?|illegal|crash(es)?)\b/i;
const notFailure = /\b(does not|doesn't|never|without|no)\s+(throw|fail|error|reject|crash)/i;
const regressionName = /\b(regression|regressions|issue\s*#?\d+|bug\s*#?\d+|reproduc(es|tion))\b|#\d+\b/i;

export const nameSuggestsFailure = (name) => failureName.test(name) && !notFailure.test(name);

export function analyzeTests(data, analysisFiles, extra = {}) {
  const sources = new Map(data.files.map((file) => [file.path, file]));
  const base = commonFolder(data.files.map((file) => file.path));
  const moduleOf = (path) => { const rest = base ? path.slice(base.length + 1) : path; return rest.includes('/') ? rest.split('/')[0] : '(top)'; };
  const declarations = topLevel(data.files);
  const resolveExport = exportResolver(sources, declarations);
  const resolveReference = (reference) => {
    const cut = reference.lastIndexOf('#'), path = reference.slice(0, cut), name = reference.slice(cut + 1);
    return declarations.has(reference) ? reference : name === '*' ? null : resolveExport(path, name);
  };
  const callers = new Map();
  for (const [key, item] of declarations) for (const reference of item.references) {
    const target = resolveReference(reference);
    if (!target || target === key) continue;
    if (!callers.has(target)) callers.set(target, new Set());
    callers.get(target).add(key);
  }
  const labels = data.testLabels?.files ?? {};
  const cases = [], testFiles = [], direct = new Map(), strengthFor = [];
  const stronger = (a, b) => (b === null || strengthRank[a] > strengthRank[b] ? a : b);
  for (const test of data.testFiles ?? []) {
    const scan = test.scan;
    if (!scan) continue;
    const found = new Set(test.externals ?? []);
    const used = Object.keys(effects).filter((kind) => effects[kind].some((name) => found.has(name)) || (kind === 'network' && scan.fetch));
    const reached = test.imports.filter((path) => sources.has(path));
    const declared = declaredType(test.path);
    const inferred = used.includes('browser') ? 'e2e' : used.some((kind) => heavy.includes(kind)) || new Set(reached.map(moduleOf)).size >= 3 ? 'integration' : reached.length ? 'unit' : 'unknown';
    const type = declared ?? inferred, label = labels[test.path], ids = [];
    for (const item of scan.cases) {
      const id = cases.length, full = item.suite ? `${item.suite} > ${item.name}` : item.name;
      const intent = label?.cases[full]?.intent ?? null;
      const evidence = item.failures.length ? 'assertion' : item.assertions > 0 && nameSuggestsFailure(item.name) ? 'name' : null;
      const smells = item.status === 'active' && item.assertions === 0 && !item.plan && item.subtests === 0 ? [...item.smells, 'no-assertions'] : [...item.smells];
      const called = [...new Set(item.references.map(resolveReference).filter(Boolean))];
      // A check counts only for the functions that it names, and only when it runs without a condition.
      const tie = (check) => check.conditional ? [] : check.targets.map(resolveReference).filter(Boolean);
      const targets = new Set(item.failures.flatMap(tie));
      const tied = {}; // the strictest check that each function gets from this case
      for (const check of item.checks) for (const key of tie(check)) tied[key] = stronger(check.strength, tied[key] ?? null);
      strengthFor[id] = tied;
      const best = item.checks.reduce((top, check) => stronger(check.strength, top), null), strengths = {};
      for (const check of item.checks) strengths[check.strength] = (strengths[check.strength] ?? 0) + 1;
      const all = (strength) => item.checks.length > 0 && item.checks.every((check) => check.strength === strength);
      smells.push(...(best !== null && strengthRank[best] <= strengthRank.weak ? ['weak-only'] : []), ...(all('snapshot') ? ['snapshot-only'] : []),
        ...(all('call') ? ['call-only'] : []), ...(strengths.tautology ? ['tautology'] : []));
      cases.push({ id, path: test.path, name: item.name, suite: item.suite, line: item.line, status: item.status, focus: item.focus, each: item.each, type,
        assertions: item.assertions, failures: item.failures.length, kinds: [...new Set(item.failures.map((failure) => failure.kind))],
        failureLine: item.failures[0]?.line ?? null, failureTargets: [...targets].sort(), strength: best, strengths, evidence, smells, intent, intentState: intent ? label.status : null,
        regression: regressionName.test(full) || intent === 'regression' });
      ids.push(id);
      if (item.status === 'skipped' || item.status === 'todo') continue; // parked tests are inventory, never evidence
      for (const key of called) {
        if (!direct.has(key)) direct.set(key, []);
        direct.get(key).push(id);
      }
    }
    const kind = ids.length ? 'tests' : runnable.test(test.path) ? 'unrecognized' : 'helper';
    testFiles.push({ path: test.path, kind, framework: scan.framework, declared, inferred, type, effects: used, mocks: scan.mocks.length, sources: reached.length, cases: ids,
      mismatch: declared === 'unit' && used.some((name) => heavy.includes(name)) });
  }
  // Only a case that surely runs can be evidence; a conditional case (skipIf, `skip: condition`) stays a candidate.
  const runs = (id) => cases[id].status === 'active' || cases[id].status === 'focused';
  const checks = (id, key) => runs(id) && cases[id].failureTargets.includes(key);
  const candidate = (id) => cases[id].evidence !== null || (cases[id].intent === 'unhappy' && cases[id].intentState === 'current');
  const lineHits = coverageLines(data, extra.coverageLines, extra.coverageBranches);
  const affects = affectedCounter(data.files);
  const units = [];
  for (const [key, item] of declarations) {
    const ownSet = new Set(direct.get(key) ?? []), own = [...ownSet].sort((a, b) => a - b);
    if (!item.exits.length && !own.length) continue;
    const reach = new Map();
    // Routes come shortest first; a later, longer route replaces a known one only when it ties a failure check.
    for (const [caller, route] of routesTo(key, callers)) for (const id of direct.get(caller) ?? []) {
      if (ownSet.has(id)) continue;
      const tied = checks(id, caller), known = reach.get(id);
      if (!known || (tied && !known.checks)) reach.set(id, { id, route, checks: tied });
    }
    const viaAll = [...reach.values()].sort((a, b) => b.checks - a.checks || a.route.length - b.route.length || a.id - b.id);
    const failureDirect = own.filter((id) => checks(id, key)).length, viaFailure = viaAll.filter((item) => item.checks).length;
    const measured = lineHits?.get(item.path);
    // Mutants of this function from a current mutation report: our report names the function, Stryker's gives a line.
    const mutants = (data.mutation?.files[item.path] ?? []).filter((mutant) => mutant.unit ? mutant.unit === key : mutant.line >= item.line && mutant.line <= item.end);
    const exitMutant = (line) => mutants.find((mutant) => mutant.line === line && exitKinds.has(mutant.kind))?.status ?? null;
    const exits = item.exits.map(({ probe, branch, ...exit }) => ({ ...exit, hits: measured ? exitHits(measured, { line: exit.line, probe, branch }) : null, mutant: exitMutant(exit.line) }));
    const status = !exits.length ? 'no-exits' : failureDirect ? 'direct' : viaFailure ? 'indirect' : own.length || viaAll.length ? 'no-failure-assertion' : 'unreached';
    // How strictly the tests that call it check its result: null when no test calls it directly, "none" when no check is tied to it.
    const resultCheck = !own.length ? null : own.filter(runs).reduce((top, id) => strengthFor[id][key] ? stronger(strengthFor[id][key], top) : top, null) ?? 'none';
    units.push({ key, path: item.path, name: item.name, kind: item.kind, line: item.line, end: item.end, exported: item.exported, module: moduleOf(item.path),
      exits, direct: own, via: viaAll.length, viaFailure, viaCases: viaAll.slice(0, viaShown), // route[0] is the caller that the test calls
      failureDirect, candidates: own.filter((id) => !checks(id, key) && candidate(id)).length,
      model: own.filter((id) => cases[id].intent === 'unhappy' && cases[id].intentState === 'current').length, status, resultCheck, affects: affects(item.path),
      mutation: mutationOf(mutants, data.mutation?.units.find((unit) => unit.key === key)) });
  }
  const states = Object.values(labels).map((entry) => entry.status);
  const tests = { base, cases, testFiles, units, unreadable: data.unreadableTests ?? [], fixCommits: data.fixCommits ?? null,
    hotspots: (analysisFiles ?? []).filter((file) => file.hotspotScore > 0).sort((a, b) => b.hotspotScore - a.hotspotScore).slice(0, 10).map((file) => file.path),
    coverage: { state: !data.coverage ? 'none' : lineHits ? 'measured' : 'not-applicable', file: data.coverage?.file ?? null, date: data.coverage?.date ?? null, mapped: data.generatedAt ?? null },
    mutation: { state: data.mutation?.tool ? 'measured' : 'none', file: data.mutation?.file ?? null, tool: data.mutation?.tool ?? null, date: data.mutation?.date ?? null,
      staleFiles: data.mutation?.stale.length ?? 0, error: data.mutation?.error ?? null },
    labels: { file: data.testLabels?.file ?? null, current: cases.filter((item) => item.intentState === 'current').length,
      staleFiles: states.filter((state) => state === 'stale').length, unstampedFiles: states.filter((state) => state === 'unstamped').length,
      missing: cases.filter((item) => !item.intent && labels[item.path]).length } };
  tests.summary = summarizeTests(tests);
  return tests;
}

/** A function's mutation evidence: counts by outcome, the changes that no test detected, and the run status of the check. */
function mutationOf(mutants, run) {
  if (!mutants.length && !run) return null;
  const counts = {};
  for (const mutant of mutants) counts[mutant.status] = (counts[mutant.status] ?? 0) + 1;
  return { run: run?.status ?? null, tests: run?.tests ?? [], counts,
    survived: mutants.filter((mutant) => mutant.status === 'survived').map(({ line, kind, original, replacement }) => ({ line, kind, original, replacement })) };
}

/** The deepest folder holding every source file, like the viewer's map root; its subfolders are the modules. */
function commonFolder(paths) {
  let prefix = null;
  for (const path of paths) {
    const folders = path.split('/').slice(0, -1);
    if (prefix === null) { prefix = folders; continue; }
    let index = 0;
    while (index < prefix.length && index < folders.length && prefix[index] === folders[index]) index++;
    prefix = prefix.slice(0, index);
  }
  return (prefix ?? []).join('/');
}

/** Top-level declarations by "path#name"; overload signatures merge into one entry. */
function topLevel(files) {
  const declarations = new Map();
  for (const file of files) for (const declaration of file.declarations) {
    if (['interface', 'type', 'enum'].includes(declaration.kind)) continue;
    const key = `${file.path}#${declaration.name}`, metrics = declaration.metrics ?? {};
    const known = declarations.get(key);
    const exits = metrics.failureExits ?? [], references = metrics.references ?? [];
    if (known) { known.exits.push(...exits); known.references.push(...references); if (!declaration.planned) Object.assign(known, { line: declaration.start, end: declaration.end }); continue; }
    declarations.set(key, { path: file.path, name: declaration.name, kind: declaration.kind, line: declaration.start, end: declaration.end,
      exported: declaration.exported, exits: [...exits], references: [...references] });
  }
  return declarations;
}

/** Follows named, renamed and `export *` re-exports to the file that declares an exported name. */
function exportResolver(sources, declarations) {
  const memo = new Map();
  const resolve = (path, name, depth) => {
    const key = `${path}#${name}`;
    if (memo.has(key)) return memo.get(key);
    memo.set(key, null); // guards re-export cycles
    const file = sources.get(path);
    let result = null;
    if (file && depth < 8) {
      const detail = (file.exportDetails ?? []).find((item) => item.name === name);
      const local = detail?.localName ?? (detail && detail.category !== 'reexport' ? name : null);
      if (local && declarations.has(`${path}#${local}`)) result = `${path}#${local}`;
      else if (!detail && declarations.has(key)) result = key;
      for (const link of (file.reexports ?? []).filter((item) => item.target && (item.name === name || item.name === '*'))) {
        if (result) break;
        result = resolve(link.target, link.name === '*' ? name : link.imported, depth + 1);
      }
    }
    memo.set(key, result);
    return result;
  };
  return (path, name) => resolve(path, name, 0);
}

/**
 * Declarations that reference this one, up to a few calls away, each with its route: [caller, …, this declaration].
 * A test of a caller reaches this declaration through that route; the route is evidence for a reader, not a proven call.
 */
function routesTo(key, callers) {
  const routes = new Map([[key, [key]]]);
  let frontier = [key];
  for (let depth = 0; depth < callDepth && frontier.length; depth++) {
    const next = [];
    for (const current of frontier) for (const caller of callers.get(current) ?? []) {
      if (routes.has(caller)) continue;
      routes.set(caller, [caller, ...routes.get(current)]);
      next.push(caller);
    }
    frontier = next;
  }
  routes.delete(key);
  return routes;
}

function declaredType(path) {
  const parts = path.split('/'), name = parts.pop().split('.').slice(1, -1);
  for (const part of name) for (const [type, pattern] of declaredTypes) if (pattern.test(part)) return type;
  const start = parts.findIndex((part) => testFolder.test(part));
  if (start < 0) return null;
  for (const part of parts.slice(start)) for (const [type, pattern] of declaredTypes) if (pattern.test(part)) return type;
  return null;
}

/** Hits apply only to a working-tree map and to files with a valid report entry, like the viewer's coverage. */
function coverageLines(data, lines, branches) {
  if (!lines || !data.coverage || data.coverageSnapshot !== 'working-tree') return null;
  const result = new Map();
  for (const [path, entry] of Object.entries(data.coverage.files ?? {})) {
    if (Array.isArray(entry) && entry[0] > 0 && lines[path]) result.set(path, { lines: lines[path], branches: branches?.[path] ?? {} });
  }
  return result;
}

/**
 * How often a failure exit ran, or null when unmeasured. An exit on its own line uses that line (a catch block: its first
 * statement). A one-line `if (bad) throw` always runs its line, so it needs the branch: only an Istanbul-style record with
 * one block of two branches maps to the source's then/else. V8-native reports (Node, c8) write one-branch blocks in their
 * own order, so such an exit stays unknown rather than borrowing another block's count.
 */
function exitHits(measured, exit) {
  if (exit.branch !== undefined) {
    const blocks = Object.values(measured.branches[exit.line] ?? {});
    return blocks.length === 1 && blocks[0].length === 2 ? blocks[0][exit.branch] ?? null : null;
  }
  const line = exit.probe === undefined ? exit.line : exit.probe;
  return line === null ? null : measured.lines[line] ?? null;
}

/** How many source files can be affected by a change to this one, through imports (the blast radius). */
function affectedCounter(files) {
  const importers = new Map(), memo = new Map();
  for (const file of files) for (const target of file.imports) {
    if (!importers.has(target)) importers.set(target, []);
    importers.get(target).push(file.path);
  }
  return (path) => {
    if (!memo.has(path)) {
      const seen = new Set([path]), queue = [path];
      for (let index = 0; index < queue.length; index++) for (const next of importers.get(queue[index]) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
      memo.set(path, seen.size - 1);
    }
    return memo.get(path);
  };
}
