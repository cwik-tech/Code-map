// `code-map verify`: checks one change, from a base commit to a head commit or the working tree, under one rule set.
// It reuses the stored analyses of `inspect`, imports the test, compiler and coverage reports that a run manifest binds to the analyzed code, and
// writes verification-results.json and verification-report.md: four separate ratings and one readiness state, no total.
// V1 requires current human reviews for assertion and runner weakening. V0 keeps these entries informational.
// It runs authorized project commands only in the restricted worker.
// It writes only to the store and output folder, outside the repository and its Git folders.
// It also records the oracle provenance of the test cases and, when the request names a file, the hypotheses of a language model.
// V0 keeps provenance informational. V1 uses current human oracle records. `--context` reads a finished run and writes nothing.
import { ratingContract, compareRatings } from './verification-contract.mjs';
import { rolloutInformation } from './schemas/rollout-information.mjs';

import { compilerLifecycle } from './compiler-lifecycle.mjs';
import { contractInformation } from './contracts/report.mjs';
import { unavailableGenerated } from './verify-test-validation.mjs';
import { generatedOracles } from './generated-oracles.mjs';
import { migrationInformation } from './migrations.mjs';
import { publicInterfaceInformation } from './revision-policy.mjs';
import { typeInformation } from './types/verify.mjs';
import { summarizeMutation } from './mutation/report.mjs';
import { installProblem } from './worker/install.mjs';
import { executeVerify } from './verify-exec.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { compareBench } from './bench-report.mjs';
import { compareSizes } from './size-report.mjs';
import { changedCoverage, coverageSection } from './changed-coverage.mjs';
import { bundleEvidence } from './bundle-evidence.mjs';
import { compareAreas } from './complexity-areas.mjs';
import { coverageFunctions, projectCoverage, coverageLoss, executedExports } from './coverage-evidence.mjs';
import { functionList } from './complexity.mjs';
import { git } from './git.mjs';
import { groundHypotheses, readHypotheses, resultEvidence } from './hypotheses.mjs';
import { analysisId, analysisInputs } from './inputs.mjs';
import { checkStore, commandLine, comparisonOf, ensure, isInside, protectedFolderOf, realPath } from './inspect.mjs';
import { summaryReport } from './overview.mjs';
import * as staticBaseline from './profiles/static-baseline-v0.mjs';
import * as evidenceV1 from './profiles/evidence-v1.mjs';
import { collectEvidence } from './profiles/evidence-v1-inputs.mjs';
import { criterionChecks, oracleProvenance } from './provenance.mjs';
import { categories, evidenceCompleteness, exitCode, rateCategory, readiness } from './ratings.mjs';
import { requirePrivateFolder, storeLocation } from './store.mjs';
import { testChanges } from './test-changes.mjs';
import { compareSupply } from './supply/compare.mjs';
import { runtimeTestLinks } from './test-links.mjs';
import { testDependencies } from './test-dependencies.mjs';
import { testRuns } from './test-runs.mjs';
import { changedFiles, changedLines, changedPaths, coveragePatch, importOrigins, testWeakening } from './verify-change.mjs';
import { changeImpact, impactLimits, removedImports } from './impact/reach.mjs';
import { graphContext, readRun, verificationContext } from './verify-context.mjs';
import { renderReport, writeRun } from './verify-report.mjs';
import { loadReports, message, readLimited, shown } from './verify-reports.mjs';
export { loadReports } from './verify-reports.mjs';
export { verifySummary } from './verify-summary.mjs';
import { settingsDrift, withChecks, withDrift } from './verify-drift.mjs';
import { validateRequest } from './verify-request.mjs';

/** The rule sets that this version knows, by ID. Each one exports `profile` and `evaluateProfile`. */
const profiles = new Map([staticBaseline, evidenceV1].map((rules) => [rules.profile.id, rules]));
const maxRequestBytes = 1024 * 1024;
/** The results keep the first 50 changed paths. The summary on stdout names at most 20 checks, and an invalid request shows at most 20 errors. */
const shownPaths = 50, shownErrors = 20;
const typeScript = /\.(?:ts|tsx|mts|cts)$/;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const now = { state: 'current', changed: [] };

