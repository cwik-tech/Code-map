// A schema-bound rubric and independent comparisons of ordered category bands.
import { predicateDefinition } from './verification-predicate-definitions.mjs';
import { categories } from './ratings.mjs';
import { isDeepStrictEqual } from 'node:util';

/** Stores the rubric definition separately from its evaluated predicate outcomes. */
export function ratingContract({ request, rules, evaluation, repository, paths, executions = [], analysisPolicy = null, evaluatorDigest = 'unavailable' }) {
  const definition = (input) => ({ required: input.required, allowOptionalAssessment: input.allowOptionalAssessment === true,
    fundamental: (input.fundamental ?? []).map(predicateDefinition),
    bands: Object.fromEntries([3, 4, 5].map((level) => [level, (input.bands[level] ?? []).map(predicateDefinition)])) });
  return { rubric: { schemaVersion: 1, profileId: rules.profile.id, ratingRulesVersion: rules.profile.ratingRulesVersion,
    evaluatorDigest, thresholds: { ...rules.thresholds, ...(rules.profile.id === 'evidence-v1' ? { changedStatements: 90, changedFunctions: 100, mutationScore: 60, mutationCount: 10 } : {}) },
    decisionTree: ['approved-inapplicability', 'fundamental-failure', 'minimum-evidence', 'applicable-obligations', 'required-obligations-pass', 'cumulative-bands-3-4-5'],
    evidencePolicy: { eligibility: 'revision-bound-eligible-pass-fail-v1',
      trust: rules.profile.id === 'evidence-v1' ? 'isolated-with-independent-oracles-v1' : 'self-attested-and-isolated-v0',
      minimumAssessment: `${rules.profile.id}:${rules.profile.ratingRulesVersion}`, analysisPolicy,
      toolMinimums: [...new Map(executions.filter((item) => typeof item.trust?.tool === 'string' && typeof item.trust?.minimum === 'string')
        .map(({ trust: { tool, minimum } }) => [JSON.stringify([tool, minimum]), { tool, minimum }])).values()]
        .sort((a, b) => a.tool.localeCompare(b.tool) || a.minimum.localeCompare(b.minimum)) },
    categories: Object.fromEntries(categories.map((id) => [id, definition(evaluation.categories[id])])) },
  ratingScope: { repository, changeType: request.changeType, allowedPaths: request.allowedPaths === null ? null : [...request.allowedPaths].sort(),
    allowedPublicChanges: request.allowedPublicChanges == null ? null : [...request.allowedPublicChanges].sort(),
    testDeclarations: Object.fromEntries(['regressionTests', 'generatedTests'].map((key) => [key, [...(request[key] ?? [])]
      .sort((a, b) => a.file.localeCompare(b.file) || (a.name ?? '').localeCompare(b.name ?? ''))])),
    acceptanceCriteria: [...request.acceptanceCriteria].sort((a, b) => a.id.localeCompare(b.id)), paths: [...paths].sort(),
    obligations: evaluation.obligations.map(({ id, category, required, blocking, severity }) => ({ id, category, required, blocking, severity })).sort((a, b) => a.id.localeCompare(b.id)) } };
}

const knownPolicy = (policy) => typeof policy?.config === 'string' && policy.config.length > 0
  && Array.isArray(policy.roots) && policy.roots.every((path) => typeof path === 'string')
  && ['version', 'source', 'node', 'typescript'].every((key) => typeof policy.analyzer?.[key] === 'string' && policy.analyzer[key].length > 0);

/** Compares bands only when rubric, scope and evidence policies match exactly. */
export function compareRatings(base, head) {
  const reasons = [], missing = !base.rubric || !head.rubric || !base.ratingScope || !head.ratingScope
    || [base, head].some((report) => !/^[a-f0-9]{64}$/.test(report.rubric?.evaluatorDigest ?? '') || !knownPolicy(report.rubric?.evidencePolicy?.analysisPolicy));
  if (missing) reasons.push('A report has no schema-bound rubric, analysis policy, evaluator identity or obligation scope.');
  else {
    const { evidencePolicy: bp, ...br } = base.rubric, { evidencePolicy: hp, ...hr } = head.rubric;
    if (!isDeepStrictEqual(br, hr) || base.profileId !== head.profileId || base.ratingRulesVersion !== head.ratingRulesVersion) reasons.push('The rubric definitions or versions differ.');
    if (!isDeepStrictEqual(bp, hp)) reasons.push('The evidence policies differ.');
    if (!isDeepStrictEqual(base.ratingScope, head.ratingScope)) reasons.push('The obligation scopes differ.');
  }
  const state = missing ? 'UNKNOWN' : reasons.length ? 'INCOMPARABLE' : 'COMPARABLE';
  const comparisons = categories.map((id) => {
    const before = base.ratings?.[id], after = head.ratings?.[id];
    const b = before?.state === 'RATED' ? before.value : null, h = after?.state === 'RATED' ? after.value : null;
    return [id, state !== 'COMPARABLE' || b === null || h === null
      ? { state: 'UNKNOWN', base: b, head: h, reason: reasons.join(' ') || 'Both categories need an assessed band.' }
      : { state: 'COMPARED', base: b, head: h, direction: h > b ? 'UP' : h < b ? 'DOWN' : 'SAME' }];
  });
  return { state, reasons, categories: Object.fromEntries(comparisons) };
}
