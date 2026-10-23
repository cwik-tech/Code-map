# Proposal: the first rule set for `code-map verify`

**Status:** proposal, 2026-10-22. Nothing in this document is built. It needs your decisions on ten questions. They are in [section 8](#8-decisions-for-you).

## 1. Why this document exists

Today, `code-map inspect` finds static leads ("findings"), such as a broken import or an import cycle. With `--base`, it also compares two snapshots and labels each finding as new, existing or resolved. It does not say whether a change is ready.

The specification plans a second command, `code-map verify`. It takes one change, from a base commit to a head commit or the working tree, and gives two results:

- **Four ratings**, one for each category: Structural Integrity, Verification Coverage, Behavioral Confidence and Change Completeness. Each rating is a number from 1 to 5, or "Unassessed" when there is not enough evidence. The ratings are never added together.
- **One readiness state** for the whole change: READY, REVIEW, BLOCKED or INSUFFICIENT_EVIDENCE. The exit code of the command follows from it.

`verify` cannot work without a rule set. The specification calls a rule set a **profile**. A profile says:

- Which checks a change must pass
- Which failed checks stop the change
- Which evidence each rating needs
- Which thresholds apply, for example a minimum share of changed lines that the tests ran

These rules are product decisions. I did not want to invent them in code. This document is a concrete first rule set that you can accept, change or reject.

## 2. How this proposal was made

1. Three AI agents each wrote a complete rule set, from a different point of view:
   - Only what Code-map can check today
   - Refactors, where the main risk is changed behavior
   - A gate for an AI agent before it hands its work to a person
2. Three other AI agents scored the three rule sets. They checked each one against the specification and against your earlier decisions: no total score, four independent ratings, no PASS from a check that did not run, isolated execution only, and no discount for tests that were written with the code.
3. All three scorers chose the first rule set. One more agent added the best ideas of the other two.
4. I rewrote the result into this document. The scores are in the [appendix](#appendix-scores-of-the-three-drafts).

## 3. The proposal in short

The rule set has the name `static-baseline-v0`. "v0" means a first, experimental version.

It uses only evidence that Code-map has today or can import:

- The findings of the base and the head analyses, and their labels (NEW, EXISTING, RESOLVED or UNKNOWN)
- The evidence gaps that the analysis reports
- Test result files from the project's own test runs, when a run manifest ties them to the same code (refer to the terms in section 4)

Code-map runs no project code for this rule set.

As a result, `verify` with this rule set can stop a bad change, but it cannot approve a good one. It never gives READY. Two kinds of evidence are not available yet:

- A record that the expected results of the tests are correct. The specification calls this oracle validation.
- Coverage reports that are tied to the exact code that the tests ran.

Without them, two categories stay Unassessed. This is on purpose: a false READY is worse than no READY.

## 4. Terms in this document

| Term | Meaning |
| --- | --- |
| Change | The difference between the base commit and the head (a commit or the working tree) |
| Changed files | The files that differ between base and head: both names of a renamed file, and new files that Git does not ignore |
| Finding | A static lead from `code-map inspect`, for example `ARCH-RULE` (an import breaks an architecture rule). Refer to `docs/retrieval.md` for all finding rules |
| NEW, EXISTING, RESOLVED, UNKNOWN | The label of a finding when Code-map compares the head with the base. UNKNOWN means that Code-map cannot decide, for example after a moved file changed |
| Comparable | Both analyses come from the same Code-map version, settings and environment, and the head analysis describes the current code. A check that uses findings gives PASS or FAIL only for comparable analyses. Otherwise its result is UNKNOWN |
| Check | One item that the change must satisfy. The specification calls it an obligation. Its result is PASS, FAIL or UNKNOWN |
| Required check | A check that must pass before the change can be READY |
| Blocking check | A check whose failure gives BLOCKED at once |
| Bound test report | A test result file (JUnit XML, Jest or Vitest JSON) with a run manifest. The manifest records the commit, a digest of the changed files, the command and the tool versions of the run. Code-map accepts the report only when the manifest matches the analyzed code |
| Unfiltered run | A bound test run that did not select a subset of the tests |

## 5. The checks in each category

A check gives FAIL first, then UNKNOWN, then PASS. It passes only when no FAIL or UNKNOWN condition applies.

### Structural Integrity: does the change fit its interfaces and rules?

| Check | It fails when | It is unknown when | Required | Blocks |
| --- | --- | --- | --- | --- |
| No new architecture-rule break | The head has a NEW `ARCH-RULE` finding | The analyses are not comparable, a rule is invalid, an `ARCH-RULE` finding is UNKNOWN, or no rule is declared (decision 3) | Yes | Yes |
| New imports resolve | The change adds an import that does not resolve (`IMPORT-UNRESOLVED` or `IMPORT-NAME-MISSING`) | The analyses are not comparable, a changed file is not JavaScript or TypeScript, or a related finding is UNKNOWN | Yes | No |
| No new import cycle | The head has a NEW `CYCLE-VALUE` finding that is not part of a cycle in the base | The analyses are not comparable, or a cycle finding is UNKNOWN | Yes | No |
| Types are compatible | A bound TypeScript compiler report shows an error in a changed file or in a file that imports one | There is no bound compiler report. Code-map cannot import such a report yet | Yes | No |

For a feature, a check of consumer contracts takes the place of the type check. In a project without TypeScript, the type check is "not applicable" after your approval.

How the category is rated:

- **1 of 5:** a NEW architecture-rule break, or a new import that does not resolve.
- **Minimum evidence for any rating:** comparable analyses, and at least one changed code file in the analysis.
- **3 of 5:** all required checks pass. No import from a changed file is dynamic, uses loader syntax, has no classification, or was skipped by the name check.
- **4 of 5:** level 3, and the project declares architecture rules, no `ARCH-RULE` finding touches a changed file, and each test file that reaches a changed file loaded in an unfiltered run.
- **5 of 5:** not possible in this version.

### Verification Coverage: which changed code ran in tests?

| Check | It fails when | It is unknown when | Required | Blocks |
| --- | --- | --- | --- | --- |
| A bound test run of the head exists | The bound head reports ran no test case | There is no bound head report | Yes | No |

How the category is rated:

- **Minimum evidence:** a bound head test report and a bound line-coverage report. Code-map cannot bind coverage reports yet, so this category stays Unassessed in this version.
- **1 of 5:** an unfiltered run ran no test case, and the change touched code that is not a test.
- **3 of 5:** each changed test file ran, and the tests ran at least 80% of the changed lines (decision 6).
- **4 of 5:** level 3, and each test file with active cases ran, and the tests took at least 70% of the changed branches.
- **5 of 5:** not possible in this version.

### Behavioral Confidence: did independent expected results hold?

| Check | It fails when | It is unknown when | Required | Blocks |
| --- | --- | --- | --- | --- |
| No new test failures | The head report has a failed case that the base report does not have. Both reports must come from the same command, tools and environment | There is no bound head report, or the run failed without a failed case | No | Yes |
| Earlier failures | The head and the base reports share a failed case. This check only makes the old failures visible | There is no bound head report | No | No |
| Behavior preserved (refactor), regression test (fix) | Never in this version | Always in this version, because nothing can check them yet | Yes | Yes |
| Bug reproduced (fix), one check for each acceptance criterion | Never in this version | Always in this version | Yes | No |

A test case that the change added counts the same as an old one.

How the category is rated:

- **Minimum evidence:** a bound head report and a record that a person or another trusted source confirmed the expected results. No such record exists yet, so this category stays Unassessed in this version.
- **3 of 5:** the required checks pass, and there are no new test failures.
- **1, 4 and 5 of 5:** not possible in this version.

### Change Completeness: were the consumers and follow-up changes handled?

| Check | It fails when | It is unknown when | Required | Blocks |
| --- | --- | --- | --- | --- |
| Changes stay in scope | A changed file matches none of the allowed paths in the request | Nothing changed. If the request gives no allowed paths, the result is always unknown | Yes | No |
| Acceptance criteria exist (feature only) | Never | Always, when a feature request has no criteria | Yes | No |
| Consumers are updated | A NEW broken import appears in a file whose import worked in the base | The analyses are not comparable, a changed file is not supported, or Code-map cannot tell whether the import worked in the base | Yes | No |
| No new focused test | The head has a NEW `TEST-FOCUSED` finding (a test with `.only`) | The analyses are not comparable, or a changed test file cannot be read | Yes | Yes |
| Tests are not weakened | An active test case of the base is gone in the head, or a NEW finding shows that a base case is now skipped, has no assertion, or ignores errors | The analyses are not comparable, or a changed test file cannot be read | Yes | No |
| Code-map settings unchanged | The change edits `.code-map.json` or the test-labels file. Both analyses read the current settings, so a relaxed rule could hide a break | Nothing changed | Yes | No |
| Migrations and documentation | Never in this version | Always. This check only makes the gap visible | No | No |

How the category is rated:

- **1 of 5:** a consumer lost its import target.
- **Minimum evidence:** allowed paths in the request, comparable analyses, at least one changed file, and the test cases of both snapshots.
- **3 of 5:** the required checks pass, and no file outside the change imports a changed file through a computed dynamic import or an import that the name check skipped.
- **4 and 5 of 5:** not possible in this version.

## 6. What `verify` would report today

| Category | With static evidence only | With bound test reports |
| --- | --- | --- |
| Structural Integrity | 1, 2 or Unassessed | The same. A bound compiler report allows 3, and an unfiltered run then allows 4 |
| Verification Coverage | Unassessed | 1 when an unfiltered run ran nothing, otherwise Unassessed |
| Behavioral Confidence | Unassessed | Unassessed. A new test failure still gives BLOCKED |
| Change Completeness | 1, 2, 3 or Unassessed | The same |

## 7. Readiness and exit codes

| Exit code | Readiness | When it happens in this version |
| --- | --- | --- |
| 0 | READY | Never |
| 1 | REVIEW | Never, because INSUFFICIENT_EVIDENCE comes first |
| 2 | BLOCKED | A NEW architecture-rule break, a NEW focused test, or a new test failure in a bound report |
| 3 | INSUFFICIENT_EVIDENCE | All other results |
| 4 | none | The request, the rule set or its version is invalid, the request asks to run project code, or Code-map failed. No old output stays behind |

Readiness also follows these rules:

- A review cannot clear a failed required check.
- A test report without a matching run manifest never counts for readiness.
- Each failed or unknown check names its evidence and the next command to run, for example `code-map inspect --analysis <head> --base-analysis <base> --findings --baseline new --rule ARCH-RULE`.

## 8. Decisions for you

For each question, the first answer is my recommendation.

1. **Must all four categories be rated before a change can be READY?**
   - Recommended: yes. READY then stays impossible until Code-map can use test evidence that it can trust.
   - Alternative: make Verification Coverage and Behavioral Confidence optional. READY then becomes possible from static checks alone, but it means only "structurally clean".
2. **Which failures stop the change at once (BLOCKED)?**
   - Recommended: three, namely a new architecture-rule break, a new focused test and a new test failure. These are the most certain.
   - Alternative: also block a consumer that lost its import target, and a new import that does not resolve.
3. **What happens in a project without architecture rules?**
   - Recommended: the rule check is "not applicable", with the reason recorded.
   - Alternative: the rule check is unknown. Structural Integrity then stays at 2 of 5 or below.
4. **Must the TypeScript compiler check pass for 3 of 5 in Structural Integrity?**
   - Recommended: yes. Structural Integrity then stays at 2 of 5 or below until Code-map can import compiler reports.
   - Alternative: allow 3 of 5 without it, and show "types not checked" as a limit.
5. **Do you trust a run manifest that your own test run wrote?**
   - Recommended: yes, with the label "self-attested". The manifest proves which code the report describes, not that the run happened honestly.
   - Alternative: accept only manifests from a CI system that signs them, or from an isolated `code-map run`. Neither exists yet.
6. **Which coverage thresholds apply?**
   - Recommended: 80% of the changed lines for 3 of 5, 70% of the changed branches for 4 of 5, and no skipped import check. Calibrate them later on real changes.
   - Alternative: other values.
7. **What happens when a change edits Code-map's own settings?**
   - Recommended: a failed required check that does not block.
   - Alternative: a blocking failure.
8. **Must migrations and documentation be checked?**
   - Recommended: no, they stay optional and unknown for now.
   - Alternative: make them required. Change Completeness then stays at 2 of 5 or below.
9. **How are the allowed paths of a request written?**
   - Recommended: patterns with `**`, `*` and `?`, matched case-sensitively, with Code-map's own matcher.
   - Alternative: a glob library. It is a new dependency, which needs your approval.
10. **Which record will confirm that the expected results of a test are correct (for the next version)?**
    - Recommended: one record for each test case. It names the acceptance criterion, a digest of the test file, the method and the person or source that confirmed it. A model's opinion never counts.
    - Alternative: accept old tests that the change did not touch without such a record.

## 9. What must be built after your decisions

- The `verify` command and its report files
- The list of changed files for a change
- A matcher for the allowed paths
- A comparison of imports and test cases between base and head
- A reason for each import that the name check skipped
- The import of bound test reports from a request
- An adapter for TypeScript compiler reports

## Appendix: scores of the three drafts

Each cell gives the scores of the three scorers, from 1 (poor) to 5 (good).

| Draft | Fits the specification | Can be built now | Low risk of a false READY | Simple | Ready for calibration | Chosen by |
| --- | --- | --- | --- | --- | --- | --- |
| Only what Code-map can check today | 4, 4, 4 | 4, 4, 4 | 5, 4, 4 | 3, 3, 3 | 4, 4, 4 | 3 scorers |
| Refactors | 3, 4, 3 | 3, 3, 3 | 3, 4, 3 | 3, 2, 2 | 3, 4, 3 | none |
| Gate for an AI agent | 2, 3, 3 | 3, 3, 2 | 2, 2, 2 | 2, 2, 2 | 3, 3, 3 | none |

From the refactor draft, the proposal takes these ideas:

- Base and head test reports from the same command
- Cycles that were already in the base
- Thresholds in whole numbers
- Test files that failed to load

From the agent-gate draft, it takes these ideas:

- The check for deleted test cases
- The link from level 3 to readiness
- The request as the only source of scope
- A next command for each open item
