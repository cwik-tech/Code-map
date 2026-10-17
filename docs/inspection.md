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

## HTML controls

The self-contained page embeds the same shared analysis:

- Project and file Details have **Copy analysis JSON** and **Download JSON**. File exports contain only that file's details plus relevant cycle and shared-type evidence.
- **Backbone** and **Checks → Import cycles** switch between all dependencies and value dependencies. Backbone roles and placement still use the all-dependency graph; value mode filters its links.
- **Checks → Shared types** links each type declaration and both import directions.
- File Details sorts declarations by source order, size, dependency count or hook count. Opening a declaration shows referenced modules and hook call-site links.
- **Export usage** groups types, values, reexports and test-only consumers. **Hide primitive/vendor paths** filters those path-based candidates and JSON file details.

Reports describe the mapped source snapshot. The history slider changes historical sizes, not the parsed source snapshot, so JSON export is disabled at historical slider positions. Clipboard access can be unavailable for local files; use Download JSON in that case.

## Shared implementation

`lib/source-metrics.mjs` adds binding-aware source facts without typechecking or executing the inspected code. `lib/analysis.mjs` computes cycles, export usage, candidate tests, shared-type candidates and hotspots. `lib/build.mjs` embeds those results as `DATA.analysis`; the viewer does not recalculate these checks.

`createReport(data, selection)` from `lib/analysis.mjs` selects a compact report. The CLI calls it directly, and the same self-contained selector is embedded in the HTML for offline copy and download. Neither path needs an additional dependency or a model call.
