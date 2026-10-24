---
name: code-map
description: Traces affected callers, dependencies and candidate tests in JavaScript/TypeScript repositories using Code-map. Use when planning a multi-file change, reviewing a refactor, investigating missing consumer updates or choosing tests for changed code. Skip isolated copy, formatting and documentation edits unless dependency analysis is requested.
---

# Investigate change impact with Code-map

Find work that a file-by-file review could miss: consumers to update, dependencies to inspect and existing tests to examine. Return a source-backed impact assessment, not a dump of the map.

## Inputs

Requires the installed Code-map CLI and its supported Node.js runtime; live collection needs a Git checkout. Use the assigned checkout, target files/change set and requested revision. For current edits, select `--worktree`; for committed work, select `--ref` explicitly. If scope is unclear, locate relevant entry files before collecting a report. Reuse an existing report only when its snapshot matches the task; a commit SHA alone does not identify dirty files.

## Procedure

1. **Choose the question.** Identify whether you need callers, candidate tests, an architectural relationship or omitted follow-up work. Skip analysis if that question can be answered from the isolated edit alone.
2. **Collect the smallest relevant slice.** Check the installed CLI help, then select exact repository-relative files or the requested change set. If the help lists `--summary`, start with `code-map inspect --summary` for that scope: it stores one analysis outside the repository and prints findings with exact follow-up commands. Read [references/inspection.md](references/inspection.md) when constructing commands or extracting saved JSON. Do not initialize or reconfigure the project to inspect it. If the tool is unavailable, report that and continue with direct source inspection.
3. **Read the overview before details.** Read the summary's findings, gaps and freshness first, then run only the printed `next` commands that the question needs. Without `--summary`, save JSON to a temporary file and extract snapshot, scope, summary, next steps and limits before reading individual evidence. **A whole-project report can be tens of megabytes; generate/access it only when whole-project analysis or a full export is needed. Never ingest it wholesale.** Even one selected file can have a large transitive-test list.
4. **Follow evidence to source.** Inspect the relevant importers, declaration locations and test paths. Separate confirmed omissions from leads. Read actual consumers/assertions before recommending an update or a test run. Retrieve more detail only to answer an unresolved question; disclose omitted/unsupported evidence. Follow-ups read the stored snapshot: if `analysis.freshness.state` is `stale`, run the printed `refresh` command before relying on the evidence.
5. **Close the loop.** After material structural edits, refresh the affected scope. Report what changed and the relevant checks actually performed; Code-map inspection itself does not run the project's tests.

## Result

Give the snapshot/scope, confirmed affected consumers with `path:line` evidence, candidate test paths with why they matter, and remaining unknowns or follow-up actions. Distinguish static inference from executed checks. Stop expanding the map when the impact question is answered; retain the saved report for further investigation.

A new summary reuses per-file facts from the store. Use `--no-cache` to turn off this file cache.

## Interpretation traps

