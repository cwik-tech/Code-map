# Command and extraction recipes

Use these when collecting a report or extracting evidence. Check `code-map --help` first: commands below describe the existing inspection interface, not the verification roadmap. Run from the assigned checkout. Substitute real mapped source paths and a task-specific temporary output path.

## Default: summary first

```sh
code-map inspect --summary --worktree --change uncommitted
code-map inspect --summary --ref HEAD --file src/example.ts
```

The summary prints the analysis ID (`A-…`), up to 20 findings and a `next` command for each finding. Run only the commands that the question needs. Long lists come in pages. For example, `--file <path> --part tests.transitive` returns 20 items, the total and the next-page command.

The first summary analyzes the whole project. A new summary reuses valid file facts from the store cache. Use `--no-cache` to parse every file again, and read `analysis.cache` for the counts. Later summaries with the same inputs and all follow-ups reuse the stored analysis. If the store is not writable, add `--store <writable folder>`. The printed commands then include that folder.

For a change review, add `--base <ref>`, for example `--base main`. Each finding then shows `baseline`: `NEW`, `EXISTING`, `RESOLVED` or `UNKNOWN`. NEW findings come first. The comparison reports function complexity changes and a `--complexity` command for the full list.
Each function records `cyclomatic`, `nesting` and `cognitive` values. Any increase puts the function in `grew`.

The `api` section counts removed, changed, unknown and added exports. It lists the head files that still import each removed or changed export. Follow `api.next.removed` or `api.next.changed` for a complete page (`--api <status>`).

The `impact` section gives four parts: affected files and tests, stale references, changed-export call sites and documentation leads. Follow its `next` commands (`--impact <list>`) for complete pages. Read `truncated` and `complete` before using an affected-file list. The `documentation` section counts public exports without a JSDoc comment (`--undocumented`).

In a Next.js project, `frameworks.nextjs` gives route and module counts and a `next` command for each list. Use `--part nextjs.routes`, `--part nextjs.modules` or `--part nextjs.unclassified`, without `--file`.

When the repository has `.code-map-triage.json`, the summary excludes dismissed and suppressed findings. Read `findings.hidden`, and add `--include-hidden` to see them. Refer to `docs/retrieval.md` in the Code-map checkout for all commands and fields.

The summary's `models` block counts Zod, JSON Schema and JSDoc boundary values, the state models and the decision tables. Page through them with `--part models.boundaries`, `models.states`, `models.decisions`, `models.cases` or `models.errors`, without `--file`.

When the project has a supported root lockfile, the summary has a `supply` part with package counts. The comparison has `comparison.supply` with the dependency change. Its `next` command (`--dependencies`) gives the full list.

When the project has Prisma, Drizzle or JSON Schema files, the summary has `schemas`: the inventory and what Code-map did not read. The comparison has `comparison.schemas`: the breaking, compatible and unknown changes, and a migration state for each package. Their `next` commands (`--schemas`) give the complete lists.

The `frameworks.env` block counts the environment reads and the template names (`--part env.names`, `--part env.reads`, `--part env.templates`). The `frameworks.openapi` block counts the OpenAPI documents, their operations and the handler methods (`--part openapi.documents`, `--part openapi.operations`, `--part openapi.handlers`). With `--base`, `frameworks.openapi.removed` lists the operations that the change removed from the documents and from the handlers.

The summary's `architecture` block counts the files in no layer and the files without an owner, and `comparison.owners` (with `--base`) lists the owners of the changed files and the number of owners that the change touches.

The `PACKAGE-` and `FILE-ORPHANED` findings compare the package imports with each `package.json` and list source files that no file imports. Read the gaps `packagesNotInstalled`, `packageImportsUnchecked`, `packageExportsUnknown`, `packageManifestsUnreadable` and `orphansUnknown` for what these checks did not decide.

## Classic report: selected files

```sh
code-map inspect --worktree --file src/example.ts --out /tmp/code-map-task.json
```

Repeat `--file` for multiple source files. For a committed snapshot, replace `--worktree` with `--ref HEAD` or the assigned ref. Do not rely on automatic branch selection: it can choose a different branch.

## When the task concerns a change set

```sh
code-map inspect --worktree --change uncommitted --out /tmp/code-map-task.json
```

