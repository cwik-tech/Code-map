# Verification roadmap documentation audit

Date: 2026-10-23. Source: code at `8c648f1`, CLI help, parser definitions and the external stream notes.
Scope: the changelog, current status, README tables and a replacement table for section 4 of the specification.
The specification itself is unchanged.

| Document | Discrepancy | Source | Resolution |
| --- | --- | --- | --- |
| `CHANGELOG.md` | Worker entries repeat. Some claims predate execution support | `lib/verify-exec.mjs`, `lib/worker/run.mjs` | Consolidate the roadmap changes and distinguish v0 from proposed v1 |
| `docs/status.md` | Several sections give different current states for the same items | Current source and stream notes | Replace them with one dated capability view and open decisions |
| `README.md` | Command and option tables omit implemented interfaces | `bin/code-map.mjs`, `lib/cli-help.mjs` | Add the missing commands, options and aliases |
| `README.md` | Folder rows hide module names. Oracle readers are absent | Tracked module inventory | List every runtime module in the main file table |
| `README.md` | The map-script warning contradicts the package scripts | `package.json` | Correct the warning |
| External specification table | Earlier states omit the roadmap additions | Sources cited in each replacement row | Supply C01 to C45 with bounded states and remaining work |

No product rule was approved. No production code changed.
Gate results live in [the current status](../status.md#gates).
The changelog describes the roadmap delta from `ed3c5b0`.
Earlier unreleased baseline details remain in Git history at that commit.
