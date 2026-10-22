# Homework triage, 2026-10-21

Scope: read-only triage of the completed map and mutation report, with source confirmation and small local probes. No production fix is included. Gate and probe results live in [status](../status.md).

| Priority | Finding | Evidence | Recommended work |
| --- | --- | --- | --- |
| 1 | Mutation baseline work repeats for every function, and the full-run cache also changes with commit identity and documentation inputs. | `lib/mutation-run.mjs:153`, `lib/mutation-run.mjs:164`, `lib/mutation-run.mjs:175`, `lib/full-run.mjs:19`, `lib/full-run.mjs:22` | Reuse identical passing baselines within a run; keep canary checks tied to copied file/test selection. Define execution inputs so harmless metadata changes need not repeat all mutations. |
| 2 | Model-output validation rejects empty and oversized descriptions, but the current validation tests do not exercise these cases; relevant guard-removal mutations survive. | `lib/enrich.mjs:40`, `lib/enrich.mjs:41`, `test/enrich.test.mjs:25` | Add behavior tests for empty/oversized descriptions, unexpected/duplicate cases and malformed provider responses. These are missing regression protections, not demonstrated acceptance bugs in the current validator. |
| 3 | Generic calls named `text` with a numeric argument between 400 and 599 are treated as HTTP failures. The mutation report consequently changes a 500-character truncation limit into 200. | `lib/source-metrics.mjs:139`, `lib/source-metrics.mjs:185`, `lib/mutation.mjs:41`, `lib/mutation-report.mjs:29` | Restrict HTTP status recognition to appropriate receiver/call shapes and status arguments; retain generic text helper calls as ordinary code. |
| 4 | CLI subprocess tests exercise the full workflow, but static import reachability cannot associate them with the entry point or workflow module. Mutation selection can therefore say no-tests or select only pure module tests for process code. | `test/full-run.test.mjs:34`, `lib/mutation-run.mjs:134`, `lib/mutation-run.mjs:174` | Add explicit test-to-entry-point mapping or support recognized subprocess invocation evidence. Report unknown reachability separately from demonstrated absence of tests. |

The surviving mutation list needs triage before expanding tests indiscriminately: changes such as null to undefined may be equivalent in callers, and status mutations currently include the false positive above. The observed timeout is a separate investigation item; it alone does not establish a production hang.


## Resolution, 2026-10-22

The user requested fixes for all four findings. Baseline commands are now reused within an unchanged private snapshot; canary reuse is additionally bound to source path/content, commands and timeout. Execution fingerprints use content rather than commit identity and ignore ordinary documentation; explicit `executionInputs` restores invalidation for runtime documentation.

Provider envelopes now pass through the separately testable `decodeEnrichment` boundary. Regression cases cover invalid descriptions, unknown/duplicate cases, note limits and malformed or incomplete provider envelopes. HTTP scanning and mutation share one status-position selector, excluding response bodies and ordinary formatting limits.

Validated `testEntrypoints` keeps subprocess links distinct from static assertion evidence. Working-tree configuration errors fail early; historical snapshots omit absent future paths. Scoped reports preserve the declared test inventory. This repository's CLI acceptance tests are configured.

The earlier timeout involved a mutant bypassing request validation and allowing an implicit live-provider invocation. The test execution environment now disables that fallback unless an explicit executable was supplied; application authentication was not changed. Live gates and any remaining evidence limits are recorded only in [status](../status.md).
