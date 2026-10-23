# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- The analysis store refuses a root folder that another user owns (a system folder with the sticky bit, such as `/tmp`, is allowed), and it reads a stored file through one open file that does not follow a symlink.
- A report that `inspect --analysis … --out` writes is private and goes through a new temporary file and a rename, so it never writes through a symlink at the target.
- `code-map --worktree` and `inspect --worktree` no longer rewrite `.git/index`: Git commands that compare with the working tree run on a private copy of the index.
- Files whose names have non-ASCII letters or a double quote stay in the map, its history and its change sets. A file whose name has a line break is left out, so that other files keep their own content.
- The architecture-rule check no longer slows down on a rule with a long run of spaces.
- Resolve nested TypeScript and JavaScript project aliases, references and local inherited paths from the mapped revision so UI dependencies and test links are retained.

- Restore blast-radius rendering for affected files and change sets while retaining co-change navigation.
- Recognize implemented function, method and constructor overloads and distinguish declaration-only exports from possible external providers and type-only imports.
- Keep absent or invalid LCOV data unknown across coverage views and avoid attributing working-folder coverage to Git snapshots.
- Describe import cycles, namespace references, line hits and co-change as bounded evidence rather than proof of runtime defects or assertions.

### Added

- `code-map verify --request <file>`: check one change against the rule set `static-baseline-v0`. It gives four separate ratings, one readiness state and an exit code (0 READY, 1 REVIEW, 2 BLOCKED, 3 INSUFFICIENT_EVIDENCE, 4 invalid request), and it writes a Markdown report and JSON results into a private run folder outside the repository. It runs no project code.
- `code-map manifest`: write the run manifest of a test report that your own test run wrote, so that `verify` can bind the report to the analyzed code.
- `code-map inspect --summary`: analyze a snapshot once, store the analysis outside the repository, and print a small overview with findings, evidence gaps and an exact follow-up command for each finding. Unchanged inputs reuse the stored analysis.
- `code-map inspect --analysis <id>` with `--finding`, `--findings` (and `--rule`), `--file`, `--part`, `--offset`, `--limit` and `--full`: read one stored analysis without collecting again, with a freshness check and paged evidence lists.
- `--base <ref>` and `--base-analysis <id>` (with `--baseline`): compare the findings of two snapshots as new, existing, resolved or unknown, through Git renames and with comparability checks.
- Findings with stable IDs, severities, evidence kinds and capability numbers, including relative imports that match no file, imports of names that the imported file does not export, and architecture-rule breaks.
- The analysis store (`--store`, `CODE_MAP_STORE`) and compact JSON output (`--compact`).
- Architecture rules in inspection reports: `rules` and `summary.ruleViolations`.
- Verification core and report adapters, not yet used by a command: category ratings, readiness, request validation, JUnit XML, Jest and Vitest JSON, and run manifests.
- Test-quality scan and a top-level Tests tab: test inventory by layer and status, failure exits per function, failure assertions tied to the functions they check, routes through callers, fix commits with no test change, measured exit hits from working-folder LCOV, and a summary with statistics, findings, next steps and limits. Each signal names its kind of evidence. The summary is part of `code-map inspect` (`testSummary` and `tests`), Copy summary and Download JSON.
- Colour by failure tests, with evidence categories, and test layers and failure-test counts in Blast radius.
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

- The page reads architecture-rule breaks from the shared analysis, and each break records its import lines.
- An invalid command-line option prints a short message and exits with status 1.
- The project license changed from unlicensed to Apache-2.0.
- The README install steps use a generic folder path.

### Removed

- The optional test that needed a private project checkout (`CODE_MAP_HARNESS`).

### Security

- The chat server refuses requests addressed to other host names or sent from other origins, which blocks DNS rebinding.
- The chat starts Claude Code with only the `Read`, `Grep` and `Glob` tools, only the user's own settings, and no MCP servers. Before, a mapped repository's `.claude/settings.json` hooks ran commands, and the chat could see every MCP tool from the user's setup.
- Chat snapshots use a private temporary folder (mode 0700). code-map refuses the folder if it is a symlink, if another user owns it, or if other users can open it. It never deletes a folder that other users could change.
