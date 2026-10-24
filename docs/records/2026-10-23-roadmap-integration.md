# Reviewed roadmap stream integration

Date: 2026-10-23. Source: the user-supplied integrator brief and the reviewed stream commits.

The integration branch starts at `d7efbee`. It merges merge-2a, w2-tests, w2-worker, w2-impact, w2-contracts-env, w2-layers, w2-packages and w2-cache in the requested order. A final documentation commit from merge-2a follows its initial merge and precedes w2-worker. Each remaining stream meets its clean-worktree and commit-age conditions. Stream notes are retained outside the repository, as the brief requires.

Conflicts preserve every report kind and dispatch path, finding rule, CLI view, summary section and result field. Stored worker runs retain isolated attestation. Compiler, LCOV, Istanbul, size, audit and discovery reports keep their separate uses. Audit and test-information observations do not acquire new rating conditions. Model, schema, framework, environment, contract, supply, package, architecture and impact reports remain available together.

Input hashing combines the new file classes and install-state inputs. It retains the environment stream's exclusions for secret values and protected symlink targets. The cache uses the final analyzer facts and preserves schema inventory in stored analyses.

Three modules exceeded the source-line limit after merging. Command help moves to `lib/cli-help.mjs`, summary gaps move to `lib/overview-gaps.mjs`, and coverage text moves to `lib/verify-coverage-text.mjs`. The split changes no test. A separate integration correction extends a model test's pinned summary-key list for the architecture and documentation sections.

No dependency, migration, version bump, tag or push is part of this integration. No ADR is needed because the merge combines existing decisions. Detailed conflict notes and command logs are retained in the external notes folder named by the brief. Gate evidence is in [the integration status](../status.md#roadmap-integration-2026-10-23).

## Baseline finding

The complexity range test in `test/complexity.test.mjs` expects an anonymous callback name. The original base and the integration both return the stable call-position name `map#1`. A temporary archive of `d7efbee` reproduces the same mismatch. This predates the integration. The merge leaves the test and the analyzer unchanged. Exact run evidence is in the status section linked above.
