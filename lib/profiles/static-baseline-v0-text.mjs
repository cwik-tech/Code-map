// The words of the rule set static-baseline-v0: the titles of the request checks, why each open check stays UNKNOWN and what
// would close it, and each reason why two analyses are not comparable, with the action that makes them comparable.
export const requestTitles = { 'scope.allowed-paths': 'Changes stay in scope', 'scope.declared': 'Changes stay in scope', 'refactor.behavior-preserved': 'Behavior is preserved',
  'fix.reproduced': 'The bug is reproduced on the base', 'fix.regression-check': 'A regression test passes on the head', 'feature.consumer-contracts': 'Consumer contracts are compatible',
  'feature.acceptance-criteria': 'Acceptance criteria exist' };
/** A check that stays UNKNOWN because the request has no value for a field: the result of the gap, and the next action. */
export const missingFields = { 'scope.declared': ['Without them, the scope check cannot give PASS or FAIL.', 'Add allowedPaths to the request.'],
  'feature.acceptance-criteria': ['Without them, no check can tell what the feature must do.', 'Add acceptanceCriteria to the request.'] };
/** Each other check of the request stays UNKNOWN in v0: what would close it, and the next action until then. Each acceptance criterion uses `acceptance`. */
export const openChecks = {
  'refactor.behavior-preserved': ['Test results whose expected values a person or another trusted source confirmed would close this check, but Code-map cannot read such a record yet.',
    'Ask a reviewer to confirm that the head behaves as the base did.'],
  'fix.reproduced': ['A bound base report in which a test of the bug fails would close this check, but Code-map cannot tie a test case to a bug yet.', 'Run the regression test on the base, and ask a reviewer to confirm that it fails there.'],
  'fix.regression-check': ['A bound head report in which the regression test passes would close this check, but Code-map cannot tell which test case is the regression test.', 'Ask a reviewer to confirm that the regression test passes on the head.'],
  'feature.consumer-contracts': ['Contract tests of the consumers would close this check, but Code-map cannot tie a test to a consumer contract yet. A bound compiler report alone does not close it.',
    'Run the TypeScript compiler and the consumer tests on the head, and ask a reviewer to check the result.'],
  acceptance: ['A linked test case whose expected result a person or another trusted source confirmed would close this check, but this version has no record of such a confirmation.', 'Ask a reviewer to confirm that the head meets this acceptance criterion.'] };

/** Each reason why two analyses are not comparable (from compare.mjs and inspect.mjs) in words, with the action that makes them comparable. */
export const comparisonFixes = { repository: ['the analyses come from different repositories', 'Run code-map verify in the one repository that has the base and the head.'],
  analyzer: ['different Code-map versions made the analyses', 'Run code-map verify again with one Code-map version, so that this version analyzes the base and the head.'],
  config: ['the Code-map settings of the analyses differ', 'Keep .code-map.json unchanged while code-map verify runs, and run it again.'],
  environment: ['the analyses ran with different TypeScript or Node.js versions', 'Run code-map verify again with one Node.js version and one TypeScript version for the base and the head.'],
  roots: ['the source roots differ', 'Without "roots" in .code-map.json, Code-map finds the source folders of each snapshot from its own files, so a change that adds or removes a source folder changes them. '
    + 'Add "roots" with the source folders of both snapshots, for example ["lib", "src"], to .code-map.json in its own commit before the change, and use that commit as the base. '
    + 'A settings edit inside the change itself fails the settings check.'],
  'worktree-changed': ['the working tree changed after Code-map analyzed the head', 'Run code-map verify again when no person or tool edits the working tree.'],
  'freshness-unknown': ['Code-map cannot tell whether the working tree changed after it analyzed the head', 'Run code-map verify again when no person or tool edits the working tree.'],
  'renames-unavailable': ['Git cannot list the renames between the base and the head', 'Make sure that this clone has the base commit and that git diff can compare the base with the head. Then run code-map verify again.'] };
export const otherFix = ['the analyses differ in a way that this rule set does not describe', 'Analyze the base and the head with one Code-map version, one configuration and one environment. Then run code-map verify again.'];
