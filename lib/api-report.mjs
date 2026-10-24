// The API section of a comparison summary, and the paged list of export changes (`inspect --api <status>`). Pure: the
// caller supplies the comparison of the head with a base (lib/inspect.mjs comparisonOf) and the command printer.
import { apiStatuses, compareApi } from './api-compare.mjs';

/** The summary shows at most this many examples for each group, consumers for each example and listed paths. */
const examplesShown = 3, consumersShown = 5, pathsShown = 20, unresolvedShown = 5;
export const apiFilters = ['all', ...apiStatuses.map((status) => status.toLowerCase())];
const text = 'Code-map compares each export of the base and the head by its declared signature, read from the syntax. A change is a lead, not a type-check result. '
  + 'UNKNOWN means that Code-map cannot decide, for example because a type is inferred and its source changed. '
  + 'Consumers are the head files that import the name, also files that the change did not touch. Code-map cannot see consumers outside the repository.';

const computed = new WeakMap();
/** The export comparison of a context with a base, computed once for each comparison: the impact parts (lib/impact/) read it too. */
export const exportChanges = (stored, context) => {
  const { base, renames, complete, result } = context.comparison;
  if (!computed.has(context.comparison)) computed.set(context.comparison, compareApi(base, stored, { renames, complete, state: result.state, reasons: result.reasons }));
  return computed.get(context.comparison);
};
const listCommand = (context, status, more = []) => context.command(['inspect', '--analysis', context.id, '--base-analysis', context.comparison.base.id, '--api', status, ...more]);

/** The `api` section of a summary with a base: counts and a few examples for each group, and a command for each list. */
export function apiSummary(stored, context) {
  const result = exportChanges(stored, context);
  if (result.state !== 'COMPARABLE') return { state: result.state, reasons: result.reasons, scope: 'project', renamesComplete: null, entryPoints: null, public: null, module: null, next: null, text };
  const group = (name) => {
    const items = result.items.filter((item) => item.group === name), count = (status) => items.filter((item) => item.status === status).length;
    return { counts: { removed: count('REMOVED'), changed: count('CHANGED'), unknown: count('UNKNOWN'), added: count('ADDED'), unchanged: result.unchanged[name], ...(count('RENAMED') ? { renamed: count('RENAMED') } : {}) },
      examples: items.filter((item) => item.status !== 'ADDED').slice(0, examplesShown)
        .map((item) => ({ ...item, consumers: { total: item.consumers.total, items: item.consumers.items.slice(0, consumersShown) } })) };
  };
  const { entryPoints } = result;
  return { state: 'COMPARABLE', reasons: [], scope: 'project', renamesComplete: result.complete,
    entryPoints: { head: { total: entryPoints.head.files.length, files: entryPoints.head.files.slice(0, pathsShown) }, base: { total: entryPoints.base },
      added: entryPoints.added.slice(0, pathsShown), removed: entryPoints.removed.slice(0, pathsShown),
      unresolved: { total: entryPoints.head.unresolved.length, items: entryPoints.head.unresolved.slice(0, unresolvedShown) } },
    public: group('public'), module: group('module'), next: Object.fromEntries(apiFilters.map((status) => [status, listCommand(context, status)])), text };
}

/**
 * A page of export changes. `status` is one of `apiFilters`, `group` null or one of `apiGroups`. `pager(list, args)` makes the
 * page in the shape of the other pages, with `args` as the command of the next page.
 */
export function apiChangesPage(stored, context, { status = 'all', group = null } = {}, pager) {
  const result = exportChanges(stored, context), { base } = context.comparison;
  const list = result.items.filter((item) => (status === 'all' || item.status === status.toUpperCase()) && (group === null || item.group === group));
  const args = ['inspect', '--analysis', context.id, '--base-analysis', base.id, '--api', status, ...(group ? ['--api-group', group] : [])];
  return { reportType: 'code-map-api-changes', schemaVersion: 1, analysis: { id: stored.id, createdAt: stored.createdAt, freshness: context.freshness },
    filter: { status, group }, comparison: { base: { id: base.id, sha: base.data.sha, ref: base.data.ref, selector: base.inputs.selector }, state: result.state, reasons: result.reasons,
      renamesComplete: result.complete }, page: pager(list, args), text };
}
