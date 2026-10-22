# Structural inspection and JSON reports

Use `code-map inspect` inside the repository being inspected. It collects the selected snapshot and emits a structural report without writing HTML, starting a server, or calling a model.

From the Code-map checkout, these commands inspect this tool itself:

```sh
code-map inspect --worktree --file lib/analyze.mjs --out /tmp/code-map-analysis.json
code-map inspect --worktree --file lib/analyze.mjs --file lib/build.mjs --out /tmp/code-map-files.json
code-map inspect --worktree --change uncommitted --out /tmp/code-map-changes.json
code-map --json --ref HEAD --file lib/build.mjs --out /tmp/code-map-committed.json
```

Without `--out`, JSON goes to standard output, with no progress messages. Redirect it or pipe it to another tool. `inspect` and `--json` produce the same report format. An explicit `--out` names the JSON file; the normal HTML output setting is not used.

Paths passed with `--file` are exact repository-relative mapped source paths. Repeat the option to select several files. Source bodies and full history are omitted. With no selection, the report describes the whole mapped project.

## Select a change set

`--change` adds one set of files to any `--file` selections:

| Value | Files selected |
| --- | --- |
| `latest` | The most recent source-changing commit recorded in the map |
| `branch` | Files changed since the mapped branch split from main/master, when available |
| `uncommitted` | Modified and untracked source files in a `--worktree` snapshot |

Unavailable or unknown selections fail with a nonzero exit status. Explicit files that are not mapped sources also fail. Files removed by a change remain in `selection.missing`; they have no current declaration analysis. An empty change set stays empty and does not silently select the whole project.

`--exclude-vendors` omits file details under `components/ui/` and `components/ai-elements/`. This is a path heuristic, not verified vendor provenance. Project totals remain unfiltered.

## Report format

The report has `schemaVersion: 1`. All paths are repository-relative and source lines start at one.

| Field | Contents |
| --- | --- |
| `snapshot` | Project, mapped ref, commit SHA, generation time, and whether the working tree was selected. A SHA alone does not identify uncommitted edits. |
| `selection` | Selected source paths, selected change set, and missing paths from changes |
| `summary` | Project source count, selected file count, cycle counts, shared-type count, and edges with unknown classifications |
| `files` | Per-file size, churn, import evidence, production importers, candidate tests, exports, declarations and co-change partners |
| `cycles.all` | Strongly connected groups across all resolved source dependencies, with their internal edges |
| `cycles.value` | Groups across value and side-effect dependencies, including literal dynamic imports and `require` calls |
| `sharedTypes` | Type declarations whose consumers import them while the owner imports those consumers as values |
| `hotspots` | Up to ten selected files ranked by source lines multiplied by commit count |
| `testSummary` | Test-quality summary: statistics, observations, next steps and limits. Whole-project reports use the project summary; file and change selections summarize the selection |
| `tests` | Test-quality evidence: test files, test cases, functions with failure exits or test links, fix commits, coverage state and label state |
| `limits` | Interpretation limits that travel with the report |

For a file selection, cycles touching the selection retain all their members and edges. Shared-type candidates retain both sides of their evidence. Project totals in `summary` describe the full snapshot; `files` contains only the selected details.

### Dependency evidence

Each import edge records its source, target (or `null` when unresolved), source line, specifier, kind, mode, and imported type/value names.

- `kind`: `type`, `value`, `side-effect`, or `unknown` for older facts without classification.
- `mode`: `static`, `dynamic`, `require`, or `type-query`; older unclassified facts use `unknown`.
- Mixed imports retain both type and value names. A non-type-only import containing only inline type specifiers is conservatively a side-effect edge: emitted module loading depends on compiler settings.
- Bare imports are side effects. Literal dynamic imports with options are included. Nonliteral targets remain unresolved; the tool does not evaluate them.

These are possible dependencies, not proof of calls, execution order, or runtime initialization defects. An acyclic value graph does not prove that dynamic wiring is acyclic.

### Declaration metrics

Each top-level declaration and class member records its inclusive line span, referenced internal modules, and hook call sites. Imported bindings are resolved within the source file, so a parameter that shadows an imported name does not count as that dependency. References in nested callbacks remain inside their enclosing declaration's metrics. Type references count as dependencies too.

Hook metrics include imported React hooks, aliases and namespace calls, plus imported custom names following the `useX` convention. Custom entries have `classification: "convention"`; they are candidates rather than verified hook implementations. Counts describe call sites, not the number of calls at runtime.

### Export usage

Export records separate `value`, `type`, and `reexport` categories. Each record includes source-line evidence, detected consumers and local reference counts.

