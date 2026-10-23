# Summary-first retrieval and verification foundations, 2026-10-22

Source: the implementation handoff for the external specification `Testing/code_map_verification_spec.md` and its HTML companion, on local `main` at `7438431` plus uncommitted changes. The user decided: four independent ordinal ratings (1 to 5 or Unassessed, Not applicable only for an approved, wholly inapplicable optional category), no combined score; independent oracle validation; opt-in isolated execution; no discount for a test that was added with its implementation; current inspection behavior and evidence boundaries stay. The user also asked for one stored analysis with a small summary and retrievable evidence.

## Decisions and deviations

| ID | Decision | Why | Who |
| --- | --- | --- | --- |
| D1 | The store is a user cache folder outside the mapped repository (`--store`, `CODE_MAP_STORE`, `XDG_CACHE_HOME/code-map`, `~/.cache/code-map`) | Inspection stays read-only for the repository and its `.git` folder. Refer to [the ADR](../adr/2026-10-22-Stored-analysis-retrieval.md), status Proposed | Claude, waiting for user acceptance |
| D2 | The analysis ID hashes the inputs that decide the analysis. View options and `--history` are not inputs | Same inputs reuse the stored analysis. The analysis does not use the history strip, so the store reads only two history points | Claude |
| D3 | The summary shows at most 20 findings and at most 5 for each rule, with no filling from one rule | The overview stays small and shows several kinds of finding | Claude |
| D4 | New evidence kind `graph` for import-graph findings | The six existing kinds describe test evidence. An import edge is a parsed possible dependency | Claude |
| D5 | `IMPORT-UNRESOLVED` covers relative specifiers only, without `?` or `!` | An unresolved package or alias name can be an installed package. Loader syntax does not name a file. The summary counts loader imports as a gap | Claude |
| D6 | Schema version 1 gets additive fields only: `rules`, `summary.ruleViolations`, and `analysis` for reports from a stored analysis | The existing fields keep their meaning. `docs/inspection.md` now says that consumers ignore unknown fields | Claude |
| D7 | A clean working tree has a null digest | A clean working tree is its commit. A run manifest of that commit then binds to it | Claude |
| D8 | The lockfile digest is the SHA-256 of the content, for a commit and for a working tree | The first version used Git blob IDs for commits, which never matched a run manifest. Found in the integration of the parallel work | Claude |
| D9 | The verification request uses `ratingRulesVersion`, as the report does | The ratings work used `rulesVersion`; the corrected specification uses one name | Claude |
| D10 | `inspect` gives static evidence, findings and retrieval. A future `verify` adds obligations, profiles, ratings, readiness and exit codes | The specification named `verify` for work that the summary design puts into `inspect` | Claude, recorded in the specification |
| D11 | `code-map verify` is not built | A runnable profile needs versioned rubric predicates, thresholds and blocking rules. Those are product decisions for the user. The rating and readiness core is ready for them | Blocked on a user decision |
| D12 | `IMPORT-NAME-MISSING` follows `export * from` re-exports of local files, and skips a target whose names are not all known: a re-export from a package, CommonJS, a destructured export, `export =` or no export | A false break report is worse than a skipped check. The summary counts each skipped import as a gap | Claude |

## Parallel work

Four agents worked on separate write sets: the specification and its HTML companion; the rating, readiness and request core (`lib/ratings.mjs`, `lib/verify-request.mjs`); the report adapters (`lib/adapters/`); and the two-snapshot comparison. The main thread integrated their work. D8 and D9 are the two mismatches that the integration found.

## Measurements

M1, 2026-10-22, this machine (macOS, Node 24.21.0): Pipeline template at `08bcb5f4`, `code-map inspect --summary --ref HEAD` with a new store. These are single runs, not a benchmark.

| Step | Wall time | Peak memory | Output |
| --- | ---: | ---: | --- |
| First summary (full collection and analysis) | 18.34 s | 1.16 GB | 35,144-byte summary. 3,041,082-byte stored analysis. 3,153 findings |
| Second summary (same inputs) | 0.31 s | 340 MB | The same analysis ID, `reused: true` |
| One finding (`--finding`) | 0.31 s | 347 MB | 5,940 bytes. Its file-level test list had 304 entries in pages of 20 |
| One page of one file list (`--part tests.transitive --limit 3`) | 0.31 s | not measured | 3 of 1,108 entries, with the next command |

M2, 2026-10-22, the same machine and project, after the fixes of review R2, with a new store. Single runs, not a benchmark.

