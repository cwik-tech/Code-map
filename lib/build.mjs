// Collects everything the map shows and renders the self-contained HTML page.
import { typedFacts } from './types/collect.mjs';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { scanDeclaredPatterns } from './patterns.mjs';
import { migrationUses } from './migrations.mjs';
import { analyzeFile, createResolver } from './analyze.mjs';
import { analyzeProject, createReport } from './analysis.mjs';
import { apiSurface, packageEntryPoints } from './api-surface.mjs';
import { analyzeContracts, contractInputs, contractKind } from './contracts/openapi.mjs';
import { boundedInputs, protocolInputs, deploymentPath, examplePath } from './contracts/inputs.mjs';
import { deploymentEntries, compareDeployment } from './frameworks/deployment.mjs';
import { checkExamples } from './impact/examples.mjs';
import { analyzeEnv, templateFacts } from './frameworks/env.mjs';
import { analyzeElectronIpc } from './frameworks/electron-ipc.mjs';
import { analyzeElectron } from './frameworks/electron.mjs';
import { analyzeFrameworks } from './frameworks/nextjs.mjs';
import { jsonRanges } from './models/ranges.mjs';
import { readModelFiles } from './models/model-files.mjs';
import { analyzeModels } from './models/models.mjs';
import { readStyles } from './packages/styles.mjs';
import { analyzePackages, packageReadPaths } from './packages/index.mjs';
import { descriptionStatus, loadDescriptions } from './descriptions.mjs';
import { branchesAt, git, growingBranch, sourceReader } from './git.mjs';
import { readChanges, readCoChanges, readFixCommits } from './changes.mjs';
import { findCodeowners } from './codeowners.mjs';
import { readCoverage } from './coverage.mjs';
import { fileTimes, readHistory } from './history.mjs';
import { detectRoots, ignored, isCode, isTest, isTestScript, projectName, readAliases, readBudgets, selectSources, selectTests, underRoots, outsideRoots, unsupportedFiles } from './project.mjs';
import { readSupply } from './supply/lockfile.mjs';
import { supplyPolicy } from './supply/policy.mjs';
import { labelsForMap, loadTestLabels } from './test-labels.mjs';
import { summarizeTests } from './test-summary.mjs';

import { expandPatterns } from './dynamic-patterns.mjs';

const viewerPath = new URL('./viewer.html', import.meta.url);

/** Reads the repository and returns the facts the page and the chat need. */
/** The ref to map: null for the working tree, else --ref, else the local branch whose source changed most recently. */
export function selectRef(repository, config, options) {
  if (options.worktree) return null;
  if (options.ref) return options.ref;
  const reader = sourceReader(repository, 'HEAD'), paths = reader.list();
  const packageText = paths.includes('package.json') ? reader.read(['package.json']).get('package.json') : undefined;
  return growingBranch(repository, detectRoots(paths, config, packageText).filter((root) => root !== '.'));
}

