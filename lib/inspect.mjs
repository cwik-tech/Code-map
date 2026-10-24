// Summary-first inspection: `--summary` analyzes a snapshot once (or reuses the stored analysis of the same inputs) and
// prints a small overview. `--analysis <id>` reads that stored analysis: one finding, a page of findings, a page of
// evidence, a file report or the full report. Follow-ups never collect again; they only check whether the code changed.
// `--base <ref>` also analyzes a base commit and labels each finding NEW, EXISTING, RESOLVED or UNKNOWN against it.
// `--api <status>` with `--base-analysis` pages through the export changes of that comparison (lib/api-report.mjs), and
// `--impact <list>` through one list of its change impact. `--undocumented` pages the public exports without JSDoc (lib/impact/).
import { revisionPolicy } from './revision-policy.mjs';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { apiGroups } from './api-compare.mjs';
import { apiChangesPage, apiFilters } from './api-report.mjs';
import { collect, mapData, selectRef } from './build.mjs';
import { compareFindings, comparability } from './compare.mjs';
import { gitRenames } from './compare-git.mjs';
import { impactLists, impactPage, undocumentedPage } from './impact/report.mjs';
import { openFileCache } from './file-cache.mjs';
import { deriveFindings } from './findings.mjs';
import { git } from './git.mjs';
import { analysisId, analysisInputs, changedInputs } from './inputs.mjs';
import { defaultLimit, dependenciesPage, fileReport, filePart, findingReport, findingsPage, complexityPage, maxLimit, schemasPage, page, projectPart, summaryReport } from './overview.mjs';
import { loadConfig } from './project.mjs';
import { snapshotSchemas } from './schemas/collect.mjs';
import { insideRepository, loadAnalysis, saveAnalysis, requirePrivateFolder, storeLocation, storeVersion, validId } from './store.mjs';
import { checkTriageOptions, triageContext } from './triage-view.mjs';
import { changedFiles } from './verify-change.mjs';

/** The analysis does not use the history strip, so the store reads only its two end points. */
const analysisHistory = 2;
const retrievalOnly = ['base-analysis', 'baseline', 'finding', 'findings', 'rule', 'part', 'offset', 'limit', 'full', 'complexity', 'api', 'api-group', 'unlabeled', 'dependencies', 'schemas', 'impact', 'undocumented'];
const baselines = ['new', 'existing', 'resolved', 'unknown'];
/** The options that take a value, so that a printed command can keep a value that starts with "-" attached to its option. */
const valueOptions = new Set(['--analysis', '--base-analysis', '--finding', '--rule', '--part', '--offset', '--limit', '--file', '--change', '--store', '--ref', '--labels', '--out', '--baseline', '--api', '--api-group', '--impact']);
/** Each report reads its own options. These pairs select two reports, or give an option that the selected report ignores. */
const conflicts = [['finding', ['file', 'change', 'rule', 'baseline', 'summary']], ['findings', ['part', 'summary']], ['summary', ['part']], ['part', ['change']],
  ['complexity', ['finding', 'findings', 'part', 'full', 'summary', 'change', 'file']], ['api', ['finding', 'findings', 'part', 'full', 'summary', 'rule', 'baseline', 'file', 'change', 'complexity']],
  ['dependencies', ['finding', 'findings', 'part', 'full', 'summary', 'change', 'file', 'complexity', 'api']],
  ['schemas', ['finding', 'findings', 'part', 'full', 'summary', 'change', 'file', 'complexity', 'api', 'dependencies']],

  ['impact', ['finding', 'findings', 'part', 'full', 'summary', 'rule', 'baseline', 'file', 'change', 'complexity', 'api', 'dependencies', 'schemas']],
  ['undocumented', ['finding', 'findings', 'part', 'full', 'summary', 'rule', 'baseline', 'file', 'change', 'complexity', 'api', 'impact', 'dependencies', 'schemas', 'base-analysis']]];