- A test import or `direct` failure-test status is static evidence, not a passing test run or proof of a correct assertion.
- An all-edge cycle can contain only type edges; inspect the value graph and source before alleging a runtime cycle.
- Unreferenced exports and co-change are leads, not proof of dead code or a hidden dependency.
- Working-folder LCOV in `inspect` lacks revision and command binding. Only `code-map verify` binds a coverage report, through a run manifest. It reports the line coverage of the changed lines from LCOV, and the statement coverage from Istanbul JSON. Statement and function coverage are information only. Optional model labels do not verify behavior.
- An export change in the `api` section of a summary with `--base` compares declared signatures from the syntax. A CHANGED export does not prove a broken caller. With `--types`, explicit named shapes also compare. Unknown checker shapes retain UNKNOWN. Consumers outside the repository are not visible.
- The `impact` section of a summary with `--base` gives leads. The affected-file walk stops at depth 10 and 2000 files: read `truncated`, and treat `complete: false` as a partial list. A stale reference is a text match, so confirm it in the file. A `likelyBreak` call only compares the argument count with the head signature from the syntax: the TypeScript compiler decides. A documentation lead means that no documentation file changed, not that a document is wrong.
- A `NEXT-` finding comes from the client and server classes that Code-map derives from `'use client'` directives and the import graph. It is a lead, not a Next.js build error: read `frameworks.nextjs.unclassified` in the summary for what the classes do not cover.
- In the summary's `models` block, "named in a test" means only that a test file that imports the model's file contains the boundary value or sends the event. It is not a tested case, and Code-map ran no case. `UNKNOWN` means that a limit, a target or a config is not a literal.
- An `ENV-` finding compares the environment reads of the mapped files with the names in the env template files. A deployment can set a name that no template declares, and a file outside the source roots can read a name. Code-map never reads `.env` files with values.
- An `OPENAPI-` finding compares the methods and paths of an OpenAPI document in JSON with the Next.js route handlers. It does not apply `next.config` rewrites, a `basePath` or the middleware. A YAML document is not read: `frameworks.openapi.documents` lists it as `not-read`.
- A layer violation is an `ARCH-RULE` finding named `layer:<lower> -> <higher>`. The `layers` setting declares the layers. A file in no layer is outside the model: read `architecture.layers.outside` before you say that no import breaks a layer. Read per-file owners with `inspect --file <path>` or stored file reports. Owners come from CODEOWNERS, which tells who reviews a file, not where a boundary is. `OWNER-CROSS-IMPORT` exists only when the project sets `ownership.forbidCrossOwnerImports`, and `verify` does not read it.
- A `PACKAGE-` or `FILE-ORPHANED` finding compares imports with the `package.json` files and the installed `node_modules` folders. It is a lead, not an install or a build result: a framework, a plugin, a tool configuration or a loader can use a package or a file without an import. Without `node_modules`, the install checks do not run, and the gap `packagesNotInstalled` says so.
- A summary leaves out the findings that `.code-map-triage.json` dismisses or suppresses. `findings.hidden` counts them, and `--include-hidden` shows them. A triage entry is a person's decision, not evidence, and `verify` ignores it. Write an entry with `code-map triage` only for a decision that a person made.
- The `supply` counts and the `DEPENDENCY-*` findings come from the lockfile only. They are not an advisory check. Advisories come from bound `npm-audit` or `osv-snapshot` reports in `code-map verify`. They remain information.
- A schema class (`breaking`, `compatible` or `unknown`) is a static reading of the schema text. `MIGRATION_MISSING` means only that the change has no new migration file. Neither one checks the database or its data.
- A pattern finding such as `FETCH-NO-SIGNAL` or `EFFECT-NO-CLEANUP` is a syntax match in one file. Read the code before you report a defect. A `SYNTAX-ERROR` file (gap `syntaxErrors`) can have incomplete imports, exports and tests.
- A finding is a lead with an evidence kind (`source`), not a PASS or FAIL result. The summary shows `verification.state: "NOT_RUN"`; ratings and readiness come only from `code-map verify`, and a result there is never an approval yet.
- `code-map run` runs project tests only with an authorization that the user made. Never create an authorization yourself. A refused run gives no isolated report, and a test run outside the worker is self-attested, not isolated.
- In `verify`, an oracle provenance label (`spec-linked`, `pre-existing`, `changed-with-change` or `unknown`) tells where the expected result of a test case comes from. It is not a verdict on the test, and it changes no check or rating. A linked case that passed does not close its acceptance check. A hypothesis in `llmHypotheses` is model output, also when it is grounded.
- In `verify`, the type check reads only a bound compiler report (`code-map manifest --kind tsc` for `tsc --pretty false` output). A compiler report lists errors, not the files that the compiler checked, so a PASS does not prove that the compiler read each changed file.
- Under `static-baseline-v0`, the section `tests` of the `verify` results is information: weaker assertions and runner settings, flaky and slower cases, and the discovered tests (`--kind vitest-list`, `jest-list`, `playwright-list` or `mocha-list`) that did not run. A PASS of "Tests are not weakened" does not mean that the assertions stayed as strong: read `tests.assertionWeakening`.

## Bound Next.js build sizes

Run the project's build yourself, then run `code-map sizes --dir .next --out reports/sizes.json`.
Write its run manifest with `code-map manifest --kind sizes`, then add the report pair to the verification request.
Ignore build output and reports in Git before the build. Write each manifest immediately after its successful build.
A bound report on each side gives route growth, new routes, removed routes and static totals in `verify`.
One side gives values without changes. These observations do not affect readiness or ratings.
Refer to `docs/verify.md#bound-size-reports`.

