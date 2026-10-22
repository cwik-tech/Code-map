# Test-quality implementation review

## Scope and verdict

Independent review requested by the user on 2026-10-21. Reviewed the relevant Claude conversation, the current `main` checkout at `5fe1a1f289e5b6763d41dec84ef93e8baffe11dd`, and its uncommitted test-analysis implementation. The two commits ahead of `origin/main` provide the alias-resolution and structural-inspection foundations. The test-quality feature itself is uncommitted.

Claude was still implementing the viewer during this review. These findings concern the inspected snapshot, not a completed delivery or a frozen release. No production code was changed by this reviewer. Source line references describe the review-time files and can move.

Verdict: the direction addresses the user's request, but the current evidence model can hide real testing gaps. Correct the issues below before presenting its results as an assessment of test adequacy. Gate results have one home: [review status](../status.md).

## Findings

| ID | Priority | Evidence | Reproduced behavior or source finding | Recommended correction |
| --- | --- | --- | --- | --- |
| TQ-01 | P1 | `lib/test-quality.mjs:63`, `lib/test-quality.mjs:71`, `lib/test-quality.mjs:83` | A skipped or todo test with a failure assertion marks its referenced function `checked`. A fixture with only `test.skip('rejects bad input', () => expect(() => parse(null)).toThrow())` reports a direct failure test even though the summary has no running case. | Keep parked tests in the inventory. Exclude them from runnable candidate links and failure-test evidence. Treat conditional execution as uncertain. Include focused cases in runnable candidates while retaining the focus warning. |
| TQ-02 | P1 | `lib/test-quality.mjs:57`, `lib/test-quality.mjs:80`, `lib/test-scan.mjs:104` | Failure evidence belongs to the entire case and is credited to every referenced source name. `expect(parse('ok')).toBe('ok'); expect(() => other()).toThrow()` marks both functions `checked`. An unused nested function containing a failure assertion also counts as a check, without any invocation. | Bind failure assertions to their source subjects when possible. Otherwise retain a candidate association with explicit uncertainty. Do not let unrelated assertions or uncalled helper bodies close a gap. |
| TQ-03 | P1 | `lib/test-quality.mjs:57`, `lib/test-quality.mjs:71`, `lib/test-summary.mjs:79` | A name alone closes a gap. `test('handles invalid input', () => expect(parse('ok')).toBe('ok'))` produces `checked`, despite no detected failure assertion. The separate name-only warning does not restore that gap. | Keep name hints separate from assertion evidence and from the main gap count. A name can direct inspection but cannot establish a failure check. |
| TQ-04 | P1 | `lib/source-metrics.mjs:125`, `lib/test-quality.mjs:183`, `lib/test-quality.mjs:187` | Real LCOV from Node 24.21.0 marks an unexecuted throw as having run. For `export function parse(x) { if (!x) throw new Error('bad'); return x; }`, a test calling only `parse('ok')` produces branch blocks `[1]`, `[1]`, `[0]` on that line. Selecting the lowest block and index zero returns one hit for the throw. | Do not assume LCOV block order identifies the AST then/else branch across producers. Use a verified producer-specific mapping, or return unknown for ambiguous same-line exits. Add a regression using real generated coverage. |
| TQ-05 | P1 | `lib/viewer.html:858`, `lib/viewer.html:1406`, `lib/viewer.html:1411` | The new color metric grants all failure exits of a `checked` function full credit, and all exits of an `indirect` function half credit. The legend calls this a percentage of exits that have a failure test. There is no assertion-to-exit mapping, and no evidence supports the half weight. One test for one error can color every error in that function as covered. | Use categorical colors for candidate failure-test evidence. Reserve exit percentages for actual measured exit hits, with unknowns visible. Do not imply that function-level associations prove every exit has a test. |
| TQ-06 | P2 | `lib/test-summary.mjs:10`, `lib/analysis.mjs:153`, `lib/test-quality.mjs:79` | Scoped output loses indirect evidence. With `outer` in one source file calling `inner` in another, a failure test of `outer` gives `inner` an `indirect` status. Selecting the inner file reports that status but returns no cases or test files, because the selectors retain only `unit.direct`. | Retain indirect case identifiers and paths, including their route and distance. Include them in scoped JSON and the viewer evidence. |
| TQ-07 | P2 | `lib/test-scan.mjs:62`, `lib/test-scan.mjs:63`, `lib/test-summary.mjs:13` | An ordinary imported alias is invisible: `import { test as check } from 'vitest'; check('rejects bad input', ...)` yields no cases and no test files in the summary. Files with no recognized cases are silently omitted, so unsupported syntax resembles absent tests. | Resolve framework bindings, including aliases. Distinguish discovered test files from parsed test files and unsupported or unrecognized files. Describe parameterized calls as definitions unless their expanded case count is known. |
| TQ-08 | P2 | `lib/test-labels.mjs:29`, `lib/test-labels.mjs:55`, `lib/test-labels.mjs:73` | Optional labels have incomplete freshness and completeness checks. A hashless entry is `current`. A file with two cases and a current hash but a label for only one case never lists the missing label. Separately, the documented `labels stamp` instruction skips an existing hash, so it cannot refresh a stale entry after relabeling. | Track missing labels per case. Distinguish unstamped labels from verified freshness. Make the refresh command explicit and targeted, with tests for initial, partial, stale and refreshed labels. |

