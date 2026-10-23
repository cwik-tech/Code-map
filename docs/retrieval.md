# Summary-first inspection and stored analyses

`code-map inspect --summary` analyzes one snapshot, stores the analysis outside the repository, and prints a small overview. The overview lists findings, evidence gaps and an exact follow-up command for each finding. Follow-up commands read the stored analysis by its ID. They do not collect the code again, and they tell you when the code changed after the analysis.

The classic `code-map inspect` report does not change. It keeps schema version 1, and [the inspection reference](inspection.md) describes its fields. A full report is for an archive, for debugging or for an integration. It is not the normal input for an agent prompt.

## Start with the summary

Run the summary inside the repository, and select the snapshot explicitly:

```sh
code-map inspect --summary --worktree
code-map inspect --summary --ref HEAD --change latest
```

The first summary of a snapshot collects and analyzes the whole project. It costs the same time and memory as a whole-project `inspect`. A file or change selection makes the overview smaller, but it does not make the first run cheaper. The next summary with the same inputs reuses the stored analysis and does not collect again. `analysis.reused` tells you which case applies.

A `--file` or `--change` selection limits the overview to findings that touch the selected files, and to test findings for cases that reach them. The stored analysis always covers the whole project. The printed commands keep the selection.

## Follow the printed commands

Each command reads one stored analysis. Copy the commands from the output. The analysis ID starts with `A-`, and a finding ID is its rule ID followed by ten hexadecimal characters.

| Command | Output (`reportType`) |
| --- | --- |
| `code-map inspect --analysis <id>` | The summary of the stored analysis (`code-map-summary`). To scope it, add `--summary` with `--file` or `--change`; without `--summary`, those options give the file report below |
| `code-map inspect --analysis <id> --finding <finding id>` | One finding and its evidence (`code-map-finding`) |
| `code-map inspect --analysis <id> --finding <finding id> --part <name>` | One complete evidence list of the finding, one page at a time (`code-map-evidence`) |
| `code-map inspect --analysis <id> --findings` | A page of findings (`code-map-findings`). Add `--rule <rule id>`, `--file` or `--change` to filter |
| `code-map inspect --analysis <id> --file <path>` | The schema version 1 report of the selected files, from the stored analysis |
| `code-map inspect --analysis <id> --file <path> --part <name>` | One complete list of one file, one page at a time (`code-map-evidence`) |
| `code-map inspect --analysis <id> --full --out <file>` | The whole-project schema version 1 report, from the stored analysis. The printed command suggests a file in the `exports` folder of the store, which only you can open. A file written inside the repository changes the working tree, and the analysis of a working tree then becomes stale |

A follow-up command works from any folder, because the stored analysis records its repository. It does not read the `.code-map.json` of the current folder. When `--store` or an environment variable chose the store, each printed command includes `--store <folder>`. The options of one command must select one view: for example, `--finding` with `--file`, `--rule` or `--baseline` fails. `--compact` writes JSON without indentation, for any `inspect` output.

The schema version 1 report from a stored analysis is the same report that `inspect` gives for that snapshot, plus an `analysis` object with the ID and the freshness. Its `snapshot.generatedAt` is the time of the stored analysis.

## Compare with a base commit

`--base <ref>` also analyzes a base commit, or reuses its stored analysis, and labels each finding against it:

```sh
code-map inspect --summary --worktree --base main
code-map inspect --summary --ref HEAD --base HEAD~1 --change latest
```

The base is always a commit. Each finding of the summary gets a `baseline` and a `matchedBy` value:

| `baseline` | `matchedBy` | Meaning |
| --- | --- | --- |
| `EXISTING` | `fingerprint` or `rename` | The base has the same finding, also after a Git rename of its file |
| `NEW` | null | The base has no matching finding |
| `RESOLVED` | `absent` or `path-removed` | A base finding has no match in the head. `path-removed`: its file is gone |
| `UNKNOWN` | `changed-in-move`, `ambiguous`, `not-measured`, `outside-window`, `rule-base-changed`, `renames-incomplete` or `not-comparable` | Code-map cannot decide. The file changed while it moved. Several base findings match one head finding. The rule needs coverage on both sides. A bug-fix commit is outside the window of the last 100 commits on one side. The common source folder that names the modules of the architecture rules changed. Git skipped rename detection because of its rename limit. Or the analyses are not comparable |

