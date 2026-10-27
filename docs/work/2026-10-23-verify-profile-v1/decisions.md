# Your 10 decisions on the rule set `evidence-v1`

**Decided on 2026-10-23:** you accepted answer A, the recommendation, for all 10 questions. `evidence-v1` is accepted, and `static-baseline-v0` stays the default.

## What you decide

`code-map verify` checks a code change and gives one of three results:

- **READY:** the evidence is sufficient to merge the change.
- **REVIEW:** a person must look at the change.
- **BLOCKED:** a required check failed.

A rule set is the list of checks and limits that gives this result. The accepted rule set, `static-baseline-v0`, uses only static analysis, so it never gives READY.

I built a second rule set, `evidence-v1`. It also uses the results of real test runs, and with it READY becomes possible. It works now, but only when a request names it, and each report says "proposed and not approved". It stays like that until you answer the 10 questions below.

The current code uses answer A for all 10 questions. If you select B or give your own value, I change the code and its tests to match.

You do not need to read the full proposal to answer. It is here if you want the details: [proposal.md](proposal.md), section 8.

## How to answer

Reply in the terminal with one letter for each number, for example: `1A 2A 3A 4A 5A 6A 7A 8A 9A 10A`. Answer A is my recommendation. You can also write your own value for a question.

## Terms

| Term | Meaning |
| --- | --- |
| Isolated run | Code-map runs the tests itself in its restricted worker, without network access, and writes the record of the run. |
| Self-attested report | A test report that your own run or CI made. Code-map cannot confirm how the run was made. |
| Rating | Each of four categories gets a rating from 1 to 5: Structural Integrity, Verification Coverage, Behavioral Confidence and Change Completeness. |
| Mutation score | Code-map puts small faults into the changed code. The score is the percentage of faults that the tests find. |
| Harness run | A generated test of one function: property tests, fuzz tests, a decision table or a state model. |

## The questions

### 1. Which rule set is the default?

- **A (recommended):** `static-baseline-v0` stays the default. A request uses `evidence-v1` only when it names it. Make `evidence-v1` the default later, when the calibration corpus has cases for its new checks.
- **B:** Make `evidence-v1` the default now.

Your answer: A, accepted on 2026-10-23.

### 2. Can READY use self-attested reports?

- **A (recommended):** No. READY needs an isolated run for each test report that a rating uses. A self-attested report still counts for the ratings and for BLOCKED.
- **B:** Yes. READY accepts self-attested reports, and the report shows their label.

Your answer: A, accepted on 2026-10-23.

### 3. How does a person confirm that a test checks an acceptance criterion?

- **A (recommended):** With a record in `.code-map/oracles.json` that the command `code-map oracle` writes. The record names the test, the criterion, the method and the person, and it holds a digest of the test file. When the test file changes, the record becomes stale. You accepted this method for v0 (decision 10 of v0).
- **B:** Also accept the tag `[AC:<id>]` in a test name, without a record.

Your answer: A, accepted on 2026-10-23.

### 4. What evidence shows that a refactor kept the behavior?

- **A (recommended):** One of these two is sufficient. The first is a differential run that finds no difference between the old and the new code for at least 20 inputs. The second is a run in which each existing test that reaches a changed file passes on the old and on the new code.
- **B:** Require both.

Your answer: A, accepted on 2026-10-23.

### 5. Which mutation score gives 5 of 5 in Behavioral Confidence?

- **A (recommended):** At least 60%, from at least 10 mutants of the changed code. Calibrate the value later on real changes.
- **B:** Another value, or no 5 of 5 from mutation.

Your answer: A, accepted on 2026-10-23.

### 6. Which coverage gives 5 of 5 in Verification Coverage?

- **A (recommended):** At least 90% of the changed statements and every changed function, from an isolated run.
- **B:** Other values.

Your answer: A, accepted on 2026-10-23.

### 7. What does a failed harness run do?

- **A (recommended):** It fails an optional check. The change can then get REVIEW, but not READY. It does not get BLOCKED.
- **B:** It fails a blocking check, so the change gets BLOCKED.

Your answer: A, accepted on 2026-10-23.

### 8. What does a new install script in a dependency do?

- **A (recommended):** It fails the dependency check only when `.code-map.json` sets `forbidInstallScripts`. Otherwise the report shows it as information.
- **B:** It always fails the dependency check.

Your answer: A, accepted on 2026-10-23.

### 9. Must the check of migrations and documentation pass?

- **A (recommended):** The check stays optional, as you decided for v0, but it now gives PASS or FAIL. Change Completeness gets 4 of 5 only when the check passes.
- **B:** Make the check required.

Your answer: A, accepted on 2026-10-23.

### 10. Does the public interface check apply to every type of change?

- **A (recommended):** Yes. It applies to every change and replaces the check of v0, which applied only to features.
- **B:** Only to features and refactors.

Your answer: A, accepted on 2026-10-23.

## What happens after you answer

1. I record your answers and the date in the proposal.
2. If an answer is not A, an OpenCode session changes the code and the tests, and I review and test the result.
3. I change the status of `evidence-v1` from "proposed" to "accepted" in the code, the reports and the docs.
4. If you select 1B, `evidence-v1` also becomes the default.
