# Review status

## Test-quality review, 2026-10-21

Reviewed `main` at `5fe1a1f289e5b6763d41dec84ef93e8baffe11dd` plus uncommitted changes while Claude was actively implementing. Findings and evidence are in [the review record](records/2026-10-21-test-quality-review.md). This is a review snapshot, not implementation approval.

| Check | Result |
| --- | --- |
| Focused `code-map inspect --worktree` | Completed for the scanner, quality analysis, summary and source metrics; report guided direct source inspection. |
| Initial `npm test` | 37 tests: 33 passed, 4 failed. The failing browser probes reported `ReferenceError: TESTS is not defined` during the viewer implementation. This result does not describe a frozen final viewer. |
| Follow-up `npm test` | 37 passed, 0 failed, 0 skipped; approximately 9.7 seconds. The viewer changed during the review. Passing existing tests does not resolve the independently reproduced scanner defects. |
| Parser and report probes | Reproduced skipped/todo credit, unrelated assertion credit, name-only credit, unused helper credit, missing alias inventory and missing scoped indirect evidence. |
| Real coverage probe | Node 24.21.0 generated LCOV from a happy-only test; the analyzer incorrectly reported a hit for its unexecuted throw. |
| Label probes | Reproduced hashless labels marked current and missing case labels omitted from the work list. |
| Typecheck and lint | Not run: no scripts for either are defined in the inspected `package.json`. No typecheck or lint success is claimed. |
| Diff whitespace | `git diff --check` passed. The two new documentation files were read in full and their relative links checked. |

No production files, dependencies, commits or branches were changed by the reviewer. Claude remains responsible for implementation and final gates.

## Test-quality implementation closeout, 2026-10-21

Implementation of the test-quality scan and the Tests tab, after the review above. The work is uncommitted on `main` at `5fe1a1f`. Gate results are from the final working tree.

| Check | Result |
| --- | --- |
| `npm test` | 51 tests: 51 passed, 0 failed, 0 skipped. 14 tests are new in `test/test-quality.test.mjs`, including a browser acceptance test for the Tests tab and its export. |
| Real coverage regression | Passed. The test writes LCOV with `node --test --experimental-test-coverage` on Node 24.21.0. |
| `node --check` | Passed for every file in `lib/` and for `bin/code-map.mjs`. |
| `git diff --check` | Passed. |
| Code-map structural check (`inspect --worktree`) | 0 import cycles, 0 value cycles, 0 unused exports, no source file over 300 lines. `bin/code-map.mjs` has no importer because it is the entry point. |
| Typecheck and lint | Not run: the project is plain JavaScript with no typecheck or lint script. |
| Runs on real projects | Code-map: 0.8 s. Cwik Foundry, working tree with coverage: 1.5 s. Pipeline template at `HEAD`: 18.3 s and 1.4 GB, against 14.7 s and 1.0 GB before this change. The Pipeline template report is 48 MB, against 29 MB before. |

| Finding | Resolution | Regression test |
| --- | --- | --- |
| TQ-01 | Skipped and todo cases are inventory only. Conditional cases can only be candidates. Focused cases count and keep the focus warning. | "parked tests stay inventory …" |
| TQ-02 | Each failure assertion is tied to the names inside it, the value a checked variable holds, the try block of a caught error, or the arguments of a helper call. A case that calls one source function ties its assertions to it. Other failure evidence is a candidate. Uncalled nested helpers do not count. | "a failure assertion counts only for the function it names …" |
| TQ-03 | A test name never closes a gap. It is a candidate and a separate observation. | "a test name alone never closes a gap" |
| TQ-04 | A same-line exit uses branch data only when the line has one block with two branches (Istanbul style). Otherwise it is unknown. Exits on their own line use line hits; catch blocks use their first statement. | "coverage: real Node LCOV …" |
| TQ-05 | The colour mode shows evidence categories, with the weakest function for a file or folder. It shows no percentage. | acceptance test |
| TQ-06 | Each function keeps up to five cases that reach it through callers, with the route. Scoped reports and summaries include them. | "scoped reports and summaries keep cases …" |
| TQ-07 | Framework aliases and namespace imports resolve. Test files are `tests`, `helper` or `unrecognized`, and unrecognized files are an observation. Parameterized definitions count once and are labelled as such. | "the scanner finds cases …", "files named as tests …" |
| TQ-08 | Labels are `missing`, `unstamped`, `stale` or `current`. The work list shows missing cases in current files. `labels stamp --file <test>` refreshes reviewed labels. | "label freshness …" |

