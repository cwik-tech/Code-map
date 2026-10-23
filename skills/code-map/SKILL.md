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

## Interpretation traps

- A test import or `direct` failure-test status is static evidence, not a passing test run or proof of a correct assertion.
- An all-edge cycle can contain only type edges; inspect the value graph and source before alleging a runtime cycle.
- Unreferenced exports and co-change are leads, not proof of dead code or a hidden dependency.
- Existing LCOV lacks revision/command binding; optional model labels do not verify behavior.
- A finding is a lead with an evidence kind (`source`), not a PASS or FAIL result. The summary shows `verification.state: "NOT_RUN"`: no ratings or readiness exist yet.
