# Verification roadmap status

## State on 2026-10-23

This status covers the branch `cwik-tech/roadmap-integration` at commit `1a91222` and later documentation commits.
On 2026-10-23 a trace mapped each part of each requirement to a test, 15 gaps were closed, and 21 findings of an external review were fixed.
On 2026-10-24 Electron support was added (IPC contracts, window security, entry points, platform code, startup and memory). Refer to [the Electron record](records/2026-10-24-electron.md). Python and React Native stay deferred.
Refer to [the trace and fix record](records/2026-10-23-requirement-trace-and-fixes.md).
The earlier text below describes the W7 integration in `cwik-tech/integrator5`.
The scope is TypeScript, JavaScript and React.
At that time, Python, Electron and React Native were out of scope by user decision. Electron was added on 2026-10-24.

`exists` means that the bounded target is implemented and tested.
`partial` means that a buildable part of that target is absent.
An evidence limit alone does not make a capability partial.
The capability table lists 45 capabilities that exist and no partial capabilities.
Each row retains the bounded scope and evidence limits of its stream.
Baseline references are in [the audit record](records/2026-10-23-final-capability-audit.md).
W7 merge decisions and commands are in [the integration record](records/2026-10-23-w7-integration.md).

### Capabilities

| IDs | State | What exists (source) | Limits |
| --- | --- | --- | --- |
| C01 | exists | Relative imports respect snapshot compiler settings and package module formats. Import-equals dependencies retain locations and dependency kinds. Relative template patterns expand within one folder. Unresolved-import findings give the specifier span. A relative asset import, such as `./globals.css`, resolves to its file. Source: `lib/analyze.mjs`, `lib/dynamic-patterns.mjs`, `lib/packages/imports.mjs`. | Computed targets and unsupported loaders are unknown. |
| C02 | exists | Named-import checks, bound compiler diagnostics, optional compiler programs, bound file discovery and individual diagnostic lifecycle exist. Source: `lib/import-names.mjs`, `lib/adapters/tsc.mjs`, `lib/types/discovery.mjs`, `lib/compiler-lifecycle.mjs`. | Dynamic evaluation is unknown. Compiler scope is self-attested. Missing, ambiguous or incomparable lifecycle evidence stays UNKNOWN. |
| C03 | exists | Public entry points, consumers, unique rename pairs, inferred and explicit accessible checker shapes, and package release policy exist. Source: `lib/api-compare.mjs`, `lib/types/api.mjs`. | Ambiguous renames and external consumers are unknown. Shape compatibility does not prove semantic compatibility. |
| C04 | exists | Declared signatures, named parameter and return shapes, and head argument assignability exist. Computed namespace member uses are separate dynamic consumers with UNKNOWN compatibility. Source: `lib/api-signatures.mjs`, `lib/types/program.mjs`. | Spread, rest, unresolved types and dynamic calls retain UNKNOWN. External consumers are outside the snapshot. |
| C05 | exists | All-edge and value-edge cycles have base and head labels. Source: `lib/analysis.mjs`, `lib/compare.mjs`. | Import cycles do not prove runtime initialization failures. |
| C06 | exists | Import-direction and layer rules produce witness findings. Overlapping layers are refused. Source: `lib/rules.mjs`, `lib/layers.mjs`. | Findings cover declared policies and resolved edges. |
| C07 | exists | Reverse file impact and symbol propagation follow imports, named re-exports and local declaration references. Unresolved computed loaders name conservative candidate files and their importers in a separate list. Source: `lib/impact/reach.mjs`, `lib/types/impact.mjs`. | Depth and result budgets disclose truncation. Dynamic bindings prevent complete reachability. Candidates are leads, not definite impact. |
| C08 | exists | Static direct and transitive relationships, also through re-exporting barrels, link affected code to known tests. Bound coverage of a run that names one test file confirms, refutes or adds static links as information. Source: `lib/test-quality.mjs`, `lib/impact/reach.mjs`, `lib/test-links.mjs`. | Reachability is not test execution. Runtime links need a coverage run of one test file. Execution does not prove an assertion. |
| C09 | exists | Bound function counters identify zero-hit exports. Pure exports and public aliases retain direct, transitive or candidate test relationships. Source: `lib/coverage-evidence.mjs`, `lib/test-quality.mjs`. | Static relationships do not prove execution. Missing counters and ambiguous joins remain UNKNOWN. Hits do not prove assertions. |
| C10 | exists | Static inventory and bound Jest, Vitest, Playwright and Mocha discovery use command-bound attestation. Mocha pending cases retain denominator credit. Source: `lib/adapters/test-list.mjs`, `lib/test-runs.mjs`. | Pending cases receive no execution credit. Unsupported runners and ambiguous joins remain unknown. Discovery is not execution. |
| C11 | exists | Bound reports give project and file statement totals. Flat Istanbul source maps remap counters. Source: `lib/source-map.mjs`, `lib/coverage-evidence.mjs`. | Line counters are not statement counters. Indexed coverage maps and map URLs are unsupported. |
| C12 | exists | Bound reports give branch totals, changed branch counters and adjusted base comparisons. Source: `lib/coverage-evidence.mjs`, `lib/changed-coverage.mjs`. | Branch identity depends on producer coordinates and IDs. |
| C13 | exists | Bound reports give function totals and column-aware AST joins. Source: `lib/complexity.mjs`, `lib/coverage-evidence.mjs`. | Collisions and unavailable coordinates remain unknown. Hits do not prove behavior. |
| C14 | exists | Head diff ranges select executable counters. Adjusted base maps identify lost coverage on unchanged lines. Source: `lib/coverage-evidence.mjs`, `lib/verify-change.mjs`. | Missing head counters remain unmeasured. |
| C15 | exists | Bound Stryker reports and isolated changed-line mutants retain distinct outcomes and revision caches. Built-in kills require assertion diagnostics. A `{testFiles}` selector selects the tests that reach the files with sampled mutants, and `--print-selection` shows the words to authorize. Survivors with identical compiled output are equivalent candidates. Source: `lib/mutation/run.mjs`, `lib/mutation/outcome.mjs`, `lib/mutation/report.mjs`, `lib/mutation/generate.mjs`. | Runner errors remain outside scores. Equivalent candidates count as survived and require review. Each mutant runs the same selected tests. A failed baseline stops the run. Built-in compiler checks are local. |
| C16 | exists | Isolated differential replay compares shared inputs, normalized outputs, capped logs, rejections and workspace file deltas. Source: `lib/harness/runtime.mjs`, `lib/harness/effects.mjs`. | Transient writes and historical dependency recreation are not observed. |
| C17 | exists | Seeded properties record generator versions, bounded shrinking and minimized inputs in run-local regression fixtures. Source: `lib/harness/generator.mjs`, `lib/harness/fixtures.mjs`. | Generated test skeletons need reviewed assertions and repository copying. |
| C18 | exists | Worker subprocesses measure subject V8 blocks per input. New blocks and outcome classes retain corpus seeds. Reports track block counts and corpus growth. A spec can give a typed initial corpus and an invariant. Invariant failures are a separate outcome. Source: `lib/harness/runtime.mjs`, `lib/harness/coverage.mjs`. | Finite runs cannot prove safety. Block coverage is not path coverage. Imported files and module initialization are unmeasured. |
| C19 | exists | Bound comparisons retain outcomes, timings and retries. Authorized offline installs prepare revisions. Impact-plus-baseline selections retain per-attempt denominators and file outcomes. Paired base and head reports give case outcome transitions and lost base passes. Failures match as a multiset. Reports with contradictory counts are ineligible. Source: `lib/verify-exec.mjs`, `lib/verify-selection.mjs`, `lib/worker/install.mjs`, `lib/test-runs.mjs`. | Incomplete impact and missing selected outcomes remain UNKNOWN. Comparable environments and cached packages are required. Lifecycle scripts never run. |
| C20 | exists | OpenAPI route checks, bounded GraphQL and Proto comparisons, and isolated route runs exist. Request examples and nested response rules are validated. Source: `lib/contracts/openapi.mjs`, `lib/contracts/graphql.mjs`, `lib/contracts/proto.mjs`, `lib/harness/schema.mjs`. | Unsupported rules retain UNKNOWN. No complete server or middleware runs. |
| C21 | exists | Schema comparisons, old-name consumer leads and deployment risks include explicit SQLite snapshots. Restricted fixture migrations compare declared query rows. Source: `lib/schemas/rollout.mjs`, `lib/schemas/sql.mjs`, `lib/harness/migrate.mjs`. | Structural compatibility is conservative. Missing data oracles, unsupported dialects, computed SQL and unresolved aliases remain UNKNOWN. Syntax does not prove deployment order. |
| C22 | exists | Scalar Zod safeParse outcomes and JSON Schema or JSDoc integer boundaries link expected outcomes to worker calls. Source: `lib/models/zod.mjs`, `lib/models/ranges.mjs`, `lib/harness/runtime.mjs`. | Unsupported constraints, arrays and nested boundaries remain UNKNOWN. Validator qualification needs project dependencies. |
| C23 | exists | Opt-in authorized XState tracing records events and transitions. Bound inspect and verify views report unseen, unauthorized and unhandled observations. Source: `lib/models/trace-run.mjs`, `lib/models/trace-report.mjs`. | Finite runs cover only observed sequences. Missing packages, ambiguous models and unsupported parallel values give UNKNOWN. Project reports remain self-attested. |
| C24 | exists | Bounded exhaustive or pairwise cases run against declared rules. Human oracle references expose confirmation and digest freshness. Source: `lib/models/decision-table.mjs`, `lib/harness/metadata.mjs`. | A confirmation does not authenticate identity or prove that the rule is correct. |
| C25 | exists | Configured import-path, imported-name and call-name patterns produce comparison findings and consumer leads. Source: `lib/migrations.mjs`, `lib/verify-change.mjs`. | Dynamic consumers and semantic compatibility remain unknown. |
| C26 | exists | Environment templates, Next.js routes and Docker, Vercel and Compose declarations have producer and consumer checks. Docker retains declaration kind and stage. Electron IPC channels are matched through wrappers and injected dependencies, unsafe window settings give findings, and the main and preload entries resolve to source. Source: `lib/frameworks/env.mjs`, `lib/frameworks/deployment.mjs`, `lib/frameworks/next-routes.mjs`, `lib/frameworks/electron-ipc.mjs`, `lib/frameworks/electron.mjs`. | Only resulting-image ENV satisfies runtime reads. Computed names, dynamic parents and ambiguous phases remain unknown. No image build runs. Electron channels that Code-map cannot resolve stay UNKNOWN. A validated URL still gives the openExternal lead. |
| C27 | exists | Removed and weakened cases affect checks. Expected-failure transitions join assertion and runner weakening reviews in evidence-v1. Source: `lib/assertion-compare.mjs`, `lib/weakening-reviews.mjs`, `lib/weakening-command.mjs`. | V0 retains its checks and thresholds. Static matchers cannot establish intent. Local records cannot authenticate the named person. |
| C28 | exists | Allowed paths constrain changed files. Declared public export permissions annotate removed, changed and added exports. Source: `lib/verify-request.mjs`, `lib/revision-policy.mjs`. | Public export annotations are information. External consumers and unavailable compiler facts remain unknown. |
| C29 | exists | Text and language-service searches cover named, default and namespace imports. Deleted-module joins use base imports. Readable generated consumers are included. Source: `lib/impact/references.mjs`, `lib/impact/report.mjs`, `lib/types/program.mjs`. | Dynamic names, unavailable output and external consumers remain unknown. Generated reads retain size and symlink protections. |
| C30 | exists | Functions retain cyclomatic, cognitive, nesting and size deltas. Declarations retain size deltas. Files and folders retain cognitive totals and size-only changes. Source: `lib/complexity.mjs`, `lib/complexity-areas.mjs`, `lib/complexity-size.mjs`. | Folder totals include unchanged siblings. Uncertain matches retain UNKNOWN. No universal size threshold applies. Static metrics do not measure runtime cost. |
| C31 | exists | Revision rules, layers and ownership policies evaluate both snapshots. Policy changes, exceptions and relaxed witnesses supplement cycle and owner deltas. Source: `lib/revision-policy.mjs`, `lib/compare.mjs`. | Missing CODEOWNERS evidence, dynamic edges and general pattern subsumption remain unknown. |
| C32 | exists | Static package use includes named configuration plugins. Computed loaders expose UNKNOWN candidates and sites. Bound bundles explain unused chunks and orphan leads. Source: `lib/packages/unused.mjs`, `lib/bundle-evidence.mjs`. | Arbitrary runtime package names and dynamic plugins remain unresolved. An unused first-load chunk does not prove dead code. |
| C33 | exists | Public JSDoc, documentation-change leads, fenced syntax, self-imports and optional virtual TypeScript example checks exist. Comparisons label new diagnostics. Source: `lib/impact/docs.mjs`, `lib/impact/examples.mjs`, `lib/types/examples.mjs`. | Semantic clarity and runtime behavior need review. Compiler evidence uses snapshot dependencies and bounded programs. |
| C34 | exists | npm, Yarn classic, pnpm and text Bun inventories support CycloneDX export, dependency policy and bound OSV matching. Database provenance stays separate from import time. Source: `lib/supply/lockfile.mjs`, `lib/supply/lock-extras.mjs`, `lib/supply/sbom.mjs`, `lib/supply/osv.mjs`. | Unsupported syntax and missing metadata remain UNKNOWN. Legacy OSV arrays have UNKNOWN database provenance. Supplied metadata does not certify freshness or exploitability. |
| C35 | exists | Static safeguards and restricted fetch faults report missing timeouts and escaping errors. Declared retry and logging policies add syntax observations and an injected-failure case. Source: `lib/declared-patterns.mjs`, `lib/harness/call.mjs`, `lib/harness/runtime.mjs`. | Unsupported syntax remains UNKNOWN. Syntax never certifies runtime safeguards. Other clients and paths outside the declared harness remain unmeasured. |
| C36 | exists | Bound asset sizes and controlled command timings compare medians, noise ranges, minimum changes and load drift. A probe gives self-attested Electron startup and memory reports that verify compares. Source: `lib/bench-report.mjs`, `lib/worker/bench.mjs`, `lib/sizes.mjs`, `lib/size-report.mjs`, `lib/electron/probe.cjs`. | Both sides need the same machine. Other processes and caches affect timings. Commands define measured routes. The Electron probe has not yet run with a real app. |
| C37 | exists | Case provenance, acceptance tags and digest-bound human records identify origins and independent-evidence requirements. Assertion provenance gives the criterion, the Git author and commit, and the non-test files of that commit. Source: `lib/provenance.mjs`, `lib/oracles.mjs`. | Human identity and independent oracle truth are not authenticated. Git authorship is a claim. V0 keeps provenance informational. |
| C38 | exists | Signed or hashed manifests bind source, lockfiles, artifacts and environments. Exact environment comparisons reject differences and disclose missing facts. Source: `lib/worker/signing.mjs`, `lib/run-compatibility.mjs`, `lib/verify-reports.mjs`. | Historical environments are not reconstructed. Missing facts retain UNKNOWN. Own-report eligibility differs from pair eligibility. Signatures do not prove uncompromised machines. |
| C39 | exists | Restricted workers enforce execution budgets, sampled disk limits, observed descendant cleanup and per-tool evidence minimums. Source: `lib/trust.mjs`, `lib/verify-reports.mjs`, `lib/worker/authorize.mjs`, `lib/worker/budgets.mjs`. | macOS process environments and descendants between samples remain platform limits. Trust tiers authenticate provenance, not oracle truth. |
| C40 | exists | One summary table counts discovered, supported, parsed, skipped, malformed and dynamically unresolved facts by stack. Supported stacks with such files add uncertainty warnings. Unanalyzed stacks share one gap line. Source: `lib/completeness.mjs`, `lib/overview-gaps.mjs`. | CSS has no parser. Runtime edges remain unknown. |
| C41 | exists | Stable fingerprints, decisions, suppression expiry, owners and labeled precision samples exist. Source: `lib/triage.mjs`, `lib/triage-view.mjs`. | Representative labels and periodic sampling require people. |
| C42 | exists | Generated files compile before they run with exact authorized command words. Syntax errors block the run, and type errors are information. Static links and bound line hits select changed-line mutants. Reports link outcomes, human oracle records and tagged acceptance support. Source: `lib/mutation/generated.mjs`, `lib/generated-oracles.mjs`, `lib/verify-test-validation.mjs`. | The sample has a 20-mutant bound per declaration and template. Whole-run coverage is not per-test coverage. Failure cause, equivalent mutants and independent oracle truth require review. |
| C43 | exists | Seeded calibration and human-labeled commit replay report mismatches, confusion matrices, precision, recall and durations. Cases can declare expected category bands, and the report counts band agreement for defect and clean cases. Unassessed never counts as agreement. Source: `calibration/run.mjs`, `calibration/real-labels.mjs`, `scripts/replay.mjs`. | Representative historical labels require people. Fixture agreement does not validate product thresholds. |
| C44 | exists | A bounded user model command receives finished context with bounded dependency paths from changed files to the consumers and tests that failed or unknown checks name. Typed hypotheses and evidence IDs are validated and saved separately. Source: `lib/model-review.mjs`, `lib/hypotheses.mjs`. | Model output remains a hypothesis. It never assigns ratings. |
| C45 | exists | Schema-validated obligations, results and rubric definitions produce four independent ratings, readiness and linked reports. Compatible stored runs support band comparisons. Source: `lib/verification-schema.mjs`, `lib/verification-contract.mjs`, `lib/verify.mjs`. | Missing compatibility metadata and Unassessed bands retain UNKNOWN. V0 never gives READY. Evidence-v1 is accepted and opt-in. Calibration grants no approval. |