## Minimal reproduction notes

TQ-01, TQ-02, TQ-03, TQ-06 and TQ-07 were reproduced by passing literal source and test text through the actual exported `analyzeFile`, `analyzeTests`, `analyzeProject`, `createReport` and `summarizeTests` functions, as appropriate. No framework execution was claimed for these parser probes.

For TQ-04, create a temporary directory containing this source:

```js
// a.mjs
export function parse(x) { if (!x) throw new Error('bad'); return x; }
```

```js
// a.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from './a.mjs';
test('happy', () => assert.equal(parse('ok'), 'ok'));
```

Inside that directory, generate real coverage:

```sh
node --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination=lcov.info a.test.mjs
```

Read it with `readCoverage` and pass its line and branch data to `analyzeTests` with `coverageSnapshot: 'working-tree'`. The current code returns one hit for the throw despite the happy-only execution. This reproduction verifies the Node producer specifically; other producers were not tested.

TQ-05 was confirmed by reading the actual color calculation and legend. TQ-08's hashless and partial-label cases were reproduced through exported functions; the stamp behavior follows directly from its existing-hash guard.

## Product feedback for Claude

- Keep the visible top-level Tests tab and the three-part summary: statistics, observations and next steps. This directly addresses the discoverability issue in the conversation.
- Separate test inventory, inferred associations, assertions found in source, measured execution and model labels. A source pattern is repeatable but still heuristic; the UI must not call an inferred gap a proven fact.
- Prefer “no failure assertion found” over “happy path only.” An unrecognized custom assertion is unknown, not proof that the case exercises only success.
- Show test-layer totals alongside intent totals and unknown intent. Regression describes why a test exists; a regression can exercise either a success or a failure. Do not force those categories to be mutually exclusive.
- Keep each recommendation tied to a source location, a candidate test location and the evidence strength. The new value for an LLM is a compact investigation index with traceable examples, rather than an unqualified quality score.
- Show coverage age and missing revision binding beside the measurement. A working-tree selection alone does not establish that an older coverage report matches the current source.
- Before closeout, add focused regression tests for these cases and an acceptance check that opens Tests, selects a source scope, and exports matching evidence. The existing tests do not directly exercise the new scanner and summary contracts in the inspected snapshot.

## Documentation handoff

The new CLI verbs, optional label file and `tests` / `testSummary` output need corresponding changes in `docs/inspection.md`, `AI-AGENT-USE.md`, the relevant README sections and `CHANGELOG.md` before implementation closeout. Those files were checked against the new parser and report selector. Their updates remain with Claude because the implementation is still changing. This review itself does not warrant a changelog entry or an ADR.

## Follow-up review at `32dcb5e`, 2026-10-21

The user requested another review of the current files and Claude chat. The checkout was clean on branch `test-quality`; the latest changes were committed, not uncommitted. Reviewed `main...HEAD`, the scanner and assertion-linking implementation, its regressions, and Claude's latest conversation about a targeted mutation checker. Used focused `code-map inspect --worktree` to orient the source review. Verification results are in [review status](../status.md).

The earlier review led to material improvements: name-only evidence no longer closes a gap, ambiguous Node LCOV stays unknown, the color scale uses evidence categories, indirect routes are retained, framework aliases are recognized, and label completeness and refresh have explicit handling. The latest text-matching changes reduce fixture-text false positives. Structured verification arguments and shell quoting are useful additions.

