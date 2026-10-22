# Default workflow decision, 2026-10-21

Source: the user's request to run labeling and other stages together by default, followed by approval to extend the workflow and reuse unchanged results. The user confirmed that a first run without a map should include everything.

The default `code-map` command now selects the working tree and coordinates enrichment, supported tests, Node coverage, mutation checks and HTML generation. `code-map all` is an explicit alias. `build` preserves the previous page-only operation; structural `inspect` stays read-only. Implementation and cache limits are documented in [the workflow reference](../full-run.md), and verification evidence belongs in [status](../status.md).

The approval covers using the installed Claude login for descriptions and labels and running this repository's tests and mutations. It does not require adding dependencies, changing authentication, committing or pushing. No ADR is needed: the CLI default and cache format are reversible local interface choices.
