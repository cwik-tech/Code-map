# Structural inspection and JSON reports

Use `code-map inspect` inside the repository being inspected. It collects the selected snapshot and emits a structural report without writing HTML, starting a server, or calling a model.

From the Code-map checkout, these commands inspect this tool itself:

```sh
code-map inspect --worktree --file lib/analyze.mjs --out /tmp/code-map-analysis.json
code-map inspect --worktree --file lib/analyze.mjs --file lib/build.mjs --out /tmp/code-map-files.json
code-map inspect --worktree --change uncommitted --out /tmp/code-map-changes.json
code-map --json --ref HEAD --file lib/build.mjs --out /tmp/code-map-committed.json
```

Without `--out`, JSON goes to standard output, with no progress messages. Redirect it or pipe it to another tool. `inspect` and `--json` produce the same report format. An explicit `--out` names the JSON file; the normal HTML output setting is not used. `--compact` writes the JSON without indentation.

A whole-project report of a large project can be tens of megabytes. For agent work, start with `code-map inspect --summary` and follow the commands that it prints: [Summary-first inspection and stored analyses](retrieval.md) describes that workflow. It reads the same analysis as this report.

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
| `summary` | Project source count, selected file count, cycle counts, shared-type count, edges with unknown classifications, and the number of architecture-rule violations |
| `files` | Per-file size, churn, import evidence, production importers, candidate tests, exports, declarations, co-change partners, syntax errors (`syntax`) and operational patterns (`patterns`) |
| `cycles.all` | Strongly connected groups across all resolved source dependencies, with their internal edges |
| `cycles.value` | Groups across value and side-effect dependencies, including literal dynamic imports and `require` calls |
| `sharedTypes` | Type declarations whose consumers import them while the owner imports those consumers as values |
| `hotspots` | Up to ten selected files ranked by source lines multiplied by commit count |
| `rules` | The architecture rules from `.code-map.json`: `declared` (the text rules, then the [layer rules](retrieval.md#layers-and-owners) such as `layer:data -> ui`), `invalid` (not in the form `from -> to`) and `violations` (`rule`, `from`, `to` and the import `lines`, and `layers` with the two layer names for a layer break). A selection keeps the violations that touch it |
| `owners` | With CODEOWNERS or an ownership policy: the ownership `file` and the reported `files`, each with `path`, `owners` and matching `line` |
| `testSummary` | Test-quality summary: statistics, observations, next steps and limits. Whole-project reports use the project summary; file and change selections summarize the selection |
| `tests` | Test-quality evidence: test files, test cases, functions with failure exits or test links, fix commits, coverage state and label state |
| `limits` | Interpretation limits that travel with the report |

A report that comes from a stored analysis (`--analysis <id> --file <path>`) also has an `analysis` object with the ID and the freshness. Consumers must ignore fields that they do not know, because schema version 1 can get new fields.

For a file selection, cycles touching the selection retain all their members and edges. Shared-type candidates retain both sides of their evidence. Project totals in `summary` describe the full snapshot; `files` contains only the selected details.

### Dependency evidence

Each import edge records its source, target (or `null` when unresolved), source line, specifier, kind, mode, and imported type/value names.

- `kind`: `type`, `value`, `side-effect`, `dynamic-pattern`, or `unknown` for older facts without classification.
- `mode`: `static`, `dynamic`, `require`, or `type-query`; older unclassified facts use `unknown`.
- Mixed imports retain both type and value names. A non-type-only import containing only inline type specifiers is conservatively a side-effect edge: emitted module loading depends on compiler settings.
- Bare imports are side effects. Literal dynamic imports with options are included. Bounded relative template patterns expand into possible targets. Other nonliteral targets remain unresolved.

These are possible dependencies, not proof of calls, execution order, or runtime initialization defects. An acyclic value graph does not prove that dynamic wiring is acyclic.

### Declaration metrics

Each top-level declaration and class member records its inclusive line span, referenced internal modules, and hook call sites. Imported bindings are resolved within the source file, so a parameter that shadows an imported name does not count as that dependency. References in nested callbacks remain inside their enclosing declaration's metrics. Type references count as dependencies too.

Hook metrics include imported React hooks, aliases and namespace calls, plus imported custom names following the `useX` convention. Custom entries have `classification: "convention"`; they are candidates rather than verified hook implementations. Counts describe call sites, not the number of calls at runtime.

Each function, method, arrow function and class member with a body also records its `complexity`. The record has these fields:

- `start` and `end`: the first and the last line of the function itself, from 1. For `const run = (x) => {}`, `start` is the line of the arrow function, not of `const`. `code-map verify` uses these lines to join coverage to the function.
- `cyclomatic`: 1, plus 1 for each `if`, `?:`, `case` (not `default`), `for`, `for in`, `for of`, `while`, `do`, `catch`, `&&`, `||`, `??`, `&&=`, `||=` and `??=`. Optional chaining (`?.`) does not count.
- `nesting`: the maximum depth of `if`, loops, `switch`, `try` and `catch` in the body. A `try` block and its `catch` and `finally` blocks are one level. An `else if` stays at the level of its first `if`.
- `cognitive`: cognitive complexity under Campbell (2017). Each control structure adds one plus its nesting level.
  Controls include `if`, `?:`, `switch`, loops and `catch`. A switch counts once, regardless of its cases.
  Each `else if`, `else`, labelled jump and direct recursive call adds one without a nesting increment.
  Each sequence of matching `&&`, `||` or `??` operators adds one. A different operator starts another sequence.
  Parentheses and type-only assertions preserve sequences and direct recursion. Negated groups and call arguments have separate sequences. Logical assignments do not count.
  Nested functions inherit enclosing control levels and add one function level. Their totals stay in their own records.
  `try` and `finally` add no cognitive nesting. Unlabelled jumps and optional chaining add nothing.
- `functions`: the functions in the body, each with its `name`, its own lines and values and its own `functions`. An empty list is left out.

A nested function has its own values, and its body does not add to the enclosing function. It keeps its own name or its direct variable, property or class field name. A class field is a class property with a value.

A callback argument takes the variable name when its call initializes that variable. For example, `const send = useCallback(() => {})` gives `send`. This also works through `await`, `as` and parentheses around the call or callback. Other callback arguments use the callee name and its call position, for example `useEffect#1` or `map#1`. A property call uses its last name, so `list.map` gives `map`. Positions count all calls with that callee name in the same parent function, including calls without callbacks. Nested functions have separate counts. Multiple callbacks of one call share its name.

The remaining nested functions get `<anonymous 1>`, `<anonymous 2>` and so on, in source order. A declaration that is not a function records only `functions`. Examples include a class field, an object of functions, or a wrapper call such as `wrap(() => {})`. The record leaves out a class member that has its own record. Code-map applies no threshold to these values. They are measurements, not verdicts.

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

### Operational patterns and syntax errors

Each file record has two more fields. Older stored analyses do not have them.

- `syntax`: the result of the parser for the file. `errors` is the number of syntax errors that the TypeScript parser reports. `line` and `message` describe the first error, and they are null when `errors` is 0. The parser continues after an error, so the other facts of the file can be incomplete.
- `patterns`: the operational patterns of the file, in source order. Each item has `kind`, `line`, `scope`, `call` and `ordinal`. `kind` is `fetch-no-signal`, `interval-not-cleared`, `empty-catch` or `effect-no-cleanup`. `scope` is the name path of the enclosing declarations, and it is empty at the top level. An interval item also has `reason`. An effect item also has `hook` and `subscriptions`, each with `call` and `line`.

`ordinal` is the position among the items of the same kind with the same `scope` and `call`. Test files and test helpers have no `patterns`. [The retrieval reference](retrieval.md#operational-patterns-and-syntax-errors) tells what each pattern detects and lists its known false positives. The summary counts the files with syntax errors, also test files, in the gap `syntaxErrors`.

`files[].tests.direct` contains runnable tests that import the file itself. `transitive` contains other runnable tests that reach it through source files or helpers. Helper files pass imports along; they are not counted as tests when runnable tests are identifiable. Import reach does not establish assertions or executed coverage.

## Test quality

The test-quality scan finds functions whose failure exits have no failure test. It cannot judge whether an existing test checks the correct behavior. `testSummary.canAndCannot` carries this sentence, and `testSummary.limits` lists the limits of each signal.

### Evidence kinds

Each statistic, observation and next step has a `source`:

| `source` | Meaning |
| --- | --- |
| `inventory` | Counted in the test files: cases, statuses, test files that the scan cannot read or parse. Also the files in which the parser reports a syntax error. The supply-chain findings also use it: they come from the packages of the lockfile |
| `inferred` | A link from a test reference to a source function, or a failure assertion that the scan ties to a function. Check it in the code |
| `pattern` | A source pattern: failure exits, assertions, fixed waits, swallowed errors, tests with no assertion, the exports of a `'use server'` file, and operational patterns such as a `fetch` with no signal |
| `measured` | Working-folder coverage. It applies only to a working-tree map and is not tied to a revision |
| `git` | Commit history: bug-fix commits among the last 100, found by their subject |
| `model` | Optional labels from `docs/code-map/test-labels.json` |
| `graph` | The parsed import graph covers resolved edges, cycles, export use, architecture rules, and Next.js module classes. Package checks also read manifests and installed package folders. Possible dependencies, not proven calls. Findings use this kind; the test summary does not |
| `contract` | A file that declares names or operations, compared with the code: the names of an env template file, or the operations of an OpenAPI document. Findings use this kind. The test summary does not |

### Report fields

| Field | Contents |
| --- | --- |
| `testSummary.statistics[]` | `key`, `source`, `label`, `value`, `detail`, and `warn` when the value needs attention |
| `testSummary.observations[]` | `key`, `severity` (`high`, `medium`, `low`), `source`, `count`, `text`, `action` and up to eight `evidence` items: `path`, `line`, `text`, and for functions a `test` to start from |
| `testSummary.nextSteps[]` | `source`, `text` and `evidence` |
| `testSummary.counts` | The raw numbers behind the statistics, including `layers` and `intents` |
| `tests.testFiles[]` | `path`, `kind` (`tests`, `helper`, or `unrecognized` for a file named like a test with no recognized case), `framework`, `type` (the layer), `declared` and `inferred` layers, `effects`, `mismatch`, and `cases` (case IDs) |
| `tests.cases[]` | `id`, `path`, `name`, `suite`, `line`, `status` (`active`, `focused`, `skipped`, `todo`, `conditional`), `each` for a parameterized definition, `type`, `assertions`, `failures`, `kinds`, `failureTargets`, `evidence`, `smells`, `intent`, `intentState` and `regression` |
| `tests.units[]` | A top-level function, class or value with failure exits or direct test links: `key` (`path#name`), `line`, `exits` (`line`, `kind`, `hits`), `direct` (case IDs), `via` and `viaCases` (the first five cases that reach it through callers, each with its `route`), `failureDirect`, `viaFailure`, `candidates`, `status` and `affects` |
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

- A failure assertion is tied to the source names inside it, to the value that a checked local variable holds (`const r = parse(x)`), to the code in the `try` block or promise that a caught error comes from, and, for a local helper, to the names in the helper call's arguments. When a case references only one source function, its failure assertions are tied to that function.
- Only `active` and `focused` cases are evidence. Skipped and todo cases are inventory only. Conditional cases (`skipIf`, `skip: condition`) can only be candidates.
- A failure assertion about another function, a failure-like test name and a model label are `candidates`. They never change a status.
- A nested function in a test counts only where the test calls it.
- Failure exits inside a `catch` block belong to the catch. Each exit has a `hits` value only for a working-tree map with a coverage report: the line of an exit on its own line, the first statement of a catch block, or, for a one-line `if (bad) throw`, an Istanbul-style branch record with one block of two branches. V8-native reports, such as Node's own LCOV, number one-branch blocks in their own order, so such an exit stays `null`.
- A parameterized definition (`test.each`) counts once, because its row count is unknown.

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

`lib/rules.mjs` checks the architecture rules for the reports and for the viewer. `lib/source-metrics.mjs` adds binding-aware source facts, including failure exits and references between declarations, without typechecking or executing the inspected code. `lib/test-scan.mjs` reads test cases, `lib/test-assertions.mjs` classifies their assertions, and `lib/test-quality.mjs` links them to source functions. `lib/analysis.mjs` computes cycles, export usage, candidate tests, shared-type candidates, hotspots and the test-quality evidence. `lib/build.mjs` embeds those results as `DATA.analysis`; the viewer does not recalculate these checks.

`createReport(data, selection, summarize)` from `lib/analysis.mjs` selects a compact report; `summarize` is `summarizeTests` from `lib/test-summary.mjs`. The CLI calls them directly, and the same self-contained functions are embedded in the HTML for offline copy and download. Neither path needs an additional dependency or a model call.
