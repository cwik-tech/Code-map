# Survivor review, 2026-10-22

Source: the user requested review and correction of the survivors from the complete run at `a464f8b`. The original IDs below identify that report, not line numbers after this change. Gate results and remaining platform limits belong in [status](../status.md).

## Findings and changes

Real HTTP regressions reproduced two existing failures: a JSON `null` message closed the connection by throwing during property access, and a rendering exception caused a second header write after HTTP 200 had already been sent. `lib/server.mjs` now validates the message object and renders the page before sending success headers. Neither change alters token or origin checks.

A separate regression demonstrated that `testsFor` discarded configured subprocess tests whenever direct assertion references existed. `lib/mutation-run.mjs` now retains declared subprocess tests alongside the focused static selection. The server process regressions are explicitly linked in `.code-map.json`; declared reachability remains separate from executed assertions.

The remaining changes add protections for existing correct behavior. Provider simulations replace only the external, paid, nondeterministic executable; they do not establish live-provider integration. Server regressions use real HTTP and owned subprocesses so an uncaught server exception fails a discovered parent test rather than being mislabeled as a test-file load error.

## Original candidate dispositions

A protected contract means a test now states the behavior; measured mutation outcomes are recorded only in status. Sentinel-return changes are kept as raw survivors when they are equivalent in private callers. Platform-specific branches remain explicitly bounded by the host used for verification.

