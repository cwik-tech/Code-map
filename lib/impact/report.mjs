// The impact section of a comparison summary and the pages of its lists (`inspect --impact <list>`), and the documentation
// section of each summary with its page (`inspect --undocumented`). The comparison parts are computed when the comparison
// runs, from the two stored analyses, the export changes, the changed files that Git reports and the head texts.
import { symbolImpact } from '../types/impact.mjs';
import { exportChanges } from '../api-report.mjs';
import { changedFiles } from '../verify-change.mjs';
import { callSites } from './calls.mjs';
import { documentationLeads, publicDocumentation } from './docs.mjs';
import { readHead } from './head-files.mjs';
import { changeImpact, impactLimits, removedImports } from './reach.mjs';
import { findReferences, placeOf, referenceTerms } from './references.mjs';

export const impactLists = ['affected', 'tests', 'references', 'calls', 'docs'];
/** The summary shows at most this many examples of each part. */
const shown = 5;
/** The affected page keeps at most this many computed-loader candidates, with their total. */
const pageCandidates = 50;
const places = ['code', 'test', 'config', 'markdown', 'json', 'yaml'];
const text = 'Each part is a static lead, not a verdict. affected: the head files that import a changed file, directly or through other files, up to the limits. '
  + 'references: head text that still names a removed export, or the old path of a removed or renamed file. calls: the uses of each changed export in its consumers. '
  + 'A likely break is a call outside the argument range of the head signature. The TypeScript compiler is the real check. '
  + 'docs: a public export that the change removed or changed while no documentation file changed. Code-map cannot see code outside the repository.';
const docsText = 'A public export is an export of a package entry point. Code-map looks for a JSDoc comment (/** … */) above the declaration, in the file that declares the name. '
  + 'It does not judge the text. Unknown: a re-export from a package, or a name without a declaration that Code-map can read.';

/** The changed files of a comparison, from Git, read once for each report. */
const changes = new WeakMap();
function filesOf(stored, comparison) {
  if (!changes.has(comparison)) changes.set(comparison, changedFiles(stored.inputs.repository, comparison.base.data.sha, stored.inputs.selector.worktree ? null : stored.data.sha).files);
  return changes.get(comparison);
}

/** Each part from the export changes (`api`) and the changed files. A part that needs texts reads only the files that it searches. */
const parts = {
  affected: ({ stored, comparison, files }) => {
    const old = files.filter((file) => file.status === 'D' || file.status === 'R').map((file) => file.from ?? file.path);
    return changeImpact(stored.data.analysis, files.filter((file) => file.status !== 'D').map((file) => file.path), impactLimits,
      removedImports(comparison.base.data.analysis, stored.data.analysis, old, comparison.renames));
  },
  references: ({ stored, comparison, api, files }) => {
    const terms = referenceTerms(api.items, files, comparison.renames, stored.data.analysis), analysis = stored.data.analysis;
    const head = terms.names.length || terms.paths.length ? readHead(stored, (path) => placeOf(path) !== null) : { texts: new Map(), skipped: 0 };
    return { terms, skippedFiles: head.skipped, ...findReferences(head.texts, terms, [...analysis.files.flatMap((file) => file.imports), ...(analysis.api?.testImports ?? [])]) };
  },
  calls: ({ stored, api }) => {
    const paths = new Set(api.items.filter((item) => item.status === 'CHANGED').flatMap((item) => item.consumers?.items ?? []).map((consumer) => consumer.path));
    return callSites(api.items, stored, paths.size ? readHead(stored, (path) => paths.has(path)).texts : new Map());
  },
  docs: ({ api, files }) => documentationLeads(api.items, files),
};

const termLists = (terms) => ({ exports: terms.names.map(({ name, files }) => ({ name, files })), paths: terms.paths.map(({ path, to }) => ({ path, to })), skipped: terms.skipped });
const walkFacts = ({ limits, truncated, complete, total, byDepth, kinds, edges, dynamicImports, candidateTruncation }) => ({ limits, truncated, complete, total, byDepth, kinds, edges, dynamicImports, candidateTruncation });

