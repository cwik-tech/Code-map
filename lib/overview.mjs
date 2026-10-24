// The small overview and the retrievable evidence of one stored analysis. Pure: the caller loads the analysis,
// checks its freshness and supplies `command(args)`, which prints an exact follow-up command for the same analysis.
import { createReport } from './analysis.mjs';
import { cacheLimit, gaps } from './overview-gaps.mjs';
import { architectureSummary, ownersChange } from './architecture-view.mjs';
import { compareAreas, changedSourcePaths } from './complexity-areas.mjs';
import { compareComplexity } from './complexity.mjs';
import { apiSummary } from './api-report.mjs';
import { findingRules, summaryItems } from './findings.mjs';
import { findingDetails } from './finding-details.mjs';
import { contractParts, contractSummary } from './contracts/report.mjs';
import { openapiParts, openapiSummary } from './contracts/openapi-report.mjs';
import { electronIpcParts, electronIpcSummary } from './frameworks/electron-ipc-report.mjs';
import { envParts, envSummary } from './frameworks/env-report.mjs';
import { electronSummary } from './frameworks/electron.mjs';
import { frameworkParts, frameworkSummary } from './frameworks/next-report.mjs';
import { modelParts, modelSummary } from './models/model-report.mjs';
import { dependencyList, supplyChange, supplyView } from './supply/summary.mjs';
import { changeView, inventoryEntries, inventoryView, schemaChange } from './schemas/report.mjs';
import { documentationSummary, impactSummary } from './impact/report.mjs';
import { summarizeTests } from './test-summary.mjs';
import { triageSummary, triageView } from './triage-view.mjs';

export const defaultLimit = 20;
export const maxLimit = 500;
/** A summary or a page shows at most this many selected files and missing paths. The file report has the complete lists. */
const selectionShown = 20;
const filePartNames = ['imports', 'importers', 'exports', 'declarations', 'tests.direct', 'tests.transitive', 'coChanges'];

/** One page of a list, with its total and the exact command for the next page (null on the last page). */
export function page(list, { offset = 0, limit = defaultLimit } = {}, next) {
  const end = offset + limit;
  return { total: list.length, offset, limit, items: list.slice(offset, end), next: end < list.length ? next(end) : null };
}

const block = (stored, context) => ({ id: stored.id, createdAt: stored.createdAt, freshness: context.freshness });
const selectionArgs = (selection) => [...(selection?.files ?? []).flatMap((path) => ['--file', path]), ...(selection?.change ? ['--change', selection.change] : [])];
const scoped = (selection) => (selection?.files?.length ?? 0) > 0 || !!selection?.change;

/** The IDs of the test cases that reach a function in one of `paths`, as in a file report. */
const casesReaching = (analysis, paths) => new Set((analysis.tests?.units ?? []).filter((unit) => paths.has(unit.path)).flatMap((unit) => [...unit.direct, ...unit.viaCases.map((item) => item.id)]));

/**
 * The files of a selection, the scoped test summary, and filters for head findings and for base entries of a comparison.
 * Unknown files fail, as in `inspect --file`.
 */
function scope(stored, selection, comparison = null) {
  if (!scoped(selection)) return { report: null, inScope: () => true, inBase: () => true };
  const report = createReport(stored.data, { files: selection.files ?? [], change: selection.change }, summarizeTests);
  const paths = new Set([...report.selection.files, ...report.selection.missing]), cases = casesReaching(stored.data.analysis, paths);
  // Base entries carry their paths after renames, but case IDs belong to one analysis. The base cases come from the base
  // analysis, with the selected paths moved back through the renames, so both sides are scoped the same way.
  const back = new Map((comparison?.renames ?? []).map((item) => [item.to, item.from]));
  const baseCases = comparison ? casesReaching(comparison.base.data.analysis, new Set([...paths].map((path) => back.get(path) ?? path))) : new Set();
  const touches = (list, ids, known) => list.some((path) => paths.has(path)) || (ids ?? []).some((id) => known.has(id));
  return { report, inScope: (finding) => touches(finding.paths, finding.caseIds, cases), inBase: (entry) => touches(entry.paths, entry.finding.caseIds, baseCases) };
}