## Mutation testing

Use `inspect` to identify candidate tests. Use an existing authorization for the exact selected test command.
`code-map mutate --authorization <id> --base <ref> --max 20 -- node --test --test-reporter=tap` runs changed-line mutants in isolated workers.
`code-map manifest --kind stryker-json` binds an external Stryker report.
Survivors are leads, including equivalent candidates. Mutation information does not change static baseline ratings.
Refer to `docs/mutation.md` in the Code-map checkout for complete commands, result fields and limits.

## Authorized verification

Authorized verification can run declared commands in the restricted worker through `execution.commands`.
An agent must use an existing authorization. It must not create an authorization for itself.
`regressionTests` and `generatedTests` record copied-test failure sensitivity as information. Fix checks stay UNKNOWN under `static-baseline-v0`.
Refer to `docs/verify.md`, section "Authorized execution".

## Harness runs

`code-map harness --authorization <id> --spec <file>` runs bounded behavioral checks in the restricted worker.
Use only a user-provided authorization for `node .code-map-harness/runtime.mjs`.
Never authorize a command for yourself. Read `docs/harness.md` in the Code-map checkout before preparing a spec.
Bound harness results are information only under `static-baseline-v0`.

## Proposed evidence-v1

Keep `static-baseline-v0` in default requests. Select `evidence-v1` only with `ratingRulesVersion: "ratings-v1"`.
This rule set is proposed and not approved. It uses isolated behavioral evidence and current human oracle records.
It can reach READY only with isolated test reports and four ratings of at least three.
A model must not run `code-map oracle` to confirm its own expected results. Only a person supplies oracle confirmation.
Read `docs/verify-evidence-v1.md` in the Code-map checkout for the checks, command, schema and evidence gaps.

## Contract and example information

Inspection reads GraphQL SDL, Protocol Buffers, deployment variable names and fenced JavaScript or TypeScript examples.
With `--base`, `frameworks.protocols.changes` classifies supported schema changes. Unsupported constructs give UNKNOWN.
Use `--part protocols.documents`, `protocols.changes`, `deployment.documents`, `examples.issues` or `examples.gaps` with the stored analysis.
The summary provides the complete commands. Checked Markdown edits invalidate working-tree analyses.
Route harness runs require an existing authorization and a working sandbox backend.
Read `docs/contracts.md` and `docs/harness.md` in the Code-map checkout for the supported subset and route specification.

Use `code-map sbom --worktree --out bom.json` for CycloneDX 1.5 JSON from the selected inventory.
Use `--ref HEAD` for committed lockfile bytes. Read `docs/retrieval.md` for supported formats and limits.

## Discovery and bundle evidence

Read `completeness` in the summary for parser coverage by stack.
With a base, read `comparison.complexity.areas` for cognitive sums and maxima of changed files and their containing folders.
Relative template patterns produce `dynamic-pattern` edges. Computed targets remain unresolved.
A bound head size report adds `bundle.unusedChunks` and `bundle.reachedOrphans` to verification JSON.
These observations do not change ratings. Route first loads do not enumerate all runtime loading.
Refer to `docs/retrieval.md` and `docs/verify.md` in the Code-map checkout for fields and limits.

## Review and independent generated oracles

`code-map review --run <run ID> --model-command <words...>` sends context to your program and saves validated hypotheses.
The program runs with your permissions, outside the restricted project worker. Read `docs/model-review.md` before use.
The default time limit is 60 seconds. Combined output has a 256 KiB limit.
Model output never changes a verification result, rating or readiness.
`generatedTestOracles` shows current human records for each generated test. A model must not confirm its own oracle.
`node scripts/replay.mjs --labels calibration/real` compares static results with human labels. No real labels are supplied.

## Measured coverage information

`verify` writes `coverageEvidence` beside the rating input `coverage`.
It gives project totals, mapped changed counters, adjusted base coverage loss and measured unexecuted exports.
These observations do not add rating conditions. Missing counters never mean zero hits.
Read `docs/coverage.md` in the Code-map checkout for fields, page limits and source map support.

## Run authentication

