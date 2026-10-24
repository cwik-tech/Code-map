# Code-map for AI agents

Code-map can help agents find possible dependencies, importers and candidate tests. Its collector exposes structured source facts; the HTML presents the same facts for human inspection.

## Installable agent skill

The small, self-contained skill is in `skills/code-map/SKILL.md`. Copy the `skills/code-map` folder into your agent's skill directory to install it. It documents current inspection behavior, the summary-first retrieval and the evidence limits. Update the installed copy when changing Code-map versions.

## Where it helps

- **Before building:** inspect imports, possible importers and declaration-only exports; compare affected files with the assigned write set and required providers.
- **Before review:** trace the actual change through its importers and related tests. Investigate affected areas omitted from the handoff.
- **When coordinating:** check dependency and file overlap before assigning parallel work. Inspect the code to confirm that required providers are implemented.
- **After a capability:** compare snapshots for new dependencies, remaining declarations and size growth; explain what changed in the delivery page.

## Use the correct snapshot

Run from the project being inspected:

```sh
code-map --ref HEAD --out /tmp/code-map-committed.html
code-map --worktree --out /tmp/code-map-working.html
```

Select the revision explicitly: the default follows the local branch with the most recent source change. Preserve existing maps by choosing a separate output. Record the commit and, for uncommitted work, the exact diff or file hashes.

For agents, start with `code-map inspect --summary --worktree` (or `--ref HEAD`). It stores one analysis outside the repository and prints a small overview: findings, evidence gaps and an exact follow-up command for each finding. Follow those commands for one finding, a page of findings or a page of evidence. They read the same stored analysis, never collect again, and mark the evidence `stale` when the code changed. A whole-project JSON report can be tens of megabytes, so read it only when the question needs it. A new summary reuses valid file facts from the store cache. With `--base <ref>` (or `--base-analysis <id>`), the summary also reports the complexity change of the functions in changed files. Its `next` command (`--complexity`) gives the complete list. When the project has a supported root lockfile, the summary also has a `supply` part: package counts, install scripts, packages without an integrity value, other hosts and licenses. With a base, `comparison.supply` shows the dependency change, and `--dependencies` gives the complete list. These are lockfile facts, not an advisory check. Refer to [the retrieval reference](docs/retrieval.md).

When the project has Prisma, Drizzle or JSON Schema files, the summary also shows their inventory (`schemas`). The comparison classifies each schema change as breaking, compatible or unknown (`comparison.schemas`). It gives a migration state for each package, for example `MIGRATION_MISSING` for a schema change without a new migration.

