# Proposal: the second rule set for `code-map verify`

**Status:** accepted on 2026-10-23. The user accepted the recommended answer of all ten decisions in section 8 ([decisions.md](decisions.md)). Code-map applies it only when a request names it (decision 1). The rule set `static-baseline-v0` stays the default, and it stays the rule set of the examples and the documentation.

## 1. Why this document exists

`code-map verify` checks one change against a rule set and gives four ratings and one readiness state. The first rule set, `static-baseline-v0`, was accepted on 2026-10-22 ([its proposal](../2026-10-22-verify-profile-v0/proposal.md)). It can stop a bad change, but it never gives READY. The reason is that it has no trusted evidence that the tests confirmed the expected behavior.

Since then, Code-map got new kinds of evidence:

- Isolated runs: Code-map runs an authorized command in a restricted worker, with no network, no access to your credentials and fixed limits. It records the result with the label "isolated", not "self-attested".
- Runs of the same tests on the base and on the head, and runs of named regression tests on both sides
- Differential runs: the same inputs go to one function of the base and of the head, and Code-map compares the outputs
- Property, fuzz, decision-table and state-model runs of one function
- Mutation runs: Code-map makes small faults in the changed lines and records which faults the tests detect
- Statement and function coverage, export and signature changes, schema changes, supply-chain changes, stale references and build sizes

`static-baseline-v0` cannot use most of this evidence. A rule set is a product decision, so I do not change the accepted one. This document proposes a second rule set, `evidence-v1`, that uses the new evidence and can give READY. You can accept it, change it or reject it. Section 8 lists the decisions.

## 2. How this proposal was made

I wrote it from three sources:

- The accepted rule set `static-baseline-v0`, including your answers to its ten questions. `evidence-v1` keeps every check and every answer of v0, except where this document says otherwise.
- Your earlier decisions:
  - Four independent ratings with no total
  - No PASS from a check that did not run
  - No discount for a test that was written with the code
  - Isolated execution, because "running in the user's environment is not a substitute for isolation"
- The evidence that the new parts of Code-map record. Each part has its own section in `docs/verify.md`, `docs/run.md` and `docs/harness.md`.

No other agent scored this proposal. The thresholds are first values for calibration, not measured values.

## 3. The proposal in short

- `evidence-v1` keeps all checks of `static-baseline-v0`.
- It adds checks for the public interface, for dependency policy and for stale references.
- It gives results to five checks that are always unknown in v0: preserved behavior, the regression test of a fix, the reproduction of a bug, acceptance criteria, and migrations and documentation.
- Behavioral Confidence gets a rating when the evidence is independent of the change. Three kinds of evidence are independent: an isolated run of the base as the reference, a differential run, and a person's record that confirms the expected result of a test.
- Each category can reach 5 of 5.
- READY becomes possible. It needs every required check to pass, all four categories rated 3 of 5 or more, and isolated runs for the test evidence (decision 2).

## 4. Terms in this document

| Term | Meaning |
| --- | --- |
| Isolated run | A run of an authorized command in Code-map's restricted worker. Its run manifest has the policy `isolated` |
| Self-attested report | A report of your own run with a manifest from `code-map manifest`. The manifest shows which code the report describes, but not how the run happened |
| Reference run | An isolated run of the base with the same command, tools and environment as an isolated run of the head |
| Pre-existing test case | A test case that the base has, and that the change did not edit |
| Differential run | A harness run that gives the same inputs to one function of the base and of the head, and compares the outputs |
| Oracle record | An entry that a person writes to confirm the expected result of one test case. It names the case, the acceptance criterion, a digest of the test file, the method and the person. A model's opinion is never an oracle record |
| Regression test | A test case that the request names for a fix. It must fail on the base and pass on the head |
| Mutant | A copy of the head with one small fault in one changed line, for example `<` in place of `<=` |
| Mutation score | The share of the mutants that the tests detect. A mutant that the tests do not detect can be equivalent: it can have the same behavior as the original code |
| Public export | An export of a package entry point (`main`, `module`, `exports`, `types` or `bin` in `package.json`) |

The terms of the v0 proposal also apply.

## 5. The checks in each category

A check gives FAIL first, then UNKNOWN, then PASS, as in v0. This section lists only the checks and the rating rules that differ from v0.

### Structural Integrity

| Check | It fails when | It is unknown when | Required | Blocks |
| --- | --- | --- | --- | --- |
| Public interface is compatible (new) | A public export that the change removed or changed still has a consumer in the repository, and a bound compiler report of the head has an error in that consumer. Without a compiler report: a call in a consumer has a number of arguments outside the range of the new signature | A changed public export has an inferred type that changed, or a changed public export has consumers and no bound compiler report of the head exists | Yes | No |

