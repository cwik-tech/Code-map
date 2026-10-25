# Changelog

All notable changes are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- Keep compiler evidence specific to each language and accept Pyright file-level diagnostics and Ruff fixes with null titles.

- Cache path-start candidates and helper assertions to avoid repeated file scans.

- Discover conditional test aliases and cases in suite registrars.
- Tie failure assertions in local and imported test helpers to their checked parameters.
- Remove false failure-test gaps when helper assertions check the failure exits.
- Report the hotspot count window separately from the history strip limit.
- Recognize entry files started by literal paths and package scripts.

- Count pytest assertion APIs through aliases, direct imports and context managers.
- Retry Python parser batches in halves after time or output limits and report retry counts.
- Scan Python test patterns outside testpaths, report default collection membership and exclude helpers from unreadable tests.
- Mark protected Python imports as optional and count unresolved optional imports without unresolved findings.
- Remove Python self-import edges while retaining cycles between distinct modules.

- Refuse repository-controlled Python interpreter paths and relative discovery folders, record the selection source, and parse UTF-8 input with warnings disabled.

- Resolve Electron ES-module preload paths through bound URL imports and TypeScript output settings.

### Added

- Generate isolated changed-line Python mutants, select linked Python tests, and import bound mutmut results with function-range locations.
- Read Pydantic field constraints and adjacent boundary cases through the shared model report.
- Check Python environment reads and BaseSettings names against templates in Python project folders.
- Read Hypothesis property-test settings, seeds, strategies and retained examples as static Python evidence.
- Bind pytest-benchmark JSON and compare Python throughput without changing checks or ratings.
- Bind mypy, pyright and ruff reports, compare their diagnostic lifecycle, and use complete Python type reports in the existing type compatibility check. Ruff remains lint information only.
- Collect Python failure exits, failure assertions and assertion-helper targets for C09, C12 and C27 test leads.
- Match pytest JUnit suite identities to Python cases for behavior verification.
- Check Python dependency declarations, distribution import names, development groups and unused packages through the shared package report.
- Recognize Python script, plugin, framework and command entry points and report orphaned modules with conservative UNKNOWN loader reach.
- Compare Python public exports, annotations, overloads and stub signatures across revisions and check imported call arguments with explicit UNKNOWN consumers.
- Include Python interpreter identity in cached analyses and comparison uncertainty.
- Scan Python modules with an isolated standard-library parser, local import resolution, cycles, impact, complexity and completeness counts.
- Collect pytest and unittest cases from syntax and map bound pytest JUnit and coverage.py LCOV reports to Python files.

- Map Electron IPC contracts through aliases, constants and wrappers, with conservative findings and a paged channel inventory.
- Find unsafe Electron window settings, missing permission handlers and non-literal external URLs.
- Resolve Electron main and preload source entries through TypeScript output settings and exclude them from orphan leads.
- Report Electron platform comparisons and the platforms touched by a verified change as information.
- Collect self-attested Electron startup and process memory samples with `electron-probe`, bind `electron-startup` manifests, and compare base and head medians as information.

- Report the `outsideRoots` gap with full folder counts and mapping instructions in summaries and verification results.
- Include unresolved import specifier spans without changing finding fingerprints.
- Report computed namespace consumers as separate dynamic UNKNOWN call sites with a reason.
- List conservative computed-loader impact candidates separately from affected files and selected tests.

- Flag mutation survivors with identical compiler output as equivalent candidates, with separate counts and reasons in verification reports.
- Run a bounded initial fuzz corpus before generated inputs and record each input source.
- Check declared fuzz invariants and retain invariant failures separately from crashes and hangs.
- Compare static test links with bound single-test coverage traces as information in verification results.
- Include per-stack discovery counts in overview gaps and verification uncertainty warnings.
- Compare expected calibration category bands and report defect and clean agreement with explicit unassessed counts.
- Include bounded dependency paths to consumers and tests in failed and unknown verification context.
- Record bounded assertion origins with criterion tags, Git authorship and associated implementation files.
- Compile generated cases before execution, resolve bounded installed declarations and report TypeScript type errors without blocking the runner.

