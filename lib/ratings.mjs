// Four independent category ratings (1-5, Unassessed or Not applicable) and a separate readiness state.
// Pure: the caller supplies validated obligations and the profile's predicate results. Nothing here adds,
// averages or weights ratings, and readiness never reads a rating value.

export const categories = ['structuralIntegrity', 'verificationCoverage', 'behavioralConfidence', 'changeCompleteness'];
export const labels = { 1: 'Failing', 2: 'Weak', 3: 'Adequate', 4: 'Strong', 5: 'Thorough' };
export const invalidExitCode = 4;

const severities = ['high', 'medium', 'low'];
const applicabilities = ['APPLICABLE', 'NOT_APPLICABLE', 'UNKNOWN'];
const results = ['PASS', 'FAIL', 'UNKNOWN', 'SKIPPED', 'NOT_APPLICABLE'];
const reviews = ['none', 'required', 'resolved'];
const exitCodes = { READY: 0, REVIEW: 1, BLOCKED: 2, INSUFFICIENT_EVIDENCE: 3 };
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;

/** Checks one obligation at the boundary. It returns every error, in field order. */
export function validateObligation(value) {
  if (!isRecord(value)) return { ok: false, errors: [{ path: '', message: 'An obligation must be an object.' }] };
  const errors = [], error = (path, message) => errors.push({ path, message });
  const oneOf = (path, list) => { if (!list.includes(value[path])) error(path, `Must be one of: ${list.join(', ')}.`); };
  if (!isText(value.id) || value.id.length > 200) error('id', 'Must be a nonempty string of at most 200 characters.');
  oneOf('category', categories);
  for (const path of ['required', 'blocking']) if (typeof value[path] !== 'boolean') error(path, 'Must be true or false.');
  oneOf('severity', severities);
  oneOf('applicability', applicabilities);
  if (value.applicability === 'NOT_APPLICABLE' && !isText(value.applicabilityReason)) error('applicabilityReason', 'A NOT_APPLICABLE obligation needs a reason.');
  else if (value.applicabilityReason !== undefined && typeof value.applicabilityReason !== 'string') error('applicabilityReason', 'Must be a string.');
  oneOf('result', results);
  // A result of NOT_APPLICABLE and an applicability of NOT_APPLICABLE must agree, so a disposition cannot hide a failure.
  if (results.includes(value.result) && (value.result === 'NOT_APPLICABLE') !== (value.applicability === 'NOT_APPLICABLE')) {
    error('result', 'The result is NOT_APPLICABLE exactly when the applicability is NOT_APPLICABLE.');
  }
  if (typeof value.eligible !== 'boolean') error('eligible', 'Must be true or false.');
  oneOf('review', reviews);
  if (!Array.isArray(value.evidenceIds) || !value.evidenceIds.every(isText)) error('evidenceIds', 'Must be an array of nonempty strings.');
  if (value.rationale !== undefined && typeof value.rationale !== 'string') error('rationale', 'Must be a string.');
  if (errors.length) return { ok: false, errors };
  const { id, category, required, blocking, severity, applicability, result, eligible, review, evidenceIds } = value;
  const obligation = { id, category, required, blocking, severity, applicability, result, eligible, review, evidenceIds: [...evidenceIds] };
  for (const path of ['applicabilityReason', 'rationale']) if (value[path] !== undefined) obligation[path] = value[path];
  return { ok: true, obligation };
}

/** PASS and FAIL count only from an eligible (revision-bound, trusted) check. Otherwise the result is UNKNOWN. */
const effective = (item) => (item.result === 'PASS' || item.result === 'FAIL') && !item.eligible ? 'UNKNOWN' : item.result;
const applies = (item) => item.applicability !== 'NOT_APPLICABLE';
const completed = (item) => item.eligible && (item.result === 'PASS' || item.result === 'FAIL');

/** Completed (eligible PASS or FAIL) and total counts. The totals keep unknown applicability. An empty total is 0 of 0. */
export function evidenceCompleteness(obligations, category) {
  const counted = obligations.filter((item) => item.category === category && applies(item));
  const bucket = (list) => ({ completed: list.filter(completed).length, total: list.length });
  return { required: bucket(counted.filter((item) => item.required)), optional: bucket(counted.filter((item) => !item.required)),
    unknown: counted.filter((item) => effective(item) === 'UNKNOWN' || item.applicability === 'UNKNOWN').length,
    skipped: counted.filter((item) => item.result === 'SKIPPED').length };
}

