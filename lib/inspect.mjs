// Summary-first inspection: `--summary` analyzes a snapshot once (or reuses the stored analysis of the same inputs) and
// prints a small overview. `--analysis <id>` reads that stored analysis: one finding, a page of findings, a page of
// evidence, a file report or the full report. Follow-ups never collect again; they only check whether the code changed.
// `--base <ref>` also analyzes a base commit and labels each finding NEW, EXISTING, RESOLVED or UNKNOWN against it.
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { collect, mapData, selectRef } from './build.mjs';
import { compareFindings, comparability } from './compare.mjs';
import { gitRenames } from './compare-git.mjs';
import { deriveFindings } from './findings.mjs';
import { git } from './git.mjs';
import { analysisId, analysisInputs, changedInputs } from './inputs.mjs';
import { defaultLimit, fileReport, filePart, findingReport, findingsPage, maxLimit, summaryReport } from './overview.mjs';
import { loadConfig } from './project.mjs';
import { insideRepository, loadAnalysis, saveAnalysis, storeLocation, storeVersion, validId } from './store.mjs';

/** The analysis does not use the history strip, so the store reads only its two end points. */
const analysisHistory = 2;
const retrievalOnly = ['base-analysis', 'baseline', 'finding', 'findings', 'rule', 'part', 'offset', 'limit', 'full'];
const baselines = ['new', 'existing', 'resolved', 'unknown'];
/** The options that take a value, so that a printed command can keep a value that starts with "-" attached to its option. */
const valueOptions = new Set(['--analysis', '--base-analysis', '--finding', '--rule', '--part', '--offset', '--limit', '--file', '--change', '--store', '--ref', '--labels', '--out', '--baseline']);
/** Each report reads its own options. These pairs select two reports, or give an option that the selected report ignores. */
const conflicts = [['finding', ['file', 'change', 'rule', 'baseline', 'summary']], ['findings', ['part', 'summary']], ['summary', ['part']], ['part', ['change']]];

/** True when the options ask for a summary or a stored analysis rather than the classic report. */
export const isRetrieval = (options) => !!options.summary || options.analysis !== undefined || options.store !== undefined || options.base !== undefined
  || retrievalOnly.some((name) => options[name] !== undefined && options[name] !== false);

export function retrieve(repository, config, options, env = process.env) {
  check(options);
  const location = storeLocation(options.store, env);
  const command = (args) => commandLine(['code-map', ...args, ...(location.explicit ? ['--store', location.root] : [])]);
  if (options.analysis === undefined) return summarize(repository, config, options, location, command);
  const id = validId(options.analysis), stored = loadAnalysis(location.root, id);
  if (!stored) throw new Error(`Analysis ${id} is not in the store (${location.root}). Run code-map inspect --summary in the repository again; unchanged code gets the same ID.`);
  const now = {}, context = { id, freshness: freshness(stored, command, now), command, fullOut: fullOut(location.root, id) };
  if (now.inputs && context.freshness.state === 'current') context.contentDigest = now.inputs.worktree?.contentDigest ?? null;
  if (options['base-analysis'] !== undefined) {
    const baseId = validId(options['base-analysis']), base = loadAnalysis(location.root, baseId);
    if (!base) throw new Error(`Analysis ${baseId} is not in the store (${location.root}). Run code-map inspect --summary --base <ref> in the repository again.`);
    if (base.inputs.selector.worktree) throw new Error(`The base analysis must be of a commit, but ${baseId} is of a working tree.`);
    context.comparison = comparisonOf(stored, base, context.freshness);
  }
  const paging = { offset: number(options.offset, 0, '--offset', 0), limit: number(options.limit, defaultLimit, '--limit', 1) };
  const selection = { files: options.file ?? [], change: options.change, includeVendors: !options['exclude-vendors'] };
  if (options.finding !== undefined) return findingReport(stored, context, options.finding, { part: options.part ?? null, ...paging });
  if (options.findings) return findingsPage(stored, context, { rule: options.rule ?? null, selection, baseline: options.baseline?.toUpperCase() ?? null, ...paging });
  if (options.full) return fileReport(stored, context, { includeVendors: selection.includeVendors });
  if (options.part !== undefined) return filePart(stored, context, selection.files[0], options.part, paging);
  if (options.summary || (!selection.files.length && !selection.change)) return summaryReport(stored, { ...context, reused: true }, selection);
  return fileReport(stored, context, selection);
}

