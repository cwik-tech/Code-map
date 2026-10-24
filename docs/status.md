# Verification roadmap status

## State on 2026-10-23

This status covers the branch `cwik-tech/roadmap-integration` at commit `1a91222` and later documentation commits.
On 2026-10-23 a trace mapped each part of each requirement to a test, 15 gaps were closed, and 21 findings of an external review were fixed.
Refer to [the trace and fix record](records/2026-10-23-requirement-trace-and-fixes.md).
The earlier text below describes the W7 integration in `cwik-tech/integrator5`.
The scope is TypeScript, JavaScript and React.
Python, Electron and React Native are out of scope by user decision.

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
| C26 | exists | Environment templates, Next.js routes and Docker, Vercel and Compose declarations have producer and consumer checks. Docker retains declaration kind and stage. Source: `lib/frameworks/env.mjs`, `lib/frameworks/deployment.mjs`, `lib/frameworks/next-routes.mjs`. | Only resulting-image ENV satisfies runtime reads. Computed names, dynamic parents and ambiguous phases remain unknown. No image build runs. |
| C27 | exists | Removed and weakened cases affect checks. Expected-failure transitions join assertion and runner weakening reviews in evidence-v1. Source: `lib/assertion-compare.mjs`, `lib/weakening-reviews.mjs`, `lib/weakening-command.mjs`. | V0 retains its checks and thresholds. Static matchers cannot establish intent. Local records cannot authenticate the named person. |
| C28 | exists | Allowed paths constrain changed files. Declared public export permissions annotate removed, changed and added exports. Source: `lib/verify-request.mjs`, `lib/revision-policy.mjs`. | Public export annotations are information. External consumers and unavailable compiler facts remain unknown. |
| C29 | exists | Text and language-service searches cover named, default and namespace imports. Deleted-module joins use base imports. Readable generated consumers are included. Source: `lib/impact/references.mjs`, `lib/impact/report.mjs`, `lib/types/program.mjs`. | Dynamic names, unavailable output and external consumers remain unknown. Generated reads retain size and symlink protections. |
| C30 | exists | Functions retain cyclomatic, cognitive, nesting and size deltas. Declarations retain size deltas. Files and folders retain cognitive totals and size-only changes. Source: `lib/complexity.mjs`, `lib/complexity-areas.mjs`, `lib/complexity-size.mjs`. | Folder totals include unchanged siblings. Uncertain matches retain UNKNOWN. No universal size threshold applies. Static metrics do not measure runtime cost. |
| C31 | exists | Revision rules, layers and ownership policies evaluate both snapshots. Policy changes, exceptions and relaxed witnesses supplement cycle and owner deltas. Source: `lib/revision-policy.mjs`, `lib/compare.mjs`. | Missing CODEOWNERS evidence, dynamic edges and general pattern subsumption remain unknown. |
| C32 | exists | Static package use includes named configuration plugins. Computed loaders expose UNKNOWN candidates and sites. Bound bundles explain unused chunks and orphan leads. Source: `lib/packages/unused.mjs`, `lib/bundle-evidence.mjs`. | Arbitrary runtime package names and dynamic plugins remain unresolved. An unused first-load chunk does not prove dead code. |
| C33 | exists | Public JSDoc, documentation-change leads, fenced syntax, self-imports and optional virtual TypeScript example checks exist. Comparisons label new diagnostics. Source: `lib/impact/docs.mjs`, `lib/impact/examples.mjs`, `lib/types/examples.mjs`. | Semantic clarity and runtime behavior need review. Compiler evidence uses snapshot dependencies and bounded programs. |
| C34 | exists | npm, Yarn classic, pnpm and text Bun inventories support CycloneDX export, dependency policy and bound OSV matching. Database provenance stays separate from import time. Source: `lib/supply/lockfile.mjs`, `lib/supply/lock-extras.mjs`, `lib/supply/sbom.mjs`, `lib/supply/osv.mjs`. | Unsupported syntax and missing metadata remain UNKNOWN. Legacy OSV arrays have UNKNOWN database provenance. Supplied metadata does not certify freshness or exploitability. |
| C35 | exists | Static safeguards and restricted fetch faults report missing timeouts and escaping errors. Declared retry and logging policies add syntax observations and an injected-failure case. Source: `lib/declared-patterns.mjs`, `lib/harness/call.mjs`, `lib/harness/runtime.mjs`. | Unsupported syntax remains UNKNOWN. Syntax never certifies runtime safeguards. Other clients and paths outside the declared harness remain unmeasured. |
| C36 | exists | Bound asset sizes and controlled command timings compare medians, noise ranges, minimum changes and load drift. Source: `lib/bench-report.mjs`, `lib/worker/bench.mjs`, `lib/sizes.mjs`, `lib/size-report.mjs`. | Both sides need the same machine. Other processes and caches affect timings. Commands define measured routes. |
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