/** True when the options ask for a summary or a stored analysis rather than the classic report. */
export const isRetrieval = (options) => options['compiler-report'] !== undefined || options['base-compiler-report'] !== undefined || !!options.summary || options.analysis !== undefined || options.store !== undefined || options.base !== undefined || !!options['include-hidden'] || !!options['no-cache']
  || retrievalOnly.some((name) => options[name] !== undefined && options[name] !== false);

/** `today` is the current calendar date (YYYY-MM-DD) for the expiry of triage entries. The caller reads the clock. */
export function retrieve(repository, config, options, env = process.env, today = null) {
  check(options);
  const location = storeLocation(options.store, env);
  const command = (args) => commandLine(['code-map', ...args, ...(location.explicit ? ['--store', location.root] : [])]);
  if (options.analysis === undefined) return summarize(repository, config, options, location, command, today);
  const id = validId(options.analysis), stored = loadAnalysis(location.root, id);
  if (!stored) throw new Error(`Analysis ${id} is not in the store (${location.root}). Run code-map inspect --summary in the repository again; unchanged code gets the same ID.`);
  const now = {}, context = { id, freshness: freshness(stored, command, now), command, fullOut: fullOut(location.root, id) };
  if (now.inputs && context.freshness.state === 'current') context.contentDigest = now.inputs.worktree?.contentDigest ?? null;
  if (options['base-analysis'] !== undefined) {
    const baseId = validId(options['base-analysis']), base = loadAnalysis(location.root, baseId);
    if (!base) throw new Error(`Analysis ${baseId} is not in the store (${location.root}). Run code-map inspect --summary --base <ref> in the repository again.`);
    if (base.inputs.selector.worktree) throw new Error(`The base analysis must be of a commit, but ${baseId} is of a working tree.`);
    context.comparison = comparisonOf(stored, base, context.freshness, undefined, command);
  }
  const paging = { offset: number(options.offset, 0, '--offset', 0), limit: number(options.limit, defaultLimit, '--limit', 1) };
  const selection = { files: options.file ?? [], change: options.change, includeVendors: !options['exclude-vendors'] };
  const pager = (list, args) => page(list, paging, (next) => context.command([...args, '--offset', String(next), ...(paging.limit === defaultLimit ? [] : ['--limit', String(paging.limit)])]));
  if (options.api !== undefined) return apiChangesPage(stored, context, { status: options.api, group: options['api-group'] ?? null }, pager);
  if (options.impact !== undefined) return impactPage(stored, context, options.impact, pager);
  if (options.undocumented) return undocumentedPage(stored, context, pager);
  // Only the summary, a findings page and a finding report show triage, so only they read the triage file.
  if (!options.full && options.part === undefined && (options.summary || options.findings || options.finding !== undefined || (!selection.files.length && !selection.change))) {
    context.triage = triageContext(stored, context.comparison ?? null, options, today);
  }
  if (options.finding !== undefined) return findingReport(stored, context, options.finding, { part: options.part ?? null, ...paging });
  if (options.complexity) return complexityPage(stored, context, paging);
  if (options.dependencies) return dependenciesPage(stored, context, paging);
  if (options.schemas) return schemasPage(stored, context, paging);
  if (options.findings) return findingsPage(stored, context, { rule: options.rule ?? null, selection, baseline: options.baseline?.toUpperCase() ?? null, ...paging });
  if (options.full) return fileReport(stored, context, { includeVendors: selection.includeVendors });
  if (options.part !== undefined) return selection.files.length ? filePart(stored, context, selection.files[0], options.part, paging) : projectPart(stored, context, options.part, paging);
  if (options.summary || (!selection.files.length && !selection.change)) return summaryReport(stored, { ...context, reused: true }, selection);
  return fileReport(stored, context, selection);
}

