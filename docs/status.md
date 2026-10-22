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