/** The selection, cut to `selectionShown` files and missing paths, with the totals and the command for the complete file report. */
function selectionView(report, context, selection) {
  const { files, change, missing } = report.selection;
  return { files: files.slice(0, selectionShown), change, missing: missing.slice(0, selectionShown), totals: { files: files.length, missing: missing.length },
    report: context.command(['inspect', '--analysis', context.id, ...selectionArgs(selection)]) };
}

/** `analysisId` is the analysis that holds the finding: the base analysis for a resolved finding of a comparison. */
function item(finding, context, extra = {}, analysisId = context.id) {
  const { id, ruleId, fingerprint, severity, source, capability, title, text, location, evidence } = finding;
  return { id, ruleId, fingerprint, severity, source, capability, title, text, location, evidence: evidence.slice(0, 3), ...extra,
    next: context.command(['inspect', '--analysis', analysisId, '--finding', id]) };
}

const baselines = ['NEW', 'UNKNOWN', 'EXISTING'], severityOrder = ['high', 'medium', 'low'];
const statusOf = (comparison, finding) => { const status = comparison.result.statuses[finding.id]; return { baseline: status.baseline, matchedBy: status.matchedBy }; };

/** The head findings of a comparison with their labels, and the base findings (resolved or unknown) in scope. */
function comparisonEntries(context, findings, inBase, rule) {
  const { base, result } = context.comparison, keep = (entry) => (rule === null || entry.finding.ruleId === rule) && inBase(entry);
  const head = findings.map((finding) => ({ finding, analysisId: context.id, extra: { ...statusOf(context.comparison, finding), side: 'head' } }));
  const fromBase = (list, baseline) => list.filter(keep).map((entry) => ({ finding: entry.finding, analysisId: base.id, extra: { baseline, matchedBy: entry.matchedBy, side: 'base' } }));
  return { head, resolved: fromBase(result.resolved, 'RESOLVED'), unknown: fromBase(result.baseUnknown, 'UNKNOWN') };
}

function comparisonBlock(context, entries) {
  const { base, result, baseReused } = context.comparison, count = (baseline) => entries.head.filter((entry) => entry.extra.baseline === baseline).length;
  return { base: { id: base.id, sha: base.data.sha, ref: base.data.ref, selector: base.inputs.selector, ...(baseReused === undefined ? {} : { reused: baseReused }) },
    state: result.state, reasons: result.reasons, policy: context.comparison.policy,
    counts: { new: count('NEW'), existing: count('EXISTING'), resolved: entries.resolved.length, unknown: count('UNKNOWN') + entries.unknown.length } };
}

/** The summary shows at most this many functions of the complexity change: grew first, then new. */
const complexityShown = 5;
/** The complexity change of a comparison, or null when the analyses are not comparable. */
const complexityChange = ({ base, result, renames, complete }, data) => result.state === 'COMPARABLE' ? {
  ...compareComplexity(base.data.analysis, data.analysis, renames, complete),
  areas: compareAreas(base.data.analysis, data.analysis, changedSourcePaths(base.data.analysis.files, data.analysis.files), renames, complete) } : null;

/** The complexity change of a comparison: counts, at most `complexityShown` grew and new examples, and the command for the complete list. */
function complexityView(context, data) {
  const result = complexityChange(context.comparison, data);
  if (!result) return null;
  const grew = result.grew.slice(0, complexityShown);
  return { counts: result.counts, areas: result.areas, grew, new: result.new.slice(0, complexityShown - grew.length),
    next: context.command(['inspect', '--analysis', context.id, '--base-analysis', context.comparison.base.id, '--complexity']) };
}

/** The command for the complete package list, or with a comparison for the complete dependency change. */
const dependenciesArgs = (context) => ['inspect', '--analysis', context.id, ...(context.comparison ? ['--base-analysis', context.comparison.base.id] : []), '--dependencies'];