| Step | Wall time | Peak memory | Output |
| --- | ---: | ---: | --- |
| First summary, `--ref HEAD` | 19.35 s | 1.16 GB | 35,581-byte summary, 3,153 findings |
| Second summary, same inputs | 0.37 s | 347 MB | The same ID, `reused: true` |
| First summary, `--worktree` | 19.39 s | not measured | — |

During M2, three new Git objects appeared in the shared object store of the Pipeline template: a blob of `agents/general-agent/general-agent.md` and two trees. Other worktrees of that repository were active at the same time (a Codex worktree and a Claude agent worktree). The runs staged no file, and `test/git-safety.test.mjs` shows no write under `.git` in an isolated fixture. The cause of these objects is not proven.

The historical figures in `docs/status.md` (18.3 s and 1.4 GB for a whole-project `inspect` of the same project) come from a different command and an earlier date. They are not comparable with M1.

## Review R1: independent reviewer, frozen copy of the working tree

An independent agent reviewed a frozen copy of the working tree, with no access to the design notes. It found eight defects (seven reproduced) and one plausible defect. Each fix has a regression test.

| ID | Finding | Verdict | Resolution | Regression test |
| --- | --- | --- | --- | --- |
| R1-1 | `git status -z` parsing read the original path of a rename only from the first status column. A rename in the second column hid the next entry, so a changed file reused an old analysis | Confirmed | `parseStatus` in `lib/inputs.mjs` reads it for both columns | "status parsing reads the original path of a rename in either status column …" |
| R1-2 | A tracked symlink to an ignored file: an edit of the target kept the analysis ID | Confirmed | Tracked symlinks count with the content of their target | "an edit of a file that a symlink points to changes the analysis ID" |
| R1-3 | Pruning failed when another process removed a store entry at the same time | Confirmed | Pruning skips an entry that is gone | "saving an analysis survives a store entry that disappears …" |
| R1-4 | Code-map's own outputs made a working-tree analysis stale: a `--full --out` file or a generated page in the repository, a store inside the repository, a relative `XDG_CACHE_HOME` | Confirmed | Only code and JSON content counts; other files count by presence. A store inside the repository is refused. A relative `XDG_CACHE_HOME` is ignored. The printed full-report command suggests a temporary file | "edits of files that the analysis does not read keep the analysis ID …", "the store ignores a relative XDG_CACHE_HOME …", "the store and the suggested full-report path stay outside the repository …" |
| R1-5 | The printed `refresh` command lost a custom `--labels` file | Confirmed | The command keeps it | Same test as R1-4 |
| R1-6 | The JUnit parser was quadratic in the nesting depth of suites | Confirmed | Suites can nest at most 64 levels | "deeply nested suites and floods of malformed entries fail fast …" |
| R1-7 | The test-results parser was quadratic in the number of malformed entries | Confirmed | The repository check runs once, the error list stops at 100, and text input has a size limit | Same test as R1-6 |
| R1-8 | The rule pattern backtracked for a long time on a long run of spaces, and it now runs in every analysis | Confirmed | Rules split at the first arrow | "rules split at the first arrow and trim both sides …" |
| R1-9 | A read-only store failed on read, because a read updates the time of use | Plausible | The time update is optional | None: it needs a read-only file system |

The reviewer also checked these points and found no defect: schema version 1 compatibility, path traversal through IDs and part names, store permissions, shell quoting of printed commands, DOCTYPE and entity rejection, an empty repository, and the reduced history.

## Review R2: seven-lens review with skeptic checks

A workflow reviewed the working tree from seven points of view: input digest and cache, retrieval output, findings and comparison, command-line compatibility, security, the verification core against the specification, and documentation accuracy. Three skeptics then tried to disprove each claimed defect. They reproduced it, read the code path and judged its impact. A claim stayed confirmed when at least two skeptics agreed. Of 62 claims, 46 stayed confirmed. They reduce to about 30 distinct defects.

The fixes ran in four groups with separate files, and each group wrote a regression test for each defect. Two checkers then tested each fix: one reproduced the scenario, and one read the code. 26 fixes passed both checks. For 10 fixes, a checker found a close variant that still failed. The main thread fixed those variants:

| ID | Variant that still failed | Fix | Regression test |
| --- | --- | --- | --- |
| W04 | The list of uncommitted changes followed the index (after `git rm --cached` or a staged move), but the analysis ID did not | The list compares the working-tree content with HEAD and ignores the index | "uncommitted changes depend on the working-tree content, not on the index" |
| W02 | The new content digest for run manifests missed the target of a symlink to an ignored file | A tracked symlink counts with its target when the commit does not hold the target. The summary shows the current content digest | "a symlink to an ignored file binds run manifests through its target …", "the summary shows the current content digest …" |
| W01 | A fix commit that the base history holds, but outside its 100-commit window, showed as NEW | It is UNKNOWN `outside-window` | Unit test in `test/compare.test.mjs` |
| W18 | A required category with only optional obligations was rated | It is Unassessed | "a category whose applicable obligations are all optional is Unassessed …" |
| W22 | On macOS, a different Unicode form of a folder name passed the store guard | The guard resolves the spelling on disk and compares the NFC form | "the store guard compares whole path segments …" |
| W23 | Findings pages of a comparison did not keep the NEW-first order | Pages use the order of the summary | "a findings page of a comparison lists NEW findings before EXISTING ones …" |
| W07 | A file name with a line break broke Git's blob reader | Such names are left out of the map | "a file name with a line break is left out …" |
| W15 | The store root was not checked | A shared root needs the sticky bit | "the store refuses a root folder that other users can change …" |
| W06 | Grafts and replace refs did not change the history input | They are part of it | "grafts and replace refs change the history input …" |
| W29 | An edited move that was not staged gave NEW and RESOLVED | A deleted file and an untracked file with the same unique file name pair, with an unknown similarity | The edited move in "a move that is not staged pairs …" |

Other decisions in this round:

- An observation of the ratings group: a verified fundamental failure that no obligation records left readiness at READY. Readiness now gives REVIEW for it.
- The store check of a stored ref first refused spaces. A valid ref can hold spaces (`main@{2 days ago}`), so only a leading `-`, a line break and NUL are refused.
- A labels or coverage file outside the repository stays refused in a stored analysis. `--summary` now refuses it before it collects.
- W28 (a new test case with the same name above an existing one changes its position, so a comparison shows NEW and RESOLVED) stays a documented limit in `docs/retrieval.md`.
- Two cases stay outside Code-map's control and are documented in `SECURITY.md` and `docs/retrieval.md`: a lazy fetch into `.git/objects` in a partial clone, and the program of a Git filter driver.

## Decisions after the commit

Source: the user's message after commit `c35e4ba`, 2026-10-22.

| ID | Decision | Scope | Who |
| --- | --- | --- | --- |
| D13 | The user accepts the recommended answer to each of the ten questions of the [rule-set proposal](../work/2026-10-22-verify-profile-v0/proposal.md): all four categories required; three blocking failures; architecture-rule check "not applicable" without rules; the TypeScript check required for 3 of 5; self-attested run manifests accepted; thresholds 80% of changed lines and 70% of changed branches; a settings edit fails without blocking; migrations and documentation optional; Code-map's own path matcher; the oracle record for the next version | `code-map verify` with `static-baseline-v0` | User |
| D14 | For now, the work covers TypeScript, JavaScript and React only. Python, Electron and React Native are deferred | The roadmap phases after Phase 2 | User |
| D15 | The HTML companion of the specification is not kept. The specification Markdown file is the only source | `Testing/code_map_verification_spec.md` | User |

## Review R3: the verify command

Source: a workflow built `code-map verify` in four parts (change facts, rule set, report writer, integration). Four reviewers then checked the rule set against the accepted proposal, the command-line behavior, security and the readability of the report. Two skeptics tested each claimed defect. 25 of 32 claims stayed confirmed, 4 of them high severity. An automated security review of commit `c35e4ba` added two medium findings (the store root, and `--out` through a symlink).

A fix workflow in four groups fixed 15 findings that both checkers then confirmed. The main thread fixed the rest:

| Finding | Fix |
| --- | --- |
| V02, V11 | A changed declaration file, and a deleted or moved source file while code exists outside the source roots, keep the import or consumer checks UNKNOWN. The analysis now records the code files outside the source roots (`outsideRoots`) |
| V07, V09 | The default output folders in the store must be private, and the in-repository check covers every folder that `verify` writes |
| V10 | The rating reasons in the JSON results name the open conditions and say when a rule set has no higher level |
| V12 | The next action for a roots difference leads out of the loop: a roots setting in its own commit, used as the base |
| V13 | New command `code-map manifest` writes the run manifest of a report, and `docs/verify.md` explains the steps |
| V14 | Each check that this version cannot close names the request field or the analysis that it comes from |
| V21 | The rule set indexes the test cases once, so large reports cost time in proportion to their size |
| V23 | An invalid run manifest names its first invalid fields |
| V25 | The Terms table explains "minimum evidence" and "predicate" |
| Security 1 | The store refuses a root that another user owns, and it reads a stored file through one open file that does not follow a symlink |
| Security 2 | A report from a stored analysis goes through a new temporary file and a rename |

V22 stays a limit: on a split index, the classic commands read the index, and Git then updates the time of `.git/sharedindex.*` (time only, no content).
