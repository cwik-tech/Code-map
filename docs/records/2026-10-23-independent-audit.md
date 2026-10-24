# Record: independent audit of the 45 capabilities, 2026-10-23

## Why this record exists

The status page (`docs/status.md`) was written by the same sessions that built the code. This record shows the independent check: auditors that did not build the code compared each capability C01 to C45 with the plan (`code_map_verification_spec.md`, section 4 and section 10), and a test check shows that each gap that they found is closed. The scope is TypeScript, JavaScript and React. Python, Electron and React Native are out of scope by the user's decision.

## How the audit was made

1. **First audit (commit be3800e).** Five Codex sessions, one for each group of nine capabilities. Each auditor quoted the requirement, found the code and the tests, ran a test or a command, and gave the verdict "complete" or "gap".
   - Result: 25 complete, 20 gaps (C01, C03, C04, C09, C10, C15, C19, C20, C21, C22, C26, C27, C29, C30, C31, C32, C34, C35, C38, C45).
2. **Fixes (commit 9a4bd85).** Six sessions closed the 20 gaps. Each fix came with a test that fails before the change.
3. **Second audit (commit 9a4bd85).** Five OpenCode sessions with the DeepSeek model, with the same method, for all 45 capabilities.
   - Result: 45 complete, 0 gaps.
4. **Test check of the fixes.** The 43 test files that the fixes added or changed ran on the old code (be3800e) and on the new code (9a4bd85).
   - On the old code: 105 of 395 tests fail. Some test files also fail to load, because their modules did not exist yet.
   - On the new code: 453 of 453 tests pass.

## Each gap of the first audit, and the test that shows its fix

Each test in this table fails on the old code and passes on the new code.

| Gap | What was missing | Test that fails before and passes after |
| --- | --- | --- |
| C01 | `import x = require()` and compiler module settings | `test/import-scope.test.mjs`: "import-equals retains located missing value and type dependencies", "NodeNext findings agree with real compiler extension and import-equals errors" |
| C03, C04 | Checker comparison of annotated exports and named parameter and return types | `test/typed-facts.test.mjs` (5 tests) and `test/api-signatures.test.mjs` (2 tests) |
| C09 | Static candidates for functions without a recognized failure exit | `test/test-quality.test.mjs`: "pure public functions retain static candidates, aliases and transitive relationships" |
| C10 | Pending Mocha cases in the discovered inventory | `test/runner-discovery.test.mjs`: "Mocha includes pending-only files and deduplicates overlapping pending cases" |
| C15 | A runner or import failure counted as a killed mutant | `test/mutation-outcome.test.mjs` (new file) and `test/mutation-run.test.mjs` |
| C19 | Test selection from the change impact plus a baseline suite | `test/verify-selection.test.mjs`: "impact plus baseline selection excludes unrelated tests and retains every failed attempt" |
| C20 | Unsupported response rules, and request examples against their schemas | `test/audit-contracts.test.mjs`: "response constraints reject enum and range violations and retain unsupported rules", "request examples are checked against parameter and body schemas" |
| C21 | SQL schema comparison and an expected-data check of migrations | `test/audit-migrate.test.mjs` (4 tests), for example "declared query rows detect value corruption and wrong row counts" |
| C22 | Boundaries from JSON Schema and range annotations | `test/audit-boundaries.test.mjs` (4 tests) |
| C26 | Docker build arguments counted as runtime variables | `test/audit-contracts.test.mjs`: "build arguments and discarded stages do not satisfy runtime reads" |
| C27 | Expected-failure modifiers did not need a review | `test/expected-failure.test.mjs` (9 tests), for example "expected failure requires a review for test.fails('case')" |
| C29 | Generated consumers in build folders | `test/impact-cli.test.mjs`: "tracked generated consumers remain searchable with bounded text reads" |
| C30 | Size changes of each symbol and file | `test/complexity-size.test.mjs` (new file) and `test/complexity-compare.test.mjs` (4 tests) |
| C31 | A looser ownership policy against the base policy | `test/revision-policy-review.test.mjs`: "ownership relaxation retains base witnesses" (2 cases) |
| C32 | A computed package load as UNKNOWN for unused dependencies | `test/packages-boundaries.test.mjs`: "computed package loads expose candidate and site uncertainty without unused findings" |
| C34 | The date of the advisory database, not the run date | `test/supply-osv.test.mjs`: "legacy advisory arrays keep missing database provenance unknown at later execution" |
| C35 | Rules for retries and logging | `test/patterns.test.mjs` and `test/declared-patterns.test.mjs` (new rules) |
| C38 | Comparisons of runs from different environments | `test/test-runs.test.mjs` (10 tests), `test/run-signing.test.mjs` (4 tests) |
| C45 | A versioned schema of the results and rating comparison between reports | `test/verification-contract.test.mjs` and `test/verification-contract-cli.test.mjs` (3 tests) |

