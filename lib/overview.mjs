// The small overview and the retrievable evidence of one stored analysis. Pure: the caller loads the analysis,
// checks its freshness and supplies `command(args)`, which prints an exact follow-up command for the same analysis.
import { createReport } from './analysis.mjs';
import { findingRules, summaryItems } from './findings.mjs';
import { findingDetails } from './finding-details.mjs';
import { summarizeTests } from './test-summary.mjs';

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
    state: result.state, reasons: result.reasons,
    counts: { new: count('NEW'), existing: count('EXISTING'), resolved: entries.resolved.length, unknown: count('UNKNOWN') + entries.unknown.length } };
}

export function summaryReport(stored, context, selection = {}) {
  const { data } = stored, { analysis } = data, comparison = context.comparison ?? null, { report, inScope, inBase } = scope(stored, selection, comparison);
  const findings = stored.findings.filter(inScope), extra = report ? selectionArgs(selection) : [];
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
  return { reportType: 'code-map-summary', schemaVersion: 1, analysis: { ...block(stored, context), reused: context.reused },
    snapshot: { project: data.project, ref: data.ref, sha: data.sha, workingTree: data.coverageSnapshot === 'working-tree',
      // The digest that a run manifest records: the content of every changed file now. It is not part of the analysis ID.
      worktreeDigest: context.contentDigest !== undefined ? context.contentDigest : stored.inputs.worktree?.contentDigest ?? null, selector: stored.inputs.selector },
    scope: { selection: report ? selectionView(report, context, selection) : null, sourceFiles: analysis.files.length, testFiles: analysis.tests?.testFiles.length ?? 0, testCases: analysis.tests?.cases.length ?? 0 },
    verification: { state: 'NOT_RUN', readiness: null, ratings: null,
      text: 'No verification ran in this summary. The findings are static leads, not PASS or FAIL results, and they give no rating. For ratings and a readiness state, run code-map verify --request <file> (refer to docs/verify.md).' },
    findings: { total: findings.length, shown: shown.length, bySeverity, byRule, items: shown.map((finding) => item(finding, context, comparison ? statusOf(comparison, finding) : {})),
      next: findings.length > shown.length ? findingsCommand() : null },
    comparison: !comparison ? null : { ...comparisonBlock(context, entries),
      resolved: page(entries.resolved.map((entry) => item(entry.finding, context, entry.extra, entry.analysisId)), { offset: 0, limit: 10 }, (next) => listCommand('resolved', ['--offset', String(next), '--limit', '10'])),
      next: Object.fromEntries(['new', 'existing', 'resolved', 'unknown'].map((baseline) => [baseline, listCommand(baseline)])) },
    gaps: gaps(stored), tests,
    commands: { findings: findingsCommand(), file: context.command(['inspect', '--analysis', context.id, '--file', '<path>']),
      full: context.command(['inspect', '--analysis', context.id, '--full', '--out', context.fullOut ?? '<file>']) },
    limits: analysis.limits };
}