function check(options) {
  const used = (name) => options[name] !== undefined && options[name] !== false;
  for (const name of retrievalOnly) if (used(name) && options.analysis === undefined) throw new Error(`--${name} needs --analysis <id>: run code-map inspect --summary first and use the commands that it prints.`);
  if (options.store !== undefined && !options.summary && options.analysis === undefined) throw new Error('--store needs --summary or --analysis <id>.');
  if (options.analysis !== undefined && (options.worktree || options.ref !== undefined)) throw new Error('--analysis already identifies the snapshot. Remove --worktree and --ref.');
  for (const [one, others] of conflicts) for (const other of others) if (used(one) && used(other)) throw new Error(`Use either --${one} or --${other}, not both.`);
  if (used('base') && options.analysis !== undefined) throw new Error('--base analyzes a base commit. With --analysis, use --base-analysis <id> from the summary instead.');
  if (used('base') && !options.summary) throw new Error('--base needs --summary.');
  if (used('base-analysis') && !used('findings') && !options.summary) throw new Error('--base-analysis needs --findings or --summary.');
  if (used('baseline') && !used('base-analysis')) throw new Error('--baseline needs --base-analysis <id>.');
  if (used('baseline') && !used('findings')) throw new Error('--baseline needs --findings.');
  if (used('baseline') && !baselines.includes(options.baseline)) throw new Error(`--baseline must be one of ${baselines.join(', ')}, not "${options.baseline}".`);
  if (used('finding') && used('findings')) throw new Error('Use either --finding <id> or --findings, not both.');
  if (used('rule') && !used('findings')) throw new Error('--rule needs --findings.');
  if (used('part') && !used('finding') && (options.file ?? []).length !== 1) throw new Error('--part needs --finding <id> or exactly one --file <path>.');
  if ((used('offset') || used('limit')) && !used('part') && !used('findings')) throw new Error('--offset and --limit need --part or --findings.');
  if (used('full') && (used('summary') || used('finding') || used('findings') || used('part') || (options.file ?? []).length || used('change'))) throw new Error('--full reports the whole project; remove the other selections.');
}