This check takes the place of the feature-only "consumer contracts" check of v0, and it applies to every change type (decision 10).

- **5 of 5 (new):** level 4, a bound compiler report of an unfiltered head run has no error in any file, and the export comparison has no UNKNOWN public export.

### Verification Coverage

No check changes. Statement and function coverage are shown, as in v0.

- **5 of 5 (new):** level 4, and an isolated run gives statement coverage of at least 90% of the changed statements and runs every changed function (decision 6).

### Behavioral Confidence

| Check | It fails when | It is unknown when | Required | Blocks |
| --- | --- | --- | --- | --- |
| Behavior preserved (refactor) | A differential run shows a different output or error for an input. Or a test case that passed in the reference run fails in the isolated head run | No differential run exists and no reference run exists | Yes | Yes |
| Bug reproduced (fix) | Each named regression test passes in the reference run, so no test shows the bug | The request names no regression test, or no reference run exists | Yes | No |
| Regression test (fix) | A named regression test fails in the isolated head run | The request names no regression test, or no isolated head run exists | Yes | Yes |
| One check for each acceptance criterion | A test case that names the criterion failed in a bound head report | No case that names the criterion passed, or no oracle record confirms such a case (decision 3) | Yes | No |
| Harness runs hold (new) | A bound harness run of the head reports a failed property, a crash outside the allowed errors, a decision-table mismatch or a state-model mismatch | No bound harness run exists. Then the check is "not applicable" | No | No |

A test case that the change added counts the same as an old one for "No new test failures", as in v0. For the minimum evidence below, an added case needs an oracle record, because the change itself wrote its expected result. This is not a discount: the case still counts in every check.

How the category is rated:

- **Minimum evidence (changed):** a bound head test report from an isolated run, and at least one independent reference: a reference run, a differential run, or an oracle record for a test case that ran.
- **1 of 5:** a new test failure, a failed behavior check, or a failed regression test.
- **3 of 5:** the required checks pass, and there are no new test failures.
- **4 of 5:** level 3, the isolated head run is unfiltered, and each acceptance criterion passes.
- **5 of 5:** level 4, and the mutation score of the changed code is at least 60%, from at least 10 mutants (decision 5).

### Change Completeness

| Check | It fails when | It is unknown when | Required | Blocks |
| --- | --- | --- | --- | --- |
| Tests are not weakened (changed) | An assertion or runner weakening lacks a current human review. Existing v0 failures still fail | A review file is invalid without a detected failure, or a changed test or runner file cannot be compared | Yes | No |
| Migrations and documentation (changed) | A database schema changed without a new migration in the change, or a removed or changed public export has no documentation change | Code-map cannot read a schema file | No | No |
| No stale references (new) | A removed export name or a removed or renamed path still appears in code, in a configuration file or in a mock path of a test | Never | No | No |
| Dependencies follow the policy (new) | The change adds a package with a denied license, from a host that is not allowed, without integrity, or with an install script when the policy forbids install scripts (decision 8) | Code-map cannot read the lockfile. Without a policy in `.code-map.json`, the check is "not applicable" | Yes | No |

**Changed on 2026-10-23, after the first draft:** assertion and runner weakening now require a current human review.
The command `code-map review-weakening` requires `--reviewed-by` and records the person's reason and date.
A model must not write a review record. Refer to [the review reference](../../weakening-reviews.md).

- **4 of 5 (new):** level 3, migrations and documentation pass, and no stale reference exists.
- **5 of 5 (new):** level 4, and every consumer of a changed export is updated in the change or shown compatible by a bound compiler report.

## 6. What `verify` would report with this rule set

| Category | With static evidence only | With self-attested reports | With isolated runs |
| --- | --- | --- | --- |
| Structural Integrity | 1, 2 or Unassessed | Up to 5 with a compiler report | The same |
| Verification Coverage | Unassessed | Up to 4 | Up to 5 |
| Behavioral Confidence | Unassessed | Unassessed, because the minimum evidence needs an isolated run | Up to 5 |
| Change Completeness | 1, 2, 3 or Unassessed | The same | Up to 5 |

## 7. Readiness and exit codes

The exit codes and the order of the states do not change. READY becomes possible:

| Exit code | Readiness | When it happens with this rule set |
| --- | --- | --- |
| 0 | READY | Every required check passes, all four categories are rated 3 of 5 or more, no blocking check fails, and each test report that a rating uses comes from an isolated run (decision 2) |
| 1 | REVIEW | No required check is unknown, and a failure that does not block is open |
| 2 | BLOCKED | A blocking check fails: the v0 blockers, a failed behavior check or a failed regression test |
| 3 | INSUFFICIENT_EVIDENCE | A required check is unknown, or a required category is Unassessed |
| 4 | none | As in v0 |

