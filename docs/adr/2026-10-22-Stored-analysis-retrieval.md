# 2026-10-22 Stored analysis with summary-first retrieval

## Status

Proposed on 2026-10-22. The user asked for one analysis with a small overview and retrievable evidence. The ID scheme, the store location and the response types below wait for the user's acceptance.

## Context

A whole-project `inspect` report of a large project was 47,755,861 bytes of indented JSON (32,577,412 compact). Most of the size was 231,016 file-to-test links, with up to 1,108 tests for one source file. Agents cannot read such a report, and a file selection does not make collection cheaper. Agents also need follow-up questions to read the same snapshot as the first answer, and to know when the code changed after it.

Constraints: collection is read-only and never runs project code. The schema version 1 report must not change for existing consumers. TypeScript is the only runtime dependency.

## Options considered

| Option | For | Against |
| --- | --- | --- |
| A. Several report sizes (small, medium, full) | No store | Agents must choose a report before they know what they need. Each size runs the full collection again. Follow-ups can read a different snapshot |
| B. One stored analysis, a summary, and retrieval by analysis ID | One collection per snapshot. Follow-ups are fast and bound to the snapshot. Full lists stay available through pages | A store to manage. An ID scheme and new response types become a public interface |
| C. A cache for each file, with incremental analysis | Cheaper first runs on large projects | Much larger change to the collector. It does not answer the snapshot-binding question by itself |
| Store inside `.git` of the mapped repository | Travels with the repository | Writes into the repository, which breaks the read-only promise |
| Store in a user cache folder outside the repository | The repository stays untouched | One more location to explain; agents in a sandbox can need `--store` |

## Decision

Option B, with the store in a user cache folder outside the repository. The analysis ID is a hash of the inputs that decide the analysis, so the same inputs reuse the stored analysis. Follow-up commands read the stored analysis by ID, report its freshness, and never collect again.

## Consequences

- An agent starts with a summary of tens of kilobytes and follows exact commands to one finding or one page of evidence.
- The response types (`code-map-summary`, `code-map-finding`, `code-map-findings`, `code-map-evidence`) and the ID formats are a public interface. A change needs a new schema version.
- The first summary still costs a full collection. Option C stays open for later.
- Every new analysis input must join the input manifest (`lib/inputs.mjs`), or a stored analysis can be reused for changed inputs.

## Revisit when

A large project needs a faster first run (consider option C), the store needs sharing between machines, or the user chooses another store location.
