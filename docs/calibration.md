# Calibration corpus

A calibration corpus is a set of known changes. For each change, the corpus gives the results that `code-map verify` must give. A replay of the corpus shows how often each check gives the correct result. This document describes the first corpus for the rule set `static-baseline-v0`. The specification calls this capability C43.

## Terms

| Term | Meaning |
| --- | --- |
| Case | One known change and its expected results |
| Seeded defect | A mistake that the author of a case put into the change on purpose, so that one check must find it |
| Clean case | A case without a seeded defect. It is the same kind of change as a seeded defect, but without the mistake |
| Positive | A check result that the case expects to be FAIL |
| Detection | A check result that is FAIL in the real run |
| True positive (TP) | An expected FAIL that the check gives |
| False negative (FN) | An expected FAIL that the check does not give |
| False positive (FP) | A FAIL where the case expects another result |
| True negative (TN) | No FAIL where the case expects another result |
| Known failure | A case where Code-map gives a wrong result. The case keeps the correct expected result and has the mark `knownFailure: true` |

## What the corpus contains

The corpus has 58 cases in the folder `calibration/`. 40 cases are for the accepted rule set `static-baseline-v0`: 21 have a seeded defect, and 19 are clean. 18 cases are for the accepted rule set `evidence-v1`: 9 have a seeded defect, and 9 are clean. A case is a small Git repository that the runner builds in a temporary folder. Each case gives:

- The files of the base commit
- The edits of the head (a commit or the working tree)
- The request fields
- The test reports to write and bind, when the case needs them
- Optional expected category ratings
- The expected readiness state
- The expected result of each check that the case is about (PASS, FAIL, UNKNOWN or NOT_APPLICABLE)

The runner also applies two rules to each case:

- A check that the case does not name must not give FAIL. A case has at most one seeded defect, so another FAIL is a false positive.
- Each test report of the case must bind to the side that the case gives (base or head).

### The cases of each check

| Check | Cases with a seeded defect | Clean cases |
| --- | --- | --- |
| `structure.architecture-rules` | `arch-new-break`: a new import from `src/core` into `src/ui` under the rule `core -> ui` | `arch-clean`: a new import in the allowed direction. `arch-existing-break`: a break that the base already has. `arch-no-rules`: a project without rules, so the result is NOT_APPLICABLE |
| `structure.imports-resolve` | `import-missing-file`: a new import of a missing file. `import-name-missing`: a new import of a name that the file does not export | `import-clean`: a new import of a file and a name that exist |
| `structure.no-new-cycle` | `cycle-new`: a new import that makes a value-import cycle | `cycle-clean`: a new import that makes no cycle |
| `completeness.consumers-updated` | `consumer-left-behind`: a moved file, and a consumer that still imports the old path | `consumer-updated`: a moved file, and each consumer imports the new path |
| `completeness.no-focused-test` | `focused-test`: a new `.only` | `focused-clean`: a new test case |
| `completeness.tests-not-weakened` | `weakened-deleted`, `weakened-skipped`, `weakened-no-assertion`, `weakened-swallowed`: a base case that the head deletes, skips, leaves without an assertion or wraps in a `catch` that ignores the error | `weakened-clean`: a new test case. `weakened-file-moved`: a test file that moves with all its cases |
| `completeness.settings-unchanged` | `settings-edited`: an edit of `.code-map.json` | `settings-clean`: a change that does not edit the settings |
| `scope.allowed-paths` | `scope-outside`: a changed path outside the allowed paths | `scope-clean`: each changed path is inside the allowed paths |
| `behavior.no-new-failures` | `behavior-new-failure`: a case that passed in the base report and failed in the head report. `behavior-new-failure-no-base`: a failed case of a working-tree head without a base report | `behavior-clean`: the case passes in both reports. `behavior-earlier-failure`: the case fails in both reports |
| `behavior.earlier-failures` | None. Refer to the note below the table | `behavior-new-failure`, `behavior-clean` |
| `structure.types-compatible` | `bound-tsc-defect`: a bound compiler error in the changed file | `bound-tsc-clean`: a clean bound compiler report |
| `vc.changed-lines-80` | `bound-lcov-lines-defect`: no changed line ran | `bound-lcov-lines-clean`: every changed line ran |
| `vc.changed-branches-70` | `bound-lcov-branches-defect`, `bound-istanbul-branches-defect`: one of two changed branches ran | `bound-lcov-branches-clean`, `bound-istanbul-branches-clean`: both branches ran |
| `vc.changed-test-files-ran` | `bound-changed-tests-defect`: the report omits the changed test file | `bound-changed-tests-clean`: the changed test file ran |
| `vc.active-test-files-ran` | `bound-active-tests-defect`, `bound-changed-tests-defect`: the report omits an active test file | `bound-active-tests-clean`, `bound-changed-tests-clean`: all active test files ran |
| `coverage.head-run` | `head-run-nothing`: the only case of the head report is skipped | `behavior-new-failure`, `behavior-clean`, `behavior-earlier-failure` |

