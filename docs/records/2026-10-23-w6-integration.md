# W6 integration record

Date: 2026-10-23.
Source: the integrator4 brief and the final committed W6 stream notes.
Worktree branch: `cwik-tech/integrator4`. Base: `c60f5aa`.
Only this worktree was changed. No tag or push was created.
Current gate results live in [status](../status.md#integration-gates).

## Merges and conflict decisions

Each source passed the required review-fix subject, clean-worktree and commit-age checks.
Weakening review and trust tiers merged after the other streams.
Each stream note was copied to the external handoff folder and removed from its merge tree.

| Branch | Source | Merge | Resolution |
| --- | --- | --- | --- |
| `cwik-tech/w6-timings` | `500e530` | `b15d270` | No conflicts. |
| `cwik-tech/w6-fuzz-coverage` | `61baef0` | `8c72f04` | No conflicts. |
| `cwik-tech/w6-schema-rollout` | `dfc248a` | `584b5d8` | Retain coverage.mjs and migrate.mjs in copied harness sources. Retain timing and schema report sections. Combine appended documentation. Derive capability totals from rows. |
| `cwik-tech/w6-diagnostics` | `c074a8c` | `e46efd1` | Retain compiler, timing and rollout report sections. Retain both imports and all appended documentation. Remove completed work items. |
| `cwik-tech/w6-revision-deps` | `5ec638d` | `316ac2b` | Keep install and timing CLI options. Keep benchmark measurements and route ordinary runs through dependency preparation phases. Preserve revision dependency metadata in report inputs and results. |
| `cwik-tech/w6-events` | `c5a01e5` | `ba455f2` | Union benchmark and trace report kinds and stored artifact names. Keep both dispatch branches. Compose trace retrieval with compiler retrieval. Preserve install and tracing options, migrated harness display, all documentation and capability rows. |
| `cwik-tech/w6-example-types` | `9afd3f8` | `6ffd13f` | Source changes merge automatically. Retain both documentation texts. Preserve completed capability rows and remove stale remaining-work items. |
| `cwik-tech/w6-generated-mutation` | `6f307af` | `ade3e0e` | Retain benchmark validation and mutation artifact validation. Preserve all result fields and add generated mutation report lines alongside compiler, timing and rollout sections. |
| `cwik-tech/w6-weakening-review` | `b339a08` | `3aa9952` | Keep all CLI options and documentation. Preserve the proposed profile review check and legacy v0 behavior. |
| `cwik-tech/w6-trust-tiers` | `e7a263d` | `778c370` | Preserve install and trust authorization fields and validators. Apply trust filtering before every adapter, including benchmarks and traces. Retain dependency metadata and all report dispatch branches. Keep all documentation. |

## Integration corrections

The schema conflict resolver truncated files. Existing stream checks exposed the error.
Commit `0592936` restores complete parent content and retains both features.
The final split moves stdout formatting to `lib/verify-summary.mjs`.
It moves report case parsing to `lib/adapters/report-cases.mjs`.
Public exports remain available through their original modules. No test changed for the split.
The help text has one combined `--base` description.
The capability table retains one current row per capability.
All stream branches are merged. No branch timed out.

## Qualification limit

The full-suite model-review abort failure originates in unchanged code and reports a process-termination permission error.
An isolated run does not erase that failure. No unrelated process-handling code was changed.

## Test commands

- `w6-timings`: `node --test test/bench.test.mjs test/bench-worker.test.mjs test/bench-verify.test.mjs test/docs.test.mjs`
- `w6-fuzz-coverage`: `node --test test/harness-fuzz-coverage.test.mjs test/harness-extensions.test.mjs test/docs.test.mjs`
- `w6-schema-rollout`: `node --test test/harness-migrate-review.test.mjs test/harness-migrate.test.mjs test/schemas-rollout.test.mjs test/docs.test.mjs`
- `w6-diagnostics`: `node --test test/compiler-cli.test.mjs test/compiler-lifecycle.test.mjs test/docs.test.mjs`
- `w6-schema-rollout-initial`: `node --test test/harness-migrate-review.test.mjs test/harness-migrate.test.mjs test/schemas-rollout.test.mjs test/docs.test.mjs`
- `w6-revision-deps`: `node --test test/worker-install-cli.test.mjs test/worker-install-record.test.mjs test/worker-install-review.test.mjs test/worker-install.test.mjs test/docs.test.mjs`
- `w6-events`: `node --test test/xstate-trace.test.mjs test/compiler-cli.test.mjs test/docs.test.mjs`
- `w6-example-types`: `node --test test/example-types.test.mjs test/docs.test.mjs`
- `w6-generated-mutation`: `node --test test/generated-mutation.test.mjs test/verify-exec-request.test.mjs test/docs.test.mjs`
- `w6-weakening-review`: `node --test test/weakening-records.test.mjs test/weakening-review-fixes.test.mjs test/weakening-review.test.mjs test/docs.test.mjs`
- `w6-trust-tiers`: `node --test test/trust-cache.test.mjs test/trust-cli.test.mjs test/trust-tiers.test.mjs test/docs.test.mjs`
- `full-suite`: `node --test --test-concurrency=4 test/*.test.mjs`
- `repair-alone`: `node --test test/repair.test.mjs`
- `model-review-alone`: `node --test test/model-review.test.mjs`
- `post-split-tests`: `node --test --test-concurrency=4 test/verify.test.mjs test/verify-report.test.mjs test/verify-report-streams.test.mjs test/manifest-mixed.test.mjs test/generated-mutation.test.mjs test/evidence-v1-cli.test.mjs test/docs.test.mjs test/compiler-cli.test.mjs test/bench-verify.test.mjs test/trust-tiers.test.mjs`

## Local integration

Source: `cwik-tech/integrator4`. Target: `cwik-tech/roadmap-integration`.
Run in the target checkout:

```sh
git switch cwik-tech/roadmap-integration
git merge --no-ff cwik-tech/integrator4
```

Likely conflict paths: `README.md`, `docs/status.md`, `docs/verify.md`, `bin/code-map.mjs`, `lib/verify.mjs`, `lib/verify-reports.mjs` and `lib/worker/`.
No dependency installation or data migration is required.
