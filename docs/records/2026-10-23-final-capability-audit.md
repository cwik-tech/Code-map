# Final capability audit

## Audit on 2026-10-23

Source: the final-status brief for `docs-final2` and the verification specification, sections 4, 5 and 10.
Code: `0e90869` on `cwik-tech/docs-final2`.
The ten W5 notes and the integrator handoff identify the changes to inspect.
The audit uses source and tests to check their claims.
The [status page](../status.md) owns the capability states, remaining work and current gate results.
The external handoff contains an identical replacement table. The specification was not edited.

## Discrepancies and actions

| Document | Previous claim | Source evidence | Action |
| --- | --- | --- | --- |
| `docs/status.md` C15 | Project compilation and equivalent-mutant decisions make mutation partial | `lib/mutation/run.mjs:47` runs a clean baseline and isolated edits. `lib/mutation/report.mjs:11` accepts external Stryker results | Mark the bounded mutation target as implemented. Keep local compilation and equivalent mutants as limits |
| `docs/status.md` C37 | Unauthenticated identity and oracle truth make provenance partial | `lib/provenance.mjs` labels origins. `lib/oracles.mjs` validates digest-bound records. `lib/profiles/evidence-v1.mjs` requires independent evidence | Mark provenance as implemented. Keep identity and oracle truth as limits |
| `docs/status.md` C18 | Outcome-guided fuzzing satisfies the full target | `lib/harness/runtime.mjs` retains outcome classes. `lib/harness/corpus.mjs` has no execution coverage feedback | Record coverage capture and feedback as remaining work |
| `docs/status.md` C19 | Historical dependency preparation is only a limit | `lib/verify-exec.mjs` runs each source revision through the worker. `lib/worker/workspace.mjs` reuses installed dependencies | Record revision-specific dependencies as remaining work. Section 10 explicitly requires each revision's declared dependencies |
| `docs/status.md` C33 | Syntax and self-import checks satisfy checked examples | `lib/impact/examples.mjs` explicitly performs no typecheck or execution | Record example typechecks as remaining work. Section 10 explicitly names type checks |
| `docs/status.md` C42 | Base sensitivity and oracle links satisfy generated-test evaluation | `lib/verify-exec.mjs` keeps copied-test results outside profile evidence. `lib/generated-oracles.mjs` provides separate information | Record targeted mutation links and new obligation links as remaining work |
| `README.md` | The command and option tables are complete | `bin/code-map.mjs` dispatches `sbom` and `key`, and parses `disk-megabytes` | Add the missing table rows |
| `CHANGELOG.md` | A fetch call without a signal has no timeout | `lib/patterns.mjs` detects syntax. It does not prove the absence of another timeout mechanism | Describe the syntax lead without a runtime claim |
| `CHANGELOG.md` | The merged stream summaries omit some interface detail and repeat the report fix | W5 notes and `node bin/code-map.mjs --help` | Add export metadata, command names and option names. Keep one report-limit fix |

C02, C21, C23, C27, C36 and C39 retain concrete implementation gaps.
C27 needs a review requirement for assertion and runner changes, not another detector.
C23 checks declared transitions separately. It does not record instrumented event sequences.
C43 has a calibration runner and labeled replay. Larger representative samples require human labels.
C45 has a versioned rating engine. Product approval remains separate from implementation.

## Capability evidence index