/** The packages of the lockfile, or with a comparison the dependency changes, one page at a time (`code-map-dependencies`). */
export function dependenciesPage(stored, context, { offset = 0, limit = defaultLimit } = {}) {
  const comparison = context.comparison ?? null, list = dependencyList(stored.data.analysis.supply, comparison), args = dependenciesArgs(context);
  return { reportType: 'code-map-dependencies', schemaVersion: 1, analysis: block(stored, context),
    ...(comparison ? { comparison: { base: { id: comparison.base.id, sha: comparison.base.data.sha, ref: comparison.base.data.ref, selector: comparison.base.inputs.selector },
      state: comparison.result.state, reasons: comparison.result.reasons } } : {}), supply: list.view,
    page: page(list.items, { offset, limit }, (next) => context.command([...args, '--offset', String(next), ...(limit === defaultLimit ? [] : ['--limit', String(limit)])])) };
}

/** The complete complexity change of a comparison, one page at a time: grew, new, unknown, then fell. */
export function complexityPage(stored, context, { offset = 0, limit = defaultLimit } = {}) {
  const { base, result } = context.comparison, compared = complexityChange(context.comparison, stored.data);
  const entries = compared ? ['grew', 'new', 'unknown', 'fell'].flatMap((change) => compared[change].map((entry) => ({ ...entry, change }))) : [];
  const args = ['inspect', '--analysis', context.id, '--base-analysis', base.id, '--complexity'];
  return { reportType: 'code-map-complexity', schemaVersion: 1, analysis: block(stored, context),
    comparison: { base: { id: base.id, sha: base.data.sha, ref: base.data.ref, selector: base.inputs.selector }, state: result.state, reasons: result.reasons },
    complexity: compared ? { counts: compared.counts, areas: compared.areas } : null,
    page: page(entries, { offset, limit }, (next) => context.command([...args, '--offset', String(next), ...(limit === defaultLimit ? [] : ['--limit', String(limit)])])) };
}