/** Why an inapplicability disposition cannot apply, or null when it applies. Only a wholly inapplicable category can be Not applicable. */
function dispositionProblem(input, own, failures) {
  const disposition = input.inapplicable;
  if (input.required) return 'A required category cannot be Not applicable. An empty required category is Unassessed.';
  if (disposition.approved !== true) return 'The inapplicability disposition is not approved.';
  if (!isText(disposition.reason)) return 'The inapplicability disposition has no reason.';
  if (failures.length) return `The disposition conflicts with a verified fundamental failure: ${failures.join(', ')}.`;
  const failure = own.find((item) => item.eligible && item.result === 'FAIL');
  if (failure) return `The disposition conflicts with an eligible failure: ${failure.id}.`;
  const applicable = own.find((item) => item.applicability === 'APPLICABLE');
  if (applicable) return `The disposition conflicts with an applicable obligation: ${applicable.id}.`;
  const open = own.find((item) => item.applicability === 'UNKNOWN');
  if (open) return `The disposition conflicts with an obligation of unknown applicability: ${open.id}.`;
  return null;
}

/** Level-3 conditions from the required obligations of the category: a FAIL is unmet; an open result is unknown. */
function obligationConditions(own) {
  return own.filter((item) => item.required && applies(item)).map((item) => {
    const result = effective(item);
    return { id: `obligation:${item.id}`, met: result === 'PASS' && item.applicability === 'APPLICABLE' ? true : result === 'FAIL' ? false : null };
  });
}

const satisfied = (list) => list.length > 0 && list.every((predicate) => predicate.met === true);

/**
 * Rates one category with the decision tree of the specification: Not applicable, then a verified fundamental
 * failure (1), then Unassessed, then Weak (2), then the highest fully satisfied cumulative band among 3, 4 and 5.
 * A band without predicates cannot be reached, so a missing higher-tier check caps the band and invents no failure.
 * Each result also tells readiness whether the minimum evidence is met and a rubric with level-3 predicates is configured.
 */
export function rateCategory(input) {
  const own = (input.obligations ?? []).filter((item) => item.category === input.category);
  const missingEvidence = [...(input.minimumEvidence?.missing ?? [])];
  const bands = input.bands ?? {};
  const minimumEvidenceMet = input.minimumEvidence?.met === true, rubricConfigured = Boolean(input.rubric) && bands[3]?.length > 0;
  const failures = (input.fundamental ?? []).filter((predicate) => predicate.met === true).map((predicate) => predicate.id);
  const rejectedDisposition = input.inapplicable ? dispositionProblem(input, own, failures) : null;
  const result = (state, value, reason, extra = {}) => ({ state, value, label: value ? labels[value] : state === 'NOT_APPLICABLE' ? 'Not applicable' : 'Unassessed',
    reason, predicates: { met: [], unmet: [], unknown: [] }, failures: [], missingEvidence, minimumEvidenceMet, rubricConfigured, rejectedDisposition, ...extra });
  if (input.inapplicable && rejectedDisposition === null) return result('NOT_APPLICABLE', null, input.inapplicable.reason);
  if (failures.length) return result('RATED', 1, `A verified fundamental failure under the category rubric: ${failures.join(', ')}.`, { failures });
  if (!input.rubric) return result('UNASSESSED', null, 'No rubric is configured for this category.');
  if (!rubricConfigured) return result('UNASSESSED', null, 'The configured rubric has no level-3 predicates.');
  if (!minimumEvidenceMet) return result('UNASSESSED', null, 'The minimum assessment evidence for this category is not available.');
  // Without an applicable obligation, "all applicable required obligations pass" is true only because nothing was checked.
  // Level 3 needs "all applicable required obligations pass", which is empty and thus proves nothing without one.
  if (!own.some((item) => item.applicability === 'APPLICABLE' && (item.required || input.allowOptionalAssessment === true && completed(item)))) return result('UNASSESSED', null, 'The category has no applicable required obligation, so it is empty.');
  const level3 = [...obligationConditions(own), ...bands[3]], level4 = bands[4] ?? [], level5 = bands[5] ?? [];
  const all = [...level3, ...level4, ...level5];
  const predicates = { met: all.filter((p) => p.met === true).map((p) => p.id), unmet: all.filter((p) => p.met === false).map((p) => p.id),
    unknown: all.filter((p) => p.met !== true && p.met !== false).map((p) => p.id) };
  // A reason names the open conditions by ID. The report turns the IDs into plain words.
  const open = (list) => [['Not met', list.filter((p) => p.met === false)], ['Without a result', list.filter((p) => p.met !== true && p.met !== false)]]
    .filter(([, items]) => items.length).map(([label, items]) => ` ${label}: ${items.map((p) => p.id).join(', ')}.`).join('');
  if (!satisfied(level3)) return result('RATED', 2, `Level 3 needs every level-3 condition.${open(level3)}`, { predicates });
  const value = !satisfied(level4) ? 3 : !satisfied(level5) ? 4 : 5;
  const next = value === 3 ? level4 : level5, level = value + 1;
  const limit = value === 5 ? '' : next.length === 0 ? ` This rule set has no level-${level} condition for this category, so ${value} of 5 is the highest rating.` : ` Level ${level} is open.${open(next)}`;
  return result('RATED', value, `All conditions up to level ${value} are met.${limit}`, { predicates });
}