The remaining cases below still let the scan overstate failure-test evidence. These were reproduced against the current code, including an independent run with the real Node test runner. This is not approval of the completed scan or of an assertion-strength implementation.

| ID | Priority | Evidence | Finding and reproduction | Correction |
| --- | --- | --- | --- | --- |
| TQ-R2-01 | P1 | `lib/test-scan.mjs:107`, `lib/test-scan.mjs:108` | TQ-02 remains partially open. Merely referencing a helper merges its assertions: `function helper(){ assert.throws(() => parse(null)); } test('reference', () => { const unused = helper; assert.equal(true, true); });`. The helper never runs, but `parse` gets `direct` evidence. Skipping the helper declaration does not prevent this reference path. | Merge helper facts for actual invocations or specifically supported callback consumers. Keep a bare reference as possible reach, without assertion credit. Add a regression for a helper assigned to an unused variable. |
| TQ-R2-02 | P1 | `lib/test-quality.mjs:60`, `lib/test-quality.mjs:64` | The one-source fallback still assigns unrelated failures to a function. `parse('ok'); assert.throws(() => JSON.parse(''));` marks `parse` as `direct`. Only the built-in JSON parser fails; the source function is exercised successfully. | Leave untied assertions as candidate evidence. One imported source name is not proof of assertion ownership. This is distinct from the multi-source regression already covered. |
| TQ-R2-03 | P2 | `lib/test-scan.mjs:92`, `lib/test-scan.mjs:93`, `lib/test-quality.mjs:82` | `parse('ok'); if (false) assert.throws(() => parse(null));` marks `parse` as `direct`. The conditional-assertion warning is useful, but it does not stop the impossible check from closing the gap. | Exclude statically unreachable checks. Preserve conditional checks as candidates when their execution is unknown; do not require general symbolic execution. |
| TQ-R2-04 | P2 | `lib/test-scan.mjs:30` | A child's modifier replaces an inherited skip: `describe.skip('parked', () => test.only('child', () => assert.throws(() => parse(null))))`. The scanner calls the child `focused` and credits `parse`; the real Node runner skips the suite. | Compose effective execution status separately from focus metadata. An ancestor skip must dominate a child's focus or conditional modifier. |
| TQ-R2-05 | P1 | `lib/test-summary.mjs:138`, `lib/test-summary.mjs:139` | The new agent guide says a test counts “when it runs” and a function is “done” when its status is `direct`. Its verification command only inspects source. It neither runs the tests nor verifies every failure exit or assertion behavior. The false positives above can satisfy that exact completion instruction. | Call `direct` a static association, not a completion gate. Require the project's relevant tests to pass and require behavior-specific evidence. Report scan changes separately from test execution and mutation results. |

### Reproduction boundary

Each of the first four cases was first passed separately through `analyzeFile` and `analyzeProject`. Each independently produced `direct` for `parse`. A combined fixture was then executed by Node 24.21.0 with `node --test`: its three active cases passed and the enclosing skipped suite did not run. Passing the same fixture text through the scanner reported four direct failure assertions for `parse`. None of the actual tests triggered its failure path.

### Feedback on the latest Claude chat

The user authorized building a targeted mutation checker and selected Pipeline template for the first trial. This review does not reverse that scope. Claude correctly stopped to repair a trial whose baseline was invalid because test-file arguments were combined incorrectly.

Before treating the trial as assertion-strength evidence:

- Require a passing baseline with the same test selection, snapshot, runtime and command as each mutant. Record test discovery and execution, not only the process exit code.
- Distinguish assertion failures from compilation, import, discovery and runner failures. Retain timeout, invalid, uncovered and uncertain outcomes instead of classifying every nonzero exit as killed.
- Describe survival as “these selected tests did not detect this change.” It does not prove that the changed code was never exercised; equivalent behavior or weak assertions can also explain survival.
- Verify that the copied module is the module the tests actually load. A copy sharing `node_modules` is useful for speed but does not establish that all writes and module resolution stay in the copy.
- Keep static assertion patterns separate from mutation evidence. First demonstrate one known killed mutant, one known surviving non-equivalent mutant, and one invalid run before generalizing the checker.

The feature remains useful as an investigation index. The strongest next improvement is reliable evidence attribution and explicit execution receipts, rather than making `direct` a proxy for completed testing.
