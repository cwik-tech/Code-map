# Code-map for AI agents

Code-map can help agents find possible dependencies, importers and candidate tests. Its collector exposes structured source facts; the HTML presents the same facts for human inspection.

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

For agents, use `code-map inspect` (or `code-map --json`) for a compact report on selected files or a change set. Repeat `--file` with exact repository-relative source paths, select `--change latest|branch|uncommitted`, and use `--out` to save JSON instead of printing it. Reports omit source bodies and full history, include evidence lines, and distinguish all-dependency cycles from value-dependency cycles. See [the inspection reference](docs/inspection.md) for the schema and limits. Static collection needs no server or model call.

The shared `analyzeProject(data)` and `createReport(data, selection)` exports in `lib/analysis.mjs` supply both CLI output and offline HTML inspection. Source metrics distinguish shadowed import bindings, declaration spans and imported hook call candidates. Shared-type entries identify a parent/child import pattern, not a mandatory refactor.

## Interpret the signals

An import is a possible dependency, including type-only imports. Cycles in this graph do not establish runtime initialization cycles. Namespace imports are possible references to every export, not proven calls. Co-change without an import link is correlation, not a demonstrated hidden dependency.

Test reachability is not executed coverage. A function body is not proof of correctness. Matching function, method and constructor overload implementations suppress declaration-only flags (static and instance scopes stay separate; abstract and ambient bodyless members remain flagged); reexports are not local missing bodies. Declaration-only exports can have external runtime providers that this parser does not resolve. `uses` retains all names for navigation; `valueUses` excludes explicit type-only imports and reexports, but does not prove execution.

LCOV is read from the working folder without revision or test-command binding: absent, invalid or zero-instrumented entries stay unknown, and commit maps and historical slider snapshots do not claim measured coverage. Even working-tree line hits prove neither assertions nor behaviour.

Dynamic wiring can escape the graph. Description freshness tracks exported names, so “current” does not certify unchanged behaviour. Confirm each suspected omission against source, contracts and real tests; retain the existing acceptance gates.

## Try it and measure

For a small paired trial, use independent reviewers with the same revision, scope, model and instructions. Give one the usual inputs and the other those inputs plus the Code-map report. Keep their notes separate until both finish. Compare confirmed unique findings, false alarms, time and preparation cost. Record examples where the map changed a decision; report a single pair as exploratory, not proof of a general quality gain.