function check(options) {
  const used = (name) => options[name] !== undefined && options[name] !== false;
  for (const name of retrievalOnly) if (used(name) && options.analysis === undefined) throw new Error(`--${name} needs --analysis <id>: run code-map inspect --summary first and use the commands that it prints.`);
  if (options.store !== undefined && !options.summary && options.analysis === undefined) throw new Error('--store needs --summary or --analysis <id>.');
  if (options['no-cache'] && !options.summary) throw new Error('--no-cache needs --summary: only a new analysis reads the file cache.');
  if (options.analysis !== undefined && (options.worktree || options.ref !== undefined)) throw new Error('--analysis already identifies the snapshot. Remove --worktree and --ref.');
  for (const [one, others] of conflicts) for (const other of others) if (used(one) && used(other)) throw new Error(`Use either --${one} or --${other}, not both.`);
  if (used('base') && options.analysis !== undefined) throw new Error('--base analyzes a base commit. With --analysis, use --base-analysis <id> from the summary instead.');
  if (used('base') && !options.summary) throw new Error('--base needs --summary.');
  if (used('api') && !used('base-analysis')) throw new Error('--api needs --base-analysis <id>: run code-map inspect --summary --base <ref> and use the commands that it prints.');
  if (used('api') && !apiFilters.includes(options.api)) throw new Error(`--api must be one of ${apiFilters.join(', ')}, not "${options.api}".`);
  if (used('api-group') && !used('api')) throw new Error('--api-group needs --api.');
  if (used('api-group') && !apiGroups.includes(options['api-group'])) throw new Error(`--api-group must be public or module, not "${options['api-group']}".`);
  if (used('impact') && !used('base-analysis')) throw new Error('--impact needs --base-analysis <id>: run code-map inspect --summary --base <ref> and use the commands that it prints.');
  if (used('impact') && !impactLists.includes(options.impact)) throw new Error(`--impact must be one of ${impactLists.join(', ')}, not "${options.impact}".`);
  if (used('base-analysis') && !used('findings') && !used('api') && !used('complexity') && !used('dependencies') && !used('schemas') && !used('impact') && !(options.part === 'examples.issues' && !(options.file ?? []).length) && !options.summary) throw new Error('--base-analysis needs --findings or --summary, or --complexity or --api or --dependencies or --schemas or --impact for the change of functions or exports.');
  if (used('baseline') && !used('base-analysis')) throw new Error('--baseline needs --base-analysis <id>.');
  if (used('baseline') && !used('findings')) throw new Error('--baseline needs --findings.');
  if (used('baseline') && !baselines.includes(options.baseline)) throw new Error(`--baseline must be one of ${baselines.join(', ')}, not "${options.baseline}".`);
  if (used('complexity') && !used('base-analysis')) throw new Error('--complexity needs --base-analysis <id>.');
  if (used('finding') && used('findings')) throw new Error('Use either --finding <id> or --findings, not both.');
  if (used('rule') && !used('findings')) throw new Error('--rule needs --findings.');
  // Without --finding and --file, --part names a project list, such as nextjs.routes.
  if (used('part') && !used('finding') && (options.file ?? []).length > 1) throw new Error('--part needs --finding <id>, exactly one --file <path>, or no selection for a project part such as nextjs.routes.');
  if ((used('offset') || used('limit')) && !['part', 'findings', 'complexity', 'api', 'dependencies', 'schemas', 'impact', 'undocumented'].some(used)) throw new Error('--offset and --limit need --part, --findings, --complexity, --api, --dependencies, --schemas, --impact or --undocumented.');
  if (used('full') && (used('summary') || used('finding') || used('findings') || used('part') || (options.file ?? []).length || used('change'))) throw new Error('--full reports the whole project; remove the other selections.');
  checkTriageOptions(options, used);
}

function number(text, fallback, name, minimum) {
  if (text === undefined) return fallback;
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < minimum || (name === '--limit' && Number(text) > maxLimit)) {
    throw new Error(`${name} must be a whole number ${name === '--limit' ? `from 1 to ${maxLimit}` : 'from 0'}, not "${text}".`);
  }
  return Number(text);
}

/**
 * The suggested path for a full report: in the store, whose folders are private to the user, and not in the shared temporary
 * folder. The store is outside the repository, where a written file would change the working tree.
 */