To review a change of an interface, add `--base <ref>` to the summary. Its `api` section counts the removed, changed, unknown and added exports, for the public API of package entry points and for the other modules. Each removed or changed export lists the head files that still import it, also files that the change did not touch. Follow `api.next.removed` and `api.next.changed` for the complete lists. A change compares declared signatures from the syntax. With `--types`, known explicit and inferred checker shapes also compare. It does not prove that a caller breaks. Refer to [compare the exported interface](docs/retrieval.md#compare-the-exported-interface).

The same summary has an `impact` section with four leads. `affected` gives the files that import a changed file, directly or through other files, by depth, and the affected test files. Read `truncated` and `complete`: the walk stops at depth 10 and at 2000 files, and a computed dynamic import makes it incomplete. `references` gives the head text that still names a removed export or the old path of a removed or renamed file, for example a mock path in a test or a name in a Markdown file. `calls` gives the uses of each changed export, with the number of arguments of each call. A `likelyBreak` call is outside the argument range of the head signature: confirm it with the TypeScript compiler. `docs` lists the public exports that the change removed or changed while no documentation file changed. Follow the `next` commands (`--impact <list>`) for the complete lists. Each summary also has a `documentation` section with the public exports without a JSDoc comment (`--undocumented`). Refer to [change impact](docs/retrieval.md#change-impact).

In a Next.js project, the summary also has a `frameworks` block. It names the checked surfaces, counts the routes and the client and server modules, and lists what Code-map cannot classify. The `NEXT-` findings are static leads about the client and server boundary: confirm each one in the code. `code-map inspect --analysis <id> --part nextjs.routes` pages through the routes with their URL patterns and the HTTP methods of each route handler. Refer to [Next.js and React checks](docs/retrieval.md#nextjs-and-react-checks).

The `frameworks` block also has `env` and `openapi`. `env` counts the environment reads and the names in the env template files. Code-map never reads `.env` or another file with secret values, and it keeps no value. `openapi` compares the operations of each OpenAPI document in JSON with the Next.js route handlers, and with `--base` it lists the removed operations. The `ENV-` and `OPENAPI-` findings are static leads: confirm each one in the code and the document. Refer to [environment keys](docs/retrieval.md#environment-keys) and [API contracts](docs/retrieval.md#api-contracts).

The summary also has a `models` block. It counts Zod, JSON Schema and JSDoc boundary values. It also counts state models and decision tables. State models use XState or files in `.code-map/models/`. Decision tables use `.code-map/decisions/`. Each list has a `next` command, for example `--part models.boundaries`. A case is "named in a test" when a test file that imports its file contains the value or sends the event. This is a weak static signal: it does not prove that a test checks the case. Refer to [models of expected behavior](docs/models.md).

The summary has an `architecture` block. Without CODEOWNERS, all source files count as unowned. It counts the source files in no layer and the source files without an owner. A layer break is an `ARCH-RULE` finding named `layer:<lower> -> <higher>`, and `code-map verify` counts the layer rules as declared rules. With CODEOWNERS and `--base <ref>`, `comparison.owners` lists the owners of the changed files and the number of owners that the change touches. An owner from CODEOWNERS tells who reviews a file. It does not prove a boundary. Refer to [layers and owners](docs/retrieval.md#layers-and-owners).

The summary also compares the package imports with each `package.json`, also in a monorepo with npm workspaces. `PACKAGE-UNDECLARED` names an import of a package that the nearest `package.json` does not declare, and `PACKAGE-DEV-ONLY` a production value import of a development dependency. Type-only imports and Electron runtime imports do not count. `PACKAGE-UNRESOLVED` and `PACKAGE-SUBPATH-NOT-EXPORTED` read the installed `node_modules` folders. Without them, these two checks do not run, and the gap `packagesNotInstalled` says so. `PACKAGE-UNUSED` names a dependency that no code, style, script or config file uses, and `FILE-ORPHANED` a source file that no file imports and that is not an entry point. With `--base`, a file that lost its last importer has a NEW `FILE-ORPHANED` finding. Each one is a static lead: confirm it in the code. Refer to [package checks](docs/retrieval.md#package-checks).

A repository can have a triage file, `.code-map-triage.json`, with the decisions of people about findings. The summary and the findings pages then leave out dismissed and suppressed findings, and `findings.hidden` counts them. Add `--include-hidden` to see them. A triage entry is a decision of a person, not evidence, and `code-map verify` does not read it. Write an entry with `code-map triage` only when a person made the decision, and give that person as `--owner`. Refer to [triage findings](docs/retrieval.md#triage-findings).

Before you hand over a change, run `code-map verify --request <file>`. It checks the change against a base commit and gives four ratings, one readiness state and an exit code. With `static-baseline-v0`, it can stop a change (exit 2, BLOCKED), but it cannot approve one: expect exit 3, INSUFFICIENT_EVIDENCE, and read the failed and unknown checks in its report. To close the type check, add the output of `tsc --noEmit --pretty false` with a run manifest from `code-map manifest --kind tsc`. A bound LCOV report of the head (`code-map manifest --kind lcov`) gives the line coverage of the changed lines. A bound Istanbul JSON report (`coverage-final.json`, `code-map manifest --kind istanbul-json`) adds statement and function coverage. These two measures are information only, and no rating condition uses them. A changed code file that the reports do not measure never counts as covered. Refer to [verify a change](docs/verify.md).

To link a test case to an acceptance criterion of the request, write `[AC:<id>]` in its name. You can also write `// @ac <id>` in a comment directly above the case. The results then give the oracle of each case that a bound head report ran one label: `spec-linked`, `pre-existing`, `changed-with-change` or `unknown`. They also list the linked cases of each criterion with their status. The acceptance checks stay UNKNOWN under `static-baseline-v0`. For your own analysis of a run, read `code-map verify --context <run ID>`. It gives the request, the failed and unknown checks with their evidence IDs, and the next actions, in at most 256 KiB of JSON. Write your hypotheses into a file with evidence IDs from that context. Put the file in a folder that Git ignores, because a file in another folder changes the working tree that `verify` checks. Then name the file in `"hypotheses"` of the next request. Code-map marks each hypothesis grounded or ungrounded, and shows it as model output. A hypothesis never changes a check, a rating, the readiness or the exit code. Refer to [hypotheses of a language model](docs/verify.md#hypotheses-of-a-language-model).

A bound `npm audit --json` report adds advisories by severity to the results, as information only.

The section `tests` of the results lists weaker assertions and weaker Vitest or Jest settings in the change, flaky and slower test cases in the bound reports, and, with a bound runner discovery report (`--kind vitest-list`, `jest-list`, `playwright-list` or `mocha-list`), the discovered test files that did not run. No check reads this section: read it yourself before the handoff.

To give `verify` test results that Code-map ran itself, use `code-map run`. It runs one authorized command in the restricted worker: no network, closed credential folders, a clean environment, a private copy of the snapshot and fixed budgets. Only the user makes an authorization with `code-map authorize`. Do not run `code-map authorize` yourself: ask the user for the authorization ID and the exact command words. Then run `code-map run --authorization <ID> --head HEAD --kind junit --artifact <report> -- <the same words>`, and add `{ "run": "<run ID>" }` to `reportInputs`. Without a sandbox backend, `run` refuses to run: report that. A test run outside the worker is self-attested, not isolated. Refer to [run tests in the restricted worker](docs/run.md).

You can also use `code-map inspect` (or `code-map --json`) for a compact report on selected files or a change set. Repeat `--file` with exact repository-relative source paths, select `--change latest|branch|uncommitted`, and use `--out` to save JSON instead of printing it. Reports omit source bodies and full history, include evidence lines, and distinguish all-dependency cycles from value-dependency cycles. See [the inspection reference](docs/inspection.md) for the schema and limits. Static collection needs no server or model call.

The shared `analyzeProject(data)` and `createReport(data, selection)` exports in `lib/analysis.mjs` supply both CLI output and offline HTML inspection. Source metrics distinguish shadowed import bindings, declaration spans and imported hook call candidates. Shared-type entries identify a parent/child import pattern, not a mandatory refactor.

## Use the test-quality summary

`code-map inspect` adds `testSummary` and `tests` to each report. The summary is an investigation index, not a quality score: each finding has its kind of evidence, a source location, and for a function an existing test to start from. Refer to [the inspection reference](docs/inspection.md#test-quality) for the fields.

- **Before writing tests:** read `testSummary.nextSteps` and the `noFailureAssertion` observation. Each entry names the function, its failure exit lines and, when one exists, a test that already reaches it.
- **After writing tests:** inspect again. A function moves from `no-failure-assertion` or `unreached` to `direct` only when a running test has a failure assertion tied to it. Report the change in status as evidence, not the absence of findings.
- **Read the evidence kind.** `inventory` and `measured` are counts. `inferred` and `pattern` are leads that need a check in the code. `model` labels are judgments and never close a gap.
- **Report the limit.** The scan finds missing failure tests. It cannot judge whether an existing test checks the correct behavior.

For the optional model pass, run `code-map labels`. It prints each test file whose labels are missing, partial, unstamped or stale, with its cases. Write each case's intent (`happy`, `unhappy`, `edge` or `regression`) into the labels file, then run `code-map labels stamp`. After you review stale labels, refresh them with `code-map labels stamp --file <test file>`.

## Interpret the signals

An import is a possible dependency, including type-only imports. Cycles in this graph do not establish runtime initialization cycles. Namespace imports are possible references to every export, not proven calls. Co-change without an import link is correlation, not a demonstrated hidden dependency.

Test reachability is not executed coverage. A function body is not proof of correctness. Matching function, method and constructor overload implementations suppress declaration-only flags (static and instance scopes stay separate; abstract and ambient bodyless members remain flagged); reexports are not local missing bodies. Declaration-only exports can have external runtime providers that this parser does not resolve. `uses` retains all names for navigation; `valueUses` excludes explicit type-only imports and reexports, but does not prove execution.

For `inspect` and the map, LCOV is read from the working folder without revision or test-command binding: absent, invalid or zero-instrumented entries stay unknown, and commit maps and historical slider snapshots do not claim measured coverage. Even working-tree line hits prove neither assertions nor behaviour.

Operational pattern findings (`FETCH-NO-SIGNAL`, `INTERVAL-NOT-CLEARED`, `CATCH-EMPTY` and `EFFECT-NO-CLEANUP`) are syntax matches in one file. A wrapper, a comment elsewhere or another file can make one of them intentional, so read the code before you change it. A `SYNTAX-ERROR` finding or the `syntaxErrors` gap means that the facts of that file can be incomplete.

Dynamic wiring can escape the graph. Description freshness tracks exported names, so “current” does not certify unchanged behaviour. Confirm each suspected omission against source, contracts and real tests; retain the existing acceptance gates.

## Try it and measure

For a small paired trial, use independent reviewers with the same revision, scope, model and instructions. Give one the usual inputs and the other those inputs plus the Code-map report. Keep their notes separate until both finish. Compare confirmed unique findings, false alarms, time and preparation cost. Record examples where the map changed a decision; report a single pair as exploratory, not proof of a general quality gain.

## Bound Next.js build sizes

Run the project's build yourself, then run `code-map sizes --dir .next --out reports/sizes.json`.
Write its run manifest with `code-map manifest --kind sizes`, then add the report pair to the verification request.
Ignore build output and reports in Git before the build. Write each manifest immediately after its successful build.
A bound report on each side gives route growth, new routes, removed routes and static totals in `verify`.
One side gives values without changes. These observations do not affect readiness or ratings.
Refer to [bound size reports](docs/verify.md#bound-size-reports).

## Mutation evidence

Use `inspect` to find candidate tests before mutation testing. Authorize the exact command before `code-map mutate`.
Import Stryker reports with `code-map manifest --kind stryker-json`.
Survivors are leads. Equivalent mutants do not change behavior. Mutation information changes no static baseline rating.
Refer to [mutation testing](docs/mutation.md) for commands, binding and limits.

## Authorized verification

Authorized verification can run declared commands in the restricted worker through `execution.commands`.
An agent must use an existing authorization. It must not create an authorization for itself.
`regressionTests` and `generatedTests` record copied-test failure sensitivity as information. Fix checks stay UNKNOWN under `static-baseline-v0`.
Refer to [authorized execution](docs/verify.md#authorized-execution).

## Harness runs

Use `code-map harness --authorization <id> --spec <file>` only with an authorization from the user.
The exact authorized command is `node .code-map-harness/runtime.mjs`.
Read [the harness guide](docs/harness.md) for schemas and limits.
Harness results are finite observations. They do not change readiness under `static-baseline-v0`.

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
Refer to [contract evidence](docs/contracts.md) for formats and limits.

Use `code-map sbom --worktree --out bom.json` to export the selected lockfile inventory.
Frozen OSV snapshots use report kind `osv-snapshot` and a bound manifest in verification requests.
OSV matches and their base/head changes are information. Read [the matching limits](docs/verify.md#frozen-osv-snapshots).

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

## Run authentication information

Verification reports show manifest signature states, signer fingerprints and base/head environment differences.
An invalid signature or unknown signer excludes the report. Unsigned reports retain compatibility.
No new rule-set check reads the signature or environment information.
Read [run authentication](docs/run.md#manifest-signatures-and-environment) for `trustedRunKeys` and the optional disk budget.

## Migration and policy information

Read `MIGRATION-USE` findings for configured import and call replacements.
Read `comparison.policy` in a base comparison for revision rules, layers and forbidden import witnesses.
In verify results, read `migrations`, `publicInterfaces` and `policy`.
The optional request field `allowedPublicChanges` lists permitted public export names. Null or omission supplies no public scope.
These sections supply information only. They add no rule-set check or rating contribution.
See [the retrieval reference](docs/retrieval.md) for the syntax and limits.

Harness runs retain side effects and regression fixtures in the private run folder.
Use `zod-boundaries` for discovered schema cases and `fault` for declared global fetch failures.
Fuzz corpus guidance combines measured subject V8 blocks and outcome classes.
Reports retain cumulative block counts and corpus growth. Block coverage is not path coverage.
Table references never create human oracle confirmations.
See [the harness reference](docs/harness.md) for mode fields and limits.

## Discovery and regression information

Discovery also accepts Playwright list JSON and Mocha dry-run JSON.
Read `tests.discoveryAttestations` for command-bound counts on each side.
Read `tests.dependencies` for lockfile changes and the shared dependency policy of isolated runs.
Repeated JUnit identities with failed and passed attempts are flaky. Every attempt remains visible.

## Optional compiler facts

Use `inspect --types` or configure `typeCheck: true` for bounded compiler facts.
`typeBudgetMs` defaults to 10000 milliseconds. A budget stop returns UNKNOWN.
Compiler discovery, inferred exports, argument compatibility, and language-service references are informational in `verify`.
Bind `tsc --listFilesOnly` output with report kind `tsc-files` to identify checked files.
Release-policy annotations and unique rename pairs describe public API changes.
The accepted rule set stays unchanged. See [compiler facts](docs/types.md).

## Controlled command timings

Use `code-map bench --authorization <id> --runs 5 --warmup 1 --worktree -- <command...>` with an existing exact-command authorization.
Bench repeats the command sequentially in one restricted workspace and keeps an isolated `bench` report.
Add base and head run IDs to verification `reportInputs`.
Verification compares median times against noise and configured thresholds. Load drift or incompatible runs give UNKNOWN.
Timing observations do not affect ratings or readiness.
Refer to [controlled timings](docs/run.md#controlled-timings).

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
See [binding and matching limits](docs/retrieval.md#bound-compiler-diagnostic-lifecycle).

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
Read [observed transitions](docs/models.md#observed-xstate-transitions) for the report fields and limits.

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
Refer to [weakening reviews](docs/weakening-reviews.md) for record fields and limits.


## Evidence trust policy

Read each verification execution's `tier`, `eligible` and reasons before using its evidence.
Optional `.code-map.json` `trust` minimums match the exact first command word.
Authorization policies can raise minimums. An agent must use an existing authorization.
Tiers do not replace binding, oracle checks or the profile's isolation requirements.
Refer to [tool trust minimums](docs/verify.md#tool-trust-minimums) for the shared policy and tier definitions.

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
Read [contract evidence](docs/contracts.md) and [harness modes](docs/harness.md).

## Stored verification band comparison

Verification results include a schema-bound rubric and obligation scope.
Use `baselineReport` in a verification request to compare with an earlier run in the same output store.
Read compatibility reasons before using a band direction. Missing compatibility evidence and Unassessed bands stay UNKNOWN.
The baseline changes no rating or readiness result.
Refer to [the stored verification contract](docs/verification-contract.md).

## Audited quality evidence

Read [quality evidence](docs/quality-evidence.md) for generated-consumer searches, size deltas and revision ownership checks.
It also defines computed dependency uncertainty, frozen advisory provenance and optional `safeguards` policies.
Syntax observations never establish runtime PASS.