Gates of commit `1a91222`: `npm test` gave 1,669 tests, 1,668 pass, 0 fail, 1 skip (XState is not installed). `node scripts/trace-check.mjs` exited 0: 293 parts, 281 pass, 0 gaps, 12 out of scope.
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

### Historical handoff decisions

These items retain the earlier decision record. W5 and W6 extend the bounded capabilities in the table above.
The older choices below are historical where those extensions supersede them. This update grants no product approval.
Source labels identify the note and its numbered question. The notes are external handoff inputs.

| Source | Decision to confirm | Current choice or limit |
| --- | --- | --- |
| `s1-api.md` Q1 | Inferred exports with unchanged declarations | Treat them as unchanged. Imported types can still change |
| `s1-api.md` Q2 | Build-output entry points | Keep unresolved paths. Do not guess a source path |
| `s1-api.md` Q3–Q4 | Parameter names and export renames | Parameter renames count as changes. Export renames remain removed and added |
| `s1-api.md` Q5–Q7 | API selection, HTML payload and status grouping | Keep whole-project API comparisons and embedded API data. This handoff uses separate C03 and C04 rows |
| `s2-tsc.md` Q1–Q4 | Compiler applicability and missing diagnostics | Require an unfiltered report for PASS. Include base importers of deleted files. Apply supplied JavaScript reports. Keep fileless errors UNKNOWN |
| `s2-tsc.md` Q5 | Earlier compiler errors | Match any bound base compiler report. Test comparison requires matching command, tools and environment |
| `s2-tsc.md` Q6 | Unknown compiler-output lines | Refuse the report |
| `s2-tsc.md` Q7 | Compiler evidence for feature contracts | V0 keeps the placeholder UNKNOWN. The accepted v1 replaces that check for every change type |
| `s2-tsc.md` Q8 | Syntax and settings diagnostic ranges | Keep the configured ranges. Decide whether every outside error must force UNKNOWN |
| `s3-coverage.md` Q1–Q2 | Unmeasured code and changed-file scope | An absent LCOV record does not satisfy the condition. Include non-test code outside source roots |
| `s3-coverage.md` Q3–Q5 | Partial, empty and multiple coverage reports | Accept bound partial runs. Refuse empty reports. Merge hits with the maximum counter |
| `s3-coverage.md` Q6–Q8 | Renames, rounding and changes without executable lines | Use Git hunks for renames. Round shares down. Keep an empty executable denominator UNKNOWN |
| `w2-coverage2.md` Q1–Q4 | Istanbul precedence, line counts and source maps | Prefer Istanbul branches and functions. Derive no line hits. Skip source-mapped entries. Refuse empty reports |
| `s4-react.md` Q1–Q3 | Framework output, package detection and severity | Add the framework block. Detect development dependencies. Keep the current NEXT rule severities |
| `s4-react.md` Q4–Q6 | Next.js proxy, nested docs routes and built-ins | Decide whether to extend entry detection and source selection, and lower severity for browser-replaced built-ins |
| `s4-react.md` Q7 | Project evidence pages | Keep the `--part nextjs.routes` form |
| `s5-calibration.md` | Known failures and unnamed checks | A corrected known failure must lose its mark. Unnamed checks must not fail |
| `s6-complexity.md` | Example count and nested functions | Show five function examples in total. Retain nested functions in file reports |
| `s8-triage.md` Q1–Q4 | Dates, hidden counts, sampling and precision scope | Use UTC. Exclude hidden findings from visible totals. Include suppressions in unlabeled samples. Use whole-analysis precision |
| `s8-triage.md` Q5–Q7 | Expiry, invalid files and revision selection | Expiry applies only to suppressions. Invalid files stop reports. Apply the current working-folder triage file |
| `s8-triage.md` Q8–Q9 | Triage changes and readable locations | Include uncommitted triage in the write set. Entries identify fingerprints without a location field |
| `w2-layers.md` Q1–Q3 | Exception syntax, overlaps and rule counts | Both top-level `allowed` and `layerExceptions` exist. Overlaps stop analysis. Forbidden layer pairs count as declared rules |
| `w2-layers.md` Q4–Q6 | Unsupported owners and cross-owner checks | Record unsupported lines. One common owner or allowed pair suffices. Owner findings remain medium and outside v0 checks |
| `w2-layers.md` Q7–Q9 | Ownership revisions, names and capability scope | Report both revisions. Keep bounded layer names. C31 remains partial because policy binding is incomplete |
| `w2-models.md` Q1–Q2 | Numeric steps and constants | Use one extra decimal place. Read literal constraints only |
| `w2-models.md` Q3–Q5 | Model fields, folders and review policy | Support `final` and `subject`. Use fixed folders. Decide whether model edits need separate review |
| `w2-models.md` Q6–Q9 | Finding severity, event lists, test reach and limits | Keep model lists separate from findings. Record unhandled and unknown events. Use direct test links and bounded model sizes |
| `w2-contracts-env.md` Q1–Q5 | Template and contract scope | Use package-local templates and matching Next.js roots. Read the first server base. Keep unmatched operations visible |
| `w2-contracts-env.md` Q6–Q9 | Severity, automatic methods and platform names | Keep current severities and framework blocks. Treat automatic HEAD and OPTIONS as handled. Keep the fixed platform-name list |
| `w2-ops.md` Q1–Q5 | Operational pattern exclusions | Exclude top-level intervals, imported fetch clients and Request-only calls. Ref-owned handles are excluded. An unref call discards the handle |
| `w2-ops.md` Q6–Q10 | Duplicate leads, severity and supported hooks | Keep overlapping leads and current severity. Parse tests for syntax only. Support React hooks. Exclude once-only listeners |
| `w2-supply.md` Q1–Q5 | Policy severity and package interpretation | Keep current severity. Count unknown licenses as gaps. Exclude local packages. Refuse invalid policies. Keep current license-expression rules |
| `w2-supply.md` Q6–Q9 | Advisory time, report use and lockfile scope | Use manifest start time. Audits remain information. Read root npm lockfiles. Count new install scripts separately |
| `w2-tests.md` Q1 | Stronger test-weakening policy | Assertion and runner changes remain information under both implemented profiles |
| `w2-tests.md` Q2–Q3 | Matcher equivalences and bail direction | Keep the extra equivalent matchers. Higher bail is currently classified as weaker |
| `w2-worker.md` Q1 | macOS process-environment exposure | Decide whether this backend is acceptable for opt-in execution |
| `w2-worker.md` Q2–Q5 | Protected paths, kernel access, defaults and head selection | Keep current protected paths and kernel allowlist. Defaults are 600 seconds, 2048 MB, 64 MB and one run. Default head is HEAD |
| `w2-worker.md` Q6–Q8 | Run exit codes, stopped artifacts and concurrency | A completed failed test command can give run exit 0. Budget stops retain no artifact. Concurrency counts active store runs |
| `w2-worker.md` Q9–Q10 | Node JUnit form and human authorization | Decide whether to accept top-level Node cases and require terminal confirmation for authorize |
| `w3-perf.md` | Performance extension | Decide when to add controlled timings and more manifest shapes |
| `w4-ruleset.md` Q1 | Evidence-v1 approval | Decided on 2026-10-23: the user accepted all ten recommended answers |

The [v1 proposal, section 8](work/2026-10-23-verify-profile-v1/proposal.md#8-decisions-for-you) holds its ten product decisions.
They cover the default profile, isolated READY evidence, human oracles, preservation evidence, mutation and coverage thresholds.
They also cover harness failures, install scripts, migration checks and public-interface applicability.
Other notes report no blocking user decision. They do not approve the choices above.


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