### Remaining work

All six W7 streams are merged. Platform and evidence limits remain in the capability rows.

### Integration gates

Gates of `main` after Electron support (2026-10-24): `npm test` gave 1,738 tests, 1,735 pass, 1 skip (XState is not installed). Two tests failed under the CPU load of another codebase and passed when their files ran alone. `node scripts/trace-check.mjs`: 318 parts, 308 pass, 10 out of scope. Its 14 failures under the same load passed when each test ran alone.
The receipts below are of the W7 integration.

Runtime: Node `v24.21.0`, TypeScript `6.0.3`. No dependency was added.
The integrated source is `cwik-tech/integrator5` at `9862f03`, on 2026-10-23.
The full suite and separate browser check pass. Earlier failed receipts remain below.

| Check | Exact result |
| --- | --- |
| `node --test --test-concurrency=4 test/*.test.mjs` | Exit 0. Tests 1499, suites 0, pass 1498, fail 0, cancelled 0, skipped 1, todo 0. Duration 237235.1395 ms. XState is not installed |
| `node --test test/repair.test.mjs` | Exit 0. Tests 17, suites 0, pass 17, fail 0, cancelled 0, skipped 0, todo 0. Duration 6673.310833 ms |
| `node --check` on changed modules | Exit 0 for all 109 changed source and test modules |
| `git diff --check be3800e HEAD` and working-tree diff | Exit 0. No whitespace errors |
| Baseline `node --test test/docs.test.mjs` | Exit 0. Tests 2, pass 2, fail 0, skipped 0. Duration 205.812042 ms |
| Imports and types selection, with docs | Exit 0. Tests 88, pass 88, fail 0, skipped 0. Duration 29902.3475 ms |
| Execution selection, with docs | Exit 0. Tests 82, pass 82, fail 0, skipped 0. Duration 17110.9405 ms |
| Tests and mutation selection, first run | Exit 1. Tests 62, pass 61, fail 1, skipped 0. Duration 30745.254209 ms. Merge resolution omitted one closing delimiter |
| Tests and mutation selection, corrected | Exit 0. Tests 83, pass 83, fail 0, skipped 0. Duration 30799.760417 ms |
| Contracts selection, with docs | Exit 0. Tests 53, pass 53, fail 0, skipped 0. Duration 8854.703 ms |
| Results selection, with docs | Exit 0. Tests 33, pass 33, fail 0, skipped 0. Duration 16829.417958 ms |
| Quality selection, with docs | Exit 0. Tests 154, pass 154, fail 0, skipped 0. Duration 48864.805959 ms |
| Focused `inspect --worktree` | Exit 0. 260 source files, 9 selected modules, 0 all-edge cycles, 0 value-edge cycles, 0 rule violations |
| Module size | No tracked `.mjs` file has more than 300 lines. No split was required |
| Typecheck and lint | Unavailable. No scripts or configurations exist. Syntax checks establish neither result |

