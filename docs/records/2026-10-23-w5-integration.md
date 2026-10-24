# W5 integration record

Date: 2026-10-23.
Source: the integrator3 brief and the ten completed stream branches.
Integration branch: `cwik-tech/integrator3`, based on `99a100b`.
Target branch: `cwik-tech/roadmap-integration`.

Each stream had a clean worktree and a final commit whose subject contained `review fixes`.
Each final commit was at least five minutes old before its merge.
Ready streams advanced while earlier streams settled. Types merged last.
No branch was omitted. No other worktree was edited. Nothing was pushed or tagged.
Each stream note was copied to the brief's external notes folder and removed from its merge commit.

## Merge choices

| Order | Branch suffix | Merge | Conflicts and resolution |
| --- | --- | --- | --- |
| 1 | `w5-contracts` | `05fa316` | No conflict |
| 2 | `w5-supply` | `cef4d6a` | Keep contract and supply documentation. Keep the expanded lockfile description and route harness inventory. Keep the current C33 and new C34 rows |
| 3 | `w5-discovery` | `9673607` | Combine agent and skill guidance. Keep contract information beside bundle, complexity and completeness fields. Keep current C33 and C34 beside new C32 |
| 4 | `w5-review` | `fff4e0d` | Retain both CLI commands and imports. Keep generated oracle links beside all existing verification fields. Combine reference sections |
| 5 | `w5-coverage` | `767a573` | Keep measured coverage and generated oracle Markdown sections. Keep every verifier import. Combine baseline compatibility normalizations and status descriptions |
| 6 | `w5-signing` | `e22e9c3` | Keep OSV text beside signatures and environment comparisons. Preserve base coverage collection with signature keys. Keep the new C38 and C39 beside current C40 |
| 7 | `w5-policy` | `ee6774f` | Retain migration, public scope and policy fields beside all prior results. Combine baseline assertions and reference sections. Keep each capability's current row |
| 8 | `w5-harness` | `39b3a49` | Union route, Zod and fault modes in schemas, report validation and copied scripts. Keep route documentation beside new mode descriptions and side effects. Preserve both module inventories |
| 9 | `w5-runners` | `715cd4f` | Union OSV and new discovery kinds. Keep discovery budgets beside signing and base coverage. Preserve both reference texts and every harness module |
| 10 | `w5-types` | `e7aa664` | Union compiler file reports with all report kinds. Keep compiler, migration and signing configuration checks. Preserve all collected facts, report sections and verifier result arrays |

The finding registry and retrieval rule table retain `MIGRATION-USE` and every prior rule.
README module and option tables retain the additions from every stream.
The status page has one current row for each capability.

## Integration corrections

The merged collector had two declarations named `packages`.
Compiler release metadata now uses `packageVersions`. Package discovery retains its separate result.
The existing compiler CLI and bound-report tests reproduced the collision before the correction.

A report with compiler, oracle and measured coverage sections exceeded the Markdown limit.
A new regression combines those sections with execution, mutation and size information.
The renderer reduces displayed information lists after reducing check rows.
It preserves each section and all JSON records. Default list limits remain unchanged for shorter reports.

The integration did not add dependencies, change profile thresholds, create a migration or approve evidence-v1.
No new architecture decision was required. These choices preserve the existing interfaces and stream features.

## Evidence and handoff

The current gate results live in [status](../status.md#gates).
The external integrator note retains exact commands, results and each conflict path as the brief requires.
Stream notes retain the earlier review observations and limits.

Run these commands in the checkout that owns the target branch:

```sh
git switch cwik-tech/roadmap-integration
git merge --no-ff cwik-tech/integrator3
```

Likely conflicts if the target has moved: README, agent and skill guides, `docs/status.md`,
`docs/retrieval.md`, `docs/verify.md`, `bin/code-map.mjs`, `lib/build.mjs`,
`lib/verify.mjs`, `lib/verify-reports.mjs` and `lib/verify-report.mjs`.
No migration or dependency installation is required. Preserve the current dependency setup.