Each row identifies implementation code and a relevant test entry point.
The table is a navigation index. An import relationship alone does not prove test execution.
Execution results and skipped cases are recorded only in [the gates table](../status.md#gates).
The capability table also names supporting source modules.

| ID | Implementation entry point | Test entry point |
| --- | --- | --- |
| C01 | `lib/analyze.mjs:26` | `test/aliases.test.mjs:29` |
| C02 | `lib/profiles/compiler-evidence.mjs:39` | `test/profile-types.test.mjs:14` |
| C03 | `lib/types/api.mjs:5` | `test/api-compare.test.mjs:41` |
| C04 | `lib/types/program.mjs:12` | `test/typed-facts.test.mjs:22` |
| C05 | `lib/analysis.mjs:12` | `test/compare.test.mjs:75` |
| C06 | `lib/layers.mjs:18` | `test/layers.test.mjs:33` |
| C07 | `lib/impact/reach.mjs:20` | `test/impact-units.test.mjs:23` |
| C08 | `lib/test-quality.mjs:27` | `test/test-quality.test.mjs:30` |
| C09 | `lib/coverage-evidence.mjs:57` | `test/coverage-extended.test.mjs:15` |
| C10 | `lib/adapters/test-list.mjs:25` | `test/runner-discovery.test.mjs:11` |
| C11 | `lib/source-map.mjs:23` | `test/coverage-extended.test.mjs:15` |
| C12 | `lib/changed-coverage.mjs:29` | `test/changed-coverage-measures.test.mjs:26` |
| C13 | `lib/coverage-evidence.mjs:47` | `test/coverage-extended.test.mjs:15` |
| C14 | `lib/coverage-evidence.mjs:122` | `test/coverage-extended.test.mjs:15` |
| C15 | `lib/mutation/run.mjs:19` | `test/mutation-run.test.mjs:9` |
| C16 | `lib/harness/runtime.mjs:102` | `test/harness-extensions.test.mjs:35` |
| C17 | `lib/harness/fixtures.mjs:6` | `test/harness-extensions.test.mjs:59` |
| C18 | `lib/harness/corpus.mjs:4` | `test/harness-extensions-review.test.mjs:24` |
| C19 | `lib/verify-exec.mjs:14` | `test/test-runs.test.mjs:12` |
| C20 | `lib/harness/route.mjs:6` | `test/harness-route.test.mjs:15` |
| C21 | `lib/schemas/compare.mjs:69` | `test/schemas-compare.test.mjs:16` |
| C22 | `lib/harness/metadata.mjs:8` | `test/harness-extensions.test.mjs:27` |
| C23 | `lib/harness/call.mjs:64` | `test/models-states.test.mjs:28` |
| C24 | `lib/models/decision-table.mjs:17` | `test/models-decisions.test.mjs:15` |
| C25 | `lib/migrations.mjs:5` | `test/policy-migration.test.mjs:43` |
| C26 | `lib/frameworks/deployment.mjs:6` | `test/contracts-extra.test.mjs:7` |
| C27 | `lib/assertion-compare.mjs:17` | `test/assertion-compare.test.mjs:15` |
| C28 | `lib/revision-policy.mjs:60` | `test/policy-migration.test.mjs:60` |
| C29 | `lib/types/references.mjs:5` | `test/typed-facts.test.mjs:22` |
| C30 | `lib/complexity-areas.mjs:14` | `test/discovery.test.mjs:42` |
| C31 | `lib/revision-policy.mjs:31` | `test/revision-policy-review.test.mjs:25` |
| C32 | `lib/bundle-evidence.mjs:5` | `test/bundle-evidence.test.mjs:23` |
| C33 | `lib/impact/examples.mjs:9` | `test/contracts-extra.test.mjs:27` |
| C34 | `lib/supply/sbom.mjs:4` | `test/supply-formats.test.mjs:7` |
| C35 | `lib/harness/call.mjs:21` | `test/harness-extensions.test.mjs:80` |
| C36 | `lib/size-report.mjs:12` | `test/sizes.test.mjs:29` |
| C37 | `lib/provenance.mjs:99` | `test/provenance.test.mjs:33` |
| C38 | `lib/worker/signing.mjs:21` | `test/run-signing.test.mjs:18` |
| C39 | `lib/worker/backend.mjs:23` | `test/worker-signing-limits.test.mjs:9` |
| C40 | `lib/completeness.mjs:7` | `test/discovery.test.mjs:53` |
| C41 | `lib/triage.mjs:39` | `test/triage.test.mjs:17` |
| C42 | `lib/generated-oracles.mjs:6` | `test/generated-oracles.test.mjs:6` |
| C43 | `calibration/real-labels.mjs:16` | `test/replay-labels.test.mjs:21` |
| C44 | `lib/model-review.mjs:11` | `test/model-review.test.mjs:18` |
| C45 | `lib/ratings.mjs:18` | `test/ratings.test.mjs:16` |

## Scope and documentation check

The README command and option tables were compared with the CLI help and parser.
The README runtime module paths were compared with tracked files.
Each tracked runtime module has a named README entry. Each named runtime module exists.
The ten stream summaries were merged with the existing Unreleased entries.
No production code, dependency manifest, profile or specification changed.
No ADR is needed because the audit makes no architecture decision.

## Local integration

Source branch: `cwik-tech/docs-final2`.
Target branch: `cwik-tech/roadmap-integration`.
Run these commands in the checkout that owns the target branch:

```sh
git switch cwik-tech/roadmap-integration
git merge --no-ff cwik-tech/docs-final2
```

Likely conflicts: `docs/status.md`, `README.md` and `CHANGELOG.md` if the target changes those files.
No migration or dependency installation is required.
No tag or push is part of this handoff.