The check `behavior.earlier-failures` gives FAIL in the case `behavior-earlier-failure`, but the change of that case is clean. The check fails by design, because it shows a failure that the base already has. Thus, the matrix counts this FAIL as a true positive of that check, but the case does not count as a seeded defect.

The corpus does not cover the checks that cannot give PASS or FAIL in this version: `completeness.migrations-docs`, `scope.declared` and the open checks for a refactor, a fix, a feature or an acceptance criterion.

The `vc.*` entries are rating conditions, not obligations. The runner maps met, unmet and unknown conditions to PASS, FAIL and UNKNOWN.
Istanbul statements and functions have no rating thresholds. The Istanbul cases test branch precedence over a bound LCOV report.

### Where the expected results come from

Each expected result comes from the conditions of the check in section 5 of [the rule set proposal](work/2026-10-22-verify-profile-v0/proposal.md) and in `lib/profiles/static-baseline-v0.mjs`. Each expected readiness comes from section 7 of the proposal. A new architecture-rule break, a new focused test or a new test failure gives BLOCKED. All other cases give INSUFFICIENT_EVIDENCE, because this rule set never gives READY.

Do not copy an expected result from a run of the tool. A copied result only repeats what the tool does, so it cannot show a wrong result.

## How to run it

Run every case:

```sh
node scripts/calibrate.mjs
```

To also write the same data as JSON, add `--out <file.json>`.

The script runs one case at a time, so the time of a case does not include the work of other cases. It prints:

- One row for each case: the defect flag, the readiness, the time of `code-map verify` and the state of the case
- The differences of each case that does not match
- The confusion matrix of each check: TP, FP, TN, FN, precision and recall
- Band agreement for each named category, split into defect and clean cases
- A summary line with the counts of each state and the total time

| State | Meaning |
| --- | --- |
| `ok` | The case gives its expected results |
| `known failure` | The case differs from its expected results, and it has the knownFailure mark |
| `fixed` | The case has the knownFailure mark, but it now gives its expected results. Remove the mark |
| `MISMATCH` | The case differs from its expected results without the knownFailure mark |
| `SKIP` | The case needs sandbox-exec, which is unavailable |
| `ERROR` | The case gave no result, for example because `code-map verify` timed out or ended with exit code 4 |

The exit code of the script is 1 when a case has the state MISMATCH or ERROR. It is 2 when `--out` has no file name. Otherwise it is 0.

The script writes only below the system temporary folder and to the `--out` file. Each case removes its temporary folder when it ends, also after an error. When the script gets SIGINT or SIGTERM, it removes the folders of the cases that still run. The current cases run no project code. They write reports by hand and bind them with `code-map manifest`.
A case with `worker: true` requires `/usr/bin/sandbox-exec`. Without it, the runner prints SKIP and its reason.
Skipped cases do not enter the confusion matrix.
The script writes only below the system temporary folder and to the `--out` file. Each case removes its temporary folder when it ends, also after an error. When the script gets SIGINT or SIGTERM, it removes the folders of the cases that still run. V0 cases write reports by hand and bind them with `code-map manifest`. V1 worker cases run fixture code in the restricted worker.

The test replays a fixed subset of the corpus:

```sh
node --test test/calibration.test.mjs
```

The original subset has 19 cases. A separate test runs all 12 bound-report cases.
Each new check or coverage condition has a FAIL case and a PASS case. The test runs four cases at a time. Only the script replays every case, because the full corpus takes longer.

The test fails when a case differs from its expected results without the knownFailure mark. It also fails when a case with the mark now matches, so that the mark does not stay after a fix. The test also checks the case data, the report of a known failure and the removal of a temporary folder after an error.

## How to add a case

1. Find the check in section 5 of the proposal and in `lib/profiles/static-baseline-v0.mjs`. Use its exact ID.
2. Write the change: the base files, the head edits and the request fields. Keep the project small.
3. Write the expected readiness and the expected result of each check that the case is about. Derive each result from the conditions of the check before you run the case.
4. Add the case to the `cases` list of the module for that check in `calibration/`. Add a new module to `calibration/cases.mjs`. Keep each module at 300 lines or fewer.
5. Run `node scripts/calibrate.mjs`. The new case must have the state `ok`.
6. If the state is MISMATCH, compare the difference with the conditions of the check. If the expected result is wrong, correct the case.
7. If Code-map is wrong, keep the correct expected result and add `knownFailure: true`. Describe the wrong result in the section "Known failures" below.
8. To add the case to the test subset, add its ID to `subset` in `test/calibration.test.mjs`.

