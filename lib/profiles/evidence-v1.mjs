// Accepted rule set. V0 remains the default and keeps its own evaluator.
import { evaluateProfile as baseline, thresholds } from './static-baseline-v0.mjs';
import { categories, readiness } from '../ratings.mjs';
import { acceptance, confirms, preserved, independentReference, regression } from './evidence-v1-behavior.mjs';
import { dependencyPolicy, migrationsDocs, publicInterface, testsNotWeakened } from './evidence-v1-checks.mjs';
import { typeCases } from './compiler-evidence.mjs';
export { thresholds };
export const profile = { id: 'evidence-v1', status: 'accepted', ratingRulesVersion: 'ratings-v1', requiredCategories: [...categories] };
export const limits = [
  'Its thresholds come from the proposal and need calibration on real changes.',
  'A compiler report lists diagnostics, not the files that the compiler checked.',
  'The stale-reference scan skips short names, binary files, symlinks and files larger than 1 MiB.',
  'Reference runs need unchanged reaching cases. A missing case text comparison keeps preservation UNKNOWN.',
  'Coverage cannot confirm an assertion. Missing statement or function measurements cannot give level 5.',
  'A model must not create an oracle record for itself. Code-map cannot authenticate the person named in a local file.',
];
const predicate = (id, met, evidenceIds = []) => ({ id, met, evidenceIds });
const result = (item, [state, rationale], ids = []) => ({ ...item, result: state, rationale, eligible: state !== 'UNKNOWN',
  applicability: state === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : 'APPLICABLE', ...(state === 'NOT_APPLICABLE' ? { applicabilityReason: rationale } : {}),
  evidenceIds: ids, nextAction: ['UNKNOWN', 'FAIL'].includes(state) ? 'Supply the missing bound evidence or correct the reported failure, then verify again.' : null });