export function summaryReport(stored, context, selection = {}) {
  const { data } = stored, { analysis } = data, comparison = context.comparison ?? null, { report, inScope, inBase } = scope(stored, selection, comparison);
  // The triage file can hide findings from the lists. `all` keeps them for the hidden counts.
  const view = triageView(context), all = stored.findings.filter(inScope), findings = view.shown(all), extra = [...(report ? selectionArgs(selection) : []), ...view.args];
  // With a base, new findings come first inside each severity; the caps of summaryItems still apply.
  const rank = (finding) => severityOrder.indexOf(finding.severity) * 3 + baselines.indexOf(statusOf(comparison, finding).baseline);
  const shown = summaryItems(comparison ? findings.map((finding, index) => ({ finding, index })).sort((a, b) => rank(a.finding) - rank(b.finding) || a.index - b.index).map((entry) => entry.finding) : findings);
  const entries = comparison ? comparisonEntries(context, findings, inBase, null) : null;
  // Every findings list of a comparison names the base, so its items keep their labels and the resolved findings.
  const findingsCommand = (args = []) => context.command(['inspect', '--analysis', context.id, ...(comparison ? ['--base-analysis', comparison.base.id] : []), '--findings', ...args, ...extra]);
  const listCommand = (baseline, more = []) => findingsCommand(['--baseline', baseline, ...more]);
  const byRule = Object.keys(findingRules).map((ruleId) => ({ ruleId, ...findingRules[ruleId], count: findings.filter((finding) => finding.ruleId === ruleId).length }))
    .filter((rule) => rule.count > 0).map((rule) => ({ ...rule, next: findingsCommand(['--rule', rule.ruleId]) }));
  const bySeverity = { high: 0, medium: 0, low: 0 };
  for (const finding of findings) bySeverity[finding.severity]++;
  const tests = (report ? report.testSummary : analysis.tests?.summary)?.statistics.map(({ key, source, label, value, warn }) => ({ key, source, label, value, ...(warn ? { warn } : {}) })) ?? [];
  // A project without schema files keeps its summary as it was: no schemas field, in the summary or in the comparison.
  const schemas = inventoryView(data.schemas, context.command(['inspect', '--analysis', context.id, '--schemas']));
  const schemaChanges = comparison ? changeView(schemaChange(comparison, data.schemas), context.command(['inspect', '--analysis', context.id, '--base-analysis', comparison.base.id, '--schemas'])) : undefined;
  // The architecture block counts unowned source files even without CODEOWNERS. A comparison uses both ownership files.
  const architecture = architectureSummary(analysis), owners = comparison ? ownersChange(comparison, analysis) : undefined;
  return { ...(analysis.typed ? { typed: { state: analysis.typed.state, reason: analysis.typed.reason ?? null, programs: analysis.typed.programs } } : {}), reportType: 'code-map-summary', schemaVersion: 1, analysis: { ...block(stored, context), reused: context.reused },
    snapshot: { project: data.project, ref: data.ref, sha: data.sha, workingTree: data.coverageSnapshot === 'working-tree',
      // The digest that a run manifest records: the content of every changed file now. It is not part of the analysis ID.
      worktreeDigest: context.contentDigest !== undefined ? context.contentDigest : stored.inputs.worktree?.contentDigest ?? null, selector: stored.inputs.selector },
    scope: { selection: report ? selectionView(report, context, selection) : null, sourceFiles: analysis.files.length, testFiles: analysis.tests?.testFiles.length ?? 0, testCases: analysis.tests?.cases.length ?? 0 },
    ...(analysis.safeguards ? { safeguards: analysis.safeguards } : {}),
    verification: { state: 'NOT_RUN', readiness: null, ratings: null,
      text: 'No verification ran in this summary. The findings are static leads, not PASS or FAIL results, and they give no rating. For ratings and a readiness state, run code-map verify --request <file> (refer to docs/verify.md).' },
    findings: { total: findings.length, shown: shown.length, bySeverity, byRule, items: shown.map((finding) => item(finding, context, { ...(comparison ? statusOf(comparison, finding) : {}), ...view.note(finding) })),
      next: findings.length > shown.length ? findingsCommand() : null, ...view.hidden(all) },
    comparison: !comparison ? null : { ...comparisonBlock(context, entries),
      complexity: complexityView(context, data), ...(owners === undefined ? {} : { owners }),
      ...supplyChange(comparison, analysis.supply, context.command(dependenciesArgs(context))),
      ...(schemaChanges === undefined ? {} : { schemas: schemaChanges }),
      resolved: page(entries.resolved.map((entry) => item(entry.finding, context, entry.extra, entry.analysisId)), { offset: 0, limit: 10 }, (next) => listCommand('resolved', ['--offset', String(next), '--limit', '10'])),
      next: Object.fromEntries(['new', 'existing', 'resolved', 'unknown'].map((baseline) => [baseline, listCommand(baseline)])) },
    // The export changes of a comparison are a section of their own, for the whole project (lib/api-report.mjs).
    ...(comparison ? { api: apiSummary(stored, context), impact: impactSummary(stored, context) } : {}),
    completeness: analysis.completeness ?? null,
    gaps: gaps(stored), tests, ...(schemas ? { schemas } : {}), frameworks: frameworksBlock(analysis, context),
    ...(architecture ? { architecture } : {}),
    // Only a snapshot with a lockfile has a supply part, so the summary of a project without one does not change.
    ...(analysis.supply ? { supply: supplyView(analysis.supply, context.command(['inspect', '--analysis', context.id, '--dependencies'])) } : {}),
    models: modelSummary(analysis, (part) => context.command(['inspect', '--analysis', context.id, '--part', part])),
    documentation: documentationSummary(stored, context),
    commands: { findings: findingsCommand(), file: context.command(['inspect', '--analysis', context.id, '--file', '<path>']),
      full: context.command(['inspect', '--analysis', context.id, '--full', '--out', context.fullOut ?? '<file>']) },
    limits: [...analysis.limits, ...cacheLimit(stored.cache)], ...triageSummary(stored, context) };
}

/** The support report of each framework: Next.js, the environment keys and the API contracts. It covers the whole project. */
function frameworksBlock(analysis, context) {
  const partCommand = (part) => context.command(['inspect', '--analysis', context.id, '--part', part]);
  return { ...electronSummary(analysis), ...frameworkSummary(analysis, partCommand), ...electronIpcSummary(analysis, partCommand), ...contractSummary(analysis, context), env: envSummary(analysis, partCommand), openapi: openapiSummary(analysis, partCommand, context.comparison ?? null) };
}