/** `cache` (lib/file-cache.mjs) gives the per-file facts of unchanged files. Without it, each file is parsed again. */
export function collect(repository, config, options, cache = null) {
  const ref = selectRef(repository, config, options);
  const reader = sourceReader(repository, ref);
  const all = reader.list();
  // Include local config bases with arbitrary names as well as nested project configs.
  const meta = [...all.filter((path) => path.endsWith('.json') || path.endsWith('.jsonc')), config.budgetsFrom]
    .filter((path) => path && all.includes(path) && !path.startsWith('.code-map/models/') && !path.startsWith('.code-map/decisions/'));
  const texts = reader.read(meta.filter((path) => !contractKind(path) && !deploymentPath(path)));
  const roots = detectRoots(all, config, texts.get('package.json'));
  const sources = selectSources(all, roots);
  const tests = selectTests(all);
  const read = new Set([...sources, ...tests, ...meta, ...all.filter((path) => ['yarn.lock', 'pnpm-lock.yaml', 'bun.lock'].includes(path))]);
  const contracts = contractInputs(all, reader);
  const remaining = [...read, ...packageReadPaths(all, read)].filter((path) => !texts.has(path) && !contractKind(path) && !deploymentPath(path));
  for (const [path, text] of reader.read(remaining)) texts.set(path, text);
  for (const [path, text] of readStyles(all, reader)) texts.set(path, text);
  for (const [path, text] of contracts.texts) texts.set(path, text);
  const aliasInfo = readAliases(texts), resolveImport = createResolver(new Set(all), aliasInfo), analyze = cache?.analyze ?? analyzeFile;
  const files = sources.filter((path) => texts.has(path)).map((path) => expandPatterns(analyze(path, texts.get(path), resolveImport), all));
  const testFacts = tests.filter((path) => texts.has(path)).map((path) => expandPatterns(analyze(path, texts.get(path), resolveImport, { tests: true }), all));
  const packageRoots = new Set(all.filter((path) => posix.basename(path) === 'package.json' && !ignored(path)).map(posix.dirname));
  const parsed = new Set([...sources, ...tests]);
  const configFacts = all.filter((path) => !parsed.has(path) && !ignored(path) && texts.has(path)
    && /\.config\.(?:[cm]?js|[cm]?ts)$/.test(path) && packageRoots.has(posix.dirname(path)))
    .map((path) => expandPatterns(analyze(path, texts.get(path), resolveImport), all));
  const configPaths = new Set(configFacts.map((file) => file.path));
  if (options.types || config.typeCheck) for (const [path, text] of reader.read(all.filter((path) => isCode(path) || /\.d\.[cm]?ts$/.test(path)))) texts.set(path, text);
  const entryPoints = packageEntryPoints(texts, files.map((file) => file.path), resolveImport);
  const descriptionsPath = resolve(repository, options.descriptions ?? config.descriptions);
  const descriptions = loadDescriptions(descriptionsPath);
  const labelsPath = resolve(repository, options.labels ?? config.testLabels);
  // Only the names of the env template files, never their text. A symlink is not followed, and a file that Code-map cannot
  // read (for example without read permission) is missing, so it does not stop the collection.
  const readEach = (paths) => { try { return reader.read(paths); } catch { return new Map(paths.flatMap((path) => { try { return [...reader.read([path])]; } catch { return []; } })); } };
  const jsonBoundaries = boundedInputs(all, reader, (path) => path.endsWith('.schema.json') && !ignored(path), (path, text) => ({ schemas: jsonRanges(path, text) }));
  const protocols = protocolInputs(all, reader);
  const deployment = boundedInputs(all, reader, deploymentPath, deploymentEntries, 262144);
  const markdown = boundedInputs(all, reader, examplePath, (path, text) => ({ text }));
  const typed = options.types || config.typeCheck ? typedFacts(new Map([...texts, ...markdown.filter((item) => item.text !== undefined).map((item) => [item.path, item.text])]), { budgetMs: config.typeBudgetMs ?? 60000 }) : null;
  const envTemplates = templateFacts(all, readEach, (paths) => reader.stat(paths));
  return { reader, typed, jsonBoundaries, roots, files, testFacts, configFacts, entryPoints, texts, aliasInfo, resolveImport, protocols, deployment, markdown, envTemplates, contractSkipped: contracts.skipped, descriptions, descriptionsPath, labelsPath, labels: loadTestLabels(labelsPath),
    codeowners: readCodeowners(repository, reader, ref, all),
    unreadableTests: all.filter(isTestScript).sort(), unsupported: unsupportedFiles(all), outside: outsideRoots(all.filter((path) => !configPaths.has(path)), roots), name: projectName(texts, repository), budgets: readBudgets(config, texts),
    allPaths: all, models: readModelFiles(repository, ref === null ? null : reader.sha, all, texts), supply: readSupply(all, texts, supplyPolicy(config.supplyChain)) };
}

/**
 * The CODEOWNERS file that GitHub reads, as { path, text }, or null. Code-map does not follow a symlink there, in the working
 * tree or in a commit: in the working tree, the link can lead to any file of the computer, and the summary shows the lines
 * that it ignores. Such a file gives { path, problem }.
 */
