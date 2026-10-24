# Measured coverage information

`code-map verify` writes `coverageEvidence` beside the existing `coverage` rating input.
It uses only reports whose manifests bind to the analyzed revision and artifact digest.
These observations do not add checks or change rating inputs under either profile.
V0 keeps its original treatment of source maps in `coverage`.
Use [bound coverage reports](verify.md#bound-coverage-reports) to supply LCOV or Istanbul JSON artifacts.
Bind each base report immediately after its base run. Bind each head report after its head run.
Add both artifact and manifest pairs to `reportInputs`.
A base report remains ineligible for head rating conditions. It supplies the informational base view.

## Result fields

`coverageEvidence` is null when neither revision has a usable bound coverage report.

| Field | Meaning |
| --- | --- |
| `project` | Head report totals and a file page |
| `baseProject` | Base report totals and a file page |
| `changed` | Changed-code counters after source map remapping, with column-aware function joins |
| `lost` | Coverage lost on unchanged lines through the adjusted base-to-head diff |
| `unexecutedExports` | Exactly joined exported functions with measured zero hits |
| `mapping` | Per-artifact source map counts, revision side, unmapped measurements and unsupported-map errors |

Each project view has `totals.lines`, `totals.statements`, `totals.branches` and `totals.functions`.
Each available measure has `covered` and `total`. An unavailable measure is null.
A zero total means that the report recorded no items. It does not establish complete instrumentation.
LCOV supplies lines, branches and optional functions. Istanbul supplies statements, branches and functions.
Code-map never derives statement counts from line counts.
LCOV records are already in source coordinates. Code-map does not remap them.
Totals include unchanged files and all report files, including measured tests.
They describe the report scope. They do not prove complete instrumentation of the repository.
Reports of one kind merge by source location, with the highest count retained.
Istanbul takes precedence over LCOV for branches and functions of the same file.

`files` has `total`, `offset`, `limit`, `nextOffset` and `details`.
The stored result shows the first page of at most 50 files. Totals are never truncated.
Each file gives all four measures beside its repository-relative `path`.
The pure `projectCoverage(reports, { offset, limit })` API selects subsequent pages from loaded bound reports.
Its limit is capped at 50. The CLI stores only the first page.
`coverageLoss` and `executedExports` accept the same page options.
The existing `coverageSection` API caps changed file details and uncovered items separately.

## Source maps and function joins

A flat Source Map v3 object in `inputSourceMap` remaps statement, branch and function ranges before the changed-line join.
Code-map decodes signed base64 VLQ segments and uses the nearest preceding segment on the same generated line.
It resolves sources relative to the generated file and `sourceRoot`.
It never reads source paths from disk. Paths outside the repository do not count.
Indexed maps, source URLs and malformed maps are unsupported and appear in `mapping.errors`.
Decoding stops above five million mapping characters, one million generated lines or one million segments.
Missing endpoints, unknown columns and ranges across sources remain unmapped.
`mapping.unmapped` counts excluded statements, functions and branch paths.
An unsupported map excludes its entry, without falling back to generated coordinates.
Source map contents are self-attested instrumentation metadata. A bound digest does not prove that they are accurate.

Functions join by file and start line. When both records have columns, the join also requires the same start column.
A collision remains `ambiguous`. Missing analysis functions remain `missing`.
Old cached records without columns cannot resolve a collision.
Named declarations use the name column. Anonymous functions use the function expression start column.
A producer with different declaration conventions can leave a function unmatched.
`unexecutedExports.evidence` is `measured function hits`.
Its `measured` denominator includes exactly joined exported functions with counters.
Its `total` counts those functions with zero hits. Missing counters never mean zero hits.
An executed function is not proof of an executed assertion or correct behavior.

## Adjusted base comparisons

`lost` compares measured base lines and branch paths with their measured head counterparts.
Zero-context Git hunks adjust unchanged base lines after insertions and deletions.
Rename patches use their old and new paths. Changed or deleted lines do not count.
A branch range that intersects an edit does not count as unchanged.
LCOV matches line, block and branch IDs. Istanbul matches mapped range, branch type and arm index.
Different producer conventions or changed IDs can prevent a comparison.
Absent head counters remain unmeasured. They never count as lost coverage.
`lost.comparable` reports whether both revisions supplied bound reports, not complete counter correspondence.
`lost.totals` gives complete lost line and branch counts.
Each file keeps at most 20 line witnesses and 20 branch witnesses, with complete per-file totals.
The Markdown report shows bounded project totals and measured export gaps.
The JSON result retains the adjusted base/head line witnesses.