- Select relevant mutation tests with `{testFiles}` and preview the exact command with `--print-selection`.
- Compare passed, failed, skipped and missing cases in bound base and head test reports as information.

- Compare explicit SQLite schema snapshots and check fixture transforms against declared query rows.
- Generate and execute JSON Schema and JSDoc integer boundaries with case links.
- Compare four independent category bands with compatible rubrics, scope and evidence policies.
- Check declared retry limits and logging policies with explicit support gaps.

- Show bound compiler diagnostic lifecycle in inspection summaries and verification reports.
- Prepare revision dependencies with authorized offline npm installs and disclose preparation results.
- Record authorized XState transitions and compare bound traces in inspection and verification.
- Typecheck fenced TypeScript examples against snapshot compiler settings with explicit skipped and unknown results.
- Link generated tests to authorized changed-line mutants, oracle records and tagged acceptance obligations.
- Record human acceptance of assertion and runner weakening with `code-map review-weakening`.
- Enforce optional per-tool evidence trust minimums from repository and authorization policies.

- Measure authorized repeated commands and compare bound timings against noise, load and change thresholds.
- Guide fuzz corpora with measured subject block coverage and retain coverage progress.
- Report schema rollout consumers and run SQLite fixture migrations in the restricted worker.

- Export CycloneDX 1.5 inventories with licenses, integrity hashes and resolved dependency relationships through `code-map sbom`.
- Read npm, Yarn classic, pnpm 6/9 and text Bun lockfiles.
- Match frozen, manifest-bound OSV snapshots and report changed advisory matches as information.
- Sign isolated artifact manifests with Ed25519 keys, verify configured trusted signers and expose public keys with `code-map key`.
- Compare recorded run environments and add sampled disk budgets with `--disk-megabytes` and process cleanup records.
- Accept bound Playwright and Mocha discovery with command-bound attestation on both revisions.
- Disclose lockfile changes, dependency deltas and shared isolated dependencies in regression results.
- Report project coverage totals, adjusted base coverage loss and measured unexecuted exports.
- Remap flat Istanbul source maps and join functions with available source columns.
- Find configured migration uses and annotate public export changes with declared scope permissions.
- Compare revision architecture rules and layers on both snapshots without new profile checks.
- Resolve bounded relative template imports and report discovery completeness by stack.
- Report cognitive totals for changed files and folders, and bound bundle evidence for orphan leads.
- Compare bounded GraphQL SDL and Protocol Buffers contracts between snapshots.
- Run example-driven route contracts in the restricted worker.
- Compare deployment variable names and check fenced documentation examples.
- Capture bounded harness side effects, retain regression fixtures and evolve deterministic fuzz corpora by outcomes.
- Execute scalar Zod boundaries, reference human table oracles and inject global fetch faults.
- Run bounded model reviews of finished verification runs and save validated hypotheses separately.
- Show current human oracle links for generated tests and compare local replay results with human labels.
- Collect optional compiler types with `inspect --types`, inferred API shapes, call compatibility and language-service references.
- Import bound compiler file lists and report unchecked changed files as information.
- Pair unique export renames, annotate release policy and trace bounded symbol impact.
- Compare public exports, declared signatures and consumers between two stored analyses.
- Import bound TypeScript compiler diagnostics for verification.
- Measure changed lines, statements, branches and functions from bound LCOV and Istanbul JSON reports.
- Inspect Next.js routes, client and server boundaries, and environment-template names.
- Compare OpenAPI JSON operations with Next.js route handlers.
- Inspect Prisma, Drizzle and JSON Schema changes and migration-file presence.
- Derive Zod boundary values, state transitions and decision-table cases with explicit support limits.
- Report affected files and tests, stale references, changed-export calls and documentation gaps.
- Check layer rules, CODEOWNERS and optional cross-owner imports.
- Find undeclared packages, unsupported package subpaths, unused dependencies and orphaned files.
- Inspect npm lockfiles, license and host policies, dependency changes and bound audit reports.
- Find `fetch` calls without a `signal`, intervals without a detected clear, empty `catch` blocks and React effects without detected cleanup.
- Report per-file parse errors and analyzer support gaps.
- Record the cyclomatic complexity, the cognitive complexity and the nesting depth of each function, and compare them between snapshots.
- Record finding decisions, expiring suppressions and precision samples with `code-map triage`.
- Report weaker assertions, weaker runner settings, flaky cases, slower cases and bound test discovery.
- Run exact authorized commands in restricted workers with private workspaces and per-run budgets.
- Run the authorized test command on the base and on the head in the restricted worker, and check that the regression tests of a fix fail on the base and pass on the head.
- Run bounded differential, property, fuzz, decision-table and state-model checks with `code-map harness`.
- Import Stryker reports and run sampled changed-line mutants with `code-map mutate`.
- Read and compare existing Next.js build sizes with `code-map sizes`. It reads the route manifests of Next.js 16 App Router builds (`page_client-reference-manifest.js`), and it counts the CSS files under `static/chunks`.
- Record oracle provenance and validate model hypotheses against evidence IDs.
- Read compact context from completed verification runs with `verify --context`.
- Add the opt-in `evidence-v1` rule set and human oracle records with `code-map oracle`.
- Add calibration cases for both rule sets and local fix replay with `scripts/replay.mjs`.

