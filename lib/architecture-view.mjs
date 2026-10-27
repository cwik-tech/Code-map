// The layers and owners in a summary: the architecture block, its evidence gaps, and the owners of the changed files of a
// comparison. Pure: the caller supplies the stored analyses and the changed files that Git reports (lib/inspect.mjs).
import { ownerMatcher } from './codeowners.mjs';

/** A summary names at most this many paths, ignored lines and changed files. The stored analysis keeps the complete lists. */
const shown = 20;
const sorted = (lists) => [...new Set(lists.flat())].sort();

/** The architecture block of a summary. Without CODEOWNERS, every source file is unowned. */
export function architectureSummary(analysis) {
  const model = analysis.rules?.layers ?? null, ownership = analysis.ownership ?? {
    file: null, rules: [], owners: [], unowned: analysis.files.length, ignored: [], policy: null, violations: [] };
  return {
    layers: model && { layers: model.layers, exceptions: model.exceptions.length, rules: model.rules.length,
      violations: (analysis.rules.violations ?? []).filter((item) => item.layers).length, outside: { count: model.outside.count, paths: model.outside.paths.slice(0, shown) } },
    ownership: ownership && { file: ownership.file, rules: ownership.rules.length, owners: ownership.owners.length, unowned: ownership.unowned,
      ignored: { count: ownership.ignored.length, items: ownership.ignored.slice(0, shown) },
      policy: ownership.policy && { forbidCrossOwnerImports: ownership.policy.forbidCrossOwnerImports, exceptions: ownership.policy.allowed.length },
      violations: ownership.violations.length },
  };
}

/** The evidence gaps of the layers and owners. `add(key, source, text, count)` adds one gap to the summary. */
export function architectureGaps(analysis, add) {
  const model = analysis.rules?.layers, ownership = analysis.ownership;
  if (model?.outside.count) add('outsideLayers', 'graph', 'Source files in no layer are outside the layer model, so no layer rule checks their imports.', model.outside.count);
  if (!ownership) return;
  const checked = ownership.policy?.forbidCrossOwnerImports === true;
  if (!ownership.file) add('codeownersMissing', 'inventory', 'The snapshot has no CODEOWNERS file in .github/, the root folder or docs/, so no source file has an owner.');
  else if (ownership.unowned) add('unownedFiles', 'inventory', `Source files have no owner in ${ownership.file}.${checked ? ' The ownership rule does not check their imports.' : ''}`, ownership.unowned);
  if (ownership.ignored.length) add('codeownersIgnored', 'inventory', `Code-map ignores lines of ${ownership.file}, for example a negated pattern that GitHub does not support. Refer to architecture.ownership.ignored.`, ownership.ignored.length);
}

/**
 * The owners of the changed files of a comparison, or undefined when neither analysis has a CODEOWNERS file. Each path gets
 * the owners under the CODEOWNERS file of the base and of the head: GitHub requests reviews with the file of the base branch,
 * and the change can edit that file. A renamed file also gets the base owners of its old path. Null when the analyses are
 * not comparable or when Git gave no list of changed files.
 */
export function ownersChange(comparison, analysis) {
  const sides = [comparison.base.data.analysis.ownership ?? null, analysis.ownership ?? null];
  if (!sides.some((side) => side?.file)) return undefined;
  if (comparison.result.state !== 'COMPARABLE' || !comparison.changed) return null;
  const [base, head] = sides.map((side) => ownerMatcher(side?.rules ?? []));
  const files = comparison.changed.map((file) => ({ path: file.path, status: file.status, ...(file.from ? { from: file.from } : {}),
    owners: sorted([base(file.path).owners, file.from ? base(file.from).owners : [], head(file.path).owners]) }));
  const owners = sorted(files.map((file) => file.owners));
  return { files: files.length, owners, touched: owners.length, unowned: files.filter((file) => !file.owners.length).length, items: files.slice(0, shown) };
}