/** A page of findings. With a comparison, `baseline` (NEW, EXISTING, RESOLVED or UNKNOWN) filters by label; resolved findings come from the base. */
export function findingsPage(stored, context, { rule = null, selection = {}, offset = 0, limit = defaultLimit, baseline = null } = {}) {
  if (rule !== null && !Object.hasOwn(findingRules, rule)) throw new Error(`Unknown rule "${rule}". Rules: ${Object.keys(findingRules).join(', ')}`);
  const comparison = context.comparison ?? null, { report, inScope, inBase } = scope(stored, selection, comparison), view = triageView(context);
  const extra = [...(report ? selectionArgs(selection) : []), ...view.args], all = stored.findings.filter((finding) => (rule === null || finding.ruleId === rule) && inScope(finding)), findings = view.shown(all);
  const entries = comparison ? comparisonEntries(context, findings, inBase, rule) : null;
  // As in the summary: inside each severity, NEW findings come first, then UNKNOWN, then EXISTING.
  const rank = (entry) => severityOrder.indexOf(entry.finding.severity) * 3 + baselines.indexOf(entry.extra.baseline);
  const head = entries ? entries.head.map((entry, index) => ({ entry, index })).sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index).map(({ entry }) => entry) : [];
  const list = !entries ? findings.map((finding) => ({ finding, analysisId: context.id, extra: {} }))
    : baseline === null ? [...head, ...entries.resolved, ...entries.unknown] : baseline === 'RESOLVED' ? entries.resolved
      : [...head.filter((entry) => entry.extra.baseline === baseline), ...(baseline === 'UNKNOWN' ? entries.unknown : [])];
  const args = ['inspect', '--analysis', context.id, ...(comparison ? ['--base-analysis', comparison.base.id] : []), '--findings', ...(rule ? ['--rule', rule] : []),
    ...(baseline ? ['--baseline', baseline.toLowerCase()] : []), ...extra];
  const result = page(list, { offset, limit }, (next) => context.command([...args, '--offset', String(next), ...(limit === defaultLimit ? [] : ['--limit', String(limit)])]));
  return { reportType: 'code-map-findings', schemaVersion: 1, analysis: block(stored, context), filter: { rule, baseline, selection: report ? selectionView(report, context, selection) : null, ...view.filter },
    ...(comparison ? { comparison: comparisonBlock(context, entries) } : {}), ...view.block(all),
    page: { ...result, items: result.items.map((entry) => item(entry.finding, context, { ...entry.extra, ...(entry.analysisId === context.id ? view.note(entry.finding) : {}) }, entry.analysisId)) } };
}

/** The schema inventory, one page at a time. With a comparison, the schema changes, one page at a time: breaking, unknown, then compatible. */
export function schemasPage(stored, context, { offset = 0, limit = defaultLimit } = {}) {
  const comparison = context.comparison ?? null, args = ['inspect', '--analysis', context.id, ...(comparison ? ['--base-analysis', comparison.base.id] : []), '--schemas'];
  const pager = (list) => page(list, { offset, limit }, (next) => context.command([...args, '--offset', String(next), ...(limit === defaultLimit ? [] : ['--limit', String(limit)])]));
  if (!comparison) {
    const view = inventoryView(stored.data.schemas, null);
    return { reportType: 'code-map-schemas', schemaVersion: 1, analysis: block(stored, context), schemas: view ? { kinds: view.kinds, migrations: view.migrations } : null, page: pager(inventoryEntries(stored.data.schemas)) };
  }
  const { base, result } = comparison, compared = schemaChange(comparison, stored.data.schemas) ?? null;
  return { reportType: 'code-map-schema-changes', schemaVersion: 1, analysis: block(stored, context),
    comparison: { base: { id: base.id, sha: base.data.sha, ref: base.data.ref, selector: base.inputs.selector }, state: result.state, reasons: result.reasons },
    schemas: compared ? { counts: compared.counts, migrations: compared.migrations } : null, page: pager(compared ? compared.changes : []) };
}

