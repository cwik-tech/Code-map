// Pure stdout summary for a completed verification run.
const shownChecks = 20;

/** The small JSON summary that `code-map verify` prints: the readiness, the four ratings, the failed checks, the hypotheses and the written files. */
export function verifySummary(results, paths) {
  const failed = results.obligations.filter((item) => item.eligible && item.result === 'FAIL').map((item) => item.id);
  return { reportType: 'code-map-verification-summary', schemaVersion: 1, runId: results.runId, ...(results.profileStatus ? { profileStatus: results.profileStatus } : {}), readiness: results.readiness.state, exitCode: results.readiness.exitCode,
    ratings: Object.fromEntries(Object.entries(results.ratings).map(([name, rating]) => [name, { state: rating.state, value: rating.value, label: rating.label }])),
    blocking: results.readiness.blocking.slice(0, shownChecks), failed: failed.slice(0, shownChecks),
    hypotheses: results.llmHypothesesFile ? { state: results.llmHypothesesFile.state, total: results.llmHypothesesFile.total, grounded: results.llmHypothesesFile.grounded, ungrounded: results.llmHypothesesFile.ungrounded } : null,
    files: { results: paths.jsonPath, report: paths.markdownPath, manifest: paths.manifestPath } };
}