A case has these fields:

| Field | Meaning |
| --- | --- |
| `id` | A unique name, used in the subset and in the reports |
| `name` | What the case shows |
| `defect` | `true` when the change contains a seeded defect. Then at least one check must expect FAIL |
| `base` | The files of the base commit, by path relative to the repository |
| `head` | The edits of the head. The value `null` deletes the file. Any other value is the new text of the file |
| `headKind` | `"commit"` (the default) or `"worktree"` |
| `request` | The request fields that replace the defaults of `calibration/run.mjs` |
| `reports` | Reports to write and bind. Each has a `side` and a `name`. JUnit reports use `cases`. Other reports use `kind`, `text`, `command` and `exitStatus` |
| `worker` | `true` when the case requires sandbox-exec |
| `expected.readiness` | The expected readiness state |
| `expected.checks` | The expected result of each check that the case is about |
| `expected.ratings` | Optional category names with expected values from 1 to 5 or `"Unassessed"`. Invalid names or values produce ERROR |
| `knownFailure` | `true` only when Code-map gives a wrong result for the case |

The runner retains each observed rating as `{ state, value }` in `ratings`.
It reports differences as `ratings.<category>` with the expected and actual value.
An observed `UNASSESSED` stays `UNASSESSED` with value `null`. Difference text displays `Unassessed`.
An expectation of `Unassessed` matches this unknown state but does not count as numeric band agreement.
An unknown observation against a numeric expectation is a mismatch.

`bandMetrics` groups each category into `defect` and `clean` counts.
Each group has `total`, `agreed`, `mismatched`, `unassessed` and `unavailable`.
Only an observed numeric band equal to its expectation increments `agreed`.
Unassessed observations and unavailable runs have separate counts. Skipped cases do not enter the table.
Only cases that declare a category expectation enter that category's counts.
JSON exports include `bandMetrics` and each case's observed `ratings`.
The import defect and clean import cases declare bands observed by replay.
These fixture bands do not establish product threshold quality.

## The current numbers

These numbers come from `node scripts/calibrate.mjs --out /tmp/w4-calibration-review.json` on 2026-10-23.
They change when the corpus or the tool changes.

| Check | TP | FP | TN | FN | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `behavior.earlier-failures` | 1 | 0 | 39 | 0 | 100% | 100% |
| `behavior.no-new-failures` | 2 | 0 | 38 | 0 | 100% | 100% |
| `completeness.consumers-updated` | 1 | 0 | 39 | 0 | 100% | 100% |
| `completeness.no-focused-test` | 1 | 0 | 39 | 0 | 100% | 100% |
| `completeness.settings-unchanged` | 1 | 0 | 39 | 0 | 100% | 100% |
| `completeness.tests-not-weakened` | 4 | 0 | 36 | 0 | 100% | 100% |
| `coverage.head-run` | 1 | 0 | 39 | 0 | 100% | 100% |
| `scope.allowed-paths` | 1 | 0 | 39 | 0 | 100% | 100% |
| `structure.architecture-rules` | 1 | 0 | 39 | 0 | 100% | 100% |
| `structure.imports-resolve` | 2 | 0 | 38 | 0 | 100% | 100% |
| `structure.no-new-cycle` | 1 | 0 | 39 | 0 | 100% | 100% |
| `structure.types-compatible` | 1 | 0 | 39 | 0 | 100% | 100% |
| `vc.active-test-files-ran` | 2 | 0 | 38 | 0 | 100% | 100% |
| `vc.changed-branches-70` | 2 | 0 | 38 | 0 | 100% | 100% |
| `vc.changed-lines-80` | 1 | 0 | 39 | 0 | 100% | 100% |
| `vc.changed-test-files-ran` | 1 | 0 | 39 | 0 | 100% | 100% |

The TN column includes cases about other checks. An ERROR counts as FN when the case expects FAIL.
Otherwise an ERROR does not count. Skipped cases never count.
All 40 cases matched. No case has a known-failure mark.
The full corpus took 53.5 seconds while other tests ran on the computer.

## Replay real fixes

Run this command against a local repository:

```sh
node scripts/replay.mjs --repo . --limit 10
```

The limit must be a positive safe integer. The script selects subjects that start with `fix`, without case sensitivity.
It reads commits reachable from HEAD in Git log order. It skips a root commit because it has no parent.
For a merge commit, it uses the first parent as the base.
Each request uses `changeType: "fix"`, the commit as head, and no reports.
The table gives the commit, readiness, failed checks, unknown checks and elapsed verification time.

