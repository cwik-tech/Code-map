# Test changed code with mutants

A mutant is one small edit to source code. Mutation testing checks whether the selected tests detect that edit.
A survivor is a lead, not proof of a missing test. An equivalent mutant does not change behavior.

## Import a Stryker report

Ignore the report folder in Git before the test run. Write the manifest immediately after Stryker finishes.

```sh
code-map manifest --artifact reports/mutation.json --kind stryker-json --exit-status 0 --out reports/mutation.manifest.json -- stryker run
```

Add this pair to `reportInputs` in the verification request:

```json
{"artifact":"reports/mutation.json","manifest":"reports/mutation.manifest.json"}
```

The reader accepts the mutation-testing-report-schema `files` object, with a `mutants` array for each relative file path.
Each mutant needs `status`, `mutatorName` and `location.start` and `location.end` positions.
Survivors can also include `equivalentCandidate: { "reason": "..." }`.
The reader accepts this field only with `status: "Survived"` and a nonblank reason of at most 2,000 characters.
Lines start at one. Columns start at zero.
The reader refuses unsafe paths, invalid positions, unknown statuses and invalid JSON.
Each report has a 50 MiB limit. Each request has a 400,000 mutant limit.
The existing request limits also apply: 64 reports and 256 MiB together.

Only a bound report of the head gives mutation information.
The manifest must record exit status zero and a discovery scope.
Binding checks the commit, working tree, configuration, lockfile and artifact digest.
External manifests remain self-attested, even when they claim isolation.

## Run built-in mutants

First, authorize the exact test command as described in [the worker guide](run.md).
Then run:

```sh
code-map mutate --authorization <id> --base main --head HEAD --max 20 --seed 0 -- node --test --test-reporter=tap
```

Use `--worktree` instead of `--head HEAD` to test uncommitted files.
The default head is `HEAD`. The default maximum is 20. The maximum must be between 1 and 1000.
The default seed is zero. A seed is an integer that selects a repeatable sample.
`--store` selects the authorization store. The worker budget flags can reduce the authorized budgets.
Each baseline and mutant gets those budgets separately. Runs are sequential.
Without a `{testFiles}` selector, Code-map keeps the exact command words.
The command itself selects the tests.

### Select tests from impact

Put one whole-word `{testFiles}` after `--` to select tests from the static head impact walk.
Code-map starts the walk at changed source files with sampled mutants.
It replaces the selector with the sorted test paths that reach those files.
An embedded selector or more than one selector stops the operation.
An empty selection stops the operation before any run. Code-map never substitutes the full suite.

First, print the selection:

```sh
code-map mutate --base main --head HEAD --max 20 --seed 0 --print-selection -- node --test --test-reporter=tap '{testFiles}'
```

`--print-selection` prints JSON with `selection` and the expanded `command` words.
It needs no authorization. It runs no command and writes no files.
Use the printed words to authorize the exact expanded command through [the worker guide](run.md).
Then run the same mutation request with `--authorization <id>` and without `--print-selection`.
Keep `{testFiles}` in that request. Authorization of template words does not authorize expanded words.
Code-map never creates authorization.

The summary and mutation artifact record `selection`. The run manifest records `discovery.selection`.
The selection has policy `impact-v1`, state, reason, source paths in `sources`, test paths in `files`, and count `total`.
An incomplete impact walk sets state `UNKNOWN` and explains the limit in `reason`.
A complete walk sets state `KNOWN`. Static reach does not prove executed coverage.
The cache key uses the expanded command words and the selection.

The baseline and every mutant run the same expanded words.
Code-map does not narrow the selection for each mutant. Each different command needs its own authorization.

Code-map first runs the unchanged head with the same command and budgets.
A failed baseline stops the operation without a mutation report.
Each mutant then runs in a fresh worker workspace with a clean environment and no network.
No mutant changes the source repository. Paths through symlinks are refused.
The operation fails closed when no isolation backend exists.

The parser edits only changed lines in source files. It excludes test files and deleted files.
It supports these edits:

