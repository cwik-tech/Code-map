# Record: requirement trace, gap fixes and review fixes, 2026-10-23

## Why this record exists

The earlier audits showed that each of the 45 capabilities of the plan exists (refer to [the independent audit](2026-10-23-independent-audit.md)). They checked one main case for each capability. A capability in section 10 of the plan has several separate requirements, so this record goes one level deeper: it maps each part of each requirement to the test that checks it. The work found 15 code gaps and fixed them. On the same day an external reviewer read the four commits under the integration branch and reported 21 defects. This record also lists those fixes and a second run on the user's repositories.

The work is on the branch `cwik-tech/roadmap-integration`, from commit `088d83d` to commit `1a91222`. `main` is unchanged. The scope is TypeScript, JavaScript and React. Python, Electron and React Native are out of scope by the user's decision.

## Terms

| Term | Meaning |
| --- | --- |
| Part | One separate thing that a capability entry of the plan requires, in the words of the plan. For example, C15 has the parts "select relevant tests" and "distinguish equivalent-candidate" |
| Trace | The file `calibration/trace.json`. It gives each part one test, by file and exact test name, and a status: `pass`, `gap` or `out-of-scope` |
| Gap | A part that the code does not do |
| Checker | `node scripts/trace-check.mjs`. It runs each named test alone and checks that it passes. A gap must name a test marked "todo", or no test and a note |

## How the trace was made and checked

1. Five OpenCode sessions split section 10 of the plan (and section 4 for C01 to C24) into parts and named a test for each part. They wrote a new test where none existed.
2. The checker ran each named test alone. A test with a wrong name, a failing test and an unmarked gap each made the checker fail in a planted check.
3. Five independent sessions read each named test and judged whether its assertions really check the part: `checks`, `partial` or `no`. They also listed requirements of the plan that no part covered.
4. Four sessions resolved each finding. Each finding got a better existing test, a split into aspects with their own tests, a new test, a gap, or a rejection with a quote from the plan. Each new test failed when its code path was broken for a moment.
5. The integrator checked each rejection and each gap against the words of the plan.

| Step | Result |
| --- | --- |
| First trace | 232 parts: 219 pass, 1 gap, 12 out of scope |
| Reviews | 141 checks, 64 partial, 14 no, and 14 parts that the split missed |
| Resolutions | 15 remapped, 26 split, 36 new tests, 11 gaps, 2 rejected |
| Final trace | 293 parts: 281 pass, 0 gaps, 12 out of scope (Python, Electron, React Native) |

The integrator corrected three resolutions:

- **C11, "pass/fail against defined threshold", is not a gap.** `evidence-v1` gives level 5 only at 90% of the changed statements, and a test checks that threshold.
- **C08, "validate through runtime traces if available", is a gap, not out of scope.** The session quoted a limit from the status table. The build sessions wrote that limit, so it cannot cancel a requirement of the plan.
- **C41, "periodically sample to measure precision", passes.** Code-map gives the sample and the precision each time a person runs it. The plan does not ask for automation.

## The 15 gaps and their fixes

One gap came from the first trace (C15 selection), one from the first review (C19), and 13 from the resolutions. The row of C37 holds its two parts.

| Capability | What was missing | What exists now |
| --- | --- | --- |
| C01 | The span of an unresolved specifier | Findings give the start column and the end line and column. Fingerprints do not change |
| C04 | Separate reports of dynamic consumers | A computed namespace use (`api[name](...)`) is a separate call site with UNKNOWN compatibility |
| C07 | Conservative fallback for computed loaders | A separate list of candidate files and their importers, bounded on the page |
| C08 | Validation of test links through runtime traces | Coverage of a run that names one test file confirms, refutes or adds static links, as information |
| C15 | Selection of the relevant tests | A `{testFiles}` selector, filled from the impact walk. `--print-selection` shows the filled words before a person authorizes them |
| C15 | Equivalent-mutant candidates | A survivor with identical compiled output is a candidate. It still counts as survived in the score |
| C18 | An initial fuzz corpus | A typed corpus that runs first, within the same time budget |
| C18 | Fuzz invariant failures | An invariant in fuzz mode, and a separate failure kind `invariant` |
| C19 | Comparison of passed and skipped cases | Transition counts of base and head outcomes, and the base passes that are now skipped or missing |
| C37 | Assertion origin and the associated change | For each assertion: the criterion, the Git author and commit, and the non-test files of that commit |
| C40 | Stack counts in the uncertainty warnings | A warning for each supported stack with skipped, malformed or unresolved files |
| C42 | A compile stage before generated cases run | Syntax errors block the run. Type errors are information. Installed type declarations are read without writes |
| C43 | Calibration of the category bands | Expected bands for each case, and agreement counts for defect and clean cases. Unassessed never counts as agreement |
| C44 | Context selected by the dependency graph | Bounded paths from changed files to the consumers and tests that a failed or unknown check names |

Each new result is information. No check, rating, threshold or readiness of either rule set changed, because a change of a rule needs a decision of the user.

The integrator found and corrected three defects in the session work before the merge:

- The first compile stage of C42 could not see installed packages. A Vitest test failed with "Cannot find module 'vitest'" and never ran. The fix reads installed declarations and keeps type errors as information.
- The runtime links of C08 listed every test file of a project. They now list only traced test files, at most 50, and they count all links first.
- The candidate list of C07 had no size limit on the page. It now keeps 50 candidates and their total.

## External review of the base commits

The reviewer read the commits `7438431^..ed3c5b0`. The integration branch builds on them, so each finding was checked there. Each of the 21 findings reproduced with a regression test that failed before the fix.