/** Evidence that the analysis could not establish. Each gap names its evidence kind. */
function gaps(stored) {
  const { analysis, sha } = stored.data, tests = analysis.tests, list = [];
  const add = (key, source, text, count = null) => list.push({ key, source, ...(count === null ? {} : { count }), text });
  add('execution', 'inventory', 'Code-map ran no project test or command. Test links, case statuses and failure-test statuses are static inference, not observed runs.');
  const coverage = tests?.coverage;
  if (!coverage || coverage.state === 'none') add('coverage', 'measured', 'No coverage report was found, so no line or branch has measured evidence.');
  else if (coverage.state === 'not-applicable') add('coverage', 'measured', `The coverage report applies only to a working-tree analysis. This analysis is of commit ${sha.slice(0, 10)}, so coverage is not used.`);
  else add('coverage', 'measured', `Coverage comes from ${coverage.file}, written ${String(coverage.date).slice(0, 10)}. It is not tied to a revision or a test command.`);
  const edges = analysis.files.flatMap((file) => file.imports);
  const dynamic = edges.filter((edge) => edge.specifier === null).length, loaders = edges.filter((edge) => edge.target === null && /^\..*[?!]/.test(edge.specifier ?? '')).length;
  if (dynamic) add('dynamicImports', 'graph', 'Dynamic imports with a computed target are not resolved. Dynamic wiring can escape the graph.', dynamic);
  if (loaders) add('loaderImports', 'graph', 'Relative imports with loader syntax (? or !) are not checked for a matching file.', loaders);
  const unchecked = analysis.importNames?.unchecked ?? {}, skipped = Object.values(unchecked).reduce((sum, count) => sum + count, 0);
  if (skipped) add('importNamesUnchecked', 'graph', `Named imports from files whose exports are not all known were not checked: ${Object.entries(unchecked).filter(([, count]) => count).map(([reason, count]) => `${count} ${reason}`).join(', ')}.`, skipped);
  const unsupported = Object.entries(analysis.unsupportedFiles ?? {}), others = unsupported.reduce((sum, [, count]) => sum + count, 0);
  if (others) add('unsupportedFiles', 'inventory', `Files in languages that the analysis does not read: ${unsupported.map(([extension, count]) => `${count} ${extension}`).join(', ')}. No finding covers them.`, others);
  if (analysis.unclassifiedEdges) add('unclassifiedEdges', 'graph', 'Some import edges have no type or value classification.', analysis.unclassifiedEdges);
  const rules = analysis.rules ?? { declared: [], invalid: [] };
  if (!rules.declared.length) add('architectureRules', 'graph', 'No architecture rules are declared in .code-map.json, so no import direction was checked.');
  if (rules.invalid.length) add('invalidRules', 'graph', `These rules are not in the form "from -> to" and were not checked: ${rules.invalid.join('; ')}.`, rules.invalid.length);
  const unrecognized = tests?.testFiles.filter((file) => file.kind === 'unrecognized').length ?? 0;
  if (unrecognized) add('unrecognizedTests', 'inventory', 'Files named as tests have no recognized test case, so the test counts do not include them.', unrecognized);
  if (tests?.unreadable.length) add('unreadableTests', 'inventory', 'Test scripts in other languages are not read, so the test counts do not include them.', tests.unreadable.length);
  return list;
}

/** A page of findings. With a comparison, `baseline` (NEW, EXISTING, RESOLVED or UNKNOWN) filters by label; resolved findings come from the base. */
export function findingsPage(stored, context, { rule = null, selection = {}, offset = 0, limit = defaultLimit, baseline = null } = {}) {
  if (rule !== null && !Object.hasOwn(findingRules, rule)) throw new Error(`Unknown rule "${rule}". Rules: ${Object.keys(findingRules).join(', ')}`);
  const comparison = context.comparison ?? null, { report, inScope, inBase } = scope(stored, selection, comparison), extra = report ? selectionArgs(selection) : [];
  const findings = stored.findings.filter((finding) => (rule === null || finding.ruleId === rule) && inScope(finding));
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
  return { reportType: 'code-map-findings', schemaVersion: 1, analysis: block(stored, context), filter: { rule, baseline, selection: report ? selectionView(report, context, selection) : null },
    ...(comparison ? { comparison: comparisonBlock(context, entries) } : {}),
    page: { ...result, items: result.items.map((entry) => item(entry.finding, context, entry.extra, entry.analysisId)) } };
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
  if (part === null) return { reportType: 'code-map-finding', schemaVersion: 1, analysis: block(stored, context), finding: shown, details };
  if (!Object.hasOwn(parts, part)) throw new Error(`Unknown part "${part}" for finding ${id}. Parts: ${Object.keys(parts).join(', ') || 'none'}`);
  return { reportType: 'code-map-evidence', schemaVersion: 1, analysis: block(stored, context), target: { finding: id }, part, page: pager(part, parts[part], { offset, limit }) };
}

/** The inspection report (schema version 1) of a file or change selection, or of the whole project, from the stored analysis. */
export function fileReport(stored, context, selection = {}) {
  const report = createReport(stored.data, { files: selection.files ?? [], change: selection.change, includeVendors: selection.includeVendors !== false }, summarizeTests);
  return { ...report, analysis: block(stored, context) };
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