/** What static-baseline-v0 cannot assess yet. The report lists these items as the limits of the rule set. */
const limits = [
  'No record confirms the expected results of the tests (oracle validation), so Behavioral Confidence stays Unassessed.',
  'Line coverage counts only the changed lines with a DA record in a bound LCOV report of the head. Statement and function coverage are information only, and no rating condition uses them. Base coverage comparison is information only.',
  'A changed code file without an SF record in the bound LCOV reports is not measured, so Verification Coverage cannot reach 3 of 5.',
  'Without a bound TypeScript compiler report of the head, the type check stays UNKNOWN in a TypeScript project.',
  'A compiler report lists errors, not the files that the compiler checked. A changed file that the compiler did not check has no error, so the type check cannot see it.',
  'No check can confirm preserved behavior (refactor), a reproduced bug or a regression test (fix), or an acceptance criterion. These checks stay UNKNOWN.',
  'No check finds a missing migration or a missing documentation update.',
  'Both analyses read the Code-map settings in the working folder, not the settings of the base commit. For a head commit, the settings check fails when the working folder has other settings than that commit.',
  'Each bound test or compiler report is self-attested. The project\'s own run wrote its run manifest, so the manifest shows which code the report describes, but not that the run was honest. A report of code-map run is isolated: Code-map ran the command in the restricted worker and wrote the manifest itself. Both count the same in this rule set.',
  'As a result, this rule set can block a change, but it cannot give READY.',
];