## 8. Decisions for you

For each question, the first answer is my recommendation.

**Decision on 2026-10-23:** the user accepted the recommended (first) answer of all ten questions.

1. **Which rule set is the default?**
   - Recommended: `static-baseline-v0` stays the default. A request uses `evidence-v1` only when it names it. Make `evidence-v1` the default only after the calibration corpus has cases for its new checks.
   - Alternative: make `evidence-v1` the default now.
2. **Can READY use self-attested reports?**
   - Recommended: no. READY needs isolated runs for each test report that a rating uses. A self-attested report still counts for the ratings and for BLOCKED.
   - Alternative: accept self-attested reports for READY, with the label in the report.
3. **How does a person confirm the expected result of a test?**
   - Recommended: with an oracle record in `.code-map/oracles.json`, written by a new command, `code-map oracle`. The record holds the case, the criterion, the digest of the test file, the method and the person. A change to the test file makes the record stale. This is decision 10 of v0, which you accepted.
   - Alternative: also accept the tag `[AC:<id>]` in a test name without a record.
4. **What is enough evidence that a refactor preserved the behavior?**
   - Recommended: one of two kinds of evidence is enough. The first is a differential run with no difference for at least 20 inputs. The second is a reference run in which each pre-existing test case that reaches a changed file passes on both sides.
   - Alternative: require both.
5. **Which mutation score gives 5 of 5 in Behavioral Confidence?**
   - Recommended: at least 60% of at least 10 mutants of the changed code. Calibrate it later on real changes.
   - Alternative: another value, or no level 5 from mutation.
6. **Which coverage gives 5 of 5 in Verification Coverage?**
   - Recommended: 90% of the changed statements and every changed function, from an isolated run.
   - Alternative: other values.
7. **What does a failed harness run do?**
   - Recommended: it fails an optional check. The change can then reach REVIEW, but not READY, and it is not BLOCKED.
   - Alternative: make it a blocking check.
8. **What does a new install script in a dependency do?**
   - Recommended: it fails the dependency check only when the policy in `.code-map.json` sets `forbidInstallScripts`. Otherwise the report shows it as information.
   - Alternative: always fail the check.
9. **Must migrations and documentation be checked?**
   - Recommended: the check stays optional, as you decided for v0, but it now gives PASS or FAIL. 4 of 5 in Change Completeness needs it to pass.
   - Alternative: make it required.
10. **Does the public interface check apply to every change type?**
    - Recommended: yes. It replaces the feature-only placeholder of v0.
    - Alternative: only for features and refactors.

## 9. What must be built after your decisions

- The rule set module `evidence-v1`, next to `static-baseline-v0`, with its own rating conditions
- The oracle records and the command `code-map oracle` (decision 3)
- The link from the isolated runs, harness runs and mutation runs of a request to the checks of this section
- Calibration cases for each new check, in the calibration corpus
- The documentation of the rule set in `docs/verify.md`

## Audit evidence corrections

| Record | Correction | Rule impact |
| --- | --- | --- |
| Changed on 2026-10-23, after the audit | Relative resolution respects project module settings. Explicit named API shapes enter checker comparison. | Existing checks and thresholds stay unchanged. Corrected import evidence also feeds `static-baseline-v0`. |
| Changed on 2026-10-23, after the audit | Require complete environment facts for reference pairs. Disclose impact-plus-baseline execution selection. | Incomplete historical environments cannot establish an independent reference. Checks and thresholds stay unchanged. |

## Audit changes

| Date | Change |
| --- | --- |
| Changed on 2026-10-23, after the audit | Expected-failure transitions require current human weakening reviews in evidence-v1. Static-baseline-v0 keeps its checks and thresholds. |
| Changed on 2026-10-23, after the audit | Built-in mutation kills require supported assertion diagnostics. Runner errors stay outside the mutation score. Earlier exit-only caches cannot supply kills. |

## Audit evidence changes

| Date and state | Evidence change | Rule effect |
| --- | --- | --- |
| Changed on 2026-10-23, after the audit | Route schemas retain unsupported rules. Integer range runs retain case links. Migration data assertions replace execution-only PASS. | Existing harness checks consume corrected evidence. Migrate remains informational. No thresholds or accepted v0 checks change. |

## Reporting contract after the audit

| Change | Effect |
| --- | --- |
| Changed on 2026-10-23, after the audit | Both profiles store schema-bound rubric definitions and compare compatible stored category bands. No rating predicate or threshold changes. |

## Audit evidence change

| Date and state | Check | Change |
| --- | --- | --- |
| Changed on 2026-10-23, after the audit | No stale references | The search includes readable generated consumers. Generated hits enter the existing v1 stale-reference check. No v0 check changes. |
