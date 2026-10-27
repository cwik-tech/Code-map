# Quality evidence after the audit

## Generated consumers (C29)

Stale-reference searches include readable generated code under `dist`, `build`, `out`, `.next` and other build folders.
These hits have `place: "generated"`.
The search retains the 1 MiB file limit and the 100-hit limit for each term.
It skips symlinks and binary files.
Dependency folders and lockfiles remain excluded.
Unavailable generated files and external consumers have no search evidence.
A text hit is a migration lead. It does not prove a semantic error.

## Size changes (C30)

Function comparison values include `lines` when both snapshots have function ranges.
The base and head values count both endpoint lines. The delta is head minus base.
Size-only changes remain in the growth or fall lists.
`complexity.areas` contains file and folder line totals with base, head and delta values.
Folder totals include unchanged siblings.
`complexity.areas.symbols` lists size changes for function and non-function declarations.
Duplicate declaration names, unconfirmed renames and incomplete rename discovery retain UNKNOWN matches.
Known size facts remain available when cognitive metrics are absent.
No size threshold applies.
Missing size evidence has no numeric delta.

## Ownership revisions (C31)

`comparison.policy` retains ownership restrictions and exceptions from each revision.
Each policy evaluates both snapshots with that snapshot's CODEOWNERS file.
`evaluations.basePolicy.head` exposes imports that a relaxed head policy hides.
`relaxed` includes ownership witnesses with the rule `OWNER-CROSS-IMPORT`.
Missing or unreadable ownership evidence stays UNKNOWN.
Rules, layers and cycle comparisons retain their existing behavior.

## Computed package loading (C32)

A computed loader with a bare or unknown prefix can reach declared dependency candidates.
Those candidates have no `PACKAGE-UNUSED` finding.
`packages.unknown.unused` names each package, its manifest and the loading sites.
Each site includes a path, line and fixed prefix. Each candidate has `state: "UNKNOWN"` and a reason.
Fixed relative prefixes do not hide unrelated package candidates.
Package ownership limits the uncertainty to the loader's package.
Inspection summaries expose the `dependenciesUnknown` evidence gap with up to three package examples and three loading sites for each example.

## Frozen advisory provenance (C34)

An advisory artifact accepts this envelope:

```json
{
  "snapshot": {
    "source": "OSV frozen npm export",
    "exportedAt": "2020-01-01T00:00:00Z"
  },
  "records": []
}
```

`records` contains OSV advisory records.
`exportedAt` identifies the frozen database export or retrieval time. `source` identifies that database export.
The bound artifact digest covers both provenance and records.
`executions[].osv.snapshotDate` comes from this explicit timestamp.
`provenance` carries the source, timestamp and state.
`executedAt` separately records the manifest's import time.
A legacy advisory array remains accepted. Its provenance is UNKNOWN and its snapshot date is null.
An advisory's publication or modification date never supplies the database timestamp.
Provenance describes the supplied artifact. It does not certify upstream truth or freshness.

## Declared safeguards (C35)

Add optional `safeguards` to `.code-map.json`:

```json
{
  "safeguards": [{
    "path": "src/api.ts",
    "symbol": "load",
    "retry": { "callee": "retry", "maxAttempts": 3 },
    "logging": { "callee": "logger.error" }
  }]
}
```

Policies apply only to collected source files. Test-file policies remain UNKNOWN.
Finding identities survive line moves and distinguish repeated calls.
Declare at most 100 policies. Each policy needs a repository-relative path and one function or method name.
Declare `retry`, `logging` or both. Each callee is an identifier or a dotted property path.
Retry checks support `callee(task, { maxAttempts: 3 })` inside the named function.
The literal attempt limit must be an integer from 1 to the declared maximum. The declared maximum cannot exceed 100.
Missing or excessive limits produce `RETRY-POLICY` findings.
Computed options, spreads, missing calls and ambiguous function names stay UNKNOWN with reasons.
Logging checks inspect catch blocks inside the named function. They skip nested functions.
A catch without the declared logger produces `LOGGING-POLICY`.
A direct logger call that names the caught error gives a syntax observation.
Conditional logging and indirect error arguments stay UNKNOWN.
The summary's `safeguards.items` lists FAIL, UNKNOWN and OBSERVED syntax results.
OBSERVED never means PASS. It does not prove that the retry wrapper enforces its limit or that a logger emits output.
Injected failure runs provide separate evidence for declared paths.
Code-map adds no retry or logging requirement to undeclared paths.

## Profile boundary

These changes preserve the checks and thresholds of `static-baseline-v0`.
The `evidence-v1` stale-reference check also sees generated-consumer hits.
The proposal records this evidence change after the audit.

## Static test evidence

Production maps preserve named, renamed and star re-export links for test attribution.
A test that imports a function through a barrel retains its link to the original declaration.
These links remain static evidence. They do not prove execution.

An enclosing skipped or todo suite keeps every child parked, including focused children.
An enclosing conditional suite keeps runnable children conditional.
Conditional cases stay in the inventory but do not count as running cases or failure evidence.
Focused runnable cases with no assertions receive the same warning as active cases.
Node test options accept quoted names such as `{'skip': true}` and shorthand names such as `{skip}`.
A shorthand option has an unknown value and retains conditional status.

Failure assertions attribute source references from the checked subject and the origins of local values or caught errors.
Expected operands, including an expected error constructor, do not receive failure attribution.

Scoped reports and summaries count all linked cases, including indirect cases beyond the five displayed routes.
Each unit retains complete indirect case IDs in `viaIds`. Its `viaCases` list keeps up to five routes for display.
Each test file retains its label freshness in `labelState`.
Scoped label statistics count only cases and test files linked to the selected source files.