## Third check: a behavior script for each capability

The second audit gave test runs as evidence. A test run alone is weak evidence, so a third audit asked for more. Five OpenCode sessions with the DeepSeek model wrote one Bash script for each capability (`calibration/behavior/C01.sh` to `C45.sh`). Each script works the same way:

1. It builds a small Git repository with the case of the requirement in a temporary folder.
2. It runs the real Code-map command line on it: `inspect`, `verify`, `manifest`, `run`, `harness`, `mutate`, `bench`, `sizes` or `sbom`.
3. It checks the output, and it prints PASS or FAIL.

I ran all 45 scripts again myself after the auditors finished. All 45 passed. Run them again with `bash scripts/capability-behavior.sh`. The scripts need `jq`, and the scripts of the restricted worker need `/usr/bin/sandbox-exec` (macOS).

| Capability | Result | What the script showed |
| --- | --- | --- |
| C01 | PASS | IMPORT-UNRESOLVED at src/b.ts:2 (imports "./not-here") |
| C02 | PASS | IMPORT-NAME-MISSING: src/user.ts imports the missing name 'absent' |
| C03 | PASS | export 'removed' reported REMOVED with 1 remaining consumer(s) |
| C04 | PASS | export 'parse' reported CHANGED with reason(s) signature |
| C05 | PASS | CYCLE-VALUE finding shows the cycle among src/x.ts, src/y.ts |
| C06 | PASS | ARCH-RULE at src/verify/check.ts: src/verify/check.ts imports src/engine/util.ts, which the rule "verify -> engine" forbids. |
| C07 | PASS | impact.affected reaches reverse dependency src/consumer.ts at depth 1 |
| C08 | PASS | impact.affected.tests links the changed source to test/lib.test.ts |
| C09 | PASS | TEST-EXPORT-CANDIDATE finding flags 'untestedHelper' as a candidate with runtime hits unknown |
| C10 | PASS | discovered 3 test cases, TEST-PARKED (skipped) and TEST-FOCUSED (.only) findings, both capability C10 |
| C11 | PASS | statement coverage from Istanbul JSON report: 1/3 changed statements covered (statement coverage) |
| C12 | PASS | branch coverage from LCOV BRDA: 1/2 changed branches covered, uncovered changed branch listed as ['5:0:1'] |
| C13 | PASS | function coverage from LCOV FN/FNDA: 1/1 changed functions, 1 exact AST join |
| C14 | PASS | changed-code coverage maps the diff to coverage: 4/4 changed lines covered (line coverage) |
| C15 | PASS | mutation testing classified 2 changed-line mutants with statuses: Killed,Survived |
| C16 | PASS | differential replay compared base and head on 2 shared inputs (4 paired calls) and recorded 2 output difference(s) |
| C17 | PASS | property testing used a seeded generator (mulberry32-v1, seed 42) and recorded a counterexample with a shrunk input |
| C18 | PASS | fuzz testing recorded 10 crash(es), 6 covered V8 blocks, corpus size 3, finite run |
| C19 | PASS | selection policy=impact-plus-baseline-v1 impact=[test/calc.test.mjs], base run 0 failed, head run 1 failed (exit 1) - regression compared |
| C20 | PASS | route harness flagged the response as minimum:age |
| C21 | PASS | correct migration PASSes and a value-corrupting update FAILs against declared assertion rows |
| C22 | PASS | boundaries generated from JSON Schema and JSDoc ranges (json-schema,range-annotation), values=17,18,19,64,65,66 |
| C23 | PASS | state model reports transitions=PAY,SHIP, unreachable=[cancelled,orphan], deadEnds=[orphan], unhandled events=[PAY,SHIP] |
| C24 | PASS | decision table enumerates 4 cases, 1 conflicting overlap, 1 gap(s) |
| C25 | PASS | MIGRATION-USE finding flags a stale consumer at src/app.js:1 symbol=legacy |
| C26 | PASS | ARG-only Docker declaration leaves the TOKEN read missing (missingReads=1, kind=ARG, runtime=false) |
| C27 | PASS | adding .fails produced 1 expected-failure weakening entry (unreviewed=1) |
| C28 | PASS | out-of-scope change src/other.ts fails the scope.allowed-paths obligation (verify exit 3) |
| C29 | PASS | removed export legacyName leaves 1 stale text reference(s), the first in a markdown file |
| C30 | PASS | function f grew in complexity, delta {"lines":7,"cyclomatic":2,"nesting":2,"cognitive":3} |
| C31 | PASS | new core->ui import is a NEW ARCH-RULE finding, base policy sees 1 head violation and 0 base violations |
| C32 | PASS | src/feature.ts becomes a NEW FILE-ORPHANED lead and used-pkg a NEW PACKAGE-UNUSED lead |
| C33 | PASS | undocumented public export 'undoc' reported, and changed export 'format' has a CHANGED documentation lead |
| C34 | PASS | sbom exported CycloneDX 1.5 with 2 components incl. left-pad@1.3.0 |
| C35 | PASS | FETCH-NO-SIGNAL static lead reported, and injected fetch hang observed as missing-timeout in the isolated harness |
| C36 | PASS | sizes read 1 route(s) with totals, and bench measured a median of 131.18383300000005ms with MAD and minimum |
| C37 | PASS | provenance labels 1 case spec-linked and links acceptance criterion 'login' |
| C38 | PASS | manifest binds commit a0247c9, environment and artifact digest, key fingerprint sha256:a1f1a92a7d64fe3a755a1dc2555033c5c9d28706c93f25f3b0040 |
| C39 | PASS | run is isolated (seatbelt), network denied, no parent token leaked into the environment, budgets recorded |
| C40 | PASS | completeness table per stack and a non-empty gaps list present: [{"stack":"TypeScript","discovered":1,"parsed":1,"skipped":0,"malformed":0," |
| C41 | PASS | suppressed finding a9163b3c77c67507 hidden, triage records state, reason, owner and expiry |
| C42 | PASS | changed-line numeric mutant of src/sum.mjs is Killed (1 killed mutant) |
| C43 | PASS | calibration corpus reports confusion matrices with precision/recall across 25 checks in 183420.959834 ms |
| C44 | PASS | context printed, review validated and saved hypotheses (grounded=1 ungrounded=1) |
| C45 | PASS | readiness BLOCKED (exit 2), four independent ratings, architecture-rules FAIL, Markdown report links results |

## Fourth check: the test files of each capability

`calibration/capability-tests.json` maps each capability to the test files that the audits named for it, and `node scripts/capability-tests.mjs` runs them. All 45 capabilities have at least one test file. The run gave 1,429 test runs and 0 failures. A test file can count for more than one capability.

## Limits of this audit

- The second audit used a different model (DeepSeek through OpenCode). Its evidence for each capability is a test run. The third check and the test check of the fixes do not depend on it.
- The behavior scripts show the main case of each requirement on a small repository. They are not a proof for every input.
- A "complete" verdict means that the bounded target of the plan exists and behaves as the tests show. The limits that the plan itself names stay, and `docs/status.md` lists them for each capability.
- The proposed rule set `evidence-v1` exists and works when a request names it. Its approval is a decision of the user: `docs/work/2026-10-23-verify-profile-v1/proposal.md`.

## Fifth check: each part of each requirement

A later check went one level deeper. It split each capability into the separate parts of its requirement and mapped each part to a test. That check found 15 gaps, which are now fixed. Refer to [the trace and fix record](2026-10-23-requirement-trace-and-fixes.md).