The product feedback is applied: each statistic, observation and next step names its kind of evidence (inventory, inferred, pattern, measured, Git or model). "No failure assertion found" replaces "happy path only". Intent totals, unknown intent and regression names are shown next to the test layers. Each function finding names a test to start from when one exists. Coverage shows its age and that it is not tied to a revision. The documentation handoff is done in `README.md`, `docs/inspection.md`, `AI-AGENT-USE.md` and `CHANGELOG.md`.

## Follow-up independent review, 2026-10-21

Reviewed clean branch `test-quality` at `32dcb5e`, including `main...HEAD` and the earlier fixes. The [follow-up review](records/2026-10-21-test-quality-review.md#follow-up-review-at-32dcb5e-2026-10-21) records remaining findings and feedback on the authorized mutation-checker trial.

| Check | Result |
| --- | --- |
| Focused `code-map inspect --worktree` | Completed for scanner, assertion classification, quality analysis and summary. |
| `npm test` | 53 passed, 0 failed, 0 skipped; approximately 10.4 seconds. Includes the existing browser acceptance test. |
| Independent parser probes | Reproduced direct failure credit from an uncalled helper reference, an unrelated built-in failure, an unreachable conditional assertion, and a focused child of a skipped suite. A legitimate direct failure assertion remained a positive control. |
| Real Node fixture | Three active cases passed, the enclosing skipped suite did not run, and no case triggered the source failure path. The scanner nevertheless reported four direct failure checks for that source function. |
| Typecheck and lint | Not run: the project defines neither script. |
| Diff whitespace | `git diff --check` passed before this documentation update. |

Only this review record and status were changed by the reviewer. No production changes, commits, installs, mutation runs against another project, or merges were performed by the reviewer.

## Follow-up resolution, assertion strength and mutation check, 2026-10-21

Work on branch `test-quality` after the follow-up review at `32dcb5e`. The fixes for TQ-R2-01 to TQ-R2-05 are in `7feec57`. Assertion strength, `code-map mutate` and the Node.js 22 minimum are in the commit that follows this record.

| Check | Result |
| --- | --- |
| `npm test` | 62 tests: 62 passed, 0 failed, 0 skipped. New: 2 regressions for the follow-up findings (one runs the reviewer's combined fixture with real `node --test`), 2 for assertion strength, and 5 in `test/mutation.test.mjs`. |
| Mutation acceptance (`test/mutation.test.mjs`) | A checked exit is detected by the named test, an unchecked exit survives (non-equivalent: no test calls the function with bad input), the canary proves that the tests load the copy, the repository stays unchanged, a failing baseline runs no mutant and records the excluded file, and load failures, fewer discovered tests, timeouts and runner failures never count as detected. |
| `node --check` and `git diff --check` | Passed. |
| Code-map structural check | 0 cycles, 0 unused exports, no source file over 300 lines. |
| Typecheck and lint | Not run: the project defines neither script. |

| Finding | Resolution |
| --- | --- |
| TQ-R2-01 | A helper's checks count only where a test calls it or passes it to a callback consumer (`forEach`, `map`, `then`, `test.step` and similar). A bare reference gives reach, not a check. |
| TQ-R2-02 | The one-source fallback is removed. A failure assertion is tied only to the names it contains, the value a checked variable holds, a caught error's try block, a helper call's arguments, or a function that receives a checked local value. |
| TQ-R2-03 | A check under a constant false condition is not counted. A check under any other condition is a candidate. |
| TQ-R2-04 | A skipped or todo suite dominates a child's `.only` or condition. Each case records its `.only` marker separately as `focus`, so the warning stays. |
| TQ-R2-05 | `agentGuide` and `verify` require the relevant tests to pass and the mutation check to detect each failure exit. The scan status `direct` is described as a static association. |

Mutation guidance from the follow-up review: each mutant runs with the same snapshot, test selection and command as the passing baseline. Every test file must pass on its own first; failing files are excluded and recorded. A canary run confirms that the tests load the copied module. Outcomes keep `error`, `timeout` and `invalid` apart from `detected`, and the report describes survival as "the selected tests did not detect this change".

Pipeline template trial at its `HEAD`, with the report in the session scratchpad and no change to that repository (45 seconds, 6 functions):

| Function | Scan status | Detected | Not detected |
| --- | --- | --- | --- |
| `tryParseDraft` | no failure assertion | 1 | 8 |
| `acceptDiscussionLeadDecision` | no failure assertion | 2 | 3 |
| `incrementPatchVersion` | no failure assertion | 1 | 2 |
| `readCodexAuthFile` | no failure assertion | 2 | 1 |
| `evaluateAppVersionPolicy` | direct | 4 | 1 |
| `parseDelegatedDiscussionCoordinatorSelection` | direct | 5 | 1 |

The four gap functions had 6 of 20 mutants detected; the two direct controls had 9 of 11. For the last function, two test files failed without a mutant under `tsx` (Pipeline template's own runner compiles first and stages assets), so the check excluded and recorded them. `readCodexAuthFile` shows a scan miss: no tied failure assertion, but its tests detect 2 of 3 changes. Survivors were not checked one by one for equivalence; the first gap's survivors were confirmed by hand earlier in the session.

Security follow-up after `0f192a3`: an automated review found that a crafted mutation report in the mapped repository could put markup into the page through an unescaped line number. The reader now keeps only positive integer lines, known statuses and plain text values, and the viewer's location links convert the line to a number. A regression test reads a crafted report, and a headless Chrome check of a map built from it found no injected element.


## Complete default workflow, 2026-10-21

The [workflow decision](records/2026-10-21-default-workflow.md) and [command reference](full-run.md) describe the change. The live run selected the working tree at `a44ac5a` with the implementation present as uncommitted files; commits were created externally while it ran. A final content check confirmed that all mapped source bodies and mutation source hashes still match the current files. The agent did not create commits.

| Check | Result |
| --- | --- |
| `npm test` | 67 passed, 0 failed, 0 skipped; approximately 14.4 seconds. |
| Focused workflow/enrichment tests after refactoring | 5 passed. Covers default execution, real native Node coverage, reuse, forced execution, cache invalidation after a test edit or missing coverage, partial mutation budgets and unavailable Claude. |
| Live Claude enrichment | Completed through the installed Claude Code login. All 24 mapped files have current descriptions and all 67 test cases have current labels; the label work list reports nothing to label. No mocked model success is claimed. |
| Live `npm run map` | Completed successfully after approximately nine minutes, including 67 passing tests in the private snapshot, native Node coverage, enrichment, mutation checks and HTML. |
| Mutation report | 78 outcomes: 39 detected, 38 survived, 1 timeout, 0 runner errors and 0 invalid mutants. Six functions have no executable evidence; no supported test files were skipped. Survivors are investigation leads, not confirmed defects. The report is `docs/code-map/mutation.json`. |
| Cache evidence | Reuse and invalidation passed against real temporary Git repositories, test runners and mutation execution. A second full live run was not performed: concurrent commits changed the selected snapshot. |
| Final source/map consistency | The generated map contains the current source bodies and current descriptions, and every mutation file hash matches the current source file. |
| Focused structural inspection | 24 source files; 0 all-edge cycles, 0 value cycles. Static import reachability does not see the full-run CLI acceptance tests; their successful process-level execution is recorded above. |
| Syntax and whitespace | `node --check` passed for 34 JavaScript files; `git diff HEAD --check` passed. |
| Typecheck and lint | Not run: this plain JavaScript repository defines neither script. No typecheck or lint success is claimed. |


## Homework triage, 2026-10-21

The [triage record](records/2026-10-21-homework-triage.md) prioritizes execution speed, boundary-test gaps and scanner accuracy. Inspection used `code-map inspect --worktree` followed by source reads. A local probe reproduced an HTTP-status mutant for the ordinary helper call `text(x, 500)`. Additional direct calls confirmed that empty and oversized model descriptions are rejected by the current validator. No production code was changed, and the full test/mutation workflow was not rerun for this read-only review.


## Homework fixes, 2026-10-22

All four findings in [the triage record](records/2026-10-21-homework-triage.md#resolution-2026-10-22) are addressed in the working tree on `test-quality` at `fc127b7`. No dependencies, application authentication, commits or pushes were changed by the agent. Reference updates are in the README, agent guide, full-run reference, inspection reference and changelog.

| Check | Result |
| --- | --- |
| Regression sequence | The initial tests reproduced cache invalidation after harmless documentation/commit changes, missing baseline/canary reuse receipts, false HTTP status selection, missing subprocess links, missing scoped summary inventory, historical snapshot rejection and an implicit live-provider test environment. Each went green after its corresponding fix. |
| `npm test` before the final snapshot regressions | 89 passed, 0 failed, 0 skipped; approximately 11.3 seconds. |
| Final targeted entrypoint/cache regressions | 11 passed after the final source changes, including historical snapshots and explicit runtime documentation inputs. |
| Final live `npm run map` | Passed: 91 discovered tests, 91 passed, no skipped test files; test verification took approximately 11.6 seconds. Full test/coverage/mutation/map execution took 455.81 seconds. |
| Live model enrichment | Completed before the measured run. The measured default run reused current descriptions and test labels. All 24 source descriptions and all 91 case labels are current. |
| Mutation evidence | 99 outcomes across 44 checked units: 56 detected and 43 survived; 0 timeouts, 0 runner errors, 0 invalid mutants, 0 no-tests/no-runner units. This is a broader selection than the previous report, so raw survivor counts are not directly comparable. A surviving change can be equivalent. |
| Baseline/canary receipts | 30 units reused group baselines and 16 reused file-specific canaries. Each canary key includes path, source content, commands and timeout. |
| Unchanged live rerun | Passed in 1.47 seconds. Output confirmed reuse of test/mutation results, descriptions and labels, then rebuilt HTML. |
| Structural inspection | 24 source files; 0 all-edge cycles, 0 value cycles. The changed modules retain declared subprocess links separately from static assertion evidence; no unit had unknown file-level reachability in the focused report. |
| Final source/report consistency | Every mutation source hash matches its current source file. The report has a complete execution receipt and every mutation unit has status `checked`. |
| Syntax, whitespace and documentation links | `node --check` passed for 35 JavaScript files. `git diff HEAD --check` passed. Checked relative links in the README, agent guide, workflow reference, inspection reference and triage record resolve. The full implementation diff was re-read. |
| Typecheck and lint | Not run: this plain JavaScript repository defines neither script. No typecheck or lint success is claimed. |

Manual check: open `docs/code-map/code-map.html`, select the Tests tab and inspect `lib/full-run.mjs`. Declared subprocess links should appear in the summary without direct failure-assertion credit; mutation outcomes should remain distinguishable from inferred evidence. The automated viewer tests passed as part of the final test run, but no separate manual browser session is claimed.
