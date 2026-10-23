// The declared input of a verification run: a versioned request, checked at the boundary before any analysis.
// Pure: it reads no file and runs no command. A request that fails validation gets every error, not only the first.

export const requestType = 'code-map-verification-request';
export const changeTypes = ['refactor', 'feature', 'fix', 'other'];
/** Execution budgets are whole numbers from 1 up to these limits: one day, 64 GiB, 1 GiB of output and 64 workers. */
export const budgetLimits = { minimum: 1, maximum: { wallClockSeconds: 86400, memoryMegabytes: 65536, outputMegabytes: 1024, concurrency: 64 } };

const fields = ['requestType', 'schemaVersion', 'base', 'head', 'intent', 'acceptanceCriteria', 'allowedPaths', 'changeType', 'profileId', 'ratingRulesVersion', 'reportInputs', 'execution'];
const identifier = /^[A-Za-z0-9._-]{1,100}$/;
const criterionId = /^[A-Za-z0-9._-]{1,64}$/;
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;
// Whitespace and control characters: NUL to space, and DEL.
const control = /[\u0000- \u007f]/;

/** Why a Git selector is unsafe, or null. A leading "-" could pass as a Git option. */
function refProblem(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) return 'Must be a nonempty string of at most 255 characters.';
  if (value.startsWith('-')) return 'Must not start with "-".';
  if (control.test(value)) return 'Must not contain whitespace or control characters.';
  if (value.includes('..')) return 'Must not contain "..".';
  return null;
}

/** Why a repository-relative path or glob is unsafe, or null. */
function pathProblem(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) return 'Must be a nonempty string of at most 1024 characters.';
  if (value.includes('\u0000')) return 'Must not contain a NUL byte.';
  if (value.includes('\\')) return 'Must use "/" separators, not backslashes.';
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return 'Must be relative to the repository root.';
  if (value.split('/').includes('..')) return 'Must not contain a ".." segment.';
  return null;
}

function unknownKeys(value, known, prefix, error) {
  for (const key of Object.keys(value)) if (!known.includes(key)) error(prefix + key, 'Unknown field.');
}

/** Checks a verification request. It returns a copy of a valid request, or every error with its field path. */
export function validateRequest(value) {
  if (!isRecord(value)) return { ok: false, errors: [{ path: '', message: 'A request must be an object.' }] };
  const errors = [], error = (path, message) => errors.push({ path, message });
  const check = (path, problem) => { if (problem) error(path, problem); };
  if (value.requestType !== requestType) error('requestType', `Must be "${requestType}".`);
  if (value.schemaVersion !== 1) error('schemaVersion', 'Must be the integer 1.');
  check('base', value.base === 'worktree' ? 'The base must be a revision, not the working tree.' : refProblem(value.base));
  check('head', value.head === 'worktree' ? null : refProblem(value.head));
  if (!isText(value.intent) || value.intent.length > 10000) error('intent', 'Must be nonempty text of at most 10000 characters.');
  criteria(value.acceptanceCriteria, error);
  if (value.allowedPaths !== null) {
    if (!Array.isArray(value.allowedPaths)) error('allowedPaths', 'Must be an array of repository-relative globs, or null when the scope is unknown.');
    else value.allowedPaths.forEach((glob, index) => check(`allowedPaths[${index}]`, pathProblem(glob)));
  }
  if (!changeTypes.includes(value.changeType)) error('changeType', `Must be one of: ${changeTypes.join(', ')}.`);
  for (const key of ['profileId', 'ratingRulesVersion']) if (typeof value[key] !== 'string' || !identifier.test(value[key])) error(key, 'Must be 1 to 100 letters, digits, ".", "_" or "-".');
  if (!Array.isArray(value.reportInputs)) error('reportInputs', 'Must be an array of {artifact, manifest} path pairs.');
  else value.reportInputs.forEach((input, index) => {
    const prefix = `reportInputs[${index}]`;
    if (!isRecord(input)) { error(prefix, 'Must be an object with artifact and manifest paths.'); return; }
    for (const key of ['artifact', 'manifest']) check(`${prefix}.${key}`, pathProblem(input[key]));
    unknownKeys(input, ['artifact', 'manifest'], `${prefix}.`, error);
  });
  execution(value.execution, error);
  unknownKeys(value, fields, '', error);
  return errors.length ? { ok: false, errors } : { ok: true, request: structuredClone(value) };
}

