# Record: Code-map on five real repositories, 2026-10-23

## Why this record exists

A second run with the final code of the day is in [the trace and fix record](2026-10-23-requirement-trace-and-fixes.md#second-run-on-the-users-repositories).

The user asked to check that the new functions work on some of the user's own codebases. This record says what ran, on which repositories, what worked, which defects the runs found, and how each defect was corrected. It describes the branch `cwik-tech/roadmap-integration`.

## How the runs were made

The repositories are private projects of the user. This record names them Project A to Project E and gives only their kind.


- Each run used the Code-map checkout of the integration branch, with `--store` and `--out-dir` in a private temporary folder. Thus no run wrote into a repository.
- Before and after each run, `git status --porcelain` of the repository was compared. It never changed.
- No project code ran. The TypeScript compiler ran one time, in a private clone of Project A, not in the user's checkout.
- The Vitest suite of Project A ran in the restricted worker, in a private clone. Refer to [isolated runs on Project A](#isolated-runs-on-project-a).

| Repository | Kind |
| --- | --- |
| Project A | Next.js 16.1.6, React, Drizzle, Vitest, 338 commits |
| Project B | React, Electron, Vitest, 311 commits |
| Project C | React, Electron, Vitest, 136 commits |
| Project D | Next.js, Prisma, Vitest, 4 commits |
| Project E | npm workspaces monorepo, 3 commits, uncommitted changes |

## Results of the final version (commit 12a8431)

| Repository | `inspect --summary` | `--base` comparison | `verify` with `static-baseline-v0` | `verify` with `evidence-v1` |
| --- | --- | --- | --- | --- |
| Project A | 3.0 s, 500 findings | 2.8 s (5 commits) | 1.2 s, INSUFFICIENT_EVIDENCE | 1.4 s, INSUFFICIENT_EVIDENCE |
| Project B | 5.5 s, 410 findings | 7.2 s (5 commits) | 1.2 s, INSUFFICIENT_EVIDENCE | 1.9 s, INSUFFICIENT_EVIDENCE |
| Project C | 2.7 s, 143 findings | 3.0 s (5 commits) | 0.9 s, INSUFFICIENT_EVIDENCE | 1.3 s, INSUFFICIENT_EVIDENCE |
| Project D | 0.8 s, 24 findings | 1.2 s (1 commit) | 0.5 s, INSUFFICIENT_EVIDENCE | 0.6 s, INSUFFICIENT_EVIDENCE |
| Project E | 4.4 s, 1,265 findings | 2.8 s (1 commit) | 0.9 s, INSUFFICIENT_EVIDENCE | 1.2 s, INSUFFICIENT_EVIDENCE |

INSUFFICIENT_EVIDENCE is the expected result: the requests had no test report, so the checks that need a test run stay unknown. A second summary of the same code took 0.4 to 0.8 seconds, because it reuses the stored analysis.

Other results:

- **Compiler report (Project A clone):** `tsc --noEmit --pretty false` gave no error in 6 seconds. With the bound report, the check "Types are compatible" gave PASS, and Structural Integrity rose from 2 to 3 of 5.
- **Build sizes (Project A):** `code-map sizes` read the existing `.next` folder in 1.6 seconds. It gave 13 routes. The home page needs 3,575,688 bytes of JavaScript on its first load (1,057,815 bytes with gzip).
- **Replays of real fix commits:** `scripts/replay.mjs` ran `verify` on 5 fix commits of Project B, 8 of Project C and 8 of Project A, in 20 to 31 seconds for each repository.
- **Completeness table (Project A):** 214 TypeScript files, 5 JavaScript files, 165 JSX and TSX files and 9 JSON files were parsed. 1 CSS file and 14 other files were skipped, and 2 dynamic imports stayed unresolved.
- **SBOM (Project A):** `code-map sbom` wrote a CycloneDX 1.5 document with 1,812 components.
- **Schema comparison (Project A, one commit):** two new Drizzle tables, reported as compatible, and no migration file in the change. The repository commits only the Drizzle journal, so this lead is correct.

## Isolated runs on Project A

The user asked to check the work on the user's codebases. The restricted worker is the safest way to run project tests, so Code-map ran the Vitest suite of Project A in it. The authorizations were made for a private clone of the repository in a temporary folder, not for the user's checkout. Each authorization allowed one exact command for one day. Each run had no network, could not read the home folder, and worked on a copy of the clone.

| Run | Command and budgets | Result |
| --- | --- | --- |
| 1 | `vitest run --reporter=junit`, 4,096 MB | The memory budget stopped the run after 47 s. Code-map kept no artifact |
| 2 | `--maxWorkers=2`, 8,192 MB | The memory budget stopped the run after 227 s, at a sampled peak of 8,200 MB |
| Head commit | `--maxWorkers=2`, 24,576 MB, 1,800 s | 352 s. JUnit report with 2,050 cases, 142 failed |
| Base commit | The same command | 392 s. 2,050 cases, 139 failed |
| Head (working tree) | The same command | 142 failed |
| Coverage (working tree) | `--coverage --coverage.reporter=lcov --coverage.reportOnFailure` | LCOV report kept. Without `reportOnFailure`, Vitest writes no report when a test fails |
| Mutation | `code-map mutate --base <base> --worktree --max 6` with two test files that pass on the head | 202 s. 77 candidate mutants on changed lines, 6 sampled, all 6 survived |

`code-map verify` for the change from the base commit to the working tree, with the isolated base and head runs, the isolated coverage, the isolated mutation report and the compiler report:

| Item | Result |
| --- | --- |
| Binding | All five reports bound. Four have the label "isolated" and one (the compiler report) "self-attested" |
| New test failures | 3 cases that pass on the base fail on the head, all in one settings test file. The change moved a settings list to another file and changed its order. A person must decide whether the order or the test is wrong |
| Earlier failures | 139 cases fail on both sides. Most are failures of the project's own tests, for example "invariant expected app router to be mounted" (36) and mocks without an export (41) |
| Line and branch coverage of the change | 107 of 320 changed lines (33.4%) and 33 of 164 changed branches (20.1%). The 3 changed settings files are not measured, because the coverage settings of the project include only `hooks/`, `lib/` and `components/` |
| Mutation | Score 0 of 6. The two selected test files do not reach the mutated lines. A survivor is a lead, not proof of a missing test |
| Ratings | Structural Integrity 3 of 5, Verification Coverage 2 of 5. With `evidence-v1`, Behavioral Confidence 1 of 5 and "Behavior preserved" FAIL |
| Readiness | BLOCKED (exit 2) with both rule sets, because of the 3 new failures |

One more defect came from these runs. The tracked symlink `.claude/skills/shadcn` points to a committed folder, and Code-map treated a link to a folder as a link outside the commit. Thus a clean working tree looked changed, and a compiler manifest bound only to a working-tree analysis. The correction is in the table below.

## Checks of the last features on Project A

| Feature | Result |
| --- | --- |
| Compiler diagnostic lifecycle | `tsc` ran on the base in a separate worktree of the clone and on the head. Both reports bound, and the lifecycle gave 0 new, 0 existing and 0 resolved diagnostics, because neither side has a type error |
| Trust tiers | Each report of `verify` shows its tier: `isolated` for the worker test runs, `isolated-signed` for the timing runs, which have a valid signature of this machine, and `self-attested` for the compiler reports |
| Controlled timings | `code-map bench --runs 5 --warmup 1` with two test files: base median 871 ms, head median 909 ms (+4.3%), noise range ±60 ms. The change is inside the noise, so no slowdown is reported |
| Offline install of revision dependencies | `npm ci --offline --ignore-scripts` ran in the sandbox with the user's npm cache readable. npm stopped with ENOTCACHED for `zod-to-json-schema-3.25.1`, and the run record says that the revision has no prepared dependencies. A complete run needs a cache that holds every package of the lockfile |

## Leads that were checked in the code and are correct

| Repository | Lead |
| --- | --- |
| Project A | Four imported packages that `package.json` does not declare: `@tiptap/core`, `@tiptap/extension-code-block`, `@radix-ui/react-radio-group`, `playwright` |
| Project A | `fetch` calls without a timeout in API route handlers that call external services (4 of 13 checked) |
| Project E | `@sinclair/typebox` is imported in `packages/agent` but not declared there |
| Project D | `DATABASE_URL` is read but not in `.env.example`, and three files in `src/lib/` have no importer |

## Defects that the runs found, and their corrections

| Defect | Correction |
| --- | --- |
| 182 of 228 complexity entries were unknown, because callbacks in React hooks had position names (`<anonymous 3>`) | A callback takes the name of its variable or of its callee and position (`send`, `useEffect#2`). The same comparison of Project A over 10 commits then gave 12 unknown entries of 132 |
| `tw-animate-css` was "unused", but a CSS file imports it | Style-file imports count as uses |
| `electron` in `devDependencies` was "development-only", but this is the normal Electron setup | `electron` is a runtime-provided package for this rule |
| A React effect whose timer handle a ref keeps was "without cleanup" | A handle that a ref keeps belongs to the owner of the ref |
| "New imports resolve" was unknown for most commits, because the analysis did not check the imports of test and configuration files | The analysis checks them. On Project A commit 0157ae0, the check now gives PASS |
| `code-map sizes` gave no routes and no CSS for a Next.js 16 build | It reads `page_client-reference-manifest.js` and counts the CSS under `static/chunks` |
| The new manifest reader refused the real Next.js 16.1 files, which have no final semicolon | The semicolon is optional |
| A tracked symlink to a committed folder made a clean working tree look changed, so compiler manifests did not bind to a commit analysis | A link to a committed folder is inside the commit. A broken link is also the same as in the commit |
| Without `--ref` or `--worktree`, every command failed on Project A with "ambiguous argument 'electron'": the repository has a branch and a folder with that name | The branch choice uses the full branch name (`refs/heads/electron`) and the `--` separator |
| `inspect --types` gave UNKNOWN for three of four configurations, because TypeScript 6 reported `incremental` without a build file and the deprecated `baseUrl` and `moduleResolution: node10` | The analysis program, which never emits, turns off the emit settings and accepts the options of TypeScript 5 projects |
| `inspect --types` then stopped at the default budget of 10 seconds | The default is 60 seconds. With it, all four programs of Project A were complete in 24 seconds, with 216 and 378 checked files |
| Under load, an aborted model review failed with "Cannot stop model command", because macOS refuses a signal to a process group that holds only an exited process | EPERM from that group counts as "nothing left to stop", as ESRCH does. Ten parallel runs of the test pass |

## Open items

- **New failures in Project A:** a person must decide whether the new order of a settings list or the 3 tests are wrong.
- **Renamed test cases:** in two Project B fix commits, a renamed test case counts as a deleted case, so "Tests are not weakened" fails. This follows the accepted rule. A change of the rule needs the user's decision.
