# Verify a change

`code-map verify` checks one change, from a base commit to a head commit or the working tree, against a rule set. It gives four ratings and one readiness state, writes a report for people and a JSON file for tools, and exits with a code that a script can use.

The accepted default rule set is `static-baseline-v0`. The [rule-set proposal](work/2026-10-22-verify-profile-v0/proposal.md) explains each check, and the user accepted it on 2026-10-22. With this rule set, `verify` can stop a bad change, but it never gives READY. This rule set does not use human oracle records. `verify` runs project code only when execution is enabled with an existing authorization. Each command runs in the [restricted worker](run.md).

`verify` also records where the expected result of each test case comes from ([oracle provenance](#oracle-provenance)), and it can show the [hypotheses of a language model](#hypotheses-of-a-language-model). Neither one changes a v0 check, rating or readiness.

Bound [harness runs](harness.md) appear as information in the results and report. They do not change `static-baseline-v0`.
Fuzz information includes the retained corpus and per-call cumulative V8 block coverage progress.
Block coverage is not path coverage. These measurements add no rule-set check.

## Run it

1. Write a request file, for example `/tmp/request.json`. The [request](#the-request) section gives its fields.
2. Run the command inside the repository:

   ```sh
   code-map verify --request /tmp/request.json
   ```

3. Read the summary on standard output. It names the readiness state, the four ratings, the failed and blocking checks, and the paths of the two report files.
4. Open `verification-report.md` for the explanation of each result.

`verify` creates the base and head analyses, or reuses them from the analysis store, as `code-map inspect --summary` does. Refer to [summary-first inspection](retrieval.md) for the store. A new analysis takes the facts of unchanged files from the [file cache](retrieval.md#the-file-cache) of the store. The second analysis reuses file facts when their inputs and import targets match.

| Option | What it does |
| --- | --- |
| `--request <file>` | The request file. It is necessary |
| `--store <folder>` | Use this analysis store. The default is the same as for `inspect --summary` |
| `--out-dir <folder>` | Write the run folders here. The default is a folder for this repository in `verifications` inside the store. A folder inside the repository or inside its Git folders is refused, also through a symlink or another spelling of the path |
| `--no-cache` | Parse every file again, without the file cache of the store. The results are the same |
| `--context <run ID>` | Print the context of a finished run for a language model, and write nothing. Use it in place of `--request`. Refer to [context for a language model](#context-for-a-language-model) |
| `--compact` | Write the summary or the context without indentation |

## The request

The request is a JSON file.
The fields `hypotheses`, `regressionTests`, `generatedTests`, `allowedPublicChanges` and `baselineReport` are optional.
Other top-level fields are necessary. Unknown fields are errors.

```json
{
  "requestType": "code-map-verification-request",
  "schemaVersion": 1,
  "base": "main",
  "head": "worktree",
  "intent": "Move the session helpers to src/auth without a change in behavior.",
  "acceptanceCriteria": [],
  "allowedPaths": ["src/auth/**", "test/auth/**"],
  "changeType": "refactor",
  "profileId": "static-baseline-v0",
  "ratingRulesVersion": "ratings-v0",
  "reportInputs": [],
  "execution": { "enabled": false, "authorization": null, "budgets": { "wallClockSeconds": 600, "memoryMegabytes": 2048, "outputMegabytes": 64, "concurrency": 1 } }
}
```

| Field | Meaning |
| --- | --- |
| `base` | The base commit, branch or tag. It cannot be `worktree` |
| `head` | The head commit, branch or tag, or `worktree` for the files as they are now |
| `intent` | What the change must do, in your words |
| `acceptanceCriteria` | `{ "id", "text" }` entries. Each one becomes a required check. No version of this rule set can confirm them yet, so they stay unknown. A test case can name a criterion with a tag. Refer to [oracle provenance](#oracle-provenance) |
| `allowedPublicChanges` | Optional list of exact public export names, or `null`. Omission means `null`. This field supplies information only |
| `allowedPaths` | Repository-relative patterns of the files that the change may touch, or `null` when the scope is not declared. `**` matches any number of folders, `*` any characters inside one name, `?` one character. The match is case-sensitive and covers the whole path |
| `changeType` | `refactor`, `feature`, `fix` or `other`. It decides some required checks: a refactor needs evidence that behavior did not change, a fix needs a reproduction and a regression test |
| `profileId`, `ratingRulesVersion` | `static-baseline-v0` and `ratings-v0` |
| `reportInputs` | Bound test, compiler, coverage, discovery and size reports: `{ "artifact", "manifest" }` pairs of repository-relative paths, or `{ "run": "<run ID>" }` for a stored run of `code-map run`. Refer to [bound test reports](#bound-test-reports), [bound compiler reports](#bound-compiler-reports), [bound coverage reports](#bound-coverage-reports), [bound discovery reports](#bound-discovery-reports) and [bound size reports](#bound-size-reports) |
| `execution` | `enabled: false` imports reports only. Enabled execution needs an authorization ID and commands. Refer to [authorized execution](#authorized-execution). The four required budgets are whole numbers from 1 up to 86,400 seconds, 65,536 MB of memory, 1,024 MB of output and 64 workers |
| `regressionTests`, `generatedTests` | Optional arrays of `{ "file", "name"? }` declarations. Generated entries also accept `mutationAuthorization`. They record test sensitivity as information |
| `hypotheses` | Optional. The repository-relative path of a file with the hypotheses of a language model. Refer to [hypotheses of a language model](#hypotheses-of-a-language-model) |

## Authorized execution

Only a person creates an authorization. An agent must use an existing authorization.
Refer to [authorize a command](run.md#authorize-a-command) for expiry, budgets and withdrawal.

1. Authorize the exact test command in this repository:

   ```sh
   code-map authorize --wall-clock-seconds 60 --command node --test --test-reporter=junit --test-reporter-destination=junit.xml
   ```

2. Put the returned authorization ID into the request:

   ```json
   "execution": {
     "enabled": true,
     "authorization": "AUTH-0123456789abcdef",
     "budgets": { "wallClockSeconds": 60, "memoryMegabytes": 2048, "outputMegabytes": 8, "concurrency": 1 },
     "commands": [{
       "id": "tests",
       "words": ["node", "--test", "--test-reporter=junit", "--test-reporter-destination=junit.xml"],
       "kind": "junit",
       "artifact": "junit.xml",
       "sides": ["base", "head"]
     }]
   },
   "regressionTests": [{ "file": "test/bug.test.mjs", "name": "rejects the bad input" }],
   "generatedTests": [{ "file": "test/generated.test.mjs" }]
   ```

3. Run `code-map verify --request <file.json>` with the authorization store through `--store`, when necessary.

Each command has a unique ID, exact command words, report kind, relative artifact path and distinct sides.
The kinds are `junit`, `jest-json` and `vitest-json`. A request lists 1 to 16 commands.
One authorization allows one exact command. Different command words need a separate verification request and authorization.
Commands run sequentially. Each run has its own budgets, bounded by the authorization.
The concurrency budget limits active worker slots. It does not make these commands run in parallel.
The worker refuses an expired authorization, different words, excessive budgets or an unavailable sandbox.
It never falls back to unrestricted execution.

### Impact and baseline test selection

Set `execution.commands[].baselineSuite` to explicit repository-relative test paths.
An empty list selects impact tests only. The list accepts at most 200 unique paths.
Put one whole-word `{testFiles}` selector in that command's `words`.
For example, use `["node", "--test", "{testFiles}"]` with `baselineSuite: ["test/smoke.test.mjs"]`.
Code-map joins baseline paths with affected tests from both revision graphs.
The sorted union defines the selected file denominator on both sides.
Authorize the exact expanded words. Authorization of template words does not authorize expanded words.
Empty selections and commands over 256 words are refused. An empty selector never runs the full suite.
Existing commands without `baselineSuite` retain their exact words.

`executionRuns[].selection` discloses the policy, baseline paths, impact paths, selected files and total.
An incomplete impact walk gives `state: "UNKNOWN"` with a reason.
`selection.observed` gives per-file passed, failed and skipped counts for a collected report.
Missing file-level outcomes give UNKNOWN and a list of missing paths.
Refused runs have no observed outcomes. Each attempt retains its own record and stored artifact.
Deleted or renamed tests absent from one revision remain selected. A missing file cannot establish a passing result.

The base uses its commit files. The head uses its commit files or the working tree.
The worker supplies the clean environment and Node.js runtime for both sides.
Normal runs become isolated reports for the existing checks, including "No new test failures".
The command, tools and environment match for comparisons.
By default, both runs use the working folder's installed dependencies.
For revision-specific preparation, authorize and pass `--install offline --npm-cache <folder>`.
Alternatively, set `execution.install` to `offline` and `execution.npmCache` to the named cache folder.
CLI options must match an existing request policy. Install options require enabled execution.
Each side runs offline npm ci in its sandbox before the command. Lifecycle scripts never run.
Missing cached packages fail preparation and preserve npm output. See [offline preparation](run.md#prepare-revision-dependencies-offline).
`executionRuns[].dependencies` records each revision SHA, lockfile, module mode and install result.
Preparation information adds no profile check. Lockfile changes remain visible in snapshot binding.

`executionRuns` records each attempt, side, command ID, run ID, stop budget and refusal reason.
A stopped or refused run supplies no report evidence. A completed command can still have failing tests.
`executions` gives report binding and parsing results. Read both sections when a report gives no evidence.

For a fix, Code-map copies the named head test files into a separate base workspace and runs the same command.
It also runs the command on the head, even when `sides` lists only the base.
For other change types, declared tests run on the head only for validation.
The command selects the tests. Declarations do not add command filters or force discovery.
A declaration without `name` selects all reported cases in that file.
Code-map uses reported file paths and exact case names. Missing or skipped cases give no confirmation.
With Node.js JUnit, put cases in `describe()` blocks. Top-level cases produce unsupported JUnit structure.

`testValidation` records each declaration, command ID, both outcomes, cases, run IDs and the confirmation reason.
A copied test that fails on the base and passes on the head confirms failure sensitivity when its case identities match.
`caseResults` records each matched case by file, suite, name and position among duplicate names.
Missing cases or different identities prevent confirmation.
A test that passes on the base proves nothing about the bug.
Generated tests use the same mechanism. For a fix, they need a base failure and a head pass.
For other changes, their head result records whether they pass.

Copied-test runs have a distinct digest. They never bind as reports of the unchanged base snapshot.
They are information only. The fix checks of `static-baseline-v0` stay UNKNOWN.
Confirmation does not validate the test oracle, prove the intended cause or replace independent review.

Test paths must stay inside the workspace. Code-map refuses symlinks, traversal, `.git` and `node_modules` components.
Each declaration list has at most 100 entries. The combined copy has at most 100 distinct files.
A file has at most 2 MiB. The total copy has at most 16 MiB.
The copy replaces only the declared files. It does not copy new helpers or change dependencies.
A shared helper absent from the base can make the test fail for an unrelated reason.
Refer to [worker limits](run.md#what-the-worker-does-not-isolate) for the isolation boundary.

## Bound test reports

A test report counts as evidence only with a run manifest that ties it to the analyzed code. Code-map reads JUnit XML and the JSON output of Jest (`--json`) and Vitest (the JSON reporter). For imported reports, you run the tests and `code-map manifest` writes the manifest. Enabled execution uses the restricted worker instead.

1. Make sure that Git ignores the folder of your reports, for example with `reports/` in `.gitignore`. A report in a folder that Git does not ignore changes the working tree, and the manifest then no longer matches it.
2. Run the tests of the head yourself, and write the report into that folder. For example: `npx vitest run --reporter=junit --outputFile=reports/junit.xml`.
3. Write the manifest at once, before you change any file. Give the exit status of the test run and, after `--`, its command:

   ```sh
   code-map manifest --artifact reports/junit.xml --kind junit --exit-status 1 --out reports/junit.manifest.json -- npx vitest run --reporter=junit
   ```

4. Add the pair to the request: `"reportInputs": [{ "artifact": "reports/junit.xml", "manifest": "reports/junit.manifest.json" }]`.
5. Run `code-map verify`. The `executions` of the results show each report with its binding state and the reasons why it does or does not count.

`code-map manifest` runs nothing. It records the command words, the commit and the repository-relative invocation folder as `workingDirectory`.
Run it from the same folder as the reported command. Artifact and output paths remain relative to the repository root.
Jest and Vitest reports accept relative paths with forward slashes or backslashes. Stored case paths use forward slashes.
It computes digests of changed files, Code-map settings, the lockfile and the report.
`--kind` accepts `junit`, `jest-json` and `vitest-json` for test reports.
Use `tsc` for a [compiler report](#bound-compiler-reports), or `lcov` or `istanbul-json` for a [coverage report](#bound-coverage-reports).
Use `sizes` for a [size report](#bound-size-reports).
`--discovery <text>` describes which tests the run selected. Each `--filter <text>` names one filter of the run.
A run with a filter is a filtered run. Some rating conditions do not accept filtered runs.
Use `npm-audit` for [npm audit reports](#npm-audit-reports), or `osv-snapshot` for [frozen OSV snapshots](#frozen-osv-snapshots).
Use `vitest-list`, `jest-list`, `playwright-list` or `mocha-list` for a [discovery report](#bound-discovery-reports).

A report counts as evidence only in these conditions:

- The manifest matches the analyzed head (or the base): the same commit, the same working-tree digest, the same settings and lockfile digests, and the report digest is in the manifest.
- Code-map can read the report.
- The manifest records an exit status and the discovery.
- An exit status of 0 does not come with a failed case.
- Declared test counts agree with the test cases.
- Jest and Vitest reports have no failed test file without a failed case.

### Isolated reports from code-map run

`code-map run` runs the tests in the restricted worker and keeps the report and its run manifest in the store. Refer to [run tests in the restricted worker](run.md).

1. Ask the user to authorize the test command once: `code-map authorize --command node --test --test-reporter=junit --test-reporter-destination=junit.xml`.
2. Run it for the head: `code-map run --authorization <ID> --head HEAD --kind junit --artifact junit.xml -- node --test --test-reporter=junit --test-reporter-destination=junit.xml`.
3. Add the run ID from the summary to the request: `"reportInputs": [{ "run": "R-20261022T101010Z-0123abcd" }]`.
4. Run `code-map verify` with the same store.

Code-map wrote the manifest of an isolated report, so its label is "isolated". A manifest that your own test run wrote stays "self-attested", also when it claims another policy. The rule set counts both labels the same. A run of another repository, a run without an artifact, and a run whose artifact no longer has the digest in its record do not count. The `executions` of the results give the reason.

A report of the base commit counts for the base: a failed case that the base report of the same command, tools and environment also has is an earlier failure, not a new one. One request can name at most 64 reports, 256 MiB of reports and 400,000 test cases. One report can have at most 50 MiB. A coverage report and a discovery report count toward the reports and the bytes. Each extra report does not count, and the results say why.

Failure matching counts repeated case identities. Repeated base attempts do not add their counts together.
When no usable file path exists, JUnit class names distinguish cases with the same suite and name.
Code-map normalizes relative and absolute file-derived suite paths. A file rename also renames that suite path. Committed and detected unstaged renames use the same mapping.
Object key order in tool and environment records does not change run identity. Command and array order still matter.
These rules apply to `static-baseline-v0` and `evidence-v1`.

Two or more bound head reports of the same command, tools and environment are attempts of one run, for example a run and its retry. Each failed case of each attempt counts as a failure: a passed retry never replaces a failed result. The section [test information](#test-information) of the results lists the flaky cases and the slower cases.

Code-map compares case outcomes in bound base and head reports of the same run.
The report kind, command, working folder, tools and environment must match.
Code-map matches each case by file, suite and name, and follows renamed test files.
It groups `errored` with `failed`.
Across attempts, a failure takes priority over a pass, and a pass takes priority over a skip.
A case is `missing` when no paired report on that side contains its key.
The comparison also counts new head cases, for example `missing>passed`.
It marks a missing head case with `deleted: true` when the change deletes its test file.

The `tests.outcomes` field gives transition counts, a total and at most 50 changed cases.
Its `basePassesLost` list keeps up to 50 base passes now skipped or missing, with their total.
Its state is `COMPARED` when a pair exists and at least one paired report has test cases, even when no outcome changes.
Without a paired base report, its state is `UNKNOWN` and it gives a reason.
When all paired reports have no test cases on both sides, its state is `UNKNOWN` with a reason that states that the paired reports have no test cases.
Cases in unpaired reports do not establish a comparison.
The Test information row gives transition counts and names up to three base passes now skipped or missing.
These outcomes are information only. They do not change checks, ratings or readiness in either rule set.

## Bound size reports

A size report records build assets in bytes and gzip bytes. Code-map reads existing files and runs no build.

1. Ignore `.next/` and `reports/` in Git before you build. Reports and build output must not change the source digest.
2. In the base checkout, run the project's build command. For example, run `npm run build`.
3. After a successful build, write the size report and its run manifest immediately:

   ```sh
   code-map sizes --dir .next --out reports/base-sizes.json
   code-map manifest --artifact reports/base-sizes.json --kind sizes --exit-status 0 --out reports/base-sizes.manifest.json -- npm run build
   ```

4. Preserve both files. Move to the head checkout, then build and write its pair:

   ```sh
   npm run build
   code-map sizes --out reports/head-sizes.json
   code-map manifest --artifact reports/head-sizes.json --kind sizes --exit-status 0 --out reports/head-sizes.manifest.json -- npm run build
   ```

5. Copy the preserved base pair into the head checkout's ignored `reports/` folder when you use separate checkouts.
6. Add both pairs to the verification request:

   ```json
   "reportInputs": [
     { "artifact": "reports/base-sizes.json", "manifest": "reports/base-sizes.manifest.json" },
     { "artifact": "reports/head-sizes.json", "manifest": "reports/head-sizes.manifest.json" }
   ]
   ```

7. Run `code-map verify --request <file>`. Set the request's base and head to the snapshots that produced these reports.

The report has `reportType: "code-map-sizes"` and `schemaVersion: 1`.
`buildId` comes from `BUILD_ID`. `nextVersion` comes from `diagnostics/framework.json`, or is `null` when absent.
`formats` lists the manifest formats read. `files` lists each static asset with its path, bytes and gzip bytes.
`routes` lists each route, its JavaScript files, bytes and gzip bytes.
Client reference builds also include route `css`, with files, bytes and gzip bytes.
`unsupported` lists page URLs without route data and gives each reason. Older reports can omit these fields.
`totals` gives file counts, bytes and gzip bytes for chunks, CSS and media.
CSS totals include every `.css` file under `static/`. Chunk and media totals use their folders, so categories can overlap.
Gzip totals sum separately compressed files with Node.js zlib's default settings. They do not measure HTTP transfer or browser timing.

A JavaScript asset can have `sources`, from its adjacent `.js.map` file.
Code-map reads version 3 maps and embedded indexed sections. It never fetches external map URLs.
It removes webpack prefixes and rejects absolute or traversal source names. Malformed adjacent maps stop size collection.
These reads use the existing file and byte budgets.

With exactly one bound head report, `bundle.state` is `HEAD_BOUND`.
`bundle.unusedChunks` lists JavaScript chunks that no reported route uses.
`bundle.reachedOrphans` lists static orphan leads contradicted by route chunk names or source-map paths.
Each lead names its `chunk` and `via`: `chunk-name` or `source-map`.
A chunk-name match requires the complete source stem, with an optional hexadecimal build hash.
These leads explain static findings. They do not change stored findings, checks, ratings or readiness.
A chunk absent from route first loads can still load later. No unused-chunk observation proves dead code.
A base-only report gives `UNAVAILABLE`. Multiple head reports give `AMBIGUOUS`, without selecting evidence.

Verification JSON also includes `complexity.areas` and the head `completeness` table.
Supported stacks with skipped, malformed or dynamically unresolved counts add uncertainty warnings to `gaps` and the Markdown limits. Stacks that Code-map does not analyze, such as CSS and other files, share one line with their counts.
Refer to [cognitive totals and discovery completeness](retrieval.md#cognitive-totals-for-files-and-folders) for their fields.

Supported manifest formats:

| File | Shape and source |
| --- | --- |
| `app-path-routes-manifest.json` | Maps App Router page and handler entries to URLs |
| `server/app/**/page_client-reference-manifest.js` | JSON assignment wrapper with `entryJSFiles` and `entryCSSFiles`, including shared layouts |
| `app-build-manifest.json` | Legacy App Router shape: `{ "pages": { "/home/page": ["static/chunks/home.js"] } }` |
| `build-manifest.json` | Pages Router `pages`, `polyfillFiles` and `lowPriorityFiles`, plus App Router `rootMainFiles` and optional `rootMainFilesTree` |
| `fallback-build-manifest.json` | The same build shape, used only when `build-manifest.json` is absent |

Installed Next.js 16.2.4 source establishes the newer shapes.
Its `dist/server/get-page-files.d.ts` defines `BuildManifest` and `rootMainFilesTree`.
Its `dist/shared/lib/turbopack/manifest-loader.js` writes the build and fallback files.
Its `dist/server/app-render/required-scripts.js` selects per-page roots from `rootMainFilesTree`.
Its `dist/pages/_document.js` selects Pages Router page, shared, polyfill and low-priority scripts.
Its `dist/build/webpack/plugins/build-manifest-plugin.js` assigns `rootMainFiles` to the App Router runtime.
Its `dist/diagnostics/build-diagnostics.js` writes the framework version.
Hand-written fixtures in `test/sizes.test.mjs` and `test/sizes-next16.test.mjs` exercise the supported shapes.
The Next.js 16.1.6 client reference shape comes from the task contract, without a local Next.js runtime trial.

Pages Router first loads include the page, `/_app`, polyfills and low-priority scripts. They exclude App Router roots and internal pages.
App Router first loads include page chunks, ancestor layouts and templates, roots and polyfills.
Client reference routes use URLs from `app-path-routes-manifest.json`. Their first loads union `entryJSFiles`, `rootMainFiles` and `polyfillFiles`.
Their CSS comes from `entryCSSFiles`. Route handlers appear with zero client bytes.
Legacy App Router entries also use mapped URLs when the path manifest exists.
Without it, legacy paths remove route groups and parallel slot names. Duplicate URL paths combine their assets.
Only `.js` files count toward first-load JavaScript. Every union counts each path once.
These counts describe manifest assets, not runtime execution, caching, compression configuration or browser timing.
No JavaScript manifest is evaluated. Client references accept only the initialization line followed by one keyed JSON object assignment.
The key must match the page entry. Other syntax fails with a clear error.
The report records this format as `page_client-reference-manifest.js`.
Other JavaScript manifests, including `_buildManifest.js`, are not parsed.
Turbopack's partial `client-build-manifest.json` is not a build-root manifest and is unsupported.
Missing client reference files produce `unsupported` notes unless an older format supplies route data.
Builds without any supported build manifest fail. Interception rewrites and route timing remain outside this slice.

The reader refuses paths outside the build folder, including symlinks. Directory symlinks are unsupported.
Limits are 20,000 files, 40,000 directory entries, 512 MiB total input and 64 MiB per file.
Manifests and metadata count toward the file and byte limits. Missing assets and invalid manifests fail the command.
An explicit `null` manifest or asset collection is invalid. Only absent optional collections use empty defaults.

The `sizes` section of verification results compares one bound report on each side.
Routes sort by byte growth. Each change has bytes, percent, gzip bytes and gzip percent.
A zero base gives a `null` percentage. New and removed routes have no change percentage.
The Markdown report lists at most five changed routes and all three static totals. JSON keeps the complete lists.
A report on one side gives values without changes. Multiple reports on one side give `AMBIGUOUS`, without choosing a report.
A report that matches both sides binds to the head, as other report kinds do.
Size reports remain self-attested information. They add no check, threshold or rating condition to `static-baseline-v0`.

## Bound coverage reports

Code-map can use two kinds of coverage report of the head. Jest, Vitest, c8 and nyc can write both kinds.

- An LCOV report (`lcov.info`, kind `lcov`) gives line coverage and branch coverage of the change. With `FN` records, it also gives function coverage.
- An Istanbul JSON report (`coverage-final.json`, kind `istanbul-json`) gives statement coverage, branch coverage and function coverage of the change. It gives no line coverage.

As for a test report, a coverage report counts only with a run manifest that ties it to the analyzed code. A coverage report is not a test report: it gives no test case, and the test checks do not read it.

1. Make sure that Git ignores the folder of the reports, for example with `coverage/` in `.gitignore`.
2. Run the tests of the head with coverage yourself. For example: `npx vitest run --coverage --coverage.reporter=lcov --coverage.reporter=json`.
3. Write a manifest for each report at once, before you change any file:

   ```sh
   code-map manifest --artifact coverage/lcov.info --kind lcov --exit-status 0 --out coverage/lcov.manifest.json -- npx vitest run --coverage
   code-map manifest --artifact coverage/coverage-final.json --kind istanbul-json --exit-status 0 --out coverage/istanbul.manifest.json -- npx vitest run --coverage
   ```

4. Add the pairs to `reportInputs` in the request, together with the test report of the head.
5. Run `code-map verify`. The `executions` of the results show each report with its binding state. The `coverage` section of the results and the section "Coverage of the changed code" of the report show the numbers.

The `tests.runtimeLinks` field compares static test imports with bound head coverage. A trace must name exactly one known test file in `discovery.filters` or `discovery.selection.files`. Use the exact repository-relative test path. A selection must have state `KNOWN`. If both fields contain paths, they must name the same test. Code-map never infers a test file from command text, discovery scope or covered paths.

For each attributed test file, `links` lists source paths with state `confirmed`, `not observed` or `runtime only`. A source file executed when an LCOV line or an Istanbul statement has a positive count. Static imports include transitive imports. Several traces of one test use the union of executed source files. Coverage of test files and paths outside the source inventory does not add a link. A static link with no executed line or statement is `not observed`, including a source file absent from the report. This state describes only the supplied traces. It does not prove that the link is false.

Only test files with a trace are listed. `untraced` counts the known test files without a trace. `counts` gives the number of links in each state for all traced test files. `files` keeps the first 50 traced test files, and each file keeps its first 200 links, with the full count in `linkTotal`. The overall state is `KNOWN` when at least one test file has a trace. Otherwise it is `UNKNOWN`, with a reason. The Markdown report gives a short summary. These links are information only. They do not change checks, ratings or readiness, and they do not prove that a test asserts a result in an executed file.

The rating conditions of Verification Coverage use only line coverage and branch coverage (decision 6 of the rule-set proposal). Statement coverage and function coverage are information only. Thus a rating needs a bound LCOV report. With an Istanbul JSON report alone, Verification Coverage stays Unassessed.

Code-map maps the reports to the change with these rules:

- A changed line is a line that the change adds or modifies in a changed code file of the head. Code-map gets the lines from the Git diff between the base and the head. For the working tree, each line of a new file that Git does not track is a changed line.
- A changed code file is a JavaScript or TypeScript file that is not a test file and not a declaration file. Code-map uses its own test-file rule (for example `*.test.ts` or a file in `test/`).
- Line coverage: a changed line is executable when an LCOV report has a `DA` record for it. It is covered when its count is more than 0. A `DA` record counts a line, not a statement, so Code-map never computes statement coverage from `DA` records.
- Statement coverage: a changed statement is an entry of `statementMap` whose source range touches a changed line. It ran when its count in `s` is more than 0. For example, an `if` statement on lines 3 to 5 touches a change of line 4.
- Branch coverage in LCOV: a changed branch is a `BRDA` record on a changed line. It is covered when its count is a number more than 0. The count `-` means that the branch was not taken.
- Branch coverage in Istanbul JSON: a changed branch is a location of `branchMap` that touches a changed line, with its count in `b`. The `else` of an `if` without an `else` has no location, so it takes the location of the `if`.
- Function coverage: a changed function is a function whose range touches a changed line. It ran when its count is more than 0. In Istanbul JSON, the range goes from the start of `decl` to the end of `loc` in `fnMap`, so a changed line in the body counts.
- In LCOV, an `FN` record gives the start line and the name of a function. LCOV 2 also gives the end line. `FNDA` gives the count of a name. Without an end line, the function ends where its joined function of the analysis ends, or else on its start line.
- The join: Code-map joins each changed function to the function of the head analysis with the same file and start line. The analysis records the start and end lines of each function. The join is `exact` when one function matches. It is `ambiguous` when the analysis or the report has more than one function that starts on that line. It is `missing` when the analysis has no function there, for example for a callback in a top-level call.
- One source for each file: when an Istanbul JSON report measures a file, the branches and functions of the file come from it. Code-map then does not use the `BRDA` and `FN` records of that file. It never adds the two kinds together, and the results record the source of each file.
- A changed code file with changed lines but without an `SF` record in an LCOV report is not measured for line coverage. Code-map never counts it as covered. Then the two coverage conditions are not met, and Verification Coverage cannot reach 3 of 5. For each other measure, the results list the files that no report measures. The report names these files for statement, function and branch coverage.
- An `SF` path or an Istanbul file path can be absolute, or relative to the working directory of the run. Code-map ignores each path outside the repository, and it counts these paths.
- The rating input `coverage` excludes Istanbul entries with `inputSourceMap`. The informational `coverageEvidence` view remaps their counters before joining changed lines. Unsupported maps and unmapped measurements remain explicit gaps. Refer to [measured coverage information](coverage.md).
- Only a bound report of the head gives rating input. A bound base report supplies informational comparisons in `coverageEvidence`. When two or more reports of one kind measure one file, a line, a statement, a branch or a function is covered when one report covers it.
- The thresholds of `static-baseline-v0` are 80% of the changed executable lines for 3 of 5, and 70% of the changed branches for 4 of 5. A change without a changed executable line gives no result for the line condition, so the rating stays below 3.

Code-map reads an Istanbul JSON report strictly. Each file entry must have `path` (the same path as its key), `statementMap`, `s`, `fnMap`, `f`, `branchMap` and `b`. Each count object must have one count for each entry of its map, and each count must be a whole number from 0. A branch must have one count for each location. Each location must have a start line and an end line from 1, and the end must not come before the start. On one line, a known end column must not precede a known start column. Code-map does not read other fields, such as `hash` or `_coverageSchema`. A report that breaks one of these rules, or a report without a file entry, does not count, and its execution record says why. One report can have at most 50 MiB, as for the other reports.

The `coverage` section of `verification-results.json` has these fields. When the request has no bound coverage report of the head, `coverage` is `null` and Verification Coverage stays Unassessed.

| Field | Meaning |
| --- | --- |
| `measure` | Always `line coverage`: the measure of `changedLines` |
| `reports` | The bound coverage reports of the head that give the coverage |
| `lineReports` | The bound LCOV reports in `reports`. Only these give line coverage. Without one, the rule set gets no coverage, and Verification Coverage stays Unassessed |
| `changedLines` | `covered`, `total`, `share` and `threshold`. The share is a percentage with one decimal, rounded down. It is `null` when the total is 0 |
| `changedBranches` | The fields of `changedLines`, and also `sources` and `files`. `sources` gives the number of files whose branches come from each kind of report (`lcov` or `istanbul-json`). `files` has `measured` and `unmeasured`, the paths of the files that no report measures |
| `changedStatements` | `measure` (`statement coverage`), `covered`, `total`, `share` and `files`. It has no threshold. It is `null` when no bound Istanbul JSON report of the head exists |
| `changedFunctions` | `measure` (`function coverage`), `covered`, `total`, `share`, `files` and `join`. `join` gives the number of `exact`, `ambiguous` and `missing` joins. It has no threshold. It is `null` without a bound Istanbul JSON report of the head and without `FN`, `FNDA` or `FNF` records for a changed file |
| `files` | `total`: the changed code files with changed lines. `measured`: the files with an `SF` record. `unmeasured`: the paths of the other files. `details`: each file that a report measures. Refer to the next table. The lists have at most 50 files |
| `outsideRepository` | The number of report paths outside the repository |

Each file in `files.details` has these fields:

| Field | Meaning |
| --- | --- |
| `path`, `source` | The file, and the kind of report that gives its branches and functions |
| `lines`, `branches`, `statements`, `functions` | `covered` and `total` of each measure. A measure that no report gives for the file is `null` |
| `uncoveredLines`, `uncoveredBranches`, `uncoveredStatements` | At most 20 uncovered lines, branches and statements. An LCOV branch is `line:block:branch`. An Istanbul JSON branch is `line:branch:path`, with the line of the branch, its key in `branchMap` and the index of its location. A statement is its start line |
| `functionJoins` | At most 20 changed functions: `name`, `line`, `covered`, `join`, and `analysis`, the name path of the function of the analysis for an exact join |

The execution record of a coverage report has `cases: null` and `coverage: { files, outside }`: the number of files in the report, and the number of paths outside the repository. The record of an Istanbul JSON report also has `sourceMapped`.

The working-folder coverage of `inspect` is not evidence for `verify`. When a bound coverage report of the head exists, the coverage gap of the head analysis in `gaps` says that the coverage of the change comes only from the bound reports.

## Additional measured coverage

`coverageEvidence` gives project totals, remapped changed counters, unexecuted exports and adjusted base comparisons.
These observations do not add checks or change rating inputs under either profile.
Refer to [measured coverage information](coverage.md) for fields, page limits and source map support.

## Bound compiler reports

The check "Types are compatible" (`structure.types-compatible`) reads the text output of the TypeScript compiler. Its report kind is `tsc`. Code-map does not run the compiler. You run it, and `code-map manifest` writes the manifest, as for a test report.

1. Make sure that Git ignores the folder of your reports, for example with `reports/` in `.gitignore`.
2. Run the compiler on the head in the root folder of the repository, with `--pretty false`. Write its standard output into that folder. For example: `npx tsc --noEmit --pretty false > reports/tsc.txt`. For a project with project references, run `npx tsc -b --pretty false`. `code-map manifest` records its invocation folder as the working folder of the run. For a run below the repository root, invoke `code-map manifest` from that same folder.
3. Write the manifest at once, before you change any file. Give the exit status of the compiler run and, after `--`, its command:

   ```sh
   code-map manifest --artifact reports/tsc.txt --kind tsc --exit-status 2 --out reports/tsc.manifest.json -- npx tsc --noEmit --pretty false
   ```

4. Add the pair to `reportInputs` in the request, next to the test reports.
5. Run `code-map verify`. The `executions` of the results show the compiler report with its binding state. For a compiler report, `errors` is the number of error diagnostics, and `outside` is the number of diagnostics outside the repository.

Code-map reads these lines of a compiler report:

- A diagnostic: `path(line,column): error TS1234: message`. Code-map also reads the categories `warning`, `suggestion` and `message`, but only an error counts for the check
- An indented line after a diagnostic, which continues its message
- A diagnostic without a file, for example `error TS5058: The specified path does not exist`
- The summary line `Found N errors`. Its number must be equal to the number of error diagnostics
- Empty lines

Code-map refuses a report with another line, for example colored output without `--pretty false` or the lines that `npm run` adds. It also refuses a path with a control character. A path is relative to the working folder of the run (`workingDirectory` in the manifest), or it is absolute. Code-map reads a path with backslashes as a Windows path. A diagnostic outside the repository does not count for the check, but the results count it.

A compiler report counts as evidence in the same conditions as a test report. Thus, a run with exit status 0 and an error diagnostic does not count, because the report and its manifest disagree. The limits of the test reports also apply, and at most 400,000 compiler diagnostics count for one request. The checks of the test reports never read a compiler report.

The type check gives these results:

| Result | When |
| --- | --- |
| FAIL | A bound head report has an error in a changed file or in a file that imports a changed file. The importers come from the head analysis. For a deleted or moved file, they also come from the base analysis. A test file that imports a changed file is an importer too |
| UNKNOWN | No bound head report exists, a head report has an error without a file, a head report has a syntax or settings error in another file, a head run did not end with exit status 0 but its report has no error, or each head report comes from a run with a filter |
| PASS | No case of FAIL or UNKNOWN applies. Type errors in other files and diagnostics outside the repository do not change the result, but the rationale counts them |
| NOT_APPLICABLE | The project has no TypeScript file, and the request gives no bound compiler report of the head |

The compiler reports type errors only when the program has no syntax error and no error in its settings or its file list. Thus, such an error in another file can hide a type error in a changed file. Code-map reads an error in another file as a syntax or settings error in these conditions:

- The file is not JavaScript or TypeScript, for example `tsconfig.json`
- The code is from TS1000 to TS1999, from TS8000 to TS8019 or from TS17000 to TS17999 (syntax)
- The code is from TS5000 to TS6999 (settings and files), but it is not a code of an unused declaration, for example TS6133

When a bound base report has the same error, the check names it as an earlier error. The same error has the same file (after a rename), the same code and the same message. The result does not change: an earlier error in a changed file also fails the check.

The type check is required, but it does not block. Structural Integrity needs a PASS of it for 3 of 5 (decision 4 of the rule-set proposal). A bound compiler report without such errors thus allows 3 of 5, and an unfiltered bound test run then allows 4 of 5. For a feature, the consumer-contract check takes the place of the type check, so a compiler report does not change the checks of a feature.

## Oracle provenance

An oracle is the expected result of a test: the value or the condition that an assertion checks. `verify` records where the oracle of each test case comes from. Each case that a bound head report ran (a case that is not skipped) gets one label:

| Label | When |
| --- | --- |
| `spec-linked` | The name of the case, or a comment directly above the case, names an acceptance criterion of the request with `[AC:<id>]` or `@ac <id>` |
| `pre-existing` | The base has the same case, and the change did not edit it. The same case has the same file (after a rename), suite, name, number of assertions and text |
| `changed-with-change` | The change added the case, or it changed the text or the number of assertions of the case |
| `unknown` | Code-map cannot tell. For example, the report gives no file for the case, or the head analysis has no case with that name in that file |

Write a tag in one of these two ways:

- In the name of the case, for example `test('signs in [AC:login]', ...)`.
- In a comment directly above the case, for example `// @ac login`. No empty line can be between the comment and the case.

The ID in a tag must be the `id` of an acceptance criterion in the request, with the same letters and the same case. A tag with another ID links no criterion, and the results count it in `unknownCriteria`. After `@ac`, the ID ends at a space or at the end of the line. Thus `@ac login.` names the ID `login.`, not `login`.

To find a case, Code-map compares the file and the name of the report case with the test scan of the head analysis. The name in the report must be equal to the name of the scanned case. It can also be equal to the suite and the name of the case, with " > " between them. A runner that makes names from a table (`test.each`) gives other names, so these cases are `unknown`.

Under `static-baseline-v0`, the labels do not change a check, rating or readiness. The user decided that a test that was added with the implementation does not count less. Each acceptance check (`acceptance.<id>`) stays UNKNOWN. Its rationale names the linked cases that passed and that failed, and its evidence IDs include their `case:` IDs. A linked case that passed does not confirm its expected result.

The `provenance` section of `verification-results.json` has these fields. The report shows the counts in the row "Test oracles" of the section "What Code-map compared".

| Field | Meaning |
| --- | --- |
| `total`, `counts` | The number of cases that the bound head reports ran, and the number of cases with each label |
| `cases` | For each label, at most 50 cases. Each case has its `case:` evidence ID, file, suite, name, status and `origin` (`pre-existing`, `changed-with-change` or `unknown`). A linked case has its `criteria`, and an unknown case has a `reason` |
| `criteria` | For each acceptance criterion: the number of linked cases, the number that passed and failed, and at most 20 linked cases |
| `unknownCriteria` | At most 20 IDs of tags that name no criterion of the request, each with its number of cases |
| `assertions` | Assertion records for matched cases in bound head reports. Each record has its case evidence ID, file, start line, text, `specification` (the first criterion or null), all `specifications`, Git `author` and `commit`, and `implementationChanges` |
| `assertionLimits`, `assertionsTruncated` | At most 200 assertion records from 20 test files. Each commit lists at most 50 non-test files. `implementationChangesTruncated` identifies a clipped commit list |

The assertion scan includes recognized assertions in local helpers. It does not trace external fixtures or custom assertion implementations.
Git blame reads each assertion start line at the requested head revision. A working-tree edit has null author and commit fields.
`implementationChanges` lists non-test paths changed by that assertion's commit, rather than all paths of the verification change.
Missing Git attribution gives null fields and a reason. A working-tree test file larger than 8 MiB has no assertion records.
Each assertion has `trust: "unconfirmed"`. Tags and Git authorship do not establish independent oracle truth.
These records change no check, rating, band or readiness under either rule set.

## Hypotheses of a language model

A language model can give hypotheses about a change: risks, missing tests, a mismatch with the intent, or other claims. Write them in a file, and name the file in the request: `"hypotheses": "reports/hypotheses.json"`. Put the file in a folder that Git ignores, as for the reports. A file in a folder that Git does not ignore changes the working tree.

```json
{
  "hypothesesVersion": 1,
  "model": "example-model-1",
  "items": [
    { "id": "H-1", "kind": "missing-test", "claim": "No test checks a name with spaces.", "evidenceIds": ["path:src/login.ts"],
      "proposedTest": { "file": "test/login.test.ts", "name": "trims the name", "text": "test('trims the name', () => {});" } }
  ]
}
```

Code-map reads the file as untrusted input:

- The file has at most 256 KiB and 100 items. Unknown fields are errors.
- `id` has 1 to 64 letters, digits, ".", "_" or "-". Each ID is different.
- `kind` is `risk`, `missing-test`, `intent-mismatch` or `other`.
- `claim` is text of at most 4,000 characters. `model` is text of at most 200 characters.
- `evidenceIds` has 1 to 50 different evidence IDs without control characters.
- `proposedTest` is optional. Its `file` is a repository-relative path without control characters. Code-map does not write or run the proposed test.

Code-map checks each evidence ID against the evidence IDs that the results use:

- The evidence IDs of the checks and of the rating conditions
- `path:` for each changed file
- `report:` for each report of the request
- `case:` for each case that a bound head report ran
- `request:` for the fields `base`, `head`, `intent`, `changeType`, `allowedPaths`, `acceptanceCriteria` and `acceptanceCriteria.<id>`

A hypothesis is grounded when each of its evidence IDs is in this set. Else it is ungrounded, and `missingEvidenceIds` names the other IDs. A grounded hypothesis is still model output, not evidence.

A hypothesis never changes a check result, a rating, the readiness or the exit code. Code-map reads the file only when these are final. When the file is not valid, the run continues without hypotheses, and `llmHypothesesFile` has the state `INVALID` and at most 20 errors.

In `verification-results.json`, `llmHypotheses` lists the hypotheses with `grounded` and `missingEvidenceIds`. `llmHypothesesFile` has the path, the SHA-256 digest, the model, the state, the errors and the counts, or it is `null`. The summary on standard output has `hypotheses`: the state and the counts, or `null`. The report has the section "Model hypotheses (model output, not evidence)" with at most 5 hypotheses. It shows fewer when the other sections leave less space below 200 lines. The report escapes the Markdown characters, and it shows each control character as a visible escape, for example `\u001b`.

## Context for a language model

`code-map verify --context <run ID>` prints the context of a finished run as JSON. A model can read it and answer with a hypotheses file. The command reads `verification-results.json` of the run. It runs no analysis and writes nothing. Give the same `--out-dir` or `--store` as for the run.

```sh
code-map verify --context V-20261022T180000Z-1a2b3c4d --out-dir /tmp/verify
```

The context has `reportType: "code-map-verification-context"`, `schemaVersion: 1` and these fields:

| Field | Meaning |
| --- | --- |
| `readiness`, `ratings` | The readiness state and its exit code, and the state, value and label of each rating |
| `request` | The intent, the change type, the base and the head with their commits, the acceptance criteria, the allowed paths, the hypotheses file and the digest of the request |
| `checks` | The failed checks and the unknown checks, blocking checks first. Each check has its ID, title, category, flags, result, rationale, evidence IDs and next action |
| `graph` | Bounded reverse-dependency paths from changed files to consumers and tests selected by failed or unknown checks. Each path links to its `checkId` and selecting `evidenceIds`. Import edges point from consumer to dependency |
| `nextActions` | The different next actions of these checks, in the same order |
| `hypotheses` | The version, the kinds and the rules of a hypotheses file |
| `omitted` | `null`, or the number of checks, criteria, allowed paths and next actions that the context left out |

Verification stores `graph` from the existing impact walk. It selects changed files from path evidence, import evidence and finding paths.
Case evidence selects test files from the bound head reports by the full case evidence ID.
For each selected test file, the graph retains impact paths from changed files to that test, even when the test did not change.
A case without a known file adds no path. Each seed has its own walk, so another changed file does not hide a connecting path.
Each graph path lists the changed file first and its consumer or test last, with the evidence IDs that selected it.
The walk stops at depth 10 or 2,000 affected files. The graph keeps at most 100 check and consumer paths.
`complete`, `truncated` and `dynamicImports` retain the uncertainty of the impact walk.
`omittedPaths` counts selected paths excluded by the graph cap or the context byte budget.
Edges always belong to retained paths. Paths for checks excluded by the byte budget are also excluded.
Older runs without graph data have no `graph` field. Graph paths are static leads and change no rating.

The context has at most 256 KiB of JSON, also with indentation. Each text has at most 2,000 characters, and the intent has at most 10,000. When the context is larger, it lists fewer items, and `omitted` counts the other items. The run folder must be private to you, as for a run that `verify` writes.

## npm audit reports

Code-map also reads the JSON output of `npm audit --json` from npm 7 and later (`auditReportVersion` 2). Code-map does not run `npm audit`, and it uses no network. You run it, and `code-map manifest --kind npm-audit` writes its manifest at once. `$?` gives the exit status of `npm audit`:

```sh
npm audit --json > reports/npm-audit.json
code-map manifest --artifact reports/npm-audit.json --kind npm-audit --exit-status $? --out reports/npm-audit.manifest.json -- npm audit --json
```

Add the pair to `reportInputs`, as for a test report. The manifest binds the report to the analyzed code in the same way, and the lockfile digest must match too. The conditions about the exit status, the discovery and failed cases apply only to test reports. The `executions` of the results then list the report with an `audit` object:

| Field | Contents |
| --- | --- |
| `use` | `information`. The rule set `static-baseline-v0` has no supply-chain check, so the advisories change no check, no rating and no readiness state |
| `databaseTime` | The `startedAt` time of the run manifest. npm reads the advisory database during the run, so the advisories are as of this time |
| `advisories` | `total` and `bySeverity` (`critical`, `high`, `moderate`, `low` and `info`). An advisory of several packages counts once |
| `packages` | `total` and `bySeverity` of the vulnerable packages, as npm counts them. A package that is vulnerable only through another package counts too |
| `items` | At most 20 advisories, most severe first, with `source`, `title`, `url`, `severity`, `package` and `range` |
| `mismatches` | The counts in `metadata.vulnerabilities` of the report that differ from the counts of its packages |

The Markdown report shows the counts and the database time, and it marks the report "Information only". An npm error output (an `error` object) and the format of npm 6 do not count, and the execution then has the reason `parse`. A report of more than 50 MiB does not count either.
## Bound discovery reports

A discovery report is the list of tests that the runner finds without a run. It gives the discovered denominator of a base or head run. Code-map reads four kinds:

| Kind | Command | Content |
| --- | --- | --- |
| `vitest-list` | `npx vitest list --json` | An array of `{ "name", "file" }` entries, one for each test case. With `--filesOnly`, an array of `{ "file" }` entries |
| `jest-list` | `npx jest --listTests --json` | An array of test file paths |
| `playwright-list` | `npx playwright test --list --reporter=json` | Nested suites with specs and project tests |
| `mocha-list` | `npx mocha --dry-run --reporter json` | A `tests` array with `file` and `fullTitle` |

1. Make sure that Git ignores the folder of your reports, for example with `reports/` in `.gitignore`.
2. Write the list of the head into that folder. For example: `npx vitest list --json > reports/vitest-list.json`.
3. Write the manifest at once, before you change any file:

   ```sh
   code-map manifest --artifact reports/vitest-list.json --kind vitest-list --exit-status 0 --out reports/vitest-list.manifest.json -- npx vitest list --json
   ```

4. Add the pair to `reportInputs` in the request, together with the test reports of the head.
5. Run `code-map verify`. The execution record of the report has `cases: null` and `discovered: { files, cases, outside }`: the number of test files, the number of test cases (`null` for a list of files) and the number of paths outside the repository. The section `tests.discovery` of the results shows the files and cases that ran.

A path in the list is absolute, or relative to the working directory of the run. Code-map resolves existing absolute paths when they need normalization. It skips link resolution for paths longer than 4,096 characters. A discovery report counts only in these conditions:

- The run manifest binds it to the base or head. Each inventory joins results from the same side.
- Code-map can read the list. One list can have at most 400,000 entries.
- The run manifest records the exit status and the discovery.
- The list command ended with exit status 0. A runner that cannot collect a test file lists less, and it ends with another exit status.

A discovery report is not a test report. No check of `static-baseline-v0` reads it, and the test checks do not count its entries as test cases.

## Test information

The section `tests` of `verification-results.json` describes test changes and test runs.
Under `static-baseline-v0`, these entries change no check, rating or readiness.
Under `evidence-v1`, assertion and runner weakening require [current human reviews](weakening-reviews.md).
The row "Test information" of `verification-report.md` gives a short form.
Comparison lists have at most 50 entries, with totals. The `reviews.entries` list retains every detected weakening.

| Field | Meaning |
| --- | --- |
| `reviews` | Every assertion and runner weakening ID, target digest, bound review, total, unreviewed count, runner incompleteness and file error. Refer to [reviews](weakening-reviews.md) |
| `assertionWeakening` | The assertion changes that make a kept test case weaker. `files`: the changed test files that Code-map compared. `total` and `entries`: the changes. `unread`: the changed test files that Code-map cannot read, for example a file larger than 4 MiB or a file that the parser cannot hold |
| `runnerSettings` | The changed runner configuration files. `files`, `weaker` and `unknown` count them. Each entry has the `path`, the `basePath`, the `runner` (`vitest` or `jest`), the `state` (`WEAKER`, `NOT_WEAKER` or `UNKNOWN`), the `changes`, the `unknown` settings and a `reason` |
| `comparisons` | Base/head and head retry environment comparisons, with the other artifact, side, policy, eligibility, missing fields and differences |
| `flaky` | The test cases that passed and failed in bound head attempts, including repeated JUnit cases within one report of the same command, tools and environment, with the number of passed and failed attempts and the reports |
| `outcomes` | Changed case outcomes and transition counts from paired base and head reports. Refer to [bound test reports](#bound-test-reports) |
| `slower` | The test cases whose head duration is more than twice the duration in the base report of the same command, tools and environment, and more than 100 ms longer. `baseMs` and `headMs` are the two durations in milliseconds. With more attempts, Code-map compares the fastest head attempt with the slowest base attempt |
| `discovery` | `null` without a bound discovery report of the head. Otherwise the `reports`, `filtered` (a report of a run with a filter), `files` (`total`, `ran`, `notRan` and the paths), `cases` (`total`, `ran`, `notRan` and the names that did not run, or `null` without a case inventory) and `unnamedCases` (head test cases without a file) |

Duplicate case names use their positions within each report for timing and discovery comparisons.
Repeated JUnit identities with mixed outcomes are conservatively flaky. JUnit cannot distinguish retries from duplicate names.
Every JUnit attempt remains in the bound report. A passed attempt never removes a failure.

`tests.discoveryAttestations` contains one entry for each bound discovery report.
Each entry names its artifact, side, matching reports, discovered count, ran count, not-ran count, unit and filtered state.
Skipped cases count as not run. Jest inventories count files because their producer lists no cases.
Command matching removes discovery and reporter switches. It retains selection arguments and requires the same working directory.
Wrappers with different command words do not join. Record equivalent commands when you write the manifests.
A filtered discovery or matching result marks the attestation as filtered.
Playwright project cases retain multiplicity. JUnit project labels and duplicate names can prevent an exact join.
Discovery inputs share a separate 400,000-entry budget. Expanded Playwright entry strings also share the report byte limit. Playwright suite depth is limited to 64 nested levels.

`tests.dependencies` discloses primary lockfile digest changes and changed root lockfile paths for base and head report comparisons.
It gives counts and up to ten package examples from the supply comparison. Counts describe the readable root npm inventory.
Unread or unsupported lockfiles leave package changes unknown. Imported reports do not establish their installed dependency trees.
When both isolated sides clone or link working-folder modules, the disclosure states that the base uses the head dependencies.
Absent modules and modules tracked in a snapshot do not establish that shared dependency policy.
`revisionDependenciesPrepared` identifies comparisons where both isolated revisions completed offline installs.
`sides.base` and `sides.head` retain each report module mode and validated preparation record.
Preparation records identify the actual npm install lockfile. Primary comparison lockfiles remain separate.
The policy needs an explicitly authorized read-only cache. It never enables network access or lifecycle scripts.
These disclosures do not change a check, rating or readiness state.
Skipped positions remain distinct. Repeated reports cannot count one execution as several discovered cases.
Suite names remain part of each discovered case name.
Tool and environment comparisons use values, independent of JSON property order.

### Weaker assertions

Code-map compares each test case that the base and the head have, in each changed test file. Cases match by path after renames, suite, name and position among duplicate names. The case must run in both snapshots, except a transition into an expected-failure or conditional expected-failure status. Code-map parses the two texts of the file with TypeScript, and it runs nothing. Each entry identifies the case, change kind and source lines. It includes assertion counts and evidence text from both snapshots. The text has at most 160 characters. A long single assertion keeps its start and end to show the matcher. Combined removed-assertion evidence keeps its first 160 characters:

| Kind | When |
| --- | --- |
| `fewer-assertions` | The head case has fewer assertions than the base case. The base text names the assertions that the head does not have |
| `looser-matcher` | A strict matcher becomes a looser one: `toBe`, `toEqual`, `toStrictEqual` or `toThrow(<value>)` becomes `toBeTruthy`, `toBeDefined`, `not.toBeNull`, `not.toBeUndefined`, `toMatchObject` or `toThrow()`. `toStrictEqual` becomes `toEqual`. An argument becomes `expect.anything()`. `assert.ok` takes the place of `assert.equal`, `assert.deepEqual` or a strict form of them. `equal` takes the place of `strictEqual`, or `deepEqual` takes the place of `deepStrictEqual` |
| `expected-failure` | The head adds `.fails`, `.failing` or a nonfalse expected-failure option. This entry requires human review in evidence-v1 |
| `plan-removed` | The base case calls `expect.assertions(n)` or `expect.hasAssertions()`, and the head case calls neither |

A changed expected value, for example `toBe(1)` to `toBe(2)`, is not weaker. In `node:assert/strict`, `equal` is the same as `strictEqual`. Code-map first pairs assertions with identical full text. It then pairs unmatched assertions by their full subject, for example the argument of `expect()`.

The check "Tests are not weakened" (`completeness.tests-not-weakened`) does not read these entries. The accepted rule set limits its FAIL to a removed case and to a NEW finding of a parked case, a case without an assertion or a case that ignores errors. A reviewer must read the entries.

### Weaker runner settings

Code-map parses changed `vitest.config.*`, `vite.config.*` and `jest.config.*` files with TypeScript. This includes `jest.config.json` and the `jest` field of changed `package.json` files. It reads the exported object literal, also through `defineConfig()` or a local constant. A Vite configuration without Vitest settings, and a `package.json` without a `jest` field, are not listed. An added file compares with the defaults, and a deleted file has no settings. These changes are weaker:

| Runner | Setting | Weaker when |
| --- | --- | --- |
| Vitest | `test.coverage.thresholds.lines`, `functions`, `branches` and `statements` (also the older `test.coverage.lines` and `100: true`) | The value is lower, or it is gone |
| Vitest | `test.exclude` | The head excludes an item that the base does not exclude. The default excludes (`...configDefaults.exclude`) are not new |
| Jest | `coverageThreshold.<key>.<metric>` for each key, for example `global` | The value is lower, or it is gone |
| Jest | `testPathIgnorePatterns` | The head ignores a pattern that the base does not ignore. Without the setting, Jest ignores `/node_modules/` |
| Both | `passWithNoTests` | The head sets it to `true` |
| Both | `bail` and, for Vitest, `retry` | The count is higher. `true` is 1 |

A configuration that is not an object literal, for example a function or `require()`, is `UNKNOWN`.
Invalid syntax and excessive nesting also give `UNKNOWN`.
A setting without a literal value is `UNKNOWN`.
An object spread can override an earlier setting and make its value unknown.
An exclude list with a computed item or an unknown spread is `UNKNOWN`.
The known default exclude spreads remain comparable.

## The output

`verify` writes each run into its own folder, `runs/<run ID>/`, with two files:

- `verification-report.md`: the explanation for people. It starts with the readiness state and what it means, then the four ratings, the coverage of the changed code, the failed checks, the unknown checks with what would resolve them, the test, compiler, coverage and discovery reports, the test information, the oracle provenance counts, the limits and a table of the terms that it uses. When the request names a hypotheses file, the section "Model hypotheses" comes before the terms. The report has at most 200 lines. When a full report has more lines, the tables of the failed and the unknown checks list fewer than 20 checks. If combined information sections still exceed the limit, their lists show fewer items. The full JSON results retain every item. The report also removes optional blank lines when needed. Every section stays present.
- `verification-results.json`: every check with its evidence IDs, the rating of each category with its conditions, the readiness state, the test, compiler, coverage and discovery reports, the coverage of the change, the [test information](#test-information), the oracle provenance (`provenance`), the hypotheses (`llmHypotheses` and `llmHypothesesFile`) and the limits. `request` has the digest, the acceptance criteria, the allowed paths and the hypotheses file of the request. Its `reportType` is `code-map-verification`, with `schemaVersion: 1`.

When both files are complete, `verify` replaces `latest.json` in the output folder. It names the last run, its readiness state, its exit code, and the paths and digests of the two files. A run that fails leaves no folder and does not change `latest.json`. The folders are private to you, and `verify` refuses an output folder that another user owns or can change.

The summary on standard output has `reportType: "code-map-verification-summary"`, the run ID, the readiness state, the exit code, the state of each rating, the IDs of the failed and blocking checks (at most 20 of each), the state and counts of the hypotheses and the paths of the files.

## Exit codes

| Exit code | Readiness | Meaning |
| --- | --- | --- |
| 0 | READY | Every required check passed. This rule set never gives it |
| 1 | REVIEW | Failures or reviews remain open |
| 2 | BLOCKED | A blocking check failed: a new architecture-rule break, a new focused test, or a new failure in a bound head test report |
| 3 | INSUFFICIENT_EVIDENCE | Required evidence is missing. With static evidence only, this is the usual result |
| 4 | none | The request is invalid, the command failed, or the request asks to run project code. No run folder stays behind. `--context` also exits with 4 when it fails, and with 0 when it prints the context |

## Compiler information

Enable `typeCheck` in `.code-map.json` for bounded compiler observations. See [compiler facts](types.md).
The new `types` section reports unchecked changed files, incompatible public calls, symbol impact, and language-service stale references.
Changed explicit named parameter and return shapes also select public calls for compatibility checks.
A bound `tsc-files` report also supplies compiler file discovery. It does not supply diagnostics.
These observations do not change the results of `static-baseline-v0`, and they add no check to `evidence-v1`.

## Limits

- The ratings describe the declared change and the checked files, not the whole project.
- A finding is a static lead. A check that uses findings gives PASS or FAIL only when the base and head analyses are comparable.
- Each check reads only the finding rules that it names. No check of `static-baseline-v0` reads the Next.js rules (`NEXT-`) the owner rule (`OWNER-CROSS-IMPORT`) or package rules (`PACKAGE-` and `FILE-ORPHANED`), so their findings do not change a result of `verify`.
- The architecture-rule check (`structure.architecture-rules`) counts the text rules in `rules` and the layer rules from `layers` in `.code-map.json` as declared rules. A layer break is an `ARCH-RULE` finding, so a NEW layer break fails the check and blocks. With layers only, the check applies. With one layer only, no pair of layers gives a rule, and the check is NOT_APPLICABLE. Refer to [layers and owners](retrieval.md#layers-and-owners).
- No check reads the model report of the analyses (C22 to C24, refer to [models of expected behavior](models.md)). A model file in `.code-map/models/` or `.code-map/decisions/` is part of the code, not a settings file. Thus, a change that edits it does not fail the settings check.
- A bound test report from your own test run proves which code the report describes, not that the run was honest. Its label is "self-attested". A report of `code-map run` has the label "isolated", and it counts the same in this rule set.
- A compiler report lists errors, not the files that the compiler checked. A changed file that the compiler did not check, for example a file outside `include` in `tsconfig.json`, has no error. The legacy profile check cannot see such a file. Optional compiler information names unchecked changed files separately.
- The type check reads only the files that import a changed file directly. An error in a file that imports a changed file through another file does not fail the check.
- Code-map finds a syntax or settings error by its file and its code. A rare syntax error with another code, or an error outside the repository, does not keep the type check UNKNOWN.
- Line, statement, branch and function coverage show which changed code ran in the tests, not that a test checked its results. Code-map does not compare the coverage of the head with the coverage of the base.
- The join of a changed function to the analysis uses only the file and the start line. Two functions that start on one line give an ambiguous join, because the analysis does not record columns.
- Under `static-baseline-v0`, the test information changes no result. The assertion comparison recognizes assertions by pattern, so a custom assertion helper can hide a weaker check. It does not compare `t.plan()` of `node:test`, the matchers of chai, or the per-file thresholds of Vitest. A changed expected value is never weaker, also when the new value checks less.
- The runner comparison reads only the listed settings in object literals. It does not read Vitest workspaces or projects, Jest `projects`, command-line options or a configuration file that another file imports.
- A flaky case needs mixed outcomes in bound head attempts of the same run. Repeated JUnit cases also count. A case that fails in one run of the head and passes in a run of another command is not flaky. Durations are as the reports give them, so a loaded computer can make a case slower.
- `verify` does not read the [triage file](retrieval.md#triage-findings) `.code-map-triage.json`. A dismissed or suppressed finding still counts in every check of `static-baseline-v0`. With `head: "worktree"`, an uncommitted triage file is a changed file of the change, as any other file.
- The advisories of a bound npm audit report are information. No check of `static-baseline-v0` uses them.
- The analyses read working-folder settings. For a head commit, a different `.code-map.json` in the working folder keeps the architecture-rule check UNKNOWN. The dependent architecture rating predicates also stay UNKNOWN. A rule from that folder cannot block the commit. The settings check still fails. Separate revision policy information evaluates both revision policies.
- Import checks cover source files, scanned test files and JavaScript or TypeScript `*.config.*` files at each package root.
- Declaration files and other code outside this scan keep the import checks UNKNOWN. A deleted or moved source file keeps the consumer check UNKNOWN when unscanned code outside the source roots exists. This includes a deleted outside-root file and a file moved from outside the roots into a root.
- A dynamic import in a changed source file keeps Structural Integrity below level 3. This includes a literal dynamic import whose target resolves.
- A test renamed to an unreadable script has unknown removal evidence. The scan does not report its cases as deleted. A separate readable test with removed cases still fails the check.
- Working-tree verification includes edits hidden by Git `assume-unchanged` and `skip-worktree` flags. It clears the flags only in a private index copy. It preserves absent sparse-checkout paths and leaves the repository index unchanged.
- The [calibration corpus](calibration.md) measures each check on small known changes. Its numbers show only that the checks find the defects that the corpus contains.
- The oracle provenance compares the text and the number of assertions of a case. An edit of a helper or a fixture outside the case does not make the case `changed-with-change`.
- A tag links a test case to a criterion. Code-map does not check that the case tests the criterion, or that its expected result is correct.
- The evidence check of a hypothesis finds each evidence ID in the results. It does not check that the evidence supports the claim.
- The rule set `static-baseline-v0` does not use the export changes of a comparison. The check "Consumers are updated" finds broken imports only. A removed or changed export with consumers is visible in the `api` section of `code-map inspect --summary --base <ref>` (refer to [compare the exported interface](retrieval.md#compare-the-exported-interface)). The rule set does not use the `impact` section either: the affected files, the stale references, the call sites and the documentation leads are leads of `inspect` only (refer to [change impact](retrieval.md#change-impact)).

## Bound mutation reports

`stryker-json` reports give changed-line mutation counts, scores and survivors when bound to the head.
Use an artifact and manifest pair, or the stored run ID from `code-map mutate`.
Mutation results are information under `static-baseline-v0`. Refer to [mutation testing](mutation.md) for commands and limits.

## The rule set evidence-v1

`static-baseline-v0` stays the default rule set of the examples. Its checks and thresholds do not change.
Select the evidence-v1 rule set with `"profileId": "evidence-v1"` and `"ratingRulesVersion": "ratings-v1"` in the request.
The user accepted the rule set on 2026-10-23. It stays opt-in. The results contain `profileStatus: "accepted"`.

V1 adds public-interface compatibility, harness results, dependency policy, stale references, and migration and documentation checks.
It can close refactor, fix and acceptance checks from bound evidence. All categories can reach five.
READY needs every required check to pass, four ratings of at least three, and isolated test reports.
Self-attested reports can fail checks and block changes. They cannot supply the minimum behavioral evidence.

A person confirms one test oracle with `code-map oracle`. The command writes `.code-map/oracles.json` atomically.
A model must not write an oracle record for itself. Tags alone never confirm an expected result.
Read [the v1 reference](verify-evidence-v1.md) for commands, record fields, thresholds, and evidence gaps.

## Contract information

`contractInformation` contains schema changes, deployment-name comparisons and checked documentation examples.
Its policy is `information-only`. These observations add no check to either rule set.
Schema changes require comparable base and head analyses. An older analysis without these facts gives UNKNOWN.
`schemaRollout` lists contract-before-expand, one-step-contract and UNKNOWN leads with source witnesses.
These observations add no check to either rule set. See [schema rollout](retrieval.md#rollout-information-in-verify).
Bound fixture migrations retain row counts and SQL errors in `executions[].harness.migration`.
See [migrate mode](harness.md#migrate-mode). Other databases give UNKNOWN.
Bound route harness runs appear under `executions[].harness`.
Refer to [contract evidence](contracts.md) and [route mode](harness.md#route-mode).

## Frozen OSV snapshots

A frozen snapshot contains OSV advisory records with explicit database provenance. Legacy advisory arrays remain accepted with UNKNOWN provenance.
Bind it with `code-map manifest --artifact reports/osv.json --kind osv-snapshot --exit-status 0 --out reports/osv.manifest.json -- import-frozen-snapshot`.
The recorded command describes the import. Code-map runs nothing.
Add the artifact and manifest pair to the request's `reportInputs`.
The manifest binds the exact artifact digest and snapshot inputs.

`executions[].osv` has `use: "information"`, `snapshotDate`, `items`, `unknown` and `comparison`.
The snapshot date comes from the artifact's `snapshot.exportedAt`. Without provenance, it is null and the provenance state is UNKNOWN.
`executedAt` separately records the manifest's `startedAt`.
Refer to [frozen advisory provenance](quality-evidence.md#frozen-advisory-provenance-c34) for the envelope and limits.
Each match lists `id`, `severity`, `package`, `version` and `snapshotDate`.
The same snapshot matches both inventories. `comparison.added` and `comparison.removed` list changed matches.
Unreadable root lockfiles refuse comparison. An absent root lockfile contributes no locked versions.
Unparseable package versions appear in `unknown`.

The matcher supports npm SEMVER events: `introduced`, exclusive `fixed`, and inclusive `last_affected`.
It also supports explicit affected versions and semantic prerelease ordering.
Unsupported npm range types and malformed event sequences refuse the snapshot with a parse reason.
Other ecosystems do not match npm packages. Withdrawn records do not match.
Severity retains CVSS entries or the available database-specific or ecosystem-specific severity.
The snapshot changes no rule, rating or readiness result under either profile.
No tool can establish exploitability or advisory completeness from these records alone.

## Generated test oracle links

`generatedTestOracles` lists every `generatedTests` declaration, also when execution is disabled.
The field is absent when the request has no generated declarations.
Each entry gives `independent`, `state`, the selected scanned cases and their oracle records.
A declaration without a name selects all scanned cases in that file.
Each selected case needs an unambiguous name and suite, and a current human record for a request criterion.
Current means that the exact selected head file bytes match the record digest.
Case states are CURRENT, STALE, MISSING or AMBIGUOUS. An unreadable oracle file gives declaration state INVALID.
A declaration is CURRENT only when every selected case has a current record. Otherwise it is UNCONFIRMED.
Missing files and absent cases never count as independent.
Records retain the criterion, method, person, date and digest. A person's identity and oracle truth remain unauthenticated.
These links do not establish execution, passing outcomes, failure sensitivity or mutation sensitivity.
They are information only. They change no check, rating or readiness under either profile.

## Generated test mutation links

Set `execution.commands[].generatedTestWords` to a command template with one whole-word `{testFile}` selector.
Use the same report kind and artifact path as that command's normal `words`.
For example:

```json
{
  "id": "tests",
  "words": ["node", "--test", "--test-reporter=junit", "--test-reporter-destination=junit.xml"],
  "generatedTestWords": ["node", "--test", "--test-reporter=junit", "--test-reporter-destination=junit.xml", "{testFile}"],
  "kind": "junit",
  "artifact": "junit.xml",
  "sides": ["head"]
}
```

Each `generatedTests` declaration can include `mutationAuthorization`, an authorization ID for its expanded command words.
Otherwise the worker uses `execution.authorization`. A broader command authorization does not authorize the file selector.
Authorize each exact expanded command through the worker procedure. Templates never authorize commands themselves.
The worker runs the generated file alone. A baseline report containing another file is refused for mutation.

`generatedTestMutations` lists each declaration, head outcome, copied base outcome for fixes, and current oracle link.
Disabled execution and absent templates retain unavailable outcomes with reasons.
Each entry has `compilation`, with `status`, `diagnostics` and the selected TypeScript `config` when compilation runs.
Compilation checks the head snapshot before the exact generated-file command runs. JavaScript gets syntax checks.
TypeScript gets separate syntax and semantic checks with snapshot project settings, local imports, aliases and local extended configs.
The compiler selects a config that includes the file, or the nearest ancestor `tsconfig.json`. Without a config, it uses compiler defaults.
The compiler reads snapshot source and JSON files of at most 8 MiB each and the installed TypeScript standard libraries.
It also reads installed `package.json` and declaration files (`.d.ts`, `.d.mts`, `.d.cts`) from the working folder's `node_modules`.
Installed files have an 8 MiB limit per file and a 32 MiB total limit per compilation.
The compiler resolves package links within the canonical `node_modules` folder. It refuses links outside that folder and package source files.
Compilation never emits files or executes project code. `noCheck` is disabled for this check.
Only a failed compilation blocks the generated head baseline, copied base run and mutants. Syntax and configuration errors cause this failure.
Each entry has a separate `typeCheck` record. Semantic errors give it a `failed` status with diagnostics. They do not block execution.
A successful TypeScript check has status `passed`. Missing `node_modules` or a size limit gives status `unavailable` with a reason.
JavaScript has an unavailable type check with a reason because it receives syntax checks only.
Disabled execution and absent templates retain unavailable compilation and type check outcomes.
Each diagnostic list keeps at most 100 errors with code, file, start line and message. `truncated` identifies a clipped list.
The report shows compilation and type check status side by side, with up to two diagnostics each. These results change no rule set predicate.

Static import links select changed source lines. Bound head LCOV hits or mapped Istanbul statement ranges further restrict the candidates.
LCOV counters take precedence when both formats measure the file. Statement ranges select candidates without creating line counters.
Coverage from a whole run is not per-test coverage. Missing measured lines give no candidate when line measurements exist.
The runner samples at most 20 built-in mutants per declaration and template, with seed zero.
`candidates` and `truncated` disclose the bound. Each baseline and mutant has the declared worker budgets.
Runs are sequential. Each mutant records its source location, generated file, run ID, reported cases and outcome.
Mutant reports have no ordinary report manifest. They cannot enter rating evidence.

A killed mutant requires a nonzero command exit and failed cases with the same identities as the passing baseline.
Missing reports, changed case identities and reported runner errors give RuntimeError. Timeouts and compile errors remain distinct.
A file that passes on head and kills a changed-line mutant is failure-sensitive.
A named declaration needs its own unambiguous failed case in a killed mutant. Other cases in the file do not prevent attribution.
Mutant status describes the file command. `selectedFailure` identifies a failed selected declaration within that command.
`supports` lists acceptance obligation IDs from tags on cases that fail killed mutants.
These links do not close obligations. Independent oracle truth and the intended cause of a failure still require review.
The information changes no check, rating or readiness under either rule set.

## Run a model review

Use `code-map review --run <run ID> --model-command <words...>` after verification.
Read [model review](model-review.md) for the user-program trust boundary, limits and saved output.

## Run authentication information

`execution.budgets.diskMegabytes` optionally limits sampled workspace disk usage from 1 to 1,048,576 MiB.

Verification reports show manifest signature states, signer fingerprints and base/head environment differences.
An invalid signature or unknown signer excludes the report. Unsigned reports retain compatibility.
Environment policy `exact-environment-v1` requires matching policy, Node, platform, OS, kernel release, architecture and TypeScript.
Optional backend values must also match. Commands, working folders and recorded tools must match for test comparisons.
Missing required fields give UNKNOWN. Different recorded values give INCOMPARABLE.
`environmentComparisons[].eligible` identifies environment eligibility for each pair.
A report remains eligible about its own environment. Incompatible pairs do not establish repeatability or timing changes.
Historical reports without required fields cannot establish earlier failures or an independent reference.
These corrections affect evidence eligibility. The accepted profile keeps its checks and thresholds.
Read [run authentication](run.md#manifest-signatures-and-environment) for `trustedRunKeys` and the optional disk budget.

## Migration, public scope and policy information

The results contain three information sections. Neither implemented rule set reads these sections as checks.

- `migrations.items` lists configured migration findings with the replacement, note and comparison label.
- `publicInterfaces.items` lists public exports that were removed, changed or added. It also retains UNKNOWN signature leads.
- `policy` contains the revision policy comparison described in [revision policy information](retrieval.md#revision-policy-information).

Each public export item has `path`, `name`, `status` and `allowed`.
`allowed` is true or false when `allowedPublicChanges` supplies a list.
It is `null` when the field is null or absent. An empty list permits no public export change.
A listed name permits that name at every discovered public entry point.
Public exports come from the existing package entry-point and declared-signature comparison.
Inferred signatures and consumers outside the repository remain bounded limits.
Full lists live in `verification-results.json`. These sections do not change readiness or ratings.

Harness decision-table rules can reference these records by `file`, `suite`, `name`, and `criterion`.
Bound harness information exposes each row's `confirmed` and `current` values.
Freshness compares the exact test bytes in the executed snapshot with the oracle digest.
The row reference declares support for its expected result. Code-map does not prove equivalence between the test and table.
These labels add no check to either rule set. See [the harness guide](harness.md).

## Controlled timing reports

Use [controlled timings](run.md#controlled-timings) for repeated authorized command measurements.
The report kind is `bench`. Its report type is `code-map-bench`, with schema version 1.
The `bench` section compares exactly one bound report per side.
It reports UNKNOWN when one side is missing or ambiguous. Results omit `bench` when no bound timing report exists.
Commands, repeat counts, machine facts, Node.js versions, tools and sandbox environments must match.
A zero base median also gives UNKNOWN.
Imported report pairs remain self-attested. Their manifest command must match the report command.
Code-map checks the samples and recomputes their statistics before accepting a report.

Configure `.code-map.json` with `"timings": { "minimumChangePercent": 10, "maximumLoadChange": 1 }`.
Both values must be finite nonnegative numbers. Unknown timing options are refused.
`minimumChangePercent` defaults to 10. `maximumLoadChange` defaults to one absolute load-average unit.
Code-map compares the range of all before and after loads, across both sides, at each load-average interval.
A range above `maximumLoadChange` gives UNKNOWN.

A change exceeds the thresholds only when both strict conditions hold:

- Its absolute median change exceeds three times the sum of both median absolute deviations.
- Its absolute percentage change exceeds `minimumChangePercent`.

The results retain the signed median change, percentage change, noise range and threshold decision.
Timing information adds no check to `static-baseline-v0` or `evidence-v1`.
It does not change ratings or readiness.

Run both sides on the same machine, with comparable dependencies and budgets.
Other machine processes, thermal changes and operating-system caches can affect measurements.
A stable load average does not prove that conditions were controlled.
Finite samples and the noise rule do not establish statistical significance or route-specific coverage.
The command defines what is measured. A command benchmark does not automatically measure individual Next.js routes.

## Compiler diagnostic lifecycle

The results include `compiler.counts` and `compiler.entries` for bound base and head compiler reports.
The Markdown report shows lifecycle counts and a bounded list of NEW diagnostics.
The JSON results retain all entries, fingerprints, display coordinates and matching reasons.
This information changes no check in `static-baseline-v0` or `evidence-v1`.
The existing type check still fails on relevant head errors, including existing errors.
See [lifecycle binding and matching limits](retrieval.md#bound-compiler-diagnostic-lifecycle).

## Observed state information

A bound `xstate-trace` report adds `executions[].xstateTrace`, with unseen transitions, unauthorized transitions and unhandled events.
Pass its stored run ID through `reportInputs`. Stale reports give binding reasons without a transition comparison.
Trace information adds no check to either rule set. Read [observed transitions](models.md#observed-xstate-transitions) for limits.

## Typed documentation examples

Typed inspections expose documentation diagnostics in `contractInformation.examples`.
Configure `typeCheck: true` to collect this evidence during verification.
Complete typed comparisons label new errors NEW and unchanged errors EXISTING.
Incomplete evidence retains UNKNOWN labels. These diagnostics add no rule-set check.


## Tool trust minimums

A trust tier describes evidence provenance. `lib/trust.mjs` defines these tiers, from lowest to highest:

| Tier | Evidence source |
| --- | --- |
| `static` | Code-map analysis. A refused input without verified provenance also starts here |
| `self-attested` | An imported report with a manifest, including `code-map manifest` output |
| `isolated` | An unsigned worker run in this machine's private store |
| `isolated-signed` | A stored worker run with a valid signature from this store's key |
| `trusted-signed` | A valid signature from a public key in `trustedRunKeys`, including an imported report |

An imported manifest cannot establish local isolation through its environment policy or a local signature alone.
A configured trusted signature takes precedence when its key also belongs to the local store.
Tiers do not prove correct test expectations. They do not replace revision binding, report validation or profile requirements.
`evidence-v1` still requires local isolation for its existing isolated-test predicates.
A trusted imported report does not automatically satisfy those predicates.

Set optional tool minimums in `.code-map.json`:

```json
{ "trust": { "vitest": "isolated", "npm": "isolated-signed", "tsc": "self-attested" } }
```

Each key matches the exact first command word. `npm test` uses `npm`, not the script's nested command.
An absolute executable path needs that exact path as its key. Code-map does not infer shell wrappers or nested tools.
A policy has at most 64 entries. Tool names have at most 4096 characters, without whitespace or control characters.
Malformed policies stop configuration loading. Omitted tools have no additional minimum.
Without `trust`, existing eligibility, checks, ratings and readiness stay unchanged.

Each JSON execution record includes `tier`. Bound records also include `trust`, with `tool`, `minimum`, `allowed` and `message`.
A report below its minimum has `eligible: false` and a `trust` reason.
It supplies no test, compiler, coverage, discovery, mutation, audit, harness or size evidence.
The Markdown report shows each displayed record's tier and refusal reason.

An authorization can also set minimums with `authorize --trust '<JSON>'`, before `--command`.
The private authorization record retains the policy. Each worker run copies it into its private run record.
Verification applies the stricter repository or authorization minimum for that tool.
Authorization minimums govern evidence acceptance. They never permit execution outside the sandbox.
Existing authorizations and stored runs without a policy retain compatibility.
Refer to [authorization options](run.md#authorize-a-command) and [security](../SECURITY.md#evidence-trust-tiers).

## Contract audit extensions

Use explicit SQLite snapshots for structural compatibility and declared query rows for migration data oracles.
JSON Schema and JSDoc integer boundaries support authorized validator runs with retained case-to-call links.
Docker ARG and discarded-stage ENV declarations do not satisfy runtime reads. Unsupported contract rules retain UNKNOWN.
Read [contract evidence](../docs/contracts.md) and [harness modes](../docs/harness.md).

## Stored result schema and category comparison

Results follow [the versioned verification contract](verification-contract.md).
Add `baselineReport` with an earlier stored verification run ID to compare four independent category bands.
Changed rubrics, scope or evidence policies prevent comparison. Unassessed categories stay UNKNOWN.