The script keeps its request, store and output in a temporary folder. It removes that folder after success or failure.
It compares `git status --porcelain` before and after replay, including after a verification error.
It runs no project code. It makes no checkout, commit or index change.

A replay measures what static checks say about real fixes. It has no expected results and measures no precision or recall.
An UNKNOWN result remains unknown. A historical fix subject does not prove that its code fixes a defect.
Git commands have a 30-second timeout and a 32 MiB output limit. Each verification has a 120-second timeout.
The script stops at the first verification error. Current settings and installed tools can affect a replay. The status comparison does not prove byte-level repository equality.

## Known failures

No case is a known failure now.

## Limits

- The same authors wrote the tool and the seeded defects. An AI model wrote the cases after it read the code of the checks. Thus, the numbers show only that the checks find the defects that the corpus contains. They do not measure how well the checks work on real changes.
- Each check has one to four seeded defects. A precision and a recall of 100% from so few cases give no statistical confidence.
- Each case uses a project with two to four files. The corpus does not measure large projects, monorepos or real Git histories.
- The test reports are written by hand. They are not the output of a real test run. The report kinds are JUnit XML, tsc text, LCOV and Istanbul JSON. They are self-attested, not worker receipts.
- The corpus does not cover the checks that cannot give PASS or FAIL in this version.
- Each expected readiness is BLOCKED or INSUFFICIENT_EVIDENCE, because this rule set never gives READY or REVIEW.

## Evidence-v1 cases

The corpus also has defect and clean cases for every new or changed check in the evidence-v1 rule set.
Each case names `profileId`. Existing cases retain `static-baseline-v0`, and new cases select `evidence-v1`.
The runner reports a separate confusion matrix for each rule set. JSON output includes `metricsByProfile`.
Expected results come from proposal sections 5 and 8. They do not come from observed tool output.

The new cases cover public compatibility, preservation, reproduction, regression, criteria, harness outcomes, migrations, stale references and dependency policy.
Behavioral worker cases use real isolated runs. They skip explicitly when `/usr/bin/sandbox-exec` is absent.
Oracle fixtures name a test-only reviewer. They do not assert that a person approved a real change.
The READY and self-attested refusal fixtures run in `test/evidence-v1-cli.test.mjs`.

## Labeled real changes

A person writes JSON files in `calibration/real/` or another local folder.
Do not derive expected results from the tool output. `labeledBy` records a name without authenticating the person.

```json
{
  "labelVersion": 1,
  "repository": "/absolute/local/repository",
  "commit": "0123456789012345678901234567890123456789",
  "labeledBy": "Person who checked the change",
  "request": {
    "base": "parent-or-base-commit",
    "intent": "Describe the intended change.",
    "changeType": "fix",
    "allowedPaths": ["src/**", "test/**"],
    "acceptanceCriteria": []
  },
  "expected": {
    "structure.imports-resolve": "PASS",
    "fix.regression-check": "UNKNOWN"
  }
}
```

Replace the example path, full commit SHA and request fields with the labeled change.
The path identifies a local repository. The commit must be a full immutable commit SHA.
Request fields are `base`, `intent`, `changeType`, `allowedPaths` and `acceptanceCriteria`.
Expected results map obligation IDs to PASS, FAIL, UNKNOWN or NOT_APPLICABLE.
Unknown fields, missing people and empty expected maps are errors.

```sh
node scripts/replay.mjs --labels calibration/real
```

The folder must contain 1 to 1000 JSON files. Each file has at most 1 MiB.
The runner validates all labels before replay. It runs cases sequentially with the accepted `static-baseline-v0` profile.
It refuses execution, reports, hypotheses and rule sets other than the default. It runs no project commands.
Each verification has a 120-second timeout. Git commands have a 30-second timeout and 32 MiB output limit.
Requests, analyses and outputs use a temporary folder, which the runner removes on return or error.
The runner compares repository status before and after each case. It makes no checkout or commit.
Current repository settings and installed dependencies affect the analysis. Status comparison does not prove byte equality.

JSON output gives each case, its person, exact result mismatches, per-case matrices and the combined matrix.
Only explicitly labeled checks enter the matrix. FAIL is positive. Other available results are negative.
Exact UNKNOWN and NOT_APPLICABLE mismatches remain visible even when the binary matrix counts a true negative.
An absent check is a mismatch. An absent expected FAIL counts as FN. Other absent checks enter no matrix cell.
Precision and recall are null when their denominator is zero.
Exit 0 means all exact labels matched. Exit 1 means a mismatch or error. Invalid command syntax exits with 2.
No real case is supplied. Broad real-change calibration remains a user labeling task.