| Original mutant ID | Disposition and evidence |
| --- | --- |
| `bin/code-map.mjs#mutateWork:1` | Protect the actionable missing `--file` diagnostic in `test/full-run.test.mjs`. Removing the guard still fails later, but loses the intended user-facing explanation. |
| `lib/analysis.mjs#createReport:1` | Protect the missing-analysis diagnostic through `createReport` in `test/boundaries.test.mjs`. |
| `lib/analysis.mjs#createReport:3` | Protect rejection of unavailable change selections in `test/boundaries.test.mjs`. |
| `lib/coverage.mjs#readCoverage:1` | Protect the public missing-report result, explicit `null`, in `test/boundaries.test.mjs`. |
| `lib/descriptions.mjs#loadDescriptions:1` | Protect rejection of an array document rather than silently treating it as an empty description record. |
| `lib/descriptions.mjs#loadDescriptions:2` | Protect the usable empty description structure for a missing file. |
| `lib/descriptions.mjs#loadDescriptions:3` | Protect legacy summary normalization and retained module/tour data. |
| `lib/descriptions.mjs#apiFingerprint:1` | Protect a stable export hash that changes with the exported interface. All description cases are in `test/boundaries.test.mjs`. |
| `lib/enrich.mjs#validateEnrichment:3` | Protect rejection of array-valued kinds/paths which stringify to a requested key; the existing guard is necessary. `test/enrich.test.mjs`. |
| `lib/enrich.mjs#askModel:2` | Protect promise rejection with its cause instead of an uncaught asynchronous exception, through the external process boundary. `test/enrich.test.mjs`. |
| `lib/full-run.mjs#cachedReport:1` | Protect repair of malformed cached JSON through the real default CLI flow. `test/full-run.test.mjs`. |
| `lib/full-run.mjs#cachedReport:2` | Equivalent in current callers: missing-cache `null` and `undefined` both make `cached` false; `fullRun` follows the same verification branch. Retain as a raw survivor. |
| `lib/full-run.mjs#cachedReport:3` | Equivalent in current callers: invalid-receipt `null` and `undefined` select the same cache miss. Retain as a raw survivor. |
| `lib/full-run.mjs#cachedReport:4` | Equivalent in current callers: coverage-mismatch `null` and `undefined` select the same cache miss. Retain as a raw survivor. |
| `lib/full-run.mjs#fullRun:1` | Protect rejection of unmapped mutation files before publishing a receipt. `test/full-run.test.mjs`. |
| `lib/full-run.mjs#fullRun:2` | Protect rejection of repository input changes during verification. A real owned fixture writes its original repository during the private-copy test run. `test/full-run.test.mjs`. |
| `lib/history.mjs#sizesAt:1` | Protect history before source files first appeared, using a real two-commit Git repository in `test/boundaries.test.mjs`. |
| `lib/mutation-report.mjs#readMutation:1` | Protect the readable error report for malformed mutation JSON. |
| `lib/mutation-report.mjs#readMutation:2` | Protect the public missing-report result, explicit `null`. Both report cases are in `test/boundaries.test.mjs`. |
| `lib/mutation-run.mjs#parseResult:2` | Protect explicit absence of an unproduced JSON runner report. |
| `lib/mutation-run.mjs#outcome:2` | Protect runner-error classification for a nonzero exit with no readable test result. |
| `lib/mutation-run.mjs#mutate:1` | Protect rejection of an empty eligible selection before workspace creation. Runner boundary cases are in `test/boundaries.test.mjs`. |
| `lib/project.mjs#loadConfig:1` | Protect rejection of array, scalar and string configuration documents. |
| `lib/project.mjs#loadConfig:2` | Protect validation of `executionInputs` types and relative paths. |
| `lib/project.mjs#readTestEntrypoints:1` | Protect rejection of non-object mappings. |
| `lib/project.mjs#readTestEntrypoints:2` | Protect nonempty target arrays and repository-relative paths. |
| `lib/project.mjs#readTestEntrypoints:3` | Protect rejection of unknown test and source paths. |
| `lib/project.mjs#readTestEntrypoints:5` | Protect the deduplicated mapping result. |
| `lib/project.mjs#projectName:1` | Protect fallback for malformed manifests. |
| `lib/project.mjs#projectName:2` | Protect the manifest project name. |
| `lib/project.mjs#projectName:3` | Protect the folder-name fallback for nameless manifests. Project boundary cases are in `test/boundaries.test.mjs`. |
| `lib/server.mjs#startServer:3` | Existing rendering-error defect fixed; protect HTTP 500 and continued availability. |
| `lib/server.mjs#startServer:4` | Protect HTTP 404 for unknown routes. |
| `lib/server.mjs#startServer:5` | Protect startup rejection after all fallback ports are occupied, using real local listeners. |
| `lib/server.mjs#chat:1` | Protect HTTP 403 for an invalid token. |
| `lib/server.mjs#chat:2` | Protect HTTP 413 for oversized input. |
| `lib/server.mjs#chat:3` | Protect HTTP 400 for malformed JSON and continued availability; the additional JSON-null regression closes an existing crash. |
| `lib/server.mjs#runClaude:1` | Protect skipping a malformed stream line before a valid provider result. HTTP/process cases are in `test/server-boundaries.test.mjs`. |
| `lib/snapshot.mjs#chatWorkspace:1` | Protect the working-tree directory and explanatory note. |
| `lib/snapshot.mjs#chatWorkspace:2` | Protect the checked-out commit directory and note. |
| `lib/snapshot.mjs#requirePrivate:2` | Windows-only early return, not equivalent: `privateRoot` uses its path. Add a platform-independent root contract test which exercises this branch when run natively on Windows. macOS execution cannot establish its Windows outcome. Snapshot cases are in `test/boundaries.test.mjs`. |
| `lib/test-labels.mjs#loadTestLabels:1` | Protect rejection of an array label document. |
| `lib/test-labels.mjs#stampTestLabels:1` | Protect a zero count and no write when a label file is missing. `test/boundaries.test.mjs`. |

## Document audit and update

`docs/full-run.md` and `docs/inspection.md` described declared subprocess tests as a fallback only. They now describe their unconditional addition to focused static test selection. `SECURITY.md` records the request/error responses. The changelog records the server and selection corrections. README configuration remains accurate; no dependency, schema migration, public configuration field or architectural decision was added.


## Verification environment follow-up, 2026-10-22

Concurrent verification gates exposed Chrome teardown watchdog failures in existing viewer checks. An isolated launch probe with software rasterization disabled completed, and the previously failing viewer cases were probed with that launch setting. Both viewer harnesses now pass `--disable-software-rasterizer` alongside `--disable-gpu`, with isolated profiles and no retries. Contributor guidance runs separate browser gates sequentially. Original failures and subsequent gate outcomes remain in [status](../status.md); the underlying macOS/Chrome mechanism is not claimed as proven.