### Changed

- Split Python facts into isolated extractor files and require a registered validator for each output key.
- Extract verification settings drift and static baseline test-run matching into modules within the 300-line limit, preserving verification behavior.

- Require current human weakening reviews in `evidence-v1` while preserving `static-baseline-v0` check behavior.

- Accept the `evidence-v1` rule set on 2026-10-23. It stays opt-in, and `static-baseline-v0` stays the default.

- Reuse private per-file analysis facts and provide `--no-cache` for a fresh parse.
- Refresh analyses after package, style, schema and analyzer-source changes.
- Keep `static-baseline-v0` as the default rule set. Keep `evidence-v1` opt-in.
- Keep harness, mutation, audit and size observations informational under `static-baseline-v0`.
- Exclude unavailable worker cases from calibration metrics and report their skips.
- Accept an explicit policy for install scripts in new dependencies.

### Fixed

- Follow injected Electron IPC wrappers through object properties and destructuring within the three-level wrapper limit.
- Resolve Electron preload source entries from named and aliased `join` and `resolve` path imports.

- Map non-test code in electron/ by default with src/ when the root package.json declares Electron and no roots setting overrides it.
- Record Next.js proxy files as server entries with their own route kind.
- Read docs folders inside Next.js app and pages routers while ordinary documentation folders stay ignored.
- Report bare browser-replaced Node.js built-ins in Next.js client code with a low finding.
- Treat enabled or lowered bail counts as weaker runner settings and keep the retry rule unchanged.
- Accept top-level Node.js JUnit cases directly under the root testsuites element without a suite.

- Count repeated failures and preserve JUnit class identity when comparing base and head test reports.
- Match earlier failures across committed and detected unstaged test renames, including file-derived suite names.
- Reject test reports with contradictory counts or failed files without failed cases.
- Compare run identity independently of JSON object key order.
- Keep the consumer check UNKNOWN for outside-root deletions and moves when unscanned consumers exist.
- Keep head-commit architecture checks and dependent rating predicates UNKNOWN when working-folder rules differ.
- Keep Structural Integrity below level 3 for resolved literal dynamic imports.
- Keep removal evidence UNKNOWN for tests renamed to unreadable scripts.
- Include working-tree edits hidden by Git index flags without changing the repository index.
- Preserve valid named imports through cyclic export-star barrels.
- Record the invocation folder in run manifests for reports from repository subfolders.
- Reject unsafe exports folders before analysis and private report writes.
- Normalize relative Windows paths in Jest and Vitest reports on POSIX.
- Keep unmatched findings UNKNOWN when unstaged edited moves lack a reliable rename pair.
- Recheck working-tree freshness after base analysis before reading live renames.
- Reject inspection offsets above the maximum safe integer.
- Preserve test failure attribution through named, renamed and star re-exports in production maps.
- Keep focused children parked or conditional under enclosing suites and report runnable empty focused tests.
- Count all indirect cases and scope model label statistics in selected test summaries.
- Exclude expected operands from failure-assertion attribution.
- Recognize quoted and shorthand Node test options with conservative conditional status.