| Usage | Meaning |
| --- | --- |
| `source` | At least one mapped production file imports the exported name |
| `test-only` | Detected consumers are only tests or test helpers |
| `unreferenced` | The file has importers, but none imports this exported name |
| `entry-point` | No file imports this file; an external entry point may use it |
| `unknown` | Wildcard reexport exposure has not been resolved |

No external importer found is not proof of dead code. Local use, namespace imports, reexports, entry points and dynamic wiring require judgment. Namespace consumers conservatively count as possible consumers of every name. These are import references, not proven calls.

`files[].tests.direct` contains runnable tests that import the file itself. `transitive` contains other runnable tests that reach it through source files or helpers. Helper files pass imports along; they are not counted as tests when runnable tests are identifiable. Import reach does not establish assertions or executed coverage.

## Test quality

The test-quality scan finds functions whose failure exits have no failure test. It cannot judge whether an existing test checks the correct behavior. `testSummary.canAndCannot` carries this sentence, and `testSummary.limits` lists the limits of each signal.

### Evidence kinds

Each statistic, observation and next step has a `source`:

| `source` | Meaning |
| --- | --- |
| `inventory` | Counted in the test files: cases, statuses, test files that the scan cannot read or parse |
| `inferred` | A link from a test reference to a source function, or a failure assertion that the scan ties to a function. Check it in the code |
| `pattern` | A source pattern: failure exits, assertions, fixed waits, swallowed errors, tests with no assertion |
| `measured` | Working-folder coverage. It applies only to a working-tree map and is not tied to a revision |
| `git` | Commit history: bug-fix commits among the last 100, found by their subject |
| `model` | Optional labels from `docs/code-map/test-labels.json` |

### Report fields

| Field | Contents |
| --- | --- |
| `testSummary.statistics[]` | `key`, `source`, `label`, `value`, `detail`, and `warn` when the value needs attention |
| `testSummary.observations[]` | `key`, `severity` (`high`, `medium`, `low`), `source`, `count`, `text`, `action` and up to eight `evidence` items: `path`, `line`, `text`, and for functions a `test` to start from |
| `testSummary.nextSteps[]` | `source`, `text` and `evidence`. A step for a function also has `target`, `startFrom` (an existing test that reaches it) and `verify` with three checks: `tests` (the files that must pass), `mutate` and `scan`. `mutate` and `scan` each have `args` to run without a shell, a shell-quoted `command`, and what to `expect`. The scan status is a static association, not proof of the behavior |
| `testSummary.agentGuide[]` | Four rules that tell an agent how to work through the next steps, how a new failure test is recognized, and how to confirm the result |
| `testSummary.counts` | The raw numbers behind the statistics, including `layers` and `intents` |
| `tests.testFiles[]` | `path`, `kind` (`tests`, `helper`, or `unrecognized` for a file named like a test with no recognized case), `framework`, `type` (the layer), `declared` and `inferred` layers, `effects`, `mismatch`, and `cases` (case IDs) |
| `tests.cases[]` | `id`, `path`, `name`, `suite`, `line`, `status` (`active`, `focused`, `skipped`, `todo`, `conditional`), `each` for a parameterized definition, `type`, `assertions`, `failures`, `kinds`, `failureTargets`, `evidence`, `smells`, `intent`, `intentState` and `regression` |
| `tests.units[]` | A top-level function, class or value with failure exits or direct test links: `key` (`path#name`), `line`, `exits` (`line`, `kind`, `hits`, and `mutant`: the outcome of its removal), `direct` (case IDs), `via` and `viaCases` (the first five cases that reach it through callers, each with its `route`), `failureDirect`, `viaFailure`, `candidates`, `status`, `resultCheck` (the strictest tied assertion, or `none`; `null` when no test calls it directly), `mutation` (`run` status, `counts` by outcome and the `survived` changes) and `affects` |
| `tests.mutation` | `state` (`measured` or `none`), the report `file`, `tool` (`code-map mutate` or `stryker`), `date`, and `staleFiles` changed since the report |
| `tests.fixCommits` | `window`, `scanned`, and the fix commits with their `sources` and `tests` |
| `tests.unreadable` | Test scripts in other languages, for example shell scripts, that the scan cannot read |
| `tests.coverage` | `state` (`measured`, `none`, or `not-applicable` for a commit map), report `file`, report `date` and map date |
| `tests.labels` | Label file, current labels, stale and unstamped files, and cases with no label in labelled files |

A unit `status` is one of these:

| Status | Meaning |
| --- | --- |
| `direct` | A running test has a failure assertion tied to this function |
| `indirect` | A running test has a failure assertion tied to a caller, up to 3 calls away |
| `no-failure-assertion` | Tests reach the function, but no failure assertion is tied to it. A custom helper can hide one, so this is unknown, not proof |
| `unreached` | No test references the function or its callers within 3 calls |
| `no-exits` | No failure exit was found; the unit is listed because tests reference it |

### Evidence rules

- A failure assertion is tied to the source names inside it, to the value that a checked local variable holds (`const r = parse(x)`), to the code in the `try` block or promise that a caught error comes from, and, for a local helper, to the names in the helper call's arguments. A local helper counts only where a test calls it or passes it to a callback consumer such as `forEach` or `test.step`; a bare reference gives reach, not a check. A check inside a condition is a candidate; a check under a constant false condition does not count.
- Only `active` and `focused` cases are evidence. Skipped and todo cases are inventory only. Conditional cases (`skipIf`, `skip: condition`) can only be candidates. A skipped or todo suite dominates a child's `.only` or condition; `focus` records each `.only` marker separately for the focus warning.
- A failure assertion about another function, a failure-like test name and a model label are `candidates`. They never change a status.
- A nested function in a test counts only where the test calls it.
- Failure exits inside a `catch` block belong to the catch. Each exit has a `hits` value only for a working-tree map with a coverage report: the line of an exit on its own line, the first statement of a catch block, or, for a one-line `if (bad) throw`, an Istanbul-style branch record with one block of two branches. V8-native reports, such as Node's own LCOV, number one-branch blocks in their own order, so such an exit stays `null`.
- A parameterized definition (`test.each`) counts once, because its row count is unknown.

### Mutation report

`code-map mutate` writes a report with `schemaVersion`, `tool`, `ref`, `sha`, `workingTree`, `files` and `units`. Each file has its content `hash` and its `mutants`: `unit`, `line`, `kind`, `original`, `replacement`, `status` (`detected`, `survived`, `timeout`, `error` or `invalid`) and, when detected, `killedBy`. Each unit records its `tests`, the test files that it `excluded` because they failed without a mutant, the `commands`, the `baseline` receipts (tests discovered, passed and failed), the `canary` outcome and its `status`: `checked`, `partial` (the mutant limit was reached), `no-tests`, `no-runner`, `baseline-failed` or `not-loaded` (the tests did not load the copied file).

A report entry counts only while the file has the same content hash. A Stryker report counts while its recorded `source` matches the file. Stryker statuses map to the same outcomes: `Killed` to detected, `Survived` to survived, `Timeout` to timeout, `NoCoverage` to no-coverage, `CompileError` to invalid and `RuntimeError` to error.

## HTML controls

The self-contained page embeds the same shared analysis:

- Project and file Details have **Copy analysis JSON** and **Download JSON**. File exports contain only that file's details plus relevant cycle and shared-type evidence.
- **Backbone** and **Checks → Import cycles** switch between all dependencies and value dependencies. Backbone roles and placement still use the all-dependency graph; value mode filters its links.
- **Checks → Shared types** links each type declaration and both import directions.
- File Details sorts declarations by source order, size, dependency count or hook count. Opening a declaration shows referenced modules and hook call-site links.
- **Export usage** groups types, values, reexports and test-only consumers. **Hide primitive/vendor paths** filters those path-based candidates and JSON file details.

- The **Tests** tab shows the test-quality summary for the selected project, module, folder, file or function. **Copy summary** copies it as Markdown; **Download JSON** saves the same report as the CLI, scoped to the selection. **Colour → by failure tests** colours functions by their evidence category.

Reports describe the mapped source snapshot. The history slider changes historical sizes, not the parsed source snapshot, so JSON export is disabled at historical slider positions. Clipboard access can be unavailable for local files; use Download JSON in that case.

## Shared implementation

`lib/source-metrics.mjs` adds binding-aware source facts, including failure exits and references between declarations, without typechecking or executing the inspected code. `lib/test-scan.mjs` reads test cases, `lib/test-assertions.mjs` classifies their assertions, and `lib/test-quality.mjs` links them to source functions. `lib/analysis.mjs` computes cycles, export usage, candidate tests, shared-type candidates, hotspots and the test-quality evidence. `lib/build.mjs` embeds those results as `DATA.analysis`; the viewer does not recalculate these checks.

`createReport(data, selection, summarize)` from `lib/analysis.mjs` selects a compact report; `summarize` is `summarizeTests` from `lib/test-summary.mjs`. The CLI calls them directly, and the same self-contained functions are embedded in the HTML for offline copy and download. Neither path needs an additional dependency or a model call.