/** With a bound coverage report, this text replaces the coverage gap of the head analysis, which is about the working-folder coverage of inspect. */
const boundCoverageGap = 'The stored head analysis does not tie a coverage report to the code. The coverage of the change comes only from the bound coverage reports of the request.';

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
export const verificationRoot = (repository, options, location) => options['out-dir'] === undefined ? join(location.root, 'verifications', sha256(realPath(repository)).slice(0, 16)) : resolve(options['out-dir']);
function outputRoot(repository, options, location) {
  const root = verificationRoot(repository, options, location);
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
 * the output folder. `options['no-cache']` turns off the file cache. It returns the results, the paths of the written files and the exit code of the readiness state.
 * An invalid request, an unknown rule set or a failure throws, and no run folder is written.
 */
export function runVerify(repository, config, options, env = process.env) {
  if (typeof options.request !== 'string' || options.request.length === 0) throw new Error('code-map verify needs --request <file.json>.');
  const { request, digest, rules } = readRequest(resolve(options.request));
  if (options.install !== undefined || options['npm-cache'] !== undefined) {
    const problem = installProblem(options.install, options['npm-cache']);
    if (problem) throw new Error(problem);
    if (!request.execution.enabled) throw new Error('Install options require enabled verification execution.');
    if (request.execution.install !== undefined && (request.execution.install !== options.install || request.execution.npmCache !== options['npm-cache'])) {
      throw new Error('CLI install options conflict with the execution install policy in the request.');
    }
    Object.assign(request.execution, { install: options.install, npmCache: options['npm-cache'] });
  }
  const location = storeLocation(options.store, env), out = outputRoot(repository, options, location);
  checkStore(repository, config, {}, location);
  const baselineReport = request.baselineReport === undefined ? null : readRun(out, request.baselineReport);
  const worktree = request.head === 'worktree';
  commitOf(repository, request.base, 'base');
  if (!worktree) commitOf(repository, request.head, 'head');
  // The base usually shares most files with the head, so the base analysis takes their facts from the file cache.
  const cache = { 'no-cache': !!options['no-cache'] };
  const head = ensure(repository, config, worktree ? { worktree: true, ...cache } : { worktree: false, ref: request.head, ...cache }, location);
  const base = ensure(repository, config, { worktree: false, ref: request.base, ...cache }, location);
  const comparison = comparisonOf(head.stored, base.stored, now, base.reused), verdict = comparison.result;
  const labels = Object.fromEntries(Object.entries(verdict.statuses).map(([id, status]) => [id, status.baseline]));
  const headAnalysis = head.stored.data.analysis, baseAnalysis = base.stored.data.analysis, headSha = head.stored.data.sha, baseSha = base.stored.data.sha;
  const files = changedFiles(repository, baseSha, worktree ? null : headSha), change = { ...files, paths: changedPaths(files) };
  const sides = { head: { inputs: head.inputs, sha: headSha, analysis: headAnalysis }, base: { inputs: base.inputs, sha: baseSha, analysis: baseAnalysis } };
  const finish = (executed) => {
    const oracleLinks = generatedOracles(repository, request, head.stored);
    const { executions, reports, compiler, coverage: bound, baseCoverage, sizes, bench, discovery, compilerFiles } = loadReports(repository, [...request.reportInputs, ...(executed?.inputs ?? [])], sides, undefined, location.root, { extended: rules.profile.id === 'evidence-v1' });
    const ratingReports = bound.map((report) => ({ ...report, files: report.ratingFiles }));
    // Only the bound coverage reports of the head give coverage, and only a bound LCOV report gives line coverage. Without one, the rule set gets null.
    const coverage = bound.length ? changedCoverage(changedLines(repository, baseSha, worktree ? null : headSha, files.files), ratingReports, functionList(headAnalysis.files)) : null;
    const mutationLines = executions.some((item) => item.mutation) ? changedLines(repository, baseSha, worktree ? null : headSha, files.files) : new Map();
    const mutation = executions.filter((item) => item.mutation).map((item) => ({ artifact: item.artifact,
      ...summarizeMutation(item.mutation, mutationLines) }));
    for (const item of executions) if (item.mutation) { item.mutation = { mutants: item.mutation.mutants.length }; }
    const command = (args) => commandLine(['code-map', ...args, ...(location.explicit ? ['--store', location.root] : [])]);
    const settingsFiles = ['.code-map.json', relative(repository, resolve(repository, config.testLabels)).split(sep).join('/')];
    const oracles = oracleProvenance(repository, { request, reports: reports.head, change, renames: comparison.renames,
      head: { sha: headSha, worktree, analysis: headAnalysis }, base: { sha: baseSha, worktree: false, analysis: baseAnalysis } });
    const v1 = rules.profile.id === 'evidence-v1';
    const evidence = v1 ? collectEvidence(repository, { head: head.stored, base: base.stored, comparison, change, config, provenance: oracles, executions, mutation, coverage: ratingReports,
      lines: changedLines(repository, baseSha, worktree ? null : headSha, files.files) }) : null;
    const tests = { runtimeLinks: runtimeTestLinks(headAnalysis, bound), ...testChanges(repository, { baseSha, headSha: worktree ? null : headSha, change, baseAnalysis, headAnalysis }), ...testRuns(reports, discovery, files.files),
      ...(reports.base.length || reports.head.length ? { dependencies: testDependencies(reports, base.inputs.lockfile, head.inputs.lockfile, compareSupply(baseAnalysis.supply, headAnalysis.supply), files.files) } : {}) };
    const context = { request, tests, comparable: verdict.state === 'COMPARABLE', comparisonReasons: verdict.reasons,
      head: sideOf(head.stored), base: sideOf(base.stored), labels, change, renames: comparison.renames,
      importOrigins: importOrigins(baseAnalysis, head.stored.findings, labels, comparison.renames),
      weakening: testWeakening(baseAnalysis, headAnalysis, comparison.renames, labels, head.stored.findings), settingsFiles,
      typescript: [...headAnalysis.files, ...(headAnalysis.tests?.testFiles ?? [])].some((file) => typeScript.test(file.path)), reports, compiler,
      coverage: coverage?.lineReports.length ? coverage : null, command, evidence, testValidation: executed?.testValidation ?? [] };
    const drifted = withDrift(rules.evaluateProfile(context),
    worktree ? [] : settingsDrift(repository, headSha, settingsFiles));
    const evaluation = v1 ? drifted : withChecks(drifted, criterionChecks(drifted.obligations, oracles.section));
    const ratings = Object.fromEntries(categories.map((name) => [name, { ...ratingOf(evaluation.categories[name]), evidenceCompleteness: evidenceCompleteness(evaluation.obligations, name) }]));
    const state = v1 ? rules.profileReadiness(evaluation.obligations, ratings, context) : readiness(evaluation.obligations, ratings, { requiredCategories: rules.profile.requiredCategories });
    const code = exitCode(state.state);
    if (worktree) requireUnchanged(repository, config, head);
    const createdAt = new Date().toISOString(), runId = runIdOf(createdAt);
    const rollout = rolloutInformation(base.stored, head.stored, comparison, change.complete);
    const information = contractInformation(baseAnalysis, headAnalysis, verdict.state === 'COMPARABLE');
    const results = { reportType: 'code-map-verification', schemaVersion: 1, runId, createdAt, profileId: rules.profile.id, ratingRulesVersion: rules.profile.ratingRulesVersion,
      ...(v1 ? { profileStatus: rules.profile.status, oracleRecords: evidence.oracles } : {}),
      ...ratingContract({ request, rules, evaluation, executions, repository: head.inputs.repository, paths: change.paths, analysisPolicy: { config: head.inputs.config, roots: head.stored.data.roots, analyzer: head.inputs.analyzer }, evaluatorDigest: head.inputs.analyzer.source }),
      changeType: request.changeType, intent: request.intent,
      request: { digest, acceptanceCriteria: request.acceptanceCriteria, allowedPaths: request.allowedPaths, hypotheses: request.hypotheses ?? null },
      base: { ref: request.base, sha: baseSha, analysisId: base.stored.id },
      head: { ref: request.head, sha: headSha, analysisId: head.stored.id, worktreeDigest: head.inputs.worktree?.contentDigest ?? null },
      comparison: { state: verdict.state, reasons: verdict.reasons }, readiness: { ...state, exitCode: code }, ratings, obligations: evaluation.obligations,
      ...(executed ? { executionRuns: executed.executionRuns, testValidation: executed.testValidation } : {}),
      ...(request.generatedTests?.length ? { generatedTestMutations: (executed?.generatedTestMutations
        ?? unavailableGenerated(request.generatedTests, 'Execution is disabled.')).map((item) => ({ ...item,
          oracle: oracleLinks.find((x) => x.file === item.file && x.name === item.name) ?? null })) } : {}),
      change: { total: change.paths.length, complete: change.complete, paths: change.paths.slice(0, shownPaths) }, executions, provenance: oracles.section,
      ...(information ? { contractInformation: information } : {}),
      ...(rollout ? { schemaRollout: rollout } : {}),
      ...(bench.head.length || bench.base.length ? { bench: compareBench(bench, config.timings) } : {}), sizes: compareSizes(sizes), bundle: bundleEvidence(sizes, headAnalysis),
      complexity: { areas: compareAreas(baseAnalysis, headAnalysis, change.paths, comparison.renames, comparison.complete) },
      completeness: headAnalysis.completeness ?? null,
      graph: graphContext({ reports, obligations: evaluation.obligations, changedPaths: change.paths, findings: head.stored.findings,
        impact: (path) => changeImpact(headAnalysis, [path], impactLimits,
          removedImports(baseAnalysis, headAnalysis, files.files.filter((file) => file.status === 'D' || file.status === 'R').map((file) => file.from ?? file.path), comparison.renames).filter((edge) => edge.target === path)) }),
      ...(request.generatedTests?.length ? { generatedTestOracles: oracleLinks } : {}),
      policy: comparison.policy, publicInterfaces: publicInterfaceInformation(head.stored, comparison, request.allowedPublicChanges ?? null),
      migrations: migrationInformation(head.stored, comparison),
      mutation, compiler: compilerLifecycle(compiler, { comparable: verdict.state === 'COMPARABLE', renames: comparison.renames, complete: comparison.complete }),
      ...(headAnalysis.typed || compilerFiles.head.length ? { types: typeInformation(base.stored, head.stored, comparison, change, compilerFiles.head) } : {}),
      coverage: coverage && coverageSection(coverage, rules.thresholds), tests,
      coverageEvidence: bound.length || baseCoverage.length ? {
        project: projectCoverage(bound), baseProject: projectCoverage(baseCoverage),
        changed: coverageSection(changedCoverage(changedLines(repository, baseSha, worktree ? null : headSha, files.files), bound, coverageFunctions(headAnalysis.files))),
        lost: coverageLoss(coveragePatch(repository, baseSha, worktree ? null : headSha), baseCoverage, bound),
        unexecutedExports: executedExports(bound, coverageFunctions(headAnalysis.files)),
        mapping: [...baseCoverage.map((report) => ({ side: 'base', artifact: report.artifact, ...report.mapping })),
          ...bound.map((report) => ({ side: 'head', artifact: report.artifact, ...report.mapping }))],
      } : null,
      gaps: summaryReport(head.stored, { id: head.stored.id, freshness: now, command, reused: true }).gaps.map((gap) => coverage && gap.key === 'coverage' ? { ...gap, text: boundCoverageGap } : gap),
      limits: v1 ? rules.limits : limits, llmHypotheses: [], llmHypothesesFile: null };
    if (baselineReport) results.ratingComparison = { ...compareRatings(baselineReport, results), baselineRunId: baselineReport.runId };
    // The hypotheses come last, when the checks, the ratings and the readiness are final: they cannot change them.
    if (request.hypotheses !== undefined) {
      const known = resultEvidence(results, { paths: change.paths, caseIds: oracles.caseIds, criteria: request.acceptanceCriteria });
      const { file, items } = groundHypotheses(readHypotheses(repository, request.hypotheses), known);
      Object.assign(results, { llmHypotheses: items, llmHypothesesFile: file });
    }
    const paths = writeRun(out, { runId, results, markdown: renderReport(results), repository });
    return { results, paths, exitCode: code };
  };
  return request.execution.enabled ? executeVerify(repository, config, request, sides, location.root, env).then(finish) : finish(null);
}

/** The context of the finished run `options.context` for a language model (lib/verify-context.mjs). It reads the output folder of verify and writes nothing. */
export function runContext(repository, options, env = process.env) {
  return verificationContext(readRun(verificationRoot(repository, options, storeLocation(options.store, env)), options.context));
}
