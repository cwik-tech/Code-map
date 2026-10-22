# Complete workflow

Run `code-map`, `code-map all`, or `npm run map` in a trusted repository. The default selects the working tree, including uncommitted files. Use `--ref <revision>` to select committed files instead.

The first run performs these steps, in order:

1. Collect source, dependencies, test inventory and structural checks.
2. Run supported discovered tests in a private temporary snapshot. Failed tests stop the workflow. Native Node tests also write LCOV to `coverage/lcov.info`, or the configured `coverage` path.
3. Generate missing or changed file descriptions and test intent labels through the installed Claude Code login. Source text is sent to Claude in sequential batches. Model output is validated for exact file paths, all requested cases and allowed intents before it is stored.
4. Attempt every discovered mutation candidate, using the existing per-file passing baseline and canary checks. Tests and mutations execute sequentially. The targeted `mutate` command retains its separate default budget.
5. Write the mutation report and execution receipt, then rebuild the HTML with descriptions, labels, coverage, mutations and structural analysis.

The report is `docs/code-map/mutation.json`. Its `workflow` field records the input fingerprint, completion state, test receipts, unsupported test files and generated coverage hash. These are runtime artifacts; development gate history lives in [status](status.md).

## Subsequent runs

Descriptions use source-content hashes, so a body change triggers a refresh even when exports stay the same. Test labels use full test-file hashes and require a label for each discovered case. Completed enrichment batches survive interruption and are reused on retry. Manually written descriptions without a source hash are reviewed once by the complete workflow.

Test and mutation results are reused only when the selected snapshot, repository inputs (including fixtures, manifests and lockfiles), tool code, runtime platform/version, configuration and mutation options match a complete receipt. Generated outputs are excluded from that fingerprint. Missing or modified generated Node coverage invalidates reuse. HTML is rebuilt even when the expensive stages are reused.

The fingerprint does not certify unchanged external services, environment variables or manually modified dependencies with unchanged lockfiles. Use `code-map --force` after those changes. This repeats tests and mutations; unchanged descriptions and labels remain reusable.

## Commands and controls

```sh
code-map                         # complete incremental working-tree run
code-map all                     # same workflow explicitly
code-map --force                 # repeat execution checks
code-map --ref HEAD              # complete committed-snapshot run
code-map build --worktree        # quick page only
code-map inspect --worktree      # structural JSON only
```

`--out` selects the final HTML path; `--mutation`, `--labels` and `--descriptions` select their own artifacts. `--file` and `--function` restrict mutation scope in a complete run; descriptions and labels still cover the project. `--max-mutants` can bound execution, but a budget that leaves candidates unchecked causes an incomplete run with a nonzero exit. No such budget is imposed by default. `--timeout` is a positive integer in seconds per test process; verification defaults to 300 seconds, and mutations retain their baseline-derived limit.

## Limits and recovery

- Claude Code must be installed and logged in when enrichment is needed. `CODE_MAP_CLAUDE` overrides its executable. The process has no tools, MCP servers or hooks and runs outside the mapped repository. Each model request times out after five minutes. Invalid, incomplete or unavailable model output stops the full run; `build` and `inspect` remain available without Claude.
- Node, Vitest and Jest use the existing runner detection. Playwright, Cypress, live, smoke, performance and unsupported test runners are reported as skipped. The workflow does not install runners or coverage plugins. Native Node coverage is automatic; other runners' coverage still comes from their own configuration.
- Only discovered top-level functions with recognized failure exits or test links are mutation candidates. Each function has at most three return-value mutants in addition to failure-exit mutants. Unreachable functions, unsupported runners and copies that tests do not load remain explicit evidence gaps. “Complete” means that the workflow attempted all candidates in its selected scope; it does not mean all behavior is tested.
- A survivor means that selected tests did not detect the change; it can be equivalent. Timeouts, invalid mutants, excluded baselines and runner errors remain distinguishable. Partial budgets, excluded/failing baselines and runner errors prevent a reusable complete receipt.
- A failed run can leave completed descriptions, labels or coverage available for retry. It does not replace the HTML with a purportedly complete map. If repository inputs change during a run, execution results are rejected and the command asks for a rerun.
- Coverage retains the existing provenance limits: line hits are not assertion evidence, and committed/historical views do not claim working-tree coverage.