/** One finding with its evidence. With `part`, one complete evidence list of the finding, one page at a time. */
export function findingReport(stored, context, id, { part = null, offset = 0, limit = defaultLimit } = {}) {
  const finding = stored.findings.find((entry) => entry.id === id);
  if (!finding) throw new Error(`No finding ${id} in analysis ${stored.id}. List the findings with: ${context.command(['inspect', '--analysis', stored.id, '--findings'])}`);
  const base = ['inspect', '--analysis', context.id, '--finding', id];
  const pager = (name, list, options = {}) => page(list, options, (next) => context.command([...base, '--part', name, '--offset', String(next), ...((options.limit ?? defaultLimit) === defaultLimit ? [] : ['--limit', String(options.limit)])]));
  const fileCommand = (path) => context.command(['inspect', '--analysis', context.id, '--file', path]);
  const { details, parts } = findingDetails(stored.data.analysis, finding, (name, list) => pager(name, list), fileCommand);
  const { weight, ...shown } = finding;
  if (part === null) return { reportType: 'code-map-finding', schemaVersion: 1, analysis: block(stored, context), finding: shown, details, ...triageView(context).detail(finding) };
  if (!Object.hasOwn(parts, part)) throw new Error(`Unknown part "${part}" for finding ${id}. Parts: ${Object.keys(parts).join(', ') || 'none'}`);
  return { reportType: 'code-map-evidence', schemaVersion: 1, analysis: block(stored, context), target: { finding: id }, part, page: pager(part, parts[part], { offset, limit }) };
}

/**
 * The inspection report (schema version 1) of a file or change selection, or of the whole project, from the stored analysis.
 * With a CODEOWNERS file or an ownership setting, `owners` gives the owners of each reported file and the CODEOWNERS line.
 */
export function fileReport(stored, context, selection = {}) {
  const report = createReport(stored.data, { files: selection.files ?? [], change: selection.change, includeVendors: selection.includeVendors !== false }, summarizeTests);
  return { ...report, analysis: block(stored, context) };
}

/** One complete project list of the framework report or of the model report (refer to frameworkParts and modelParts), one page at a time. */
export function projectPart(stored, context, part, { offset = 0, limit = defaultLimit } = {}) {
  const { analysis } = stored.data, lists = { ...frameworkParts(analysis), ...electronIpcParts(analysis), ...modelParts(analysis), ...envParts(analysis), ...openapiParts(analysis), ...contractParts(analysis, context.comparison) }, framework = part.split('.')[0], model = part.startsWith('models.');
  if (!Object.hasOwn(lists, part)) throw new Error(`Unknown part "${part}" for the project. Parts: ${Object.keys(lists).join(', ')}. A part of a file needs exactly one --file <path>.`);
  if (!(model ? analysis.models : framework === 'examples' ? analysis.examples : analysis.frameworks?.[framework === 'electron' ? 'electronIpc' : framework])) throw new Error(`Analysis ${context.id} has no ${model ? 'model' : 'framework'} report, because an older Code-map stored it. Run code-map inspect --summary again for a new analysis.`);
  const args = ['inspect', '--analysis', context.id, ...(context.comparison ? ['--base-analysis', context.comparison.base.id] : []), '--part', part];
  return { reportType: 'code-map-evidence', schemaVersion: 1, analysis: block(stored, context), target: model ? { models: part.slice('models.'.length) } : { framework }, part,
    page: page(lists[part], { offset, limit }, (next) => context.command([...args, '--offset', String(next), ...(limit === defaultLimit ? [] : ['--limit', String(limit)])])) };
}

/** One complete evidence list of one mapped file, one page at a time. */
export function filePart(stored, context, path, part, { offset = 0, limit = defaultLimit } = {}) {
  const file = stored.data.analysis.files.find((entry) => entry.path === path);
  if (!file) throw new Error(`Files are not mapped source files: ${path}`);
  if (!filePartNames.includes(part)) throw new Error(`Unknown part "${part}" for a file. Parts: ${filePartNames.join(', ')}`);
  const list = part === 'tests.direct' ? file.tests.direct : part === 'tests.transitive' ? file.tests.transitive : file[part];
  const args = ['inspect', '--analysis', context.id, '--file', path, '--part', part];
  return { reportType: 'code-map-evidence', schemaVersion: 1, analysis: block(stored, context), target: { file: path }, part,
    page: page(list, { offset, limit }, (next) => context.command([...args, '--offset', String(next), ...(limit === defaultLimit ? [] : ['--limit', String(limit)])])) };
}
