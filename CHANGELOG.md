# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- Restore blast-radius rendering for affected files and change sets while retaining co-change navigation.
- Recognize implemented function, method and constructor overloads and distinguish declaration-only exports from possible external providers and type-only imports.
- Keep absent or invalid LCOV data unknown across coverage views and avoid attributing working-folder coverage to Git snapshots.
- Describe import cycles, namespace references, line hits and co-change as bounded evidence rather than proof of runtime defects or assertions.

### Added

- Built-in Node regressions with isolated headless Chrome viewer checks via `npm test`.
- Apache License 2.0 (`LICENSE` and `NOTICE`).
- Contributor guide with Developer Certificate of Origin sign-off (`CONTRIBUTING.md` and `DCO`).
- Code of Conduct, security policy and support guide (`CODE_OF_CONDUCT.md`, `SECURITY.md` and `SUPPORT.md`).
- GitHub issue templates and a pull request template.
- README screenshots of the map of code-map's own code.

### Changed

- The project license changed from unlicensed to Apache-2.0.
- The README install steps use a generic folder path.

### Removed

- The optional test that needed a private project checkout (`CODE_MAP_HARNESS`).

### Security

- The chat server refuses requests addressed to other host names or sent from other origins, which blocks DNS rebinding.
- The chat starts Claude Code with only the `Read`, `Grep` and `Glob` tools, only the user's own settings, and no MCP servers. Before, a mapped repository's `.claude/settings.json` hooks ran commands, and the chat could see every MCP tool from the user's setup.
- Chat snapshots use a private temporary folder (mode 0700). code-map refuses the folder if it is a symlink or if another user owns it. If an older code-map left the folder open to other users, code-map deletes it and creates it again, empty.