Read `signature.state` and `signature.fingerprint` in verification executions before relying on machine authentication.
Invalid signatures and unknown signers exclude reports. Unsigned compatibility cannot detect a stripped signature.
Read `environmentComparisons` for base/head environment differences. These observations add no rule-set check.
Refer to `docs/run.md`, section "Manifest signatures and environment", for key permissions, `trustedRunKeys` and sampled disk limits.

## Migration and policy information

Read `MIGRATION-USE` findings for configured import and call replacements.
Read `comparison.policy` in a base comparison for revision rules, layers and forbidden import witnesses.
In verify results, read `migrations`, `publicInterfaces` and `policy`.
The optional request field `allowedPublicChanges` lists permitted public export names. Null or omission supplies no public scope.
These sections supply information only. They add no rule-set check or rating contribution.
See [the retrieval reference](../../docs/retrieval.md) for the syntax and limits.

Harness runs retain side effects and regression fixtures in the private run folder.
Use `zod-boundaries` for discovered schema cases and `fault` for declared global fetch failures.
Fuzz corpus guidance combines measured subject V8 blocks and outcome classes.
Reports retain cumulative block counts and corpus growth. Block coverage is not path coverage.
Table references never create human oracle confirmations.
See [the harness reference](../../docs/harness.md) for mode fields and limits.

## Discovery and regression information

Discovery also accepts Playwright list JSON and Mocha dry-run JSON.
Read `tests.discoveryAttestations` for command-bound counts on each side.
Read `tests.dependencies` for lockfile changes and the shared dependency policy of isolated runs.
Repeated JUnit identities with failed and passed attempts are flaky. Every attempt remains visible.

## Optional compiler facts

Use `inspect --types` or configure `typeCheck: true` for bounded compiler facts.
`typeBudgetMs` defaults to 10000 milliseconds. A budget stop returns UNKNOWN.
Compiler discovery, inferred and explicit export shapes, argument compatibility, and language-service references are informational in `verify`.
Bind `tsc --listFilesOnly` output with report kind `tsc-files` to identify checked files.
Release-policy annotations and unique rename pairs describe public API changes.
The accepted rule set stays unchanged. See `docs/types.md`.

## Controlled command timings

Use `code-map bench --authorization <id> --runs 5 --warmup 1 --worktree -- <command...>` with an existing exact-command authorization.
Bench repeats the command sequentially in one restricted workspace and keeps an isolated `bench` report.
Add base and head run IDs to verification `reportInputs`.
Verification compares median times against noise and configured thresholds. Load drift or incompatible runs give UNKNOWN.
Timing observations do not affect ratings or readiness.
Refer to `docs/run.md#controlled-timings` in the Code-map checkout for commands, thresholds and machine limits.

## Schema rollout and fixture transforms

Read `schemaRollout.leads` in verify results for old-name consumers and one-step deployment risks.
These syntax leads are information only. They add no check to either rule set.
Use harness mode `migrate` with `base`, `fixture` and an optional `package` folder for SQLite fixture transforms.
This mode has no subject. SQL runs only in the restricted worker through an existing authorization.
Read `docs/harness.md` in the checkout for migration selection, row counts, SQL errors and limits.

## Compiler diagnostic lifecycle

