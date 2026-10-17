// Collects everything the map shows and renders the self-contained HTML page.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { analyzeFile, createResolver } from './analyze.mjs';
import { analyzeProject, createReport } from './analysis.mjs';
import { descriptionStatus, loadDescriptions } from './descriptions.mjs';
import { branchesAt, growingBranch, sourceReader } from './git.mjs';
import { readChanges, readCoChanges } from './changes.mjs';
import { readCoverage } from './coverage.mjs';
import { fileTimes, readHistory } from './history.mjs';
import { detectRoots, isCode, isTest, projectName, readAliases, readBudgets, selectSources, selectTests, underRoots } from './project.mjs';

const viewerPath = new URL('./viewer.html', import.meta.url);

/** Reads the repository and returns the facts the page and the chat need. */
export function collect(repository, config, options) {
  const ref = options.worktree ? null : (options.ref ?? growingBranch(repository, detectRoots(sourceReader(repository, 'HEAD').list(), config).filter((root) => root !== '.')));
  const reader = sourceReader(repository, ref);
  const all = reader.list();
  const roots = detectRoots(all, config);
  const sources = selectSources(all, roots);
  const tests = selectTests(all);
  // Include local config bases with arbitrary names as well as nested project configs.
  const meta = [...all.filter((path) => path.endsWith('.json') || path.endsWith('.jsonc')), config.budgetsFrom]
    .filter((path) => path && all.includes(path));
  const texts = reader.read([...new Set([...sources, ...tests, ...meta])]);
  const resolveImport = createResolver(new Set(all), readAliases(texts));
  const files = sources.filter((path) => texts.has(path)).map((path) => analyzeFile(path, texts.get(path), resolveImport));
  const testFacts = tests.filter((path) => texts.has(path)).map((path) => analyzeFile(path, texts.get(path), resolveImport));
  const descriptionsPath = resolve(repository, options.descriptions ?? config.descriptions);
  const descriptions = loadDescriptions(descriptionsPath);
  return { reader, roots, files, testFacts, texts, descriptions, descriptionsPath,
    name: projectName(texts, repository), budgets: readBudgets(config, texts) };
}

export function mapData(repository, config, facts, historyLimit, worktree = false) {
  const keep = (path) => isCode(path) && !isTest(path) && underRoots(path, facts.roots);
  const snapshots = readHistory(repository, facts.reader.sha, facts.roots, keep, historyLimit);
  const times = fileTimes(snapshots);
  const testedBy = new Map();
  for (const test of facts.testFacts) for (const target of test.imports) testedBy.set(target, [...(testedBy.get(target) ?? []), test.path]);
  const historyFiles = [...new Set(snapshots.flatMap((snapshot) => [...snapshot.sizes.keys()]))].sort();
  const historyIndex = new Map(historyFiles.map((path, index) => [path, index]));
  const known = new Set(facts.files.map((file) => file.path));
  const data = {
    generatedAt: new Date().toISOString(), project: facts.name, roots: facts.roots,
    ref: (facts.reader.label === 'working tree' ? '' : branchesAt(repository, facts.reader.sha)) || facts.reader.label,
    sha: facts.reader.sha, budgets: facts.budgets, limits: config.limits ?? null,
    modules: facts.descriptions.modules, folders: facts.descriptions.folders,
    tour: facts.descriptions.tour.map((step) => ({ ...step, files: (step.files ?? []).filter((path) => known.has(path)) })),
    files: facts.files.map((file) => {
      const text = facts.descriptions.files[file.path];
      const time = times.get(file.path);
      return { path: file.path, lines: file.lines, header: file.header, summary: text?.summary ?? '',
        status: descriptionStatus(text, file), imports: file.imports, externals: file.externals, exports: file.exports,
        edges: file.edges, exportDetails: file.exportDetails, declarations: file.declarations, uses: file.uses, valueUses: file.valueUses, tests: testedBy.get(file.path) ?? [], created: time?.created ?? null,
        changed: time?.changed ?? null, source: facts.texts.get(file.path) ?? '' };
    }),
    tests: facts.testFacts.length,
    // Tests and their imports, so the page can find every test that reaches a file (directly or through other files).
    testFiles: facts.testFacts.map((test) => ({ path: test.path, imports: test.imports, edges: test.edges, uses: test.uses, valueUses: test.valueUses })),
    coChanges: readCoChanges(repository, facts.reader.sha, facts.roots, keep, known),
    coverage: readCoverage(repository, config),
    coverageSnapshot: worktree ? 'working-tree' : 'unbound-revision',
    // Forbidden import directions, e.g. "verify -> engine" (module or folder names; "*" = any other module).
    rules: Array.isArray(config.rules) ? config.rules.filter((rule) => typeof rule === 'string') : [],
    changes: readChanges(repository, facts.reader.sha, facts.roots, keep, worktree),
    history: { files: historyFiles, snapshots: snapshots.map((snapshot) => ({ sha: snapshot.sha.slice(0, 10), date: snapshot.date,
      subject: snapshot.subject, sizes: [...snapshot.sizes].map(([path, size]) => [historyIndex.get(path), size]) })) },
  };
  data.analysis = analyzeProject(data);
  return data;
}

export function renderPage(data, server) {
  const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, ' ');
  return readFileSync(viewerPath, 'utf8')
    .replace('"__CODE_MAP_DATA__"', () => json({ ...data, analysis: data.analysis ?? analyzeProject(data) }))
    .replace('"__CODE_MAP_SERVER__"', () => json(server))
    .replace('"__CODE_MAP_REPORT_FN__"', () => createReport.toString());
}

export function writePage(path, html) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
}