function number(text, fallback, name, minimum) {
  if (text === undefined) return fallback;
  if (!/^\d+$/.test(text) || Number(text) < minimum || (name === '--limit' && Number(text) > maxLimit)) {
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
  const fold = (text) => platform === 'darwin' || platform === 'win32' ? text.normalize('NFC').toLowerCase() : text;
  const rest = relative(fold(folder), fold(path));
  return !isAbsolute(rest) && rest.split(sep)[0] !== '..';
}

function summarize(repository, config, options, location, command) {
  // The store folder can be new, so resolve symlinks (macOS /var is /private/var) through its nearest existing parent.
  // The native call gives the spelling on disk, so a different letter case or Unicode form resolves to the same path.
  const real = (path) => { try { return realpathSync.native(path); } catch { const parent = dirname(path); return parent === path ? path : join(real(parent), basename(path)); } };
  if (isInside(real(repository), real(location.root))) {
    throw new Error(`The analysis store ${location.root} is inside the repository. Choose a folder outside the repository with --store <folder>: a store inside it changes the working tree that it describes.`);
  }
  // The store keeps these paths only inside the repository, so refuse others before the long collection starts.
  const labels = relative(repository, resolve(repository, options.labels ?? config.testLabels));
  if (!insideRepository(labels)) throw new Error(`The labels file ${options.labels ?? config.testLabels} is outside the repository. --summary needs a labels file inside it.`);
  if (typeof config.coverage === 'string' && !insideRepository(relative(repository, resolve(repository, config.coverage)))) {
    throw new Error(`The coverage file ${config.coverage} in .code-map.json is outside the repository. --summary needs a coverage file inside it.`);
  }
  const base = options.base === undefined ? null : baseCommit(repository, options.base);
  const head = ensure(repository, config, options, location), id = head.stored.id, freshness = { state: 'current', changed: [] };
  const context = { id, reused: head.reused, freshness, command, fullOut: fullOut(location.root, id), contentDigest: head.inputs.worktree?.contentDigest ?? null };
  if (base !== null) {
    const stored = ensure(repository, config, { ...options, worktree: false, ref: base, file: undefined, change: undefined }, location);
    context.comparison = comparisonOf(head.stored, stored.stored, freshness, stored.reused);
  }
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
function comparisonOf(head, base, headFreshness, baseReused) {
  let verdict = comparability(base, head), renames = [], complete = true;
  const tree = head.inputs.selector.worktree, changed = headFreshness.changed.some((kind) => kind === 'worktree' || kind === 'commit');
  const moved = !tree ? null : headFreshness.state === 'unknown' ? 'freshness-unknown' : changed ? 'worktree-changed' : null;
  if (verdict.state === 'COMPARABLE' && moved) verdict = { state: 'NOT_COMPARABLE', reasons: [moved] };
  else if (verdict.state === 'COMPARABLE') {
    try { ({ renames, complete } = gitRenames(head.inputs.repository, base.data.sha, tree ? null : head.data.sha)); }
    catch { verdict = { state: 'NOT_COMPARABLE', reasons: ['renames-unavailable'] }; }
  }
  return { base, baseReused, renames, result: compareFindings(base, head, { renames, complete, olderFixCommits: olderFixCommits(head, base), comparability: verdict }) };
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

/** The stored analysis of these inputs, or a new one. An unreadable store entry is replaced. */
function ensure(repository, config, options, location) {
  const ref = selectRef(repository, config, options), inputs = analysisInputs(repository, config, options, ref), id = analysisId(inputs);
  let stored = null;
  try { stored = loadAnalysis(location.root, id); } catch { stored = null; }
  const reused = stored !== null;
  if (!reused) {
    const facts = collect(repository, config, { ...options, ...(ref === null ? {} : { ref }) });
    const data = mapData(repository, config, facts, analysisHistory, options.worktree);
    if (facts.reader.sha !== inputs.sha || analysisId(analysisInputs(repository, config, options, ref)) !== id) {
      throw new Error('The code changed while Code-map analyzed it. Run the command again when the files are stable.');
    }
    // The roots decide which files the analysis maps, so a comparison checks them.
    const { project, ref: label, sha, generatedAt, coverageSnapshot, changes, roots, analysis } = data;
    stored = { storeVersion, id, inputs, createdAt: generatedAt, data: { project, ref: label, sha, generatedAt, coverageSnapshot, changes, roots, analysis }, findings: deriveFindings(analysis) };
    saveAnalysis(location.root, stored);
  }
  return { stored, reused, inputs };
}

/** Compares the stored inputs with the inputs of the same request now. The evidence stays that of the stored snapshot. */
/** `now.inputs` receives the inputs of the current code, for the content digest that run manifests bind to. */
function freshness(stored, command, now = {}) {
  const { repository, selector, labels } = stored.inputs;
  try {
    const config = loadConfig(repository), options = { worktree: selector.worktree, ...(selector.ref === null ? {} : { ref: selector.ref }), labels: labels.path };
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
function commandLine(args) {
  const words = [];
  for (let index = 0; index < args.length; index++) {
    if (valueOptions.has(args[index]) && args[index + 1]?.startsWith('-')) words.push(`${args[index]}=${args[++index]}`);
    else words.push(args[index]);
  }
  return words.map(quote).join(' ');
}