Use `inspect --summary --base <ref> --compiler-report <head report>` for bound compiler lifecycle information.
Add `--base-compiler-report <base report>` to compare both sides.
Each report needs `<report>.manifest.json` with kind `tsc`.
Read `compiler.counts`, `entries`, `newDiagnostics`, `truncated` and the execution refusal reasons.
Lifecycle labels change no profile check. Missing or incomparable evidence gives UNKNOWN.
See [binding and matching limits](../../docs/retrieval.md#bound-compiler-diagnostic-lifecycle).

## Offline revision dependencies

Use an existing authorization that names `--install offline --npm-cache <folder>`.
Pass the same options to `run` or enabled `verify` execution.
Requests also accept `execution.install: "offline"` and `execution.npmCache`.
Read `executionRuns[].dependencies` for revision preparation and `tests.dependencies` for comparisons.
The cache is read-only. Missing packages fail installation. Lifecycle scripts never run.
Preparation information adds no profile check.

## Observed XState transitions

Use a user authorization that explicitly includes `--trace-xstate` before running `run --trace-xstate`.
The stored command includes the Node preload. A plain command authorization does not cover it.
Use `inspect --summary --worktree --run <run ID>` to compare the trace with its bound snapshot.
In verification, trace runs in `reportInputs` add information without changing checks or ratings.
Missing XState and unsupported observations remain UNKNOWN. Unseen transitions describe only the recorded run.

## Typed documentation examples

TypeScript documentation blocks also receive diagnostics with document locations.
Read `examples.issues` for errors and comparison labels, and the summary for checked and skipped counts.
`ts no-check` fences and `// @ts-nocheck` lines opt out. Missing programs leave UNKNOWN evidence.

## Generated mutation information

Read `generatedTestMutations` for head passes, copied base outcomes, oracle links and changed-line mutant outcomes.
Use `generatedTestWords` templates with one `{testFile}` word and an existing authorization for the exact expanded words.
Each generated declaration can name its own `mutationAuthorization`. A broader authorization does not permit a narrower command.
Acceptance tags on cases that fail killed mutants give informational obligation links. Neither rule set reads these links as checks.
See the generated test mutation section of `docs/verify.md` for bounds and evidence limits.

## Human weakening reviews

The proposed `evidence-v1` profile requires current human reviews for assertion and runner weakening.
The `static-baseline-v0` results stay unchanged.
A model must not write a review record.
A person uses `code-map review-weakening --entry <weakening ID> --reason <text> --reviewed-by <name>`.
Add `--base <ref>` to match a verification base other than HEAD.
Refer to [weakening reviews](../../docs/weakening-reviews.md) for record fields and limits.


## Evidence trust policy

Read each verification execution's `tier`, `eligible` and reasons before using its evidence.
Optional `.code-map.json` `trust` minimums match the exact first command word.
Authorization policies can raise minimums. An agent must use an existing authorization.
Tiers do not replace binding, oracle checks or the profile's isolation requirements.
Refer to [tool trust minimums](../../docs/verify.md#tool-trust-minimums) for the shared policy and tier definitions.

## Selected regression evidence

Use `execution.commands[].baselineSuite` with one whole-word `{testFiles}` command selector for impact-plus-baseline selection.
Use an existing authorization for the exact expanded words. Read `executionRuns[].selection` for the denominator and per-file outcomes.
Incomplete impact or missing selected outcomes remain UNKNOWN.
Read environment comparison eligibility before interpreting retries or timing changes.
Missing environment fields give UNKNOWN. Different OS, architecture or toolchain values prevent pairwise comparisons.

## Audit evidence limits

`tests.exportedFunctions` lists pure exports, public aliases and direct or transitive static test relationships.
A missing relationship is a candidate. Instrumented hits remain UNKNOWN without bound counters.
Mocha pending cases retain skipped status and count in discovery denominators.
Built-in mutation kills require Node TAP assertion diagnostics. Authorize `--test --test-reporter=tap` explicitly.
Runner failures retain their reason and run ID. They stay outside the mutation score.
Expected-failure transitions require current human reviews in proposed evidence-v1.
Accepted static-baseline-v0 checks and thresholds stay unchanged.

## Contract audit extensions

Use explicit SQLite snapshots for structural compatibility and declared query rows for migration data oracles.
JSON Schema and JSDoc integer boundaries support authorized validator runs with retained case-to-call links.
Docker ARG and discarded-stage ENV declarations do not satisfy runtime reads. Unsupported contract rules retain UNKNOWN.
Read [contract evidence](../../docs/contracts.md) and [harness modes](../../docs/harness.md).

## Stored verification band comparison

Verification results include a schema-bound rubric and obligation scope.
Use `baselineReport` in a verification request to compare with an earlier run in the same output store.
Read compatibility reasons before using a band direction. Missing compatibility evidence and Unassessed bands stay UNKNOWN.
The baseline changes no rating or readiness result.
Refer to [the stored verification contract](../../docs/verification-contract.md).

## Audited quality evidence

Read [quality evidence](../../docs/quality-evidence.md) for generated-consumer searches, size deltas and revision ownership checks.
It also defines computed dependency uncertainty, frozen advisory provenance and optional `safeguards` policies.
Syntax observations never establish runtime PASS.