| Finding | Defect | Fix |
| --- | --- | --- |
| 1 | `mapData` dropped re-export links, so barrels hid test reach | `reexports` stays in the map data |
| 2 | Base failures were a set, so a second identical failure was not new. JUnit class names were lost | Failures match as a multiset. Class names count when no file path exists |
| 3 | A rename did not change a suite name that came from the file path | Suite paths follow renames, and all comparisons use one rename map |
| 4 | A deleted or moved file outside the roots passed the consumer check | The check stays UNKNOWN |
| 5 | Rules only in the working `.code-map.json` could block a commit | The architecture check and its rating predicates stay UNKNOWN |
| 6 | A focused test inside a skipped suite counted as runnable | The enclosing skip or condition wins. Empty focused tests get their warning |
| 7 | Reports with contradictory counts or failed files without cases were eligible | Such reports are ineligible, with a reason |
| 8 | A resolved literal `import('./b')` allowed Structural Integrity level 3 | A dynamic import prevents level 3, as the v0 proposal says |
| 9 | Cyclic `export *` barrels cached incomplete export sets | Only complete traversals are cached |
| 10 | Scoped summaries used the five displayed cases and global labels | Scoped summaries use all case IDs and the labels of their files |
| 11 | `code-map manifest` recorded `.` as the folder in a subfolder | It records the folder of the run |
| 12 | An expected error class counted as a failure target | Only the subject of an assertion counts |
| 13 | A symlink at the `exports` store folder could redirect a report | The folder is checked like the other store folders |
| 14 | An unreadable renamed test gave removed cases | It gives no removal conclusion |
| 15 | Run identity depended on the order of JSON keys | Run records are compared in canonical form |
| S1 | Quoted and shorthand Node test options were ignored | They set the status |
| S2 | Windows paths in test results kept backslashes | Both separators are accepted |
| S3 | `assume-unchanged` and `skip-worktree` edits were not part of the change | They are part of it. Only a private copy of the index changes |
| S4 | An edited rename with a new name kept the rename detection complete | Unpaired deletions and additions make it incomplete |
| S5 | A working tree that changed during a long base analysis was not detected | Code-map checks the head again before it reads live renames |
| S6 | Huge page offsets became `null` | Offsets above the safe integer limit are refused |

No calibration case changed its result. Two existing test expectations changed, because they encoded the defect: a focused test inside a skipped suite (finding 6), and the completeness of rename detection with an unhashable file (S4).

## Second run on the user's repositories

The repositories are the private projects of [the earlier real-codebase record](2026-10-23-real-codebase-validation.md), named Project A to Project E as there.

The same five repositories ran again with the final code, read-only. `git status` of each repository was the same before and after each run.

| Repository | Summary | `--base` comparison | `verify` v0 / v1 | Findings before → after |
| --- | --- | --- | --- | --- |
| Project A | 3.2 s | 3.4 s | 1.3 s / 1.6 s, INSUFFICIENT_EVIDENCE | 916 → 532 |
| Project B | 5.5 s | 8.3 s | 1.2 s / 1.8 s, INSUFFICIENT_EVIDENCE | 455 → 418 |
| Project C | 2.6 s | 3.7 s | 0.9 s / 1.2 s, INSUFFICIENT_EVIDENCE | 166 → 160 |
| Project D | 0.8 s | 1.1 s | 0.6 s / 0.7 s, INSUFFICIENT_EVIDENCE | 59 → 52 |
| Project E | 4.4 s | 3.1 s | 1.0 s / 1.2 s, INSUFFICIENT_EVIDENCE | 1,560 → 1,527 |

The first run of the day found three defects, all fixed with regression tests:

- **A false unresolved import of `./globals.css`** in four repositories. A bisect found the cause in the earlier C01 audit fix: with a `tsconfig.json`, every import went through the compiler resolver, which ignores files that are not code.
- **Export candidates of copied UI libraries.** 382 of 416 such findings on Project A were in `components/ui` and `components/ai-elements`, which Code-map already marks as vendor candidates.
- **An incomplete-evidence warning for CSS and other files** in every repository. These file kinds now share one short line.

Project A served only as a test bed for the new features, in a private clone. Each command ran in the restricted worker without network:

- The outcome comparison named the three tests that fail since one of its refactors as `passed>failed`, under both rule sets.
- The runtime links of one test file confirmed 2 static links and marked 7 as not observed.
- The mutation selection picked 6 test files that reach the 3 changed files with sampled mutants. Some of those tests fail on that head, so the baseline failed and Code-map wrote no mutation report, as designed.
- An empty pair of JUnit reports first gave `COMPARED` with no change. Such a pair now gives UNKNOWN.
- A failed check that names test cases gave no graph context. The context now follows the impact paths to the test file of each case. In this test bed the failing tests read the settings file as text, so no import path exists, and the empty context is correct.

The authorizations of these runs were made by the integrator, only in the private clone. The help of `code-map authorize` says that a person makes them.

## Gates of the final commit

| Check | Result |
| --- | --- |
| `npm test` | 1,669 tests, 1,668 pass, 0 fail, 1 skip (XState is not installed), 0 todo |
| `node scripts/trace-check.mjs` | Exit 0. 293 parts: 281 pass, 0 gaps, 12 out of scope, 0 problems |
| Browser tests under load | Three tests of `test/repair.test.mjs` and `test/test-quality.test.mjs` timed out in one full run while other sessions ran. They passed alone and in the later full runs |

## Limits

- A passing trace means that a test checks each part as the reviewers read it. It is not a proof for every input.
- The reviews and fixes were made by OpenCode (DeepSeek) and Codex sessions. The integrator reviewed each diff and confirmed the rejections and the gaps, but did not read every one of the 293 tests.
- The second run used the same five repositories as the first run. Other kinds of projects can show other defects.