const fullOut = (root, id) => join(root, 'exports', `code-map-${id}.json`);

/** True when `path` is `folder` or inside it. Whole segments count ("..cache" is inside), and letter case does not count where the file system usually ignores it. */
export function isInside(folder, path, platform = process.platform) {
  // macOS and Windows file systems usually ignore letter case, and macOS also ignores the Unicode form (NFC or NFD).
  // macOS also reaches the data volume through the firmlink /System/Volumes/Data, and realpath keeps that prefix.
  const fold = (text) => platform === 'win32' ? text.normalize('NFC').toLowerCase()
    : platform === 'darwin' ? text.normalize('NFC').toLowerCase().replace(/^\/system\/volumes\/data(?=\/|$)/, '') || '/' : text;
  const rest = relative(fold(folder), fold(path));
  return !isAbsolute(rest) && rest.split(sep)[0] !== '..';
}

/** The device and inode of a path, or null. Some file systems give no inode (0), so their paths have no identity here. */
const identity = (path) => { try { const info = statSync(path, { bigint: true }); return info.ino === 0n ? null : `${info.dev}:${info.ino}`; } catch { return null; } };

/**
 * The folder that holds `path`, of the repository and its Git folders, or null. A linked worktree or a submodule keeps its Git
 * folders outside the repository. Two tests apply: the real paths, and the identity of the path and each parent folder. The
 * identity test also finds an alias that realpath does not resolve, such as a bind mount.
 */
export function protectedFolderOf(repository, path, platform = process.platform) {
  let gitFolders = [];
  try { gitFolders = git(repository, ['rev-parse', '--git-dir', '--git-common-dir']).split('\n').filter(Boolean).map((line) => resolve(repository, line)); } catch { /* only the repository */ }
  const folders = [repository, ...gitFolders], real = realPath(path), known = new Map(folders.map((folder) => [identity(folder), folder]));
  const byPath = folders.find((folder) => isInside(realPath(folder), real, platform));
  if (byPath !== undefined) return byPath;
  known.delete(null);
  for (let step = resolve(path); ; step = dirname(step)) {
    const found = known.get(identity(step));
    if (found !== undefined) return found;
    if (dirname(step) === step) return null;
  }
}

/**
 * The path with its symlinks resolved (macOS /var is /private/var). A folder can be new, so the nearest existing parent is
 * resolved. The native call gives the spelling on disk, so a different letter case or Unicode form resolves to the same path.
 */
export const realPath = (path) => { try { return realpathSync.native(path); } catch { const parent = dirname(path); return parent === path ? path : join(realPath(parent), basename(path)); } };

/** The checks before a collection that stores analyses: the store is outside the repository, and the labels and coverage files are inside it. */
export function checkStore(repository, config, options, location) {
  // Every store output folder counts, including exports for the suggested full report.
  const holder = [location.root, join(location.root, 'analyses'), join(location.root, 'files'), join(location.root, 'exports')].map((path) => protectedFolderOf(repository, path)).find((found) => found !== null) ?? null;
  if (holder === repository) {
    throw new Error(`The analysis store ${location.root} is inside the repository. Choose a folder outside the repository with --store <folder>: a store inside it changes the working tree that it describes.`);
  }
  if (holder !== null) throw new Error(`The analysis store ${location.root} is inside the Git folder ${holder} of the repository. Choose a folder outside the repository and its Git folders with --store <folder>: Code-map never writes into them.`);
  const exports = join(location.root, 'exports');
  if (existsSync(exports)) requirePrivateFolder(exports, 'Choose another store with --store <folder>.');
  // The store keeps these paths only inside the repository, so refuse others before the long collection starts.
  const labels = relative(repository, resolve(repository, options.labels ?? config.testLabels));
  if (!insideRepository(labels)) throw new Error(`The labels file ${options.labels ?? config.testLabels} is outside the repository. --summary needs a labels file inside it.`);
  if (typeof config.coverage === 'string' && !insideRepository(relative(repository, resolve(repository, config.coverage)))) {
    throw new Error(`The coverage file ${config.coverage} in .code-map.json is outside the repository. --summary needs a coverage file inside it.`);
  }
}