Inside each severity, the summary and each findings page show NEW findings first, then UNKNOWN, then EXISTING.

Code-map reads the renames with `git diff -M`. In a comparison with the working tree, Git does not see a move that you did not stage, because the new file is untracked. Code-map then pairs a deleted file and an untracked file when their content is the same. It also pairs them when they are the only two files with the same file name. Such a pair has an unknown similarity, so a finding of those files that does not match is UNKNOWN, not NEW or RESOLVED. The `comparison` object has the base analysis (`id`, `sha`, `ref`), the `state`, the `reasons`, the `counts` of each label, up to 10 resolved findings and a command for each label. A resolved finding comes from the base analysis, so its `next` command names the base analysis ID.

The comparison is `NOT_COMPARABLE` when the two analyses come from different repositories, analyzer versions, configurations, environments or source roots, or when the working tree or the commit of a stored working-tree head changed after its analysis. The `reasons` list says which. A comparison that is not comparable gives no NEW, EXISTING or RESOLVED label. A label compares static findings. It is not a test result, and Code-map does not subtract or score.

To page through one label, follow the printed command, for example `code-map inspect --analysis <head id> --base-analysis <base id> --findings --baseline new`.

## Pages

Each page has `total`, `offset`, `limit`, `items` and `next`. `next` is the exact command for the next page, or `null` on the last page. The default page size is 20, and `--limit` accepts 1 to 500. `--offset` and `--limit` apply to `--part` and `--findings`.

The stored analysis keeps every list complete. A count in the summary is a view of a list, not a replacement for it.

| Target | Parts |
| --- | --- |
| A file (`--file <path> --part`) | `imports`, `importers`, `exports`, `declarations`, `tests.direct`, `tests.transitive`, `coChanges` |
| A cycle finding | `files`, `edges` |
| A missing-import-name finding | `exports` (the names that the target file exports) |
| An export finding | `consumers`, `importers` |
| A shared-type finding | `consumers` |
| A function finding (`TEST-NO-FAILURE-ASSERTION`, `TEST-UNREACHED`, `TEST-EXIT-NOT-RUN`) | `exits`, `cases.direct`, `cases.via`, `tests.direct`, `tests.transitive` |
| A fix-commit finding | `sources` |

For a function, the analysis keeps the first five cases that reach it through callers, with their routes. `cases.viaTotal` gives the full count. The file-level test lists are complete.

## The summary

| Field | Contents |
| --- | --- |
| `analysis` | `id`, `createdAt`, `reused`, and `freshness` |
| `snapshot` | Project, mapped ref, commit SHA, `workingTree`, `worktreeDigest` and the `selector` that the summary used. `worktreeDigest` is the SHA-256 digest of every file that differs from the commit now (changed, deleted or untracked, and the target of a tracked symlink when the commit does not hold it). Files that Git ignores are left out. It is null for a commit or a clean working tree. A run manifest records the same value, so a test report binds to this code. It is not part of the analysis ID |
| `scope` | The selection, if there is one, with at most 20 files and 20 missing paths, their totals and the command for the complete file report; and the numbers of source files, test files and test cases |
| `verification` | `state: "NOT_RUN"`, with `readiness` and `ratings` set to null. `code-map verify` is not implemented, so the summary gives no rating and no readiness |
| `findings` | `total`, `bySeverity`, `byRule` (each with a `next` command), up to 20 `items` (at most 5 for each rule, highest severity first) and `next` when more findings exist |
| `gaps` | Evidence that the analysis could not establish, each with `key`, `source`, `text` and an optional `count` |
| `tests` | The test-quality statistics: `key`, `source`, `label`, `value` and `warn` |
| `commands` | Templates for the findings list, a file report and the full report |
| `limits` | The interpretation limits of the analysis |

The summary shows at most 20 findings inline, so its size does not grow with the number of findings. Measurements on a large project are in [the record of this work](records/2026-10-22-summary-first-retrieval.md).

## Findings

A finding is one investigation lead. It is not a PASS or FAIL result, and it does not give a rating. Each finding has these fields:

| Field | Contents |
| --- | --- |
| `id` | The rule ID and the first ten hexadecimal characters of the fingerprint |
| `ruleId`, `title` | The rule, from the table below |
| `fingerprint` | Sixteen hexadecimal characters from the rule and the semantic location: paths, names and the cycle members. Line numbers are not part of it, so the ID survives line moves |
| `severity` | `high`, `medium` or `low`, from the rule |
| `source` | The kind of evidence. Refer to [evidence kinds](inspection.md#evidence-kinds) |
| `capability` | The capability number (C01 to C45) of the verification specification |
| `text`, `location`, `evidence` | What was found, where (`path`, `line`, `symbol`) and up to three evidence locations |
| `next` | The exact command that shows the finding with its evidence |

If two different findings get the same ten-character ID, the second one gets the full fingerprint in its ID.

A test-case finding identifies its case by the test file, the suite, the name and the position among cases with the same name in that file. A new case with the same name above an existing one changes that position, so a comparison then shows one NEW and one RESOLVED finding for an unchanged case.

| Rule | Severity | Evidence | Capability | Meaning |
| --- | --- | --- | --- | --- |
| `ARCH-RULE` | high | graph | C06 | An import breaks a rule in the `rules` of `.code-map.json` |
| `IMPORT-NAME-MISSING` | high | graph | C02 | A file imports a name that the imported file does not export, for example after a rename. Named imports from files with unknown exports (a re-export from a package, CommonJS, a destructured export, `export =`) are skipped and counted as a gap |
| `TEST-FOCUSED` | high | inventory | C10 | A test case is focused with `.only` |
| `TEST-EXIT-NOT-RUN` | high | measured | C12 | A measured failure exit never ran in the coverage run |
| `TEST-NO-FAILURE-ASSERTION` | high | inferred | C09 | Tests reach a function with failure exits, but no failure assertion is tied to it |
| `TEST-UNREACHED` | high | inferred | C09 | No test reaches a function with failure exits |
| `IMPORT-UNRESOLVED` | medium | graph | C01 | A relative import matches no file in the snapshot. Specifiers with `?` or `!` are not checked |
| `CYCLE-VALUE` | medium | graph | C05 | Files import each other through value or side-effect imports |
| `FIX-WITHOUT-TEST` | medium | git | C27 | A commit that looks like a bug fix changed no test file |
| `TEST-NO-ASSERTIONS` | medium | pattern | C27 | A running test case has no assertion that the scan can find |
| `TEST-UNRECOGNIZED-FILE` | medium | inventory | C40 | A file named as a test has no recognized test case |
| `CYCLE-ALL` | low | graph | C05 | Files import each other only when type-only imports count |
| `SHARED-TYPE` | low | graph | C30 | Consumers import a type from a parent that imports them |
| `EXPORT-UNREFERENCED` | low | graph | C32 | No importer uses an exported name |
| `EXPORT-TEST-ONLY` | low | graph | C32 | Only tests import an exported name |
| `TEST-SWALLOWED-ERROR` | low | pattern | C27 | A test case catches an error around an assertion and ignores it |
| `TEST-FIXED-WAIT` | low | pattern | C27 | A test case waits for a fixed time |
| `TEST-PARKED` | low | inventory | C10 | A test case is skipped, todo or conditional |
| `TEST-LAYER-MISMATCH` | low | pattern | C10 | A test in a unit-test folder uses a process, the network, a database or a browser |
| `TEST-UNREADABLE-FILE` | low | inventory | C40 | A test script in another language that the scan cannot read |

## Analysis ID and freshness

The analysis ID is a hash of the inputs that decide the analysis:

- The repository folder and the snapshot selector
- The commit SHA that the selector resolves to, and the mapped ref
- For a working tree: a content hash of each code or JSON file that differs from the commit, because the collector reads these files. For any other file, only whether it is there, because an import can resolve to it. An edit of a README or of a generated page does not change the ID. Staging a change with `git add` does not change the ID either, because the index does not count. A file marked assume-unchanged or skip-worktree counts with its content. A tracked symlink counts with the content of its target when the commit does not hold the target
- The first existing branch of `main`, `master`, `origin/main` and `origin/master`, which `--change branch` uses
- The form of the history: whether the clone is shallow, and digests of the shallow boundary, the grafts file and the replace refs
- The loaded `.code-map.json`, the test-labels file, and the coverage file with its modification time
- The analyzer: the code-map version, a hash of its source files, and the TypeScript and Node versions
- The root lockfile of the project

The same inputs give the same ID. View options (`--file`, `--change`, `--summary`, `--part` and paging) do not change the ID. Code-map hashes files itself, and it runs Git without optional locks and with a private copy of the index, so it does not change the repository. Refer to the limits below for two cases inside Git. The stored analysis keeps no history strip, so `--history` does not apply.

Each follow-up command computes the inputs again and compares them with the stored inputs:

| `freshness.state` | Meaning |
| --- | --- |
| `current` | The inputs are unchanged |
| `stale` | At least one input changed. `changed` lists the kinds (`commit`, `worktree`, `history`, `base-branch`, `config`, `labels`, `coverage`, `lockfile`, `analyzer`, `environment`), and `refresh` is the command for a new summary. The report still shows the stored snapshot, not the current code |
| `unknown` | Code-map could not read the repository. `text` gives the reason |

Run the `refresh` command inside the repository.

## The store

The store is the first of these folders: `--store <folder>`, `CODE_MAP_STORE`, `XDG_CACHE_HOME/code-map`, `~/.cache/code-map`. A relative `XDG_CACHE_HOME` is ignored, as the XDG specification requires. A store inside the repository is refused, because it would change the working tree that it describes. The check compares whole folder names, and on macOS and Windows it ignores letter case and the Unicode form of a name.

Code-map refuses a store folder that other users can change. The root folder can be shared only with the sticky bit, as `/tmp` is. The `analyses` folder and each stored file must belong to you, must not be symlinks, and must not be writable by other users. When Code-map reads a stored analysis, it checks each value that goes to Git or to the file system: the repository path, the ref, and the labels and coverage paths. A `--summary` with a labels file or a coverage file outside the repository fails before it collects. Each analysis is one gzip-compressed JSON file, `analyses/<id>.json.gz`, with permissions for the user only. Code-map writes a temporary file and renames it, so a reader never sees half a file. The store keeps the 20 analyses used most recently and deletes the older ones when it saves a new one. Several processes can share one store. A store that you can only read still serves its analyses.

A stored analysis holds paths, names, import facts and test facts, but no source text. You can delete the store at any time. The next summary of unchanged code gets the same ID again.

## Errors

When a command fails, it prints a message to standard error, prints nothing to standard output and exits with a nonzero status. Examples:

- The analysis ID is not in the store, or it is not in the form `A-` and sixteen hexadecimal characters.
- The stored file is unreadable or damaged.
- A retrieval option (`--finding`, `--findings`, `--rule`, `--part`, `--offset`, `--limit`, `--full`) has no `--analysis`.
- `--analysis` comes with `--worktree` or `--ref`. The analysis already identifies its snapshot.
- The finding ID, the rule ID or the part name is unknown. For a rule or a part, the message lists the valid names. For a finding, it gives the command that lists the findings.
- `--limit` is not a whole number from 1 to 500, or `--offset` is negative.
- `--base` has no `--summary`, comes with `--analysis`, or does not name a commit. `--base-analysis` or `--baseline` has no `--analysis`, or `--baseline` is not one of `new`, `existing`, `resolved` and `unknown`.

## Limits

- Code-map does not write to the repository or to its `.git` folder. Git commands that compare with the working tree use a private copy of the index. Two cases are outside Code-map's control: in a partial clone, Git can fetch a missing object into `.git/objects` when Code-map reads an old commit, and a Git filter driver (for example Git LFS) runs its own program when Git checks a file that has one.
- A file whose name has a line break is left out of the map, because Git's blob reader reads one name for each line.
- The first summary of a snapshot costs a full collection. The store reuses whole analyses. It does not reuse the analysis of unchanged files inside a changed snapshot.
- Findings are static leads. Code-map runs no project test or command. Confirm each finding in the code before you act on it.
- No verification ran. The summary has no rating, no readiness and no PASS or FAIL result.