Use `--ref HEAD --change latest` for the latest mapped source-changing commit. `--change branch` depends on an available branch base. Inspect `selection.missing` for deleted paths; they have no current declarations. A historical map does not supply current working-tree coverage.

## Extract an overview without printing the complete report

Node.js is already required by Code-map:

```sh
node --input-type=module - /tmp/code-map-task.json <<'JS'
import { readFileSync } from 'node:fs';
const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
console.log(JSON.stringify({
  snapshot: report.snapshot,
  selectedFiles: report.selection?.files?.length,
  missing: report.selection?.missing,
  summary: report.summary,
  nextSteps: report.testSummary?.nextSteps,
  limits: report.limits
}, null, 2));
JS
```

Then extract only the file record or test cases needed for the investigation. Limit displayed path/evidence lists and state how many entries were omitted; do not silently treat a truncated list as complete. Current file filtering reduces output size after whole-project collection, so it does not guarantee a cheap analysis run.

## When a full report is justified

Omit `--file`/`--change` only for a genuinely whole-project question, a full archive or collector debugging. Keep the output on disk and extract bounded sections. Do not replace all test paths with counts: paths remain necessary for investigating and selecting tests.

Before a handoff, `code-map verify --request <file>` checks the change against a base commit (refer to `docs/verify.md` for the request file). Exit 2 (BLOCKED) means that a blocking check failed. Exit 3 (INSUFFICIENT_EVIDENCE) is the usual result: read the failed and unknown checks in its `verification-report.md`. It never approves a change yet. The type check stays UNKNOWN until the request gives a bound compiler report: run `tsc --noEmit --pretty false > reports/tsc.txt` in the root folder of the repository, write its manifest with `code-map manifest --kind tsc`, and add both files to `reportInputs`. A bound LCOV report of the head (`code-map manifest --kind lcov`) gives the line coverage of the changed lines: the share of the changed lines with a `DA` record that ran. A changed code file without an `SF` record is not measured and never counts as covered. To link a test case to an acceptance criterion, write `[AC:<id>]` in its name or `// @ac <id>` directly above it. `code-map verify --context <run ID>` prints the context of a finished run in at most 256 KiB of JSON. The context has the request, the failed and unknown checks with their evidence IDs, and the next actions. A model can answer with a hypotheses file in a folder that Git ignores, and the next request names it in `hypotheses`. Code-map checks the evidence IDs of each hypothesis, and shows it as model output, never as evidence. A bound Istanbul JSON report (`coverage/coverage-final.json`, `code-map manifest --kind istanbul-json`) gives statement coverage: the share of the statements that touch a changed line and ran. With it, branches and functions of a file come from Istanbul JSON, and each changed function shows its join to the analysis (`exact`, `ambiguous` or `missing`). Statement and function coverage are information only. No rating condition uses them, and an Istanbul JSON report alone keeps Verification Coverage Unassessed.

The section `tests` of `verification-results.json` lists the weaker assertions of kept test cases, weaker runner settings, flaky and slower test cases, and the discovered test files and cases that did not run. Discovery accepts Vitest, Jest, Playwright and Mocha JSON. Bind it with the corresponding discovery kind in `code-map manifest`. No check reads the section, so read it before a handoff.

If the CLI help lists `run`, `code-map run --authorization <ID> --head HEAD --kind junit --artifact <report> -- <words>` runs the tests in the restricted worker. Use only an authorization ID and command words that the user gave you. Never run `code-map authorize` yourself. Add the printed run ID to the request as `{ "run": "<run ID>" }`. If `run` refuses because there is no backend, report that. A test run outside the worker is self-attested, not isolated. Refer to `docs/run.md` in the Code-map checkout.

For a stored analysis, `code-map inspect --analysis <id> --full --out <file>` writes the full report without collecting again; the printed command suggests a private file in the store. If the installed CLI help does not list `--summary`, do not invent `--summary`, `--finding` or analysis IDs. Do not invent verification results: `verify` reports only what its rule set checked. Never mix findings from different analysis IDs without disclosing the difference.

For unusual fields or unresolved classifications, read `docs/inspection.md` in the Code-map checkout. Do not preload that full reference for routine impact questions.

## Bound Next.js build sizes

Run the project's build yourself, then run `code-map sizes --dir .next --out reports/sizes.json`.
Write its run manifest with `code-map manifest --kind sizes`, then add the report pair to the verification request.
Ignore build output and reports in Git before the build. Write each manifest immediately after its successful build.
A bound report on each side gives route growth, new routes, removed routes and static totals in `verify`.
One side gives values without changes. These observations do not affect readiness or ratings.
Refer to `docs/verify.md#bound-size-reports`.