/** The summary view of each part: counts, at most `shown` examples and the command for each list. */
const views = {
  affected: (result, next) => ({ ...walkFacts(result), candidates: { total: result.candidates.length, items: result.candidates.slice(0, shown) }, tests: { total: result.tests.length, items: result.tests.slice(0, shown) }, examples: result.files.slice(0, shown),
    next: { affected: next('affected'), tests: next('tests') } }),
  references: (result, next) => ({ terms: { exports: result.terms.names.length, paths: result.terms.paths.length, skipped: result.terms.skipped.length }, total: result.hits.length,
    places: Object.fromEntries([...places, ...(result.hits.some((hit) => hit.place === 'generated') ? ['generated'] : [])].map((place) => [place, result.hits.filter((hit) => hit.place === place).length])), truncated: result.truncated, skippedFiles: result.skippedFiles,
    examples: result.hits.slice(0, shown), next: next('references') }),
  calls: (result, next) => ({ exports: result.exports.length, total: result.sites.length, likelyBreaks: result.sites.filter((site) => site.likelyBreak).length, unknown: result.sites.filter((site) => site.compatibility === 'UNKNOWN').length, unread: result.unread.length,
    examples: result.sites.slice(0, shown), next: next('calls') }),
  docs: (result, next) => ({ publicChanges: result.publicChanges, docsChanged: { total: result.docsChanged.length, files: result.docsChanged.slice(0, shown) }, total: result.leads.length,
    examples: result.leads.slice(0, shown), next: next('docs') }),
};
/** The page of each list: the facts of its part, and its items. */
const pages = {
  affected: (result) => [{ affected: { ...walkFacts(result), candidates: result.candidates.slice(0, pageCandidates), candidateTotal: result.candidates.length } }, result.files],
  tests: (result) => [{ affected: walkFacts(result) }, result.tests],
  references: (result) => [{ references: { terms: termLists(result.terms), truncated: result.truncated, skippedFiles: result.skippedFiles } }, result.hits],
  calls: (result) => [{ calls: { exports: result.exports, unread: result.unread } }, result.sites],
  docs: (result) => [{ docs: { publicChanges: result.publicChanges, docsChanged: result.docsChanged } }, result.leads],
};
const listCommand = (context, list) => context.command(['inspect', '--analysis', context.id, '--base-analysis', context.comparison.base.id, '--impact', list]);

/** The `impact` section of a summary with a base. When Git cannot read the change, the state is UNAVAILABLE with the error. */
export function impactSummary(stored, context) {
  const api = exportChanges(stored, context), empty = { scope: 'project', changed: null, affected: null, references: null, calls: null, docs: null, text };
  if (api.state !== 'COMPARABLE') return { state: api.state, reasons: api.reasons, ...empty };
  const next = (list) => listCommand(context, list);
  try {
    const files = filesOf(stored, context.comparison), input = { stored, comparison: context.comparison, api, files }, affected = parts.affected(input);
    return { state: 'COMPARABLE', reasons: [], scope: 'project', changed: { files: files.length, ...affected.changed, removed: files.filter((file) => file.status === 'D').length },
      symbols: symbolImpact(api.items, stored.data.analysis, { base: context.comparison.base.data.analysis, renames: context.comparison.renames }),
      affected: views.affected(affected, next), references: views.references(parts.references(input), next), calls: views.calls(parts.calls(input), next),
      docs: views.docs(parts.docs(input), next), text };
  } catch (error) {
    return { state: 'UNAVAILABLE', reasons: ['git-unreadable'], ...empty, error: error instanceof Error ? error.message : String(error) };
  }
}

/** One list of the impact of a comparison, one page at a time. `pager(list, args)` makes the page in the shape of the other pages. */
export function impactPage(stored, context, list, pager) {
  const api = exportChanges(stored, context), { base } = context.comparison;
  const [header, items] = api.state !== 'COMPARABLE' ? [{}, []]
    : pages[list](parts[list === 'tests' ? 'affected' : list]({ stored, comparison: context.comparison, api, files: filesOf(stored, context.comparison) }));
  return { reportType: 'code-map-impact', schemaVersion: 1, analysis: { id: stored.id, createdAt: stored.createdAt, freshness: context.freshness }, list,
    comparison: { base: { id: base.id, sha: base.data.sha, ref: base.data.ref, selector: base.inputs.selector }, state: api.state, reasons: api.reasons },
    ...header, page: pager(items, ['inspect', '--analysis', context.id, '--base-analysis', base.id, '--impact', list]), text };
}

/** The `documentation` section of a summary: the public exports without JSDoc, or null for an analysis without the facts. */
export function documentationSummary(stored, context) {
  const result = publicDocumentation(stored.data.analysis);
  if (!result) return null;
  const { items, ...counts } = result;
  return { ...counts, examples: items.slice(0, shown), next: context.command(['inspect', '--analysis', context.id, '--undocumented']), text: docsText };
}

/** The public exports without JSDoc, one page at a time. */
export function undocumentedPage(stored, context, pager) {
  const result = publicDocumentation(stored.data.analysis);
  if (!result) throw new Error(`Analysis ${context.id} has no documentation facts, because an older Code-map stored it. Run code-map inspect --summary again for a new analysis.`);
  const { items, ...counts } = result;
  return { reportType: 'code-map-undocumented', schemaVersion: 1, analysis: { id: stored.id, createdAt: stored.createdAt, freshness: context.freshness },
    documentation: counts, page: pager(items, ['inspect', '--analysis', context.id, '--undocumented']), text: docsText };
}