/**
 * Readiness from the obligations and review rules, in this order: BLOCKED, INSUFFICIENT_EVIDENCE, REVIEW, READY.
 * Category results count only for presence: a required category must be rated, with its minimum evidence met and its
 * rubric configured. A 1/5 from a fundamental failure can lack both, so the state alone is not enough. Values never apply.
 */
export function readiness(obligations, categoryResults, { requiredCategories = [] } = {}) {
  const live = obligations.filter(applies);
  const blocking = live.filter((item) => item.blocking && effective(item) === 'FAIL').map((item) => item.id);
  const insufficient = live.filter((item) => item.required && (item.applicability === 'UNKNOWN' || ['UNKNOWN', 'SKIPPED'].includes(effective(item)))).map((item) => item.id);
  const unassessedCategories = requiredCategories.filter((category) => categoryResults?.[category]?.state !== 'RATED');
  const unsupportedCategories = requiredCategories.filter((category) => categoryResults?.[category]?.state === 'RATED'
    && (categoryResults[category].minimumEvidenceMet !== true || categoryResults[category].rubricConfigured !== true));
  const review = live.filter((item) => !item.blocking && effective(item) === 'FAIL' && (item.required || item.review !== 'resolved'))
    .concat(live.filter((item) => item.review === 'required' && effective(item) !== 'FAIL')).map((item) => item.id);
  // A fundamental failure that the profile does not also record as an obligation is still an open failure.
  const failedCategories = Object.entries(categoryResults ?? {}).filter(([, result]) => result?.failures?.length).map(([category]) => category);
  const state = (name, reason) => ({ state: name, blocking, insufficient, review, unassessedCategories, unsupportedCategories, failedCategories, reason });
  if (blocking.length) return state('BLOCKED', `An eligible blocking obligation failed: ${blocking.join(', ')}.`);
  if (insufficient.length) return state('INSUFFICIENT_EVIDENCE', `Required obligations have no eligible result or applicability: ${insufficient.join(', ')}.`);
  if (unassessedCategories.length) return state('INSUFFICIENT_EVIDENCE', `Required categories are not rated: ${unassessedCategories.join(', ')}.`);
  if (unsupportedCategories.length) return state('INSUFFICIENT_EVIDENCE', `Required categories lack minimum assessment evidence or a configured rubric: ${unsupportedCategories.join(', ')}.`);
  if (review.length) return state('REVIEW', `Failures or reviews remain open: ${review.join(', ')}.`);
  if (failedCategories.length) return state('REVIEW', `A verified fundamental failure is open in: ${failedCategories.join(', ')}.`);
  if (!live.some((item) => item.required)) return state('INSUFFICIENT_EVIDENCE', 'No applicable required obligation was assessed, so the assessment is empty.');
  return state('READY', 'Every applicable required obligation passed and no review is open.');
}

/** 0 READY, 1 REVIEW, 2 BLOCKED, 3 INSUFFICIENT_EVIDENCE; any other state is an internal failure (4). */
export function exitCode(state) {
  return Object.hasOwn(exitCodes, state) ? exitCodes[state] : invalidExitCode;
}