const check = (id, category, title, outcome, required = true, blocking = false, ids = []) => result({ id, category, title, required, blocking, severity: 'medium', review: 'none' }, outcome, ids);
const compatibleConsumer = (context, path) => {
  const { applies, cases: [fails, unknowns] } = typeCases({ context, head: context.head, base: context.base,
    changed: new Set([path]), rename: (value) => value, analyses: [] });
  return applies && !fails.some(([holds]) => holds) && !unknowns.some(([holds]) => holds);
};
const cleanCompiler = (c) => c.compiler.head.some((x) => !x.filtered && x.exitStatus === 0 && x.errors === 0 && !x.outside);
/** Evaluates section 5 of the proposal from validated comparisons and bound evidence. */
export function evaluateProfile(context) {
  const output = baseline(context), e = context.evidence;
  const evidenceIds = [...context.reports.head, ...context.reports.base, ...context.compiler.head].map((x) => `report:${x.artifact}`);
  const obligations = output.obligations.filter((x) => x.id !== 'feature.consumer-contracts').map((x) => {
    const outcome = x.id === 'completeness.tests-not-weakened' ? testsNotWeakened(context, x) : x.id === 'refactor.behavior-preserved' ? preserved(context) : x.id === 'fix.reproduced' ? regression(context, true)
      : x.id === 'fix.regression-check' ? regression(context, false) : x.id.startsWith('acceptance.') ? acceptance(context, x.id.slice(11))
      : x.id === 'completeness.migrations-docs' ? migrationsDocs(context) : null;
    if (x.id === 'completeness.tests-not-weakened') return result(x, outcome, [...x.evidenceIds, 'path:.code-map/reviews.json', ...(context.tests?.reviews?.entries ?? []).map((entry) => entry.id)]);
    return outcome ? result(x, outcome, x.id.startsWith('acceptance.')
      ? [...evidenceIds, 'path:.code-map/oracles.json', ...e.cases.filter((c) => c.criteria?.includes(x.id.slice(11))).map((c) => c.evidenceId).filter(Boolean)].slice(0, 50) : evidenceIds) : x;
  });
  obligations.push(check('structure.public-interface', categories[0], 'Public interface is compatible', publicInterface(context), true, false,
    [...evidenceIds, ...e.api.items.filter((x) => x.group === 'public').map((x) => `path:${x.path}`)]));
  const harness = e.harness, failures = harness.flatMap((x) => x.outcomes).filter((x) => x.kind !== 'UNKNOWN');
  obligations.push(check('behavior.harness-holds', categories[2], 'Harness runs hold', !harness.length ? ['NOT_APPLICABLE', 'No bound harness run exists.']
    : failures.length ? ['FAIL', 'A bound harness reports a failed property, mismatch, crash or hang.']
      : harness.some((x) => x.calls === 0 || x.unknownCalls || x.outcomes.some((y) => y.kind === 'UNKNOWN')) ? ['UNKNOWN', 'A harness call has no result.'] : ['PASS', 'The bound harness runs hold.'], false));
  const stale = e.references.hits.filter((x) => x.place !== 'markdown');
  obligations.push(check('completeness.no-stale-references', categories[3], 'No stale references', stale.length
    ? ['FAIL', 'Removed exports or old paths still occur in code, configuration or test paths.'] : ['PASS', 'The stale-reference scan found no remaining reference.'], false, false, stale.map((x) => `path:${x.path}`)));
  obligations.push(check('completeness.dependency-policy', categories[3], 'Dependencies follow the policy', dependencyPolicy(context), true, false,
    e.supplyFindings.map((x) => x.id)));
  const byId = new Map(obligations.map((x) => [x.id, x])), pass = (id) => byId.get(id)?.result === 'PASS';
  const own = Object.fromEntries(Object.entries(output.categories).map(([id, input]) => [id, { ...input, rubric: { version: 'ratings-v1' }, obligations: obligations.filter((x) => x.category === id),
    bands: { ...input.bands } }]));
  const [si, vc, bc, cc] = categories.map((id) => own[id]);
  si.bands[5] = [predicate('si.clean-compiler-public-known', cleanCompiler(context) && e.api.state === 'COMPARABLE' && e.api.complete && !e.api.items.some((x) => x.group === 'public' && x.status === 'UNKNOWN'), evidenceIds)];
  const measured = e.isolatedCoverage, full = (kind) => measured?.[kind]?.total > 0 && measured[kind].covered === measured[kind].total;
  vc.bands[5] = [predicate('vc.isolated-statements-functions', Boolean(measured?.changedStatements?.total > 0
    && measured.changedStatements.covered * 100 >= measured.changedStatements.total * 90 && full('changedFunctions')
    && !measured.unmeasuredBy.statements.length && !measured.unmeasuredBy.functions.length && measured.joins.ambiguous === 0 && measured.joins.missing === 0), measured?.reports?.map((x) => `report:${x}`) ?? [])];
  const isolatedHead = context.reports.head.filter((x) => x.attestation === 'isolated' && x.cases.some((y) => y.status !== 'skipped'));
  const independent = independentReference(context)
    || e.harness.some((x) => x.mode === 'differential' && x.base === context.base.sha && x.inputs > 0 && x.attestation === 'isolated')
    || isolatedHead.some((r) => r.cases.some((x) => x.status !== 'skipped' && e.oracles.some((o) => confirms(o, x))));
  bc.minimumEvidence = { met: isolatedHead.length > 0 && independent, missing: [...(!isolatedHead.length ? ['A bound isolated head test report'] : []), ...(!independent ? ['An isolated reference, differential run or current human oracle for a case that ran'] : [])] };
  bc.allowOptionalAssessment = true;
  bc.fundamental = [predicate('bc.failed-behavior', ['behavior.no-new-failures', 'refactor.behavior-preserved', 'fix.regression-check'].some((id) => byId.get(id)?.result === 'FAIL'), evidenceIds)];
  bc.bands[4] = [predicate('bc.unfiltered-criteria', isolatedHead.some((x) => !x.filtered) && context.request.acceptanceCriteria.every((x) => pass(`acceptance.${x.id}`)), evidenceIds)];
  bc.bands[5] = [predicate('bc.mutation-sixty-ten', e.mutation.some((x) => x.score >= 60 && x.counts.killed + x.counts.timeout + x.counts.survived + x.counts.noCoverage >= 10), e.mutation.map((x) => `report:${x.artifact}`))];
  cc.bands[4] = [predicate('cc.docs-stale-clean', pass('completeness.migrations-docs') && pass('completeness.no-stale-references'))];
  cc.bands[5] = [predicate('cc.all-consumers-compatible', e.api.state === 'COMPARABLE' && e.api.complete && e.api.items.filter((x) => x.status !== 'ADDED')
    .every((x) => x.status !== 'UNKNOWN' && (x.consumers?.items ?? []).every((y) => context.change.paths.includes(y.path) || compatibleConsumer(context, y.path))), evidenceIds)];
  return { obligations, categories: own };
}
/** V1 adds category floors and isolated test evidence to the unchanged readiness state order. */
export function profileReadiness(obligations, ratings, context) {
  const state = readiness(obligations, ratings, { requiredCategories: categories });
  if (state.state !== 'READY') return state;
  const low = categories.filter((x) => ratings[x].value < 3);
  if (low.length || [...context.reports.head, ...context.reports.base].some((x) => x.attestation !== 'isolated')) return { ...state, state: 'INSUFFICIENT_EVIDENCE', reason: 'READY requires ratings of at least three and isolated test reports.' };
  return state;
}