function readCodeowners(repository, reader, ref, all) {
  const path = findCodeowners(all);
  if (path === null) return null;
  const parts = path.split('/');
  const link = ref === null ? parts.some((_, index) => lstatSync(join(repository, ...parts.slice(0, index + 1))).isSymbolicLink())
    : git(repository, ['ls-tree', '-z', '--full-tree', reader.sha, '--', path]).startsWith('120000 ');
  if (link) return { path, problem: 'The file is a symlink, and Code-map does not follow it. No file gets an owner from it.' };
  if (ref === null && !lstatSync(join(repository, path)).isFile()) return { path, problem: 'The path is not a regular file. No file gets an owner from it.' };
  return { path, text: reader.read([path]).get(path) ?? '' };
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
      return { path: file.path, contentDigest: file.contentDigest, lines: file.lines, header: file.header, summary: text?.summary ?? '',
        status: descriptionStatus(text, file), imports: file.imports, externals: file.externals, exports: file.exports,
        edges: file.edges, reexports: file.reexports, exportDetails: file.exportDetails, declarations: file.declarations, uses: file.uses, valueUses: file.valueUses, syntax: file.syntax, patterns: file.patterns,
        tests: testedBy.get(file.path) ?? [], created: time?.created ?? null,
        changed: time?.changed ?? null, source: facts.texts.get(file.path) ?? '' };
    }),
    configFiles: facts.configFacts ?? [],
    tests: facts.testFacts.length,
    // Tests and their imports, so the page can find every test that reaches a file (directly or through other files).
    testFiles: facts.testFacts.map((test) => ({ path: test.path, imports: test.imports, edges: test.edges, uses: test.uses, valueUses: test.valueUses,
      exports: test.exports, exportDetails: test.exportDetails, externals: test.externals, syntax: test.syntax, scan: test.testScan })),
    unreadableTests: facts.unreadableTests, unsupportedFiles: facts.unsupported, outsideRoots: facts.outside,
    fixCommits: readFixCommits(repository, facts.reader.sha, keep, isTest),
    testLabels: labelsForMap(facts.labels, facts.testFacts, facts.texts, relative(repository, facts.labelsPath)),
    coChanges: readCoChanges(repository, facts.reader.sha, facts.roots, keep, known),
    coverage: readCoverage(repository, config),
    coverageSnapshot: worktree ? 'working-tree' : 'unbound-revision',
    // Forbidden import directions, e.g. "verify -> engine" (module or folder names; "*" = any other module).
    rules: Array.isArray(config.rules) ? config.rules.filter((rule) => typeof rule === 'string') : [],
    // Layers from the top to the bottom, their exceptions, the ownership setting and the CODEOWNERS file of the snapshot (lib/project.mjs checks the settings).
    layers: config.layers ?? null, layerExceptions: [...(config.allowed ?? []), ...(config.layerExceptions ?? [])], ownershipPolicy: config.ownership ?? null, codeowners: facts.codeowners ?? null,
    changes: readChanges(repository, facts.reader.sha, facts.roots, keep, worktree),
    history: { files: historyFiles, snapshots: snapshots.map((snapshot) => ({ sha: snapshot.sha.slice(0, 10), date: snapshot.date,
      subject: snapshot.subject, sizes: [...snapshot.sizes].map(([path, size]) => [historyIndex.get(path), size]) })) },
  };
  data.analysis = analyzeProject(data, { coverageLines: data.coverage?.lines, coverageBranches: data.coverage?.branches });
  if (config.safeguards?.length) data.analysis.safeguards = { informationOnly: true, items: scanDeclaredPatterns(new Map(facts.files.map((file) => [file.path, facts.texts.get(file.path)])), config.safeguards) };
  // A separate section, so the reports that read the analysis keep their fields. Only a comparison with a base reads it.
  data.analysis.migrations = migrationUses(new Map([...facts.files, ...facts.testFacts, ...(facts.configFacts ?? [])].map((file) => [file.path, facts.texts.get(file.path) ?? ''])), config.migrations);
  data.analysis.api = apiSurface(facts.files, facts.testFacts, facts.entryPoints);
  const packageVersions = {};
  for (const [path, text] of facts.texts) if (posix.basename(path) === 'package.json') {
    try { const value = JSON.parse(text); if (typeof value?.version === 'string') packageVersions[path] = value.version; } catch { /* invalid manifests have no release policy */ }
  }
  data.analysis.api.packages = packageVersions;
  const symbols = (declarations) => declarations.flatMap((item) => [
    { name: item.name, references: item.metrics?.references ?? [] }, ...symbols(item.children ?? []),
  ]);
  data.analysis.api.symbols = Object.fromEntries(facts.files.map((file) => [file.path, symbols(file.declarations)]));
  if (config.api?.breaking) data.analysis.api.breaking = config.api.breaking;
  if (facts.typed) data.analysis.typed = facts.typed;
  // The framework report reads every path (for routes outside the source roots) and the per-file React facts.
  data.analysis.frameworks = analyzeFrameworks(data.analysis, { paths: facts.allPaths, texts: facts.texts, files: facts.files, roots: facts.roots });
  const electron = analyzeElectron(data.analysis, { texts: facts.texts, aliases: facts.aliasInfo });
  if (electron) data.analysis.frameworks.electron = electron;
  // The model report reads the Zod and XState facts of the source files, the texts of linked tests and the model files (C22 to C24).
  data.analysis.models = analyzeModels({ files: facts.files, testFacts: facts.testFacts, texts: facts.texts, modelFiles: facts.models, paths: facts.allPaths, jsonBoundaries: facts.jsonBoundaries });
  // The lockfile inventory (lib/supply/). A snapshot without a lockfile has none, so its analysis and outputs do not change.
  if (facts.supply) data.analysis.supply = facts.supply;
  // The environment keys and the API contracts (lib/frameworks/env.mjs, lib/contracts/openapi.mjs) read the same facts.
  const electronIpc = analyzeElectronIpc({ texts: facts.texts, files: facts.files });
  if (electronIpc) data.analysis.frameworks.electronIpc = electronIpc;
  data.analysis.frameworks.env = analyzeEnv({ paths: facts.allPaths, templates: facts.envTemplates ?? [], files: facts.files, testFiles: facts.testFacts });
  data.analysis.frameworks.openapi = analyzeContracts({ paths: facts.allPaths, texts: facts.texts, nextjs: data.analysis.frameworks.nextjs, files: data.analysis.files, skipped: facts.contractSkipped });
  data.analysis.frameworks.protocols = { documents: facts.protocols ?? [] };
  data.analysis.frameworks.deployment = compareDeployment(facts.allPaths, facts.deployment ?? [], data.analysis.frameworks.env);
  data.analysis.examples = checkExamples(new Map((facts.markdown ?? []).filter((x) => x.text !== undefined).map((x) => [x.path, x.text])), facts.texts, data.analysis.api);
  if (facts.typed) {
    const examples = facts.typed.examples;
    Object.assign(data.analysis.examples, { checked: examples?.checked ?? 0, skipped: examples?.skipped ?? 0, typeState: examples?.state ?? 'UNKNOWN',
      limits: 'Compiler checks use snapshot files and installed TypeScript libraries. External dependencies and runtime behavior remain unknown.' });
    data.analysis.examples.issues.push(...(examples?.issues ?? []));
    data.analysis.examples.gaps.push(...(examples?.gaps ?? [{ reason: facts.typed.reason ?? 'compiler-unavailable' }]));
  }
  data.analysis.examples.gaps.push(...(facts.markdown ?? []).filter((x) => x.state === 'UNKNOWN').map(({ path, reason }) => ({ path, reason })));
  // The package report reads the parsed files with their import lines, the Next.js routes and the node_modules folders of the working folder.
  const { completeness, ...packages } = analyzePackages({ repository, texts: facts.texts, paths: facts.allPaths, files: facts.files, testFacts: facts.testFacts,
    entryPoints: facts.entryPoints, electron, nextjs: data.analysis.frameworks.nextjs, resolve: facts.resolveImport, aliases: facts.aliasInfo });
  data.analysis.packages = packages;
  data.analysis.completeness = completeness;
  // The analysis holds the compact test and link results; the raw scan and references would only make the page larger.
  for (const test of data.testFiles) delete test.scan;
  const strip = (list) => { for (const declaration of list) { if (declaration.metrics) delete declaration.metrics.references; strip(declaration.children ?? []); } };
  for (const file of data.files) strip(file.declarations);
  return data;
}

export function renderPage(data, server) {
  const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, ' ');
  return readFileSync(viewerPath, 'utf8')
    // The page does not show the lockfile inventory, so it is left out and the page keeps its size.
    .replace('"__CODE_MAP_DATA__"', () => json({ ...data, analysis: { ...(data.analysis ?? analyzeProject(data)), supply: undefined } }))
    .replace('"__CODE_MAP_SERVER__"', () => json(server))
    .replace('"__CODE_MAP_REPORT_FN__"', () => createReport.toString())
    .replace('"__CODE_MAP_TEST_SUMMARY_FN__"', () => summarizeTests.toString());
}

export function writePage(path, html) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
}
