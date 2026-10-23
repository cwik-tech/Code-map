// `code-map verify`: checks one change, from a base commit to a head commit or the working tree, under one rule set.
// It reuses the stored analyses of `inspect`, imports the test reports that a run manifest binds to the analyzed code, and
// writes verification-results.json and verification-report.md: four separate ratings and one readiness state, no total.
// It runs no project code. It writes only to the analysis store and the output folder, outside the repository and its Git folders.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { git } from './git.mjs';
import { analysisId, analysisInputs } from './inputs.mjs';
import { checkStore, commandLine, comparisonOf, ensure, isInside, protectedFolderOf, realPath } from './inspect.mjs';
import { summaryReport } from './overview.mjs';
import * as staticBaseline from './profiles/static-baseline-v0.mjs';
import { categories, evidenceCompleteness, exitCode, rateCategory, readiness } from './ratings.mjs';
import { requirePrivateFolder, storeLocation } from './store.mjs';
import { changedFiles, changedPaths, importOrigins, testWeakening } from './verify-change.mjs';
import { renderReport, writeRun } from './verify-report.mjs';
import { loadReports, message, readLimited, shown } from './verify-reports.mjs';

export { loadReports } from './verify-reports.mjs';
import { validateRequest } from './verify-request.mjs';

/** The rule sets that this version knows, by ID. Each one exports `profile` and `evaluateProfile`. */
const profiles = new Map([[staticBaseline.profile.id, staticBaseline]]);
const maxRequestBytes = 1024 * 1024;
/** The results keep the first 50 changed paths. The summary on stdout names at most 20 checks, and an invalid request shows at most 20 errors. */
const shownPaths = 50, shownChecks = 20, shownErrors = 20;
const typeScript = /\.(?:ts|tsx|mts|cts)$/;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const now = { state: 'current', changed: [] };

/** What static-baseline-v0 cannot assess yet. The report lists these items as the limits of the rule set. */
const limits = [
  'No record confirms the expected results of the tests (oracle validation), so Behavioral Confidence stays Unassessed.',
  'Code-map cannot bind a coverage report to the analyzed code yet, so Verification Coverage stays Unassessed.',
  'Code-map cannot import TypeScript compiler reports yet, so the type check stays UNKNOWN in a TypeScript project.',
  'No check can confirm preserved behavior (refactor), a reproduced bug or a regression test (fix), or an acceptance criterion. These checks stay UNKNOWN.',
  'No check finds a missing migration or a missing documentation update.',
  'Both analyses read the Code-map settings in the working folder, not the settings of the base commit. For a head commit, the settings check fails when the working folder has other settings than that commit.',
  'Each bound test report is self-attested. The project\'s own test run wrote its run manifest, so the manifest shows which code the report describes, but not that the run was honest.',
  'As a result, this rule set can block a change, but it cannot give READY.',
];

/** The validated request, the SHA-256 of its file and its rule set. Each problem is an invalid request (exit code 4). */
function readRequest(path) {
  const bytes = readLimited(path, maxRequestBytes, 'request file');
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch (error) { throw new Error(`The request file ${shown(path)} is not valid JSON: ${shown(message(error))}`); }
  const checked = validateRequest(value);
  if (!checked.ok) {
    const lines = checked.errors.slice(0, shownErrors).map((error) => `  ${shown(error.path || 'request')}: ${shown(error.message)}`);
    const more = checked.errors.length > shownErrors ? [`  and ${checked.errors.length - shownErrors} more errors`] : [];
    throw new Error([`The request file ${shown(path)} is not a valid verification request:`, ...lines, ...more].join('\n'));
  }
  const { request } = checked, rules = profiles.get(request.profileId);
  if (request.execution.enabled) throw new Error('This version of code-map verify runs no project code. Set execution.enabled to false, and add the reports of your own test run to reportInputs.');
  if (!rules) throw new Error(`The rule set "${request.profileId}" is not known. This version knows: ${[...profiles.keys()].join(', ')}.`);
  if (request.ratingRulesVersion !== rules.profile.ratingRulesVersion) {
    throw new Error(`The rule set ${rules.profile.id} uses the rating rules "${rules.profile.ratingRulesVersion}", not the rating rules "${request.ratingRulesVersion}".`);
  }
  return { request, digest: sha256(bytes), rules };
}