function summarize(repository, config, options, location, command, today) {
  checkStore(repository, config, options, location);
  const base = options.base === undefined ? null : baseCommit(repository, options.base);
  const head = ensure(repository, config, options, location), id = head.stored.id, freshness = { state: 'current', changed: [] };
  const context = { id, reused: head.reused, freshness, command, fullOut: fullOut(location.root, id), contentDigest: head.inputs.worktree?.contentDigest ?? null };
  if (base !== null) {
    const stored = ensure(repository, config, { ...options, worktree: false, ref: base, file: undefined, change: undefined }, location);
    context.comparison = comparisonOf(head.stored, stored.stored, freshness, stored.reused, command);
  }
  context.triage = triageContext(head.stored, context.comparison ?? null, options, today);
  return summaryReport(head.stored, context, { files: options.file ?? [], change: options.change });
}

/** The base must be a commit of this repository: never the working tree, and never a word that Git could read as an option. */
function baseCommit(repository, ref) {
  const fail = () => new Error(`The base "${ref}" is not a commit in this repository. Give --base a commit, branch or tag.`);
  if (ref === 'worktree' || ref.startsWith('-') || ref.length === 0) throw fail();
  try { git(repository, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); } catch { throw fail(); }
  return ref;
}

/**
 * A working-tree head is compared only while its commit and working tree are as stored, because the renames come from the
 * working tree as it is now. Other inputs, such as the base branch, do not change the renames.
 */
export function comparisonOf(head, base, headFreshness, baseReused, command = (args) => commandLine(['code-map', ...args])) {
  // The base analysis can take long enough for the working tree to change after the head was stored.
  if (head.inputs.selector.worktree && headFreshness.state === 'current') Object.assign(headFreshness, freshness(head, command));
  let verdict = comparability(base, head), renames = [], complete = true;
  const tree = head.inputs.selector.worktree, changed = headFreshness.changed.some((kind) => kind === 'worktree' || kind === 'commit');
  const moved = !tree ? null : headFreshness.state === 'unknown' ? 'freshness-unknown' : changed ? 'worktree-changed' : null;
  if (verdict.state === 'COMPARABLE' && moved) verdict = { state: 'NOT_COMPARABLE', reasons: [moved] };
  else if (verdict.state === 'COMPARABLE') {
    try { ({ renames, complete } = gitRenames(head.inputs.repository, base.data.sha, tree ? null : head.data.sha)); }
    catch { verdict = { state: 'NOT_COMPARABLE', reasons: ['renames-unavailable'] }; }
  }
  const policy = tree && headFreshness.state !== 'current'
    ? { informationOnly: true, state: 'UNKNOWN', reason: 'The stored working-tree policy is stale or its freshness is unknown.' } : revisionPolicy(head, base);
  return { base, baseReused, renames, complete, policy, changed: changedForOwners(head, base, verdict, tree),
    result: compareFindings(base, head, { renames, complete, olderFixCommits: olderFixCommits(head, base), comparability: verdict }) };
}

/** The changed files from the base to the head, for the owners of the change. Only a comparable pair with a CODEOWNERS file reads them. */
function changedForOwners(head, base, verdict, tree) {
  if (verdict.state !== 'COMPARABLE' || ![head, base].some((stored) => stored.data.analysis.ownership?.file)) return null;
  try { return changedFiles(head.inputs.repository, base.data.sha, tree ? null : head.data.sha).files; } catch { return null; }
}

/** The fix commits of the head that the base history already holds. Git exits 1 for a commit that is not an ancestor. */
function olderFixCommits(head, base) {
  const older = new Set();
  for (const finding of head.findings) {
    if (finding.ruleId !== 'FIX-WITHOUT-TEST') continue;
    try { git(head.inputs.repository, ['merge-base', '--is-ancestor', finding.key[0], base.data.sha]); older.add(finding.key[0]); } catch { /* newer than the base, or unknown */ }
  }
  return older;
}