## Changed-line mutation evidence

Inspection selects candidate tests without execution.
Use `code-map mutate --authorization <id> --base <ref> --worktree --max 20 -- node --test --test-reporter=tap` for authorized isolated execution.
Use `code-map manifest --kind stryker-json` for an external mutation report.
Verification binds the report to the head before it counts changed-line mutants. Survivors include possible equivalent mutants.
Refer to `docs/mutation.md` in the Code-map checkout for complete commands and limits.

## Authorized verification

Authorized verification can run declared commands in the restricted worker through `execution.commands`.
An agent must use an existing authorization. It must not create an authorization for itself.
`regressionTests` and `generatedTests` record copied-test failure sensitivity as information. Fix checks stay UNKNOWN under `static-baseline-v0`.
Refer to `docs/verify.md`, section "Authorized execution".

## Behavioral harness

Inspection does not execute model cases. Use `code-map harness --authorization <id> --spec <file>` for authorized runs.
Read `docs/harness.md` in the Code-map checkout for each mode and its input schema.
Bind the stored run through `reportInputs: [{ "run": "<id>" }]` in a verification request.
Harness observations do not change `static-baseline-v0`.

## The evidence-v1 rule set

Keep `static-baseline-v0` in default requests. Select `evidence-v1` only with `ratingRulesVersion: "ratings-v1"`.
The user accepted this rule set on 2026-10-23. It stays opt-in. It uses isolated behavioral evidence and current human oracle records.
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

`code-map sbom --worktree --out bom.json` exports CycloneDX 1.5 JSON without execution.
The inventory supports npm, Yarn classic, pnpm 6 and 9, and text Bun.
Bound `osv-snapshot` reports match frozen advisories during verification. Advisory changes remain information.

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
See [the retrieval reference](../../../docs/retrieval.md) for the syntax and limits.

Harness runs retain side effects and regression fixtures in the private run folder.
Use `zod-boundaries` for discovered schema cases and `fault` for declared global fetch failures.
Fuzz corpus guidance combines measured subject V8 blocks and outcome classes.
Reports retain cumulative block counts and corpus growth. Block coverage is not path coverage.
Table references never create human oracle confirmations.
See [the harness reference](../../../docs/harness.md) for mode fields and limits.

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
See [binding and matching limits](../../../docs/retrieval.md#bound-compiler-diagnostic-lifecycle).

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
Refer to [weakening reviews](../../../docs/weakening-reviews.md) for record fields and limits.


## Evidence trust policy

Read each verification execution's `tier`, `eligible` and reasons before using its evidence.
Optional `.code-map.json` `trust` minimums match the exact first command word.
Authorization policies can raise minimums. An agent must use an existing authorization.
Tiers do not replace binding, oracle checks or the profile's isolation requirements.
Refer to [tool trust minimums](../../../docs/verify.md#tool-trust-minimums) for the shared policy and tier definitions.

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
Expected-failure transitions require current human reviews in evidence-v1.
Accepted static-baseline-v0 checks and thresholds stay unchanged.

## Contract audit extensions

Use explicit SQLite snapshots for structural compatibility and declared query rows for migration data oracles.
JSON Schema and JSDoc integer boundaries support authorized validator runs with retained case-to-call links.
Docker ARG and discarded-stage ENV declarations do not satisfy runtime reads. Unsupported contract rules retain UNKNOWN.
Read [contract evidence](../../../docs/contracts.md) and [harness modes](../../../docs/harness.md).

## Stored verification band comparison

Verification results include a schema-bound rubric and obligation scope.
Use `baselineReport` in a verification request to compare with an earlier run in the same output store.
Read compatibility reasons before using a band direction. Missing compatibility evidence and Unassessed bands stay UNKNOWN.
The baseline changes no rating or readiness result.
Refer to [the stored verification contract](../../../docs/verification-contract.md).

## Audited quality evidence

Read [quality evidence](../../../docs/quality-evidence.md) for generated-consumer searches, size deltas and revision ownership checks.
It also defines computed dependency uncertainty, frozen advisory provenance and optional `safeguards` policies.
Syntax observations never establish runtime PASS.
