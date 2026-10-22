# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- Resolve nested TypeScript and JavaScript project aliases, references and local inherited paths from the mapped revision so UI dependencies and test links are retained.

- Restore blast-radius rendering for affected files and change sets while retaining co-change navigation.
- Recognize implemented function, method and constructor overloads and distinguish declaration-only exports from possible external providers and type-only imports.
- Keep absent or invalid LCOV data unknown across coverage views and avoid attributing working-folder coverage to Git snapshots.
- Describe import cycles, namespace references, line hits and co-change as bounded evidence rather than proof of runtime defects or assertions.

### Added

- Complete default workflow: incremental Claude file descriptions and test labels, supported tests, native Node coverage, all eligible mutations and the final map, with cached execution receipts, `--force`, explicit `all` and quick `build` commands.

- Test-quality scan and a top-level Tests tab: test inventory by layer and status, failure exits per function, failure assertions tied to the functions they check, routes through callers, fix commits with no test change, measured exit hits from working-folder LCOV, and a summary with statistics, findings, next steps and limits. Each signal names its kind of evidence. The summary is part of `code-map inspect` (`testSummary` and `tests`), Copy summary and Download JSON.
- Colour by failure tests, with evidence categories, and test layers and failure-test counts in Blast radius.
- A test lens on the map: the Tests tab turns on the failure-test colours, with measured evidence solid and inferred evidence hatched. Badges count gaps and undetected changes, function boxes show one dot for each failure exit, and an open function marks its failure exit lines.
- Assertion strength: each assertion is rated as exact, partial, snapshot, mock call, weak or a tautology, and each function shows the strictest check tied to it.
- `code-map mutate`: a targeted mutation check that removes failure exits and replaces return values in a private copy, runs the tests that reach them after a per-file baseline and a canary, and reports detected, survived, timeout and error outcomes. The map and `inspect` read its report, or a Stryker report, while the file is unchanged.
- Agent-ready next steps: each step for a function names its exits, a test to start from and a `verify` command, and `testSummary.agentGuide` explains how a new failure test is recognized.
- Optional model labels for test intent: `code-map labels`, `code-map labels stamp` and `--labels`, with per-case completeness and freshness.
- Shared structural analysis and compact JSON inspection for whole projects, selected files and change sets, available through the CLI and offline HTML copy/download controls.
- All/value dependency graph controls with source-line evidence, shared-type extraction candidates, declaration dependency and hook metrics, and grouped export usage with primitive/vendor filtering.

- Built-in Node regressions with isolated headless Chrome viewer checks via `npm test`.
- Apache License 2.0 (`LICENSE` and `NOTICE`).
- Contributor guide (`CONTRIBUTING.md`).
- Code of Conduct, security policy and support guide (`CODE_OF_CONDUCT.md`, `SECURITY.md` and `SUPPORT.md`).
- GitHub issue templates and a pull request template.
- README screenshots of the map of code-map's own code.

### Changed

- Require Node.js 22 or newer. Node.js 20 no longer gets security fixes.

- The project license changed from unlicensed to Apache-2.0.
- The README install steps use a generic folder path.

### Removed

- The optional test that needed a private project checkout (`CODE_MAP_HARNESS`).

### Security

- The chat server refuses requests addressed to other host names or sent from other origins, which blocks DNS rebinding.
- The chat starts Claude Code with only the `Read`, `Grep` and `Glob` tools, only the user's own settings, and no MCP servers. Before, a mapped repository's `.claude/settings.json` hooks ran commands, and the chat could see every MCP tool from the user's setup.
- Chat snapshots use a private temporary folder (mode 0700). code-map refuses the folder if it is a symlink, if another user owns it, or if other users can open it. It never deletes a folder that other users could change.