/** Reuses a stored analysis or builds one with per-file reuse. `--no-cache` forces a fresh parse of every file. */
export function ensure(repository, config, options, location) {
  const ref = selectRef(repository, config, options), inputs = analysisInputs(repository, config, options, ref), id = analysisId(inputs);
  let stored = null;
  try { if (!options['no-cache']) stored = loadAnalysis(location.root, id); } catch { stored = null; }
  const reused = stored !== null;
  if (!reused) {
    const cache = options['no-cache'] ? null : openFileCache(location.root, { inputs: { config: inputs.config, lockfile: inputs.lockfile } });
    const facts = collect(repository, config, { ...options, ...(ref === null ? {} : { ref }) }, cache);
    const data = mapData(repository, config, facts, analysisHistory, options.worktree), schemas = snapshotSchemas(facts.reader, facts.texts);
    if (facts.reader.sha !== inputs.sha || analysisId(analysisInputs(repository, config, options, ref)) !== id) {
      throw new Error('The code changed while Code-map analyzed it. Run the command again when the files are stable.');
    }
    // The roots decide which files the analysis maps, so a comparison checks them.
    const { project, ref: label, sha, generatedAt, coverageSnapshot, changes, roots, analysis } = data;
    // The counts of the file cache describe this run, not the code: the summary shows them, and nothing compares them.
    const parsed = facts.files.length + facts.testFacts.length, counts = cache ? cache.finish() : { state: 'off', hits: 0, misses: parsed, written: 0, removed: 0 };
    stored = { storeVersion, id, inputs, createdAt: generatedAt, cache: counts, data: { project, ref: label, sha, generatedAt, coverageSnapshot, changes, roots, analysis, schemas }, findings: deriveFindings(analysis) };
    saveAnalysis(location.root, stored);
  }
  return { stored, reused, inputs };
}

/** Compares the stored inputs with the inputs of the same request now. The evidence stays that of the stored snapshot. */
/** `now.inputs` receives the inputs of the current code, for the content digest that run manifests bind to. */
function freshness(stored, command, now = {}) {
  const { repository, selector, labels } = stored.inputs;
  try {
    const config = loadConfig(repository), options = { types: !!stored.inputs.typed, worktree: selector.worktree, ...(selector.ref === null ? {} : { ref: selector.ref }), labels: labels.path };
    now.inputs = analysisInputs(repository, config, options, selectRef(repository, config, options));
    const changed = changedInputs(stored.inputs, now.inputs);
    if (!changed.length) return { state: 'current', changed };
    const select = selector.worktree ? ['--worktree'] : selector.ref === null ? [] : ['--ref', selector.ref];
    const labelArgs = labels.path === relative(repository, resolve(repository, config.testLabels)) ? [] : ['--labels', labels.path];
    return { state: 'stale', changed, refresh: command(['inspect', '--summary', ...select, ...labelArgs]),
      text: 'The code or the analysis inputs changed after this analysis. This report shows the stored snapshot, not the current code.' };
  } catch (error) {
    return { state: 'unknown', changed: [], text: `Code-map could not check the current code: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Quotes a word for a POSIX shell only when it needs it. zsh expands a word that starts with "=", so that word is quoted. */
export function quote(word) {
  return /^[A-Za-z0-9_\/.,:=@%+-]+$/.test(word) && !word.startsWith('=') ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/** A command line to paste. An option value that starts with "-" is printed as --option=value, so a parser cannot read it as an option. */
export function commandLine(args) {
  const words = [];
  for (let index = 0; index < args.length; index++) {
    if (valueOptions.has(args[index]) && args[index + 1]?.startsWith('-')) words.push(`${args[index]}=${args[++index]}`);
    else words.push(args[index]);
  }
  return words.map(quote).join(' ');
}