### Evidence and product decisions

The accepted `static-baseline-v0` never gives READY.
Harness, mutation, audit and size observations do not change its ratings.
The opt-in `evidence-v1` can give READY. The user accepted it on 2026-10-23, and `static-baseline-v0` stays the default.
Its fixtures follow the proposal. They do not independently validate its thresholds.
An imported manifest is self-attested. A signature authenticates a trusted signer, not the truth of its report.
See [worker security](../SECURITY.md), [worker operation](run.md) and the limits in the capability table.

The [v1 proposal, section 8](work/2026-10-23-verify-profile-v1/proposal.md#8-decisions-for-you) holds its ten product decisions.
They cover the default profile, READY evidence, human oracles, preservation, mutation and coverage thresholds.
They also cover harness failures, install scripts, migration checks and public-interface applicability.
On 2026-10-23 the user accepted the recommended answer of all ten ([decisions.md](work/2026-10-23-verify-profile-v1/decisions.md)).

### Handoff decisions

The build streams left default choices for the user to confirm. On 2026-10-23 the user asked the integrator to decide them from the experience of the real-codebase runs. Each row gives the decision. "Changed" means that the code changed to follow it. Source labels identify the handoff note and its numbered question.

| Source | Question | Decision |
| --- | --- | --- |
| `s1-api.md` Q1 | Inferred exports with unchanged declarations | Treat them as unchanged. Imported types can still change |
| `s1-api.md` Q2 | Build-output entry points | Keep unresolved paths. Do not guess a source path |
| `s1-api.md` Q3–Q4 | Parameter names and export renames | Parameter renames count as changes. Export renames stay a removal and an addition |
| `s1-api.md` Q5–Q7 | API selection, HTML payload and status grouping | Keep whole-project API comparisons and embedded API data |
| `s2-tsc.md` Q1–Q4 | Compiler applicability and missing diagnostics | Require an unfiltered report for PASS. Include base importers of deleted files. Apply supplied JavaScript reports. Keep errors without a file UNKNOWN |
| `s2-tsc.md` Q5 | Earlier compiler errors | Match any bound base compiler report |
| `s2-tsc.md` Q6 | Unknown compiler-output lines | Refuse the report |
| `s2-tsc.md` Q7 | Compiler evidence for feature contracts | Done: v0 keeps UNKNOWN, and the accepted v1 checks the public interface for every change type |
| `s2-tsc.md` Q8 | Syntax and settings errors in other files | Keep the code ranges. Real projects often have old errors in unrelated files, and UNKNOWN for each of them would make the check useless |
| `s3-coverage.md` Q1–Q8 | Unmeasured code, partial and multiple reports, renames and rounding | Keep the current rules: an absent record does not satisfy a condition, partial runs count, empty reports are refused, hits merge by maximum, shares round down |
| `w2-coverage2.md` Q1–Q4 | Istanbul precedence, line counts and source maps | Prefer Istanbul branches and functions. Derive no line hits. Remap flat source maps |
| `s4-react.md` Q1–Q3 | Framework output, package detection and severity | Keep the framework block, the detection of development dependencies and the rule severities |
| `s4-react.md` Q4 | Next.js 16 `proxy` file | Changed: a `proxy` file is a server entry, like `middleware`. Next.js 16 renamed the file |
| `s4-react.md` Q5 | `docs` folders inside a Next.js router | Changed: a `docs` folder inside `app/` or `pages/` is read, because it holds routes. Other `docs` folders stay ignored |
| `s4-react.md` Q6 | Node.js built-ins that Next.js replaces in the browser | Changed: a client import of such a bare built-in, such as `path`, is a low-severity lead. Other built-ins and `node:` imports stay high |
| `s4-react.md` Q7 | Project evidence pages | Keep the `--part nextjs.routes` form |
| `s5-calibration.md` | Known failures and unnamed checks | A corrected known failure loses its mark. Unnamed checks must not fail |
| `s6-complexity.md` | Example count and nested functions | Show five function examples in total. Keep nested functions in file reports |
| `s8-triage.md` Q1–Q9 | Dates, totals, sampling, expiry and revisions | Keep the current rules: UTC dates, hidden findings out of visible totals, suppressions in samples, whole-analysis precision, expiry only for suppressions, the working-folder triage file |
| `w2-layers.md` Q1–Q6 | Exceptions, overlaps, owners and cross-owner checks | Keep the current rules. Owner findings stay medium and outside v0 checks |
| `w2-layers.md` Q7–Q9 | Ownership revisions and capability scope | Done: the base policy comparison of C31 exists, so C31 is no longer partial |
| `w2-models.md` Q1–Q4 | Numeric steps, constants, model fields and folders | Keep one extra decimal place, literal limits only, the fields `final` and `subject`, and fixed folders |
| `w2-models.md` Q5 | Review of model edits | No separate review. A model edit is a changed file and stays visible in the change. Decide again when a rule set rates with models |
| `w2-models.md` Q6–Q9 | Findings, events, test links and limits | Keep model lists separate from findings, both event lists, direct test links and the size limits. None of the real repositories had models |
| `w2-contracts-env.md` Q1–Q9 | Templates, contract scope, severity and methods | Keep the current rules |
| `w2-ops.md` Q1–Q10 | Operational pattern exclusions, leads and hooks | Keep the current rules |
| `w2-supply.md` Q1–Q9 | Policy, licenses, advisories and lockfiles | Keep the current rules. The accepted v1 uses `forbidInstallScripts` |
| `w2-tests.md` Q1 | Stronger test-weakening policy | Done: v0 keeps weakening as information, and the accepted v1 requires a current human review |
| `w2-tests.md` Q2 | Matcher equivalences | Keep the extra equivalent matchers |
| `w2-tests.md` Q3 | `bail` direction | Changed: adding or lowering `bail` is weaker, because the run stops earlier and hides later failures. Raising or removing it is not weaker |
| `w2-worker.md` Q1 | macOS process-environment exposure | Accept it for opt-in runs. [The worker guide](run.md) warns that a run on macOS can read the environment of other processes |
| `w2-worker.md` Q2–Q8 | Protected paths, kernel access, defaults, exit codes and concurrency | Keep the current rules |
| `w2-worker.md` Q9 | Top-level cases of the Node.js JUnit reporter | Changed: a test case directly below `<testsuites>` is accepted, as `node --test` writes it |
| `w2-worker.md` Q10 | A terminal confirmation for `authorize` | No prompt. An agent with a terminal can answer a prompt, and a prompt breaks scripted use. The documented rule stays: a person makes each authorization |
| `w3-perf.md` | Performance extension | Done: controlled timing reports and `code-map bench` exist (C36) |
| `w4-ruleset.md` Q1 | Evidence-v1 approval | Decided on 2026-10-23: the user accepted all ten recommended answers |

The [v1 proposal, section 8](work/2026-10-23-verify-profile-v1/proposal.md#8-decisions-for-you) holds its ten product decisions.
They cover the default profile, isolated READY evidence, human oracles, preservation evidence, mutation and coverage thresholds.
They also cover harness failures, install scripts, migration checks and public-interface applicability.
No handoff decision stays open.


## Historical W7 quality stream checks

The implementation run uses `node --test --test-concurrency=4 test/*.test.mjs`.
Result: 1387 tests, 1382 pass, 4 fail, 1 skipped. Duration: 412250.021417 ms.
Two assertions need the added size fields and generated-file classification.
Two browser cases fail with Chrome display and teardown diagnostics.
The review brief reserves that browser file. Its separate rerun passes all 17 tests in 12231.839292 ms.
Syntax checks pass for all 25 changed or new modules. `git diff --check` passes.
No typecheck or lint script exists in this ESM JavaScript project.
The final review run uses the same full-suite command.
Result: 1394 tests, 1393 pass, 0 fail, 0 cancelled, 1 skipped, 0 todo.
Duration: 223897.749708 ms. Exit status: 0.
The existing XState integration case is skipped because XState is not installed.
Both browser cases pass in the final full suite.
Review regression selection: 105 tests pass. The final package-boundary selection passes all 12 tests.
Final syntax checks pass for all 30 changed or new modules. `git diff --check` passes.
The final focused Code-map report selects seven files. All-edge and value-edge cycle counts remain zero.