| Source | Replacement |
| --- | --- |
| `<`, `<=`, `===`, `!==` | `<=`, `<`, `!==`, `===`, respectively |
| `true`, `false` | `false`, `true`, respectively |
| `&&` | `||` |
| Numeric `+` | `-` |
| Unary `!` | The operand |
| A returned expression whose return type includes `undefined` | `undefined` |

The standalone TypeScript checker must prove numeric operands and the allowed return type.
It does not resolve project imports or load project compiler settings.
Uncertain arithmetic and return types get no mutant.
New standalone compiler diagnostics produce `CompileError`.
Include the project compiler in the authorized command when project compiler checks are necessary.
A passing command produces `Survived`.
For each survivor, Code-map compares the original and mutated file with the installed TypeScript compiler API, `transpileModule`.
It removes comments, preserves ECMAScript syntax and JSX, and uses compiler formatting to normalize whitespace.
Spaces inside string and template literals remain significant.
Identical output adds `equivalentCandidate: { reason }`. The status stays `Survived` for Stryker compatibility.
Compiler errors prevent this classification. Code-map applies no other equivalence rule.
Declaration files receive no candidate classification because `transpileModule` cannot emit them.
A person must review each candidate. Local transpilation does not prove equivalence under project compiler settings.
A nonzero command needs supported assertion evidence before it produces `Killed`.
The built-in classifier supports Node with `--test --test-reporter=tap` on standard output.
It requires complete TAP diagnostics with a test assertion failure and no collection, hook or runner failure.
Other reporters and commands have unknown failure classification and produce `RuntimeError`.
Authorize the exact command with this reporter. Code-map never adds reporter arguments.
The wall-clock budget produces `Timeout`. Other budgets, signals and worker refusals produce `RuntimeError`.
Collection, import, setup and mixed runner failures produce `RuntimeError`.
Each outcome retains its reason and originating worker run ID.

The result lists the report, manifest, stored run ID and outcome `counts`, including cached results.
Add `{"run":"<run ID>"}` to `reportInputs` with the same store.
The stored aggregate report has an isolated manifest. Executed mutants link to their worker records. Refused mutants have a reason and a null worker ID.
The report records the base, head, working-tree digest, seed, canonical order, candidate count and sample.
The sample uses a SHA-256 rank of the seed and edit identity. Execution follows path and source offset order.

Results remain in the private store, indexed by revision inputs, base, seed, maximum, command, backend and budgets.
The classification version also enters the cache key. Earlier results cannot supply cached kills or omit the new candidate classification.
An authorization trust policy also enters the cache key when present. Different minimums cannot reuse an earlier policy snapshot.
A repeat invocation still requires authorization and a passing baseline before it reuses a cached report.
Cache reuse validates the artifact digest and revision binding.
A damaged cache entry stops the operation. It never silently supplies evidence.

## Read the verification result

`verification-results.json` has a `mutation` array with changed-line counts, score and survivors for each eligible report.
Counts distinguish killed, survived, timeout, no coverage, compile error, ignored and runtime error.
`counts.survived` retains all survivors. `counts.equivalentCandidate` counts candidates, and `counts.ordinarySurvived` counts the other survivors.
The `survivors` list retains all survivors. The separate `equivalentCandidates` list records each candidate path, line, mutator and reason.
The score is `100 * (killed + timeout) / (killed + timeout + survived + noCoverage)`.
Candidates still count as survived. The score and all rating rules stay unchanged in both supported profiles.
Compile errors, ignored mutants and runtime errors do not enter the score.
A zero denominator gives `null`. A report with no matching changed mutant has no measured score.
The Markdown report shows up to three reports, three survivors and three candidate reasons per report. JSON keeps all survivors and candidates.

Mutation information changes no check, rating or readiness under `static-baseline-v0`.
It does not prove the test oracle. Candidate classification requires human review and does not prove equivalent behavior.

## Generated test files

Verification can run the built-in mutants with one generated test file per authorized command.
Read [generated test mutation links](verify.md#generated-test-mutation-links) for templates, authorization, outcomes and limits.