- Give one short gap for stacks that Code-map does not analyze (CSS, other files), not an incomplete-evidence warning for each. Every real repository showed these warnings.
- Report empty paired test reports as UNKNOWN with a reason instead of an empty comparison.
- Select verification graph paths to unchanged tests named by bound case evidence and record the selecting evidence IDs.

- Give no `TEST-EXPORT-CANDIDATE` finding for files that Code-map marks as vendor candidates (`components/ui/`, `components/ai-elements/`). On Project A, 382 of 416 such findings were copied library components.
- Resolve a relative import with an explicit asset extension, such as `./globals.css`, to its file when a `tsconfig.json` exists. The compiler-aware resolver reported such imports as unresolved since the C01 audit fix.
- Respect snapshot module settings for relative imports and retain import-equals dependencies.
- Detect explicit accessible named API shape changes and check their known consumers.
- Expose pure exported-function test candidates and retain Mocha pending cases in discovery denominators.
- Require supported Node TAP assertion diagnostics for built-in mutation kills and exclude runner errors from scores.
- Identify expected-failure transitions for current human weakening reviews in evidence-v1.
- Derive authorized regression selections from impact tests and explicit baseline paths. Retain each attempt and selected file outcomes.
- Exclude incompatible environments from repeatability and timing comparisons. Keep incomplete historical comparisons unknown.
- Validate OpenAPI examples and retain unsupported response rules as UNKNOWN.
- Exclude Docker build arguments and discarded-stage variables from runtime producers.
- Validate stored verification results against a versioned JSON Schema and persist rubric definitions.
- Include available generated consumers in stale-reference searches.
- Retain size-only growth and declaration, file and folder size deltas.
- Expose ownership-policy relaxations and revision-bound witnesses.
- Mark computed dependency loading candidates UNKNOWN.
- Separate advisory database provenance from import time.

- Choose the default branch with its full name, so a branch with the name of a folder (for example `electron`) no longer stops every command without `--ref`.
- Build the program of `--types` without the emit settings of a build, and accept the options that TypeScript 6 marks as deprecated, so a TypeScript 5 project gets complete typed facts. The default budget of the typed facts is now 60 seconds.
- Treat a tracked symlink to a committed folder, and a broken tracked symlink, as part of the commit, so a clean working tree has no working-tree digest and a manifest binds to a commit analysis.
- Accept the client reference manifests that Next.js 16.1 writes without a final semicolon.
- Settle an aborted model review also when macOS refuses the signal to an empty process group.
- Keep combined compiler, oracle and coverage reports within 200 Markdown lines while retaining every section and the full JSON results.
- Classify repeated JUnit identities with mixed outcomes as flaky while retaining every attempt.
- Preserve compiler package versions and package discovery results when both analysis extensions are enabled.
- Name a callback by its variable or by its callee and position (for example `send` or `useEffect#2`), so that a new callback does not make the complexity of the other callbacks unknown.
- Check the imports of test files, test helpers and configuration files at the root of a package, so that the check "New imports resolve" can pass when a change touches them.
- Count a package that a style file imports (for example `@import 'tw-animate-css'`) as used. Do not report `electron` in `devDependencies`, or a type-only import, as a development-only dependency.
- Do not report a React effect whose timer or subscription handle a ref keeps, because the owner of the ref clears it.
- Count Next.js low-priority scripts once and exclude App Router roots from Pages Router sizes.
- Reject null build manifests and null asset collections.

### Security

- Refuse Linux worker binds that contain protected folders.
- Collect bounded artifacts inside the sandbox and refuse artifact symlinks.
- Stop observed detached descendants before artifact collection.
- Validate dependency links and keep cloned workspace entries private.