function criteria(list, error) {
  if (!Array.isArray(list)) { error('acceptanceCriteria', 'Must be an array of {id, text} entries.'); return; }
  const seen = new Set();
  list.forEach((item, index) => {
    const prefix = `acceptanceCriteria[${index}]`;
    if (!isRecord(item)) { error(prefix, 'Must be an object with id and text.'); return; }
    if (typeof item.id !== 'string' || !criterionId.test(item.id)) error(`${prefix}.id`, 'Must be 1 to 64 letters, digits, ".", "_" or "-".');
    else if (seen.has(item.id)) error(`${prefix}.id`, `Duplicate criterion ID "${item.id}".`);
    else seen.add(item.id);
    if (!isText(item.text)) error(`${prefix}.text`, 'Must be nonempty text.');
    unknownKeys(item, ['id', 'text'], `${prefix}.`, error);
  });
}

function execution(value, error) {
  if (!isRecord(value)) { error('execution', 'Must be an object with enabled, authorization and budgets.'); return; }
  if (typeof value.enabled !== 'boolean') error('execution.enabled', 'Must be true or false.');
  if (!Object.hasOwn(value, 'authorization') || (value.authorization !== null && !isText(value.authorization))) error('execution.authorization', 'Must be an authorization reference, or null.');
  else if (value.enabled === true && value.authorization === null) error('execution.authorization', 'Enabled execution needs an authorization reference.');
  if (!isRecord(value.budgets)) error('execution.budgets', 'Must be an object with explicit budgets.');
  else {
    for (const [key, maximum] of Object.entries(budgetLimits.maximum)) {
      const budget = value.budgets[key];
      if (!Number.isInteger(budget) || budget < budgetLimits.minimum || budget > maximum) error(`execution.budgets.${key}`, `Must be a whole number from ${budgetLimits.minimum} to ${maximum}.`);
    }
    unknownKeys(value.budgets, Object.keys(budgetLimits.maximum), 'execution.budgets.', error);
  }
  unknownKeys(value, ['enabled', 'authorization', 'budgets'], 'execution.', error);
}

const open = (id, category, severity, rationale, fields = {}) => ({ id, category, required: true, blocking: false, severity,
  applicability: 'APPLICABLE', result: 'UNKNOWN', eligible: false, review: 'none', evidenceIds: [], rationale, ...fields });

/**
 * The obligations that a validated request requires before any evidence arrives. Each one starts UNKNOWN.
 * A refactor needs preservation evidence, a fix needs a reproduction and a regression check, and a feature needs
 * acceptance criteria and consumer or contract checks. Preservation and regression failures block.
 */
export function requiredObligationsFor(request) {
  const list = [request.allowedPaths === null
    ? open('scope.declared', 'changeCompleteness', 'medium', 'No allowed paths were declared, so the scope of the change is unknown.', { applicability: 'UNKNOWN' })
    : open('scope.allowed-paths', 'changeCompleteness', 'medium', 'Every changed path must match the declared allowed paths.')];
  if (request.changeType === 'refactor') list.push(open('refactor.behavior-preserved', 'behavioralConfidence', 'high', 'A refactor must preserve the observable behavior.', { blocking: true }));
  if (request.changeType === 'fix') {
    list.push(open('fix.reproduced', 'behavioralConfidence', 'high', 'The fault must be reproduced on the base revision.'));
    list.push(open('fix.regression-check', 'behavioralConfidence', 'high', 'A regression check must pass on the head revision.', { blocking: true }));
  }
  if (request.changeType === 'feature') {
    list.push(open('feature.consumer-contracts', 'structuralIntegrity', 'high', 'Consumers and contracts of the changed interfaces must be checked.'));
    if (request.acceptanceCriteria.length === 0) list.push(open('feature.acceptance-criteria', 'changeCompleteness', 'high', 'A feature needs acceptance criteria, and none were declared.'));
  }
  for (const criterion of request.acceptanceCriteria) list.push(open(`acceptance.${criterion.id}`, 'behavioralConfidence', 'high', criterion.text));
  return list;
}