/** The commit SHA of a request selector. The request check already refused a selector that Git could read as an option. */
function commitOf(repository, ref, field) {
  try { return git(repository, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim(); } catch {
    throw new Error(`The ${field} "${shown(ref)}" is not a commit in this repository. Give ${field} a commit, branch or tag in the request.`);
  }
}

/**
 * --out-dir, or verifications/<repository key> in the store: the key is a short hash of the real path of the repository, so
 * latest.json there names a run of this repository. A folder inside the repository or its Git folders would change what verify describes.
 */
function outputRoot(repository, options, location) {
  const root = options['out-dir'] === undefined ? join(location.root, 'verifications', sha256(realPath(repository)).slice(0, 16)) : resolve(options['out-dir']);
  const holder = [root, join(root, 'runs')].map((path) => protectedFolderOf(repository, path)).find((found) => found !== null) ?? null;
  if (holder !== null) throw new Error(`The output folder ${shown(root)} is inside ${holder === repository ? 'the repository' : `the Git folder ${shown(holder)} of the repository`}. `
    + 'Choose a folder outside the repository and its Git folders with --out-dir <folder>: a folder inside them changes the code or the Git data that verify describes.');
  // In the store, the verifications folder and the folder of this repository must be private, as the analyses folder is:
  // another user who could change them could replace latest.json with a forged readiness state.
  if (options['out-dir'] === undefined) for (const folder of [join(location.root, 'verifications'), root]) {
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    requirePrivateFolder(folder, 'Remove it, or choose another output folder with --out-dir <folder>.');
  }
  return root;
}

/** A working-tree head must stay as analyzed, because the change list, the renames and the report binding read it again. */
function requireUnchanged(repository, config, head) {
  const current = analysisInputs(repository, config, { worktree: true }, null);
  if (analysisId(current) !== head.stored.id || (current.worktree?.contentDigest ?? null) !== (head.inputs.worktree?.contentDigest ?? null)) {
    throw new Error('The working tree changed while Code-map verified it. Run the command again when the files are stable.');
  }
}

/** The settings files whose content in the working folder differs from the head commit. A file that Code-map cannot read counts as different. */
function settingsDrift(repository, sha, paths) {
  const current = (path) => { try { return existsSync(join(repository, path)) ? readLimited(join(repository, path), maxRequestBytes, 'settings file').toString('utf8') : null; } catch { return undefined; } };
  const committed = (path) => { try { return git(repository, ['cat-file', 'blob', `${sha}:${path}`]); } catch { return null; } };
  return paths.filter((path) => current(path) !== committed(path));
}

/**
 * Both analyses read the settings in the working folder. For a head commit with other settings there, the settings check fails.
 * When .code-map.json differs, the architecture-rule check cannot pass or be not applicable, because the head commit can have other rules.
 */
function withDrift(evaluation, drift) {
  if (!drift.length) return evaluation;
  const evidenceIds = drift.map((path) => `path:${path}`), rulesDrift = drift.includes('.code-map.json');
  const nextAction = 'Undo the settings change in the working folder, or put it aside with git stash, so that the working folder has the settings of the head commit. Then run code-map verify again.';
  const change = (item) => {
    if (item.id === 'completeness.settings-unchanged') {
      const rationale = `The working folder has other settings than the head commit in ${drift.join(', ')}. Both analyses read the settings of the working folder, so a relaxed rule can hide a break.`;
      return { ...item, applicability: 'APPLICABLE', result: 'FAIL', eligible: true, evidenceIds: [...new Set([...evidenceIds, ...(item.result === 'FAIL' ? item.evidenceIds : [])])],
        rationale: item.result === 'FAIL' ? `${rationale} ${item.rationale}` : rationale, nextAction };
    }
    if (item.id !== 'structure.architecture-rules' || !rulesDrift || !['PASS', 'NOT_APPLICABLE'].includes(item.result)) return item;
    const { applicabilityReason: _, ...rest } = item;
    return { ...rest, applicability: item.applicability === 'NOT_APPLICABLE' ? 'UNKNOWN' : item.applicability, result: 'UNKNOWN', eligible: false, evidenceIds: ['path:.code-map.json'],
      rationale: 'The analyses read the architecture rules from .code-map.json in the working folder, not from the head commit, so this check cannot pass.', nextAction };
  };
  const obligations = evaluation.obligations.map(change), byId = new Map(obligations.map((item) => [item.id, item]));
  return { ...evaluation, obligations, categories: Object.fromEntries(Object.entries(evaluation.categories).map(([name, input]) =>
    [name, { ...input, obligations: (input.obligations ?? []).map((item) => byId.get(item.id) ?? item) }])) };
}

/** The rating of one category and the evidence IDs of each predicate that it names: a level-1 or band predicate of the rule set, or "obligation:<id>" for a required check. */
function ratingOf(input) {
  const rating = rateCategory(input), { met, unmet, unknown } = rating.predicates;
  const own = new Map([...(input.obligations ?? []).map((item) => [`obligation:${item.id}`, item.evidenceIds]),
    ...[...(input.fundamental ?? []), ...Object.values(input.bands ?? {}).flat()].map((predicate) => [predicate.id, predicate.evidenceIds ?? []])]);
  return { ...rating, predicateEvidence: Object.fromEntries([...rating.failures, ...met, ...unmet, ...unknown].map((id) => [id, [...(own.get(id) ?? [])]])) };
}

const sideOf = (stored) => ({ analysisId: stored.id, sha: stored.data.sha, analysis: stored.data.analysis, findings: stored.findings });
/** A run ID that sorts by time: V-<UTC time>-<8 random hexadecimal characters>. */
const runIdOf = (createdAt) => `V-${createdAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${randomBytes(4).toString('hex')}`;

/**
 * Runs one verification: `options.request` is the request file, `options.store` the analysis store and `options['out-dir']`
 * the output folder. It returns the results, the paths of the written files and the exit code of the readiness state.
 * An invalid request, an unknown rule set, a request to run project code or a failure throws, and no run folder is written.
 */
export function runVerify(repository, config, options, env = process.env) {
  if (typeof options.request !== 'string' || options.request.length === 0) throw new Error('code-map verify needs --request <file.json>.');
  const { request, digest, rules } = readRequest(resolve(options.request));
  const location = storeLocation(options.store, env), out = outputRoot(repository, options, location);
  checkStore(repository, config, {}, location);
  const worktree = request.head === 'worktree';
  commitOf(repository, request.base, 'base');
  if (!worktree) commitOf(repository, request.head, 'head');
  const head = ensure(repository, config, worktree ? { worktree: true } : { worktree: false, ref: request.head }, location);
  const base = ensure(repository, config, { worktree: false, ref: request.base }, location);
  const comparison = comparisonOf(head.stored, base.stored, now, base.reused), verdict = comparison.result;
  const labels = Object.fromEntries(Object.entries(verdict.statuses).map(([id, status]) => [id, status.baseline]));
  const headAnalysis = head.stored.data.analysis, baseAnalysis = base.stored.data.analysis, headSha = head.stored.data.sha, baseSha = base.stored.data.sha;
  const files = changedFiles(repository, baseSha, worktree ? null : headSha), change = { ...files, paths: changedPaths(files) };
  const sides = { head: { inputs: head.inputs, sha: headSha, analysis: headAnalysis }, base: { inputs: base.inputs, sha: baseSha, analysis: baseAnalysis } };
  const { executions, reports } = loadReports(repository, request.reportInputs, sides);
  const command = (args) => commandLine(['code-map', ...args, ...(location.explicit ? ['--store', location.root] : [])]);
  const settingsFiles = ['.code-map.json', relative(repository, resolve(repository, config.testLabels)).split(sep).join('/')];
  const evaluation = withDrift(rules.evaluateProfile({ request, comparable: verdict.state === 'COMPARABLE', comparisonReasons: verdict.reasons,
    head: sideOf(head.stored), base: sideOf(base.stored), labels, change,
    importOrigins: importOrigins(baseAnalysis, head.stored.findings, labels, comparison.renames),
    weakening: testWeakening(baseAnalysis, headAnalysis, comparison.renames, labels, head.stored.findings), settingsFiles,
    typescript: [...headAnalysis.files, ...(headAnalysis.tests?.testFiles ?? [])].some((file) => typeScript.test(file.path)), reports, coverage: null, command }),
  worktree ? [] : settingsDrift(repository, headSha, settingsFiles));
  const ratings = Object.fromEntries(categories.map((name) => [name, { ...ratingOf(evaluation.categories[name]), evidenceCompleteness: evidenceCompleteness(evaluation.obligations, name) }]));
  const state = readiness(evaluation.obligations, ratings, { requiredCategories: rules.profile.requiredCategories }), code = exitCode(state.state);
  if (worktree) requireUnchanged(repository, config, head);
  const createdAt = new Date().toISOString(), runId = runIdOf(createdAt);
  const results = { reportType: 'code-map-verification', schemaVersion: 1, runId, createdAt, profileId: rules.profile.id, ratingRulesVersion: rules.profile.ratingRulesVersion,
    changeType: request.changeType, intent: request.intent, request: { digest },
    base: { ref: request.base, sha: baseSha, analysisId: base.stored.id },
    head: { ref: request.head, sha: headSha, analysisId: head.stored.id, worktreeDigest: head.inputs.worktree?.contentDigest ?? null },
    comparison: { state: verdict.state, reasons: verdict.reasons }, readiness: { ...state, exitCode: code }, ratings, obligations: evaluation.obligations,
    change: { total: change.paths.length, complete: change.complete, paths: change.paths.slice(0, shownPaths) }, executions,
    gaps: summaryReport(head.stored, { id: head.stored.id, freshness: now, command, reused: true }).gaps, limits, llmHypotheses: [] };
  const paths = writeRun(out, { runId, results, markdown: renderReport(results), repository });
  return { results, paths, exitCode: code };
}

/** The small JSON summary that `code-map verify` prints: the readiness, the four ratings, the failed checks and the written files. */
export function verifySummary(results, paths) {
  const failed = results.obligations.filter((item) => item.eligible && item.result === 'FAIL').map((item) => item.id);
  return { reportType: 'code-map-verification-summary', schemaVersion: 1, runId: results.runId, readiness: results.readiness.state, exitCode: results.readiness.exitCode,
    ratings: Object.fromEntries(Object.entries(results.ratings).map(([name, rating]) => [name, { state: rating.state, value: rating.value, label: rating.label }])),
    blocking: results.readiness.blocking.slice(0, shownChecks), failed: failed.slice(0, shownChecks),
    files: { results: paths.jsonPath, report: paths.markdownPath, manifest: paths.manifestPath } };
}
