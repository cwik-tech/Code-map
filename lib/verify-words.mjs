// The fixed words of the verification report: category names and questions, readiness meanings, comparison reasons,
// the Terms table, the finding rules that the checks name, and plain words for the rating conditions of static-baseline-v0.
export const names = { structuralIntegrity: 'Structural Integrity', verificationCoverage: 'Verification Coverage', behavioralConfidence: 'Behavioral Confidence', changeCompleteness: 'Change Completeness' };
export const questions = { structuralIntegrity: 'Does the change fit its interfaces and the architecture rules?', verificationCoverage: 'Which changed code ran in tests?',
  behavioralConfidence: 'Did the tests confirm expected results that a person or another trusted source validated?',
  changeCompleteness: 'Did the change also update the consumers of the changed code and the necessary follow-up files?' };
export const meanings = { READY: 'Every required check passed, and each required category has a rating.',
  REVIEW: 'No check blocks the change, and the evidence is sufficient. But some checks failed without blocking, or a person must review them.',
  BLOCKED: 'The change is not ready. A blocking check stops the change at once, and a review by a person cannot clear its failure.',
  INSUFFICIENT_EVIDENCE: 'Some required evidence is missing, so Code-map cannot decide whether the change is ready. This result is not an approval.' };
export const comparisonReasons = { repository: 'the analyses come from different repositories', analyzer: 'different Code-map versions made the analyses',
  config: 'the Code-map settings differ', environment: 'the TypeScript or Node.js versions differ', roots: 'the source roots differ',
  'worktree-changed': 'the working tree changed after the head analysis', 'freshness-unknown': 'Code-map cannot tell whether the working tree changed after the head analysis',
  'renames-unavailable': 'Git cannot list the renames between the base and the head' };
export const terms = [
  ['Change', 'The difference between the base and the head'], ['Base', 'The commit that the change starts from'], ['Head', 'The commit or the working tree that has the change'],
  ['Snapshot', 'The base or the head. For a test report, it is the snapshot that its run manifest matches. Not bound means that the manifest matches neither'],
  ['Stored analysis', 'The saved result of code-map inspect for one snapshot of the code'], ['Digest', 'A SHA-256 hash of a file or a text. Two equal digests mean equal contents'],
  ['Rule set', 'The versioned rules that select the checks and rate the categories. The specification calls a rule set a profile'],
  ['Check', 'One condition that the change must satisfy. The specification calls a check an obligation. Its result is PASS, FAIL, UNKNOWN, SKIPPED or NOT_APPLICABLE'],
  ['Required check', 'A check that must pass before the change can be READY'], ['Blocking check', 'A check whose failure gives BLOCKED at once'],
  ['Optional check', 'A check that can stay without a result when the change is READY. A failed optional check needs a review, or it gives BLOCKED when the check blocks'],
  ['Eligible result', 'A PASS or FAIL from evidence that is tied to the analyzed code. A result that is not eligible counts as UNKNOWN'],
  ['Evidence ID', 'A finding ID, or a name with a prefix: "path:" for a file, "report:" for a test report, "case:" for a test case, "import:" for an import line, "analysis:" for a stored analysis or "request:" for a field of the request'],
  ['Finding', 'A static lead from code-map inspect. A finding ID starts with the ID of its rule. The rows at the end of this table explain the rules that this report names'],
  ['NEW, EXISTING, RESOLVED, UNKNOWN', 'The label of a finding when Code-map compares the head with the base: only in the head, in both, only in the base, or Code-map cannot decide'],
  ['Comparable', 'The same Code-map version, settings and environment made both analyses'], ['Unfiltered run', 'A test run whose run manifest records no filter, so the run did not select a subset of the tests'],
  ['Run manifest', 'A file from a test run that records the commit, a digest of the working tree, the command, the tools, the configuration digest, the environment, the exit status and the digests of the report files'],
  ['Bound test report', 'A JUnit, Jest or Vitest report whose run manifest matches the analyzed code. Only a bound report can count as evidence'],
  ['Self-attested', "The project's own test run wrote the run manifest. The manifest shows which code a report describes, but not that the run was honest"],
  ['Readiness', 'One state for the whole change: READY, REVIEW, BLOCKED or INSUFFICIENT_EVIDENCE. The exit code of code-map verify comes from it'],
  ['Rating', 'A value from 1 to 5 for one category: 1 is Failing, 2 is Weak, 3 is Adequate, 4 is Strong and 5 is Thorough'],
  ['Level condition', 'A condition for a rating. 3 of 5 needs each level-3 condition. 4 of 5 also needs each level-4 condition, and 5 of 5 also needs each level-5 condition. '
    + 'A fundamental failure is a verified problem that gives 1 of 5 at once, for example a new break of an architecture rule. verification-results.json calls a condition a predicate'],
  ['Minimum evidence', 'The evidence that a category needs before it can have a rating. Without it, the category is Unassessed, and the Ratings table names the missing evidence'],
  ['Unassessed', 'The category has not enough evidence for a rating. Unassessed is not a low rating'],
];
/** The finding rules that the checks name (refer to docs/retrieval.md). The Terms table explains only the rules that the report uses. */
export const findingRules = { 'ARCH-RULE': 'An import breaks an architecture rule in .code-map.json', 'IMPORT-UNRESOLVED': 'A relative import matches no file',
  'IMPORT-NAME-MISSING': 'A file imports a name that the imported file does not export', 'CYCLE-VALUE': 'Files import each other through value or side-effect imports',
  'TEST-FOCUSED': 'A test case is focused with .only, so the runner skips the other tests', 'TEST-PARKED': 'A test case is skipped, todo or conditional',
  'TEST-NO-ASSERTIONS': 'A running test case has no assertion that the scan can find', 'TEST-SWALLOWED-ERROR': 'A test case catches an error around an assertion and ignores it' };
/** Plain words and the level of the rating conditions of static-baseline-v0. Level 1 is a fundamental failure. */
export const conditions = { 'si.new-architecture-break': [1, 'the head has a NEW ARCH-RULE finding'], 'si.new-import-unresolved': [1, 'the change adds an import that does not resolve'],
  'vc.unfiltered-run-ran-nothing': [1, 'an unfiltered run of the head ran no test case, and the change touched code that is not a test'],
  'cc.consumer-lost-target': [1, 'an import that resolved in the base is broken in the head'], 'vc.changed-test-files-ran': [3, 'each changed test file ran'],
  'si.imports-classified': [3, 'Code-map can classify each import of a changed file, and the check for missing import names skipped none of them'], 'si.rules-declared': [4, 'the project declares architecture rules'],
  'si.no-rule-finding-on-change': [4, 'no ARCH-RULE finding touches a changed file'], 'si.reaching-tests-loaded': [4, 'each test file that reaches a changed file loaded in an unfiltered run'],
  'vc.active-test-files-ran': [4, 'each test file with active test cases ran'], 'bc.no-new-failures': [3, 'the head reports have no new failed test case'],
  'cc.no-hidden-importers': [3, 'no file outside the change imports a changed file through a computed dynamic import or an import that the check for missing import names skipped'] };
