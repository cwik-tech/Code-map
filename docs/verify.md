# Verify a change

`code-map verify` checks one change, from a base commit to a head commit or the working tree, against a rule set. It gives four ratings and one readiness state, writes a report for people and a JSON file for tools, and exits with a code that a script can use.

The current rule set is `static-baseline-v0`. The [rule-set proposal](work/2026-10-22-verify-profile-v0/proposal.md) explains each check, and the user accepted it on 2026-10-22. With this rule set, `verify` can stop a bad change, but it never gives READY. Two kinds of evidence do not exist yet: a record that the expected results of the tests are correct, and coverage that is tied to the tested code. Code-map runs no project code.

## Run it

1. Write a request file, for example `/tmp/request.json`. The [request](#the-request) section gives its fields.
2. Run the command inside the repository:

   ```sh
   code-map verify --request /tmp/request.json
   ```

3. Read the summary on standard output. It names the readiness state, the four ratings, the failed and blocking checks, and the paths of the two report files.
4. Open `verification-report.md` for the explanation of each result.

`verify` creates the base and head analyses, or reuses them from the analysis store, as `code-map inspect --summary` does. Refer to [summary-first inspection](retrieval.md) for the store.

| Option | What it does |
| --- | --- |
| `--request <file>` | The request file. It is necessary |
| `--store <folder>` | Use this analysis store. The default is the same as for `inspect --summary` |
| `--out-dir <folder>` | Write the run folders here. The default is a folder for this repository in `verifications` inside the store. A folder inside the repository or inside its Git folders is refused, also through a symlink or another spelling of the path |
| `--compact` | Write the summary without indentation |

## The request

The request is a JSON file. Every field is necessary. Unknown fields are errors.

```json
{
  "requestType": "code-map-verification-request",
  "schemaVersion": 1,
  "base": "main",
  "head": "worktree",
  "intent": "Move the session helpers to src/auth without a change in behavior.",
  "acceptanceCriteria": [],
  "allowedPaths": ["src/auth/**", "test/auth/**"],
  "changeType": "refactor",
  "profileId": "static-baseline-v0",
  "ratingRulesVersion": "ratings-v0",
  "reportInputs": [],
  "execution": { "enabled": false, "authorization": null, "budgets": { "wallClockSeconds": 600, "memoryMegabytes": 2048, "outputMegabytes": 64, "concurrency": 1 } }
}
```

| Field | Meaning |
| --- | --- |
| `base` | The base commit, branch or tag. It cannot be `worktree` |
| `head` | The head commit, branch or tag, or `worktree` for the files as they are now |
| `intent` | What the change must do, in your words |
| `acceptanceCriteria` | `{ "id", "text" }` entries. Each one becomes a required check. No version of this rule set can confirm them yet, so they stay unknown |
| `allowedPaths` | Repository-relative patterns of the files that the change may touch, or `null` when the scope is not declared. `**` matches any number of folders, `*` any characters inside one name, `?` one character. The match is case-sensitive and covers the whole path |
| `changeType` | `refactor`, `feature`, `fix` or `other`. It decides some required checks: a refactor needs evidence that behavior did not change, a fix needs a reproduction and a regression test |
| `profileId`, `ratingRulesVersion` | `static-baseline-v0` and `ratings-v0` |
| `reportInputs` | Bound test reports: `{ "artifact", "manifest" }` pairs of repository-relative paths. Refer to [bound test reports](#bound-test-reports) |
| `execution` | `enabled` must be `false`: this version does not run project code. The four budgets are whole numbers from 1 up to 86,400 seconds, 65,536 MB of memory, 1,024 MB of output and 64 workers |

## Bound test reports

A test report counts as evidence only with a run manifest that ties it to the analyzed code. Code-map reads JUnit XML and the JSON output of Jest (`--json`) and Vitest (the JSON reporter). Code-map does not run the tests. You run them, and `code-map manifest` writes the manifest.

1. Make sure that Git ignores the folder of your reports, for example with `reports/` in `.gitignore`. A report in a folder that Git does not ignore changes the working tree, and the manifest then no longer matches it.
2. Run the tests of the head yourself, and write the report into that folder. For example: `npx vitest run --reporter=junit --outputFile=reports/junit.xml`.
3. Write the manifest at once, before you change any file. Give the exit status of the test run and, after `--`, its command:

   ```sh
   code-map manifest --artifact reports/junit.xml --kind junit --exit-status 1 --out reports/junit.manifest.json -- npx vitest run --reporter=junit
   ```

4. Add the pair to the request: `"reportInputs": [{ "artifact": "reports/junit.xml", "manifest": "reports/junit.manifest.json" }]`.
5. Run `code-map verify`. The `executions` of the results show each report with its binding state and the reasons why it does or does not count.

`code-map manifest` runs nothing. It records the command words, and it computes the commit, a digest of every file that differs from the commit, the digest of the Code-map settings, the digest of the lockfile and the digest of the report. `--kind` is `junit`, `jest-json` or `vitest-json`. `--discovery <text>` describes which tests the run selected, and each `--filter <text>` names one filter of the run. A run with a filter is a filtered run, which some rating conditions do not accept.

A report counts as evidence only in these conditions:

- The manifest matches the analyzed head (or the base): the same commit, the same working-tree digest, the same settings and lockfile digests, and the report digest is in the manifest.
- Code-map can read the report.
- The manifest records an exit status and the discovery.
- An exit status of 0 does not come with a failed case.

A report of the base commit counts for the base: a failed case that the base report of the same command, tools and environment also has is an earlier failure, not a new one. One request can name at most 64 reports, 256 MiB of reports and 400,000 test cases. Each extra report does not count, and the results say why.

## The output

`verify` writes each run into its own folder, `runs/<run ID>/`, with two files:

- `verification-report.md`: the explanation for people. It starts with the readiness state and what it means, then the four ratings, the failed checks, the unknown checks with what would resolve them, the test reports, the limits and a table of the terms that it uses.
- `verification-results.json`: every check with its evidence IDs, the rating of each category with its conditions, the readiness state, the test reports and the limits. Its `reportType` is `code-map-verification`, with `schemaVersion: 1`.

When both files are complete, `verify` replaces `latest.json` in the output folder. It names the last run, its readiness state, its exit code, and the paths and digests of the two files. A run that fails leaves no folder and does not change `latest.json`. The folders are private to you, and `verify` refuses an output folder that another user owns or can change.

The summary on standard output has `reportType: "code-map-verification-summary"`, the run ID, the readiness state, the exit code, the state of each rating, the IDs of the failed and blocking checks (at most 20 of each) and the paths of the files.

## Exit codes

| Exit code | Readiness | Meaning |
| --- | --- | --- |
| 0 | READY | Every required check passed. This rule set never gives it |
| 1 | REVIEW | Failures or reviews remain open |
| 2 | BLOCKED | A blocking check failed: a new architecture-rule break, a new focused test, or a new failure in a bound head test report |
| 3 | INSUFFICIENT_EVIDENCE | Required evidence is missing. With static evidence only, this is the usual result |
| 4 | none | The request is invalid, the command failed, or the request asks to run project code. No run folder stays behind |

## Limits

- The ratings describe the declared change and the checked files, not the whole project.
- A finding is a static lead. A check that uses findings gives PASS or FAIL only when the base and head analyses are comparable.
- A bound test report proves which code the report describes, not that the run was honest. Its label is "self-attested".
- Both analyses read the Code-map settings in the working folder. For a head commit, the settings check fails when the working folder has other settings than that commit.
- A changed test file, a changed declaration file or a changed code file outside the source roots keeps the import checks UNKNOWN, because the analysis does not read its imports. A deleted or moved source file keeps the consumer check UNKNOWN when code outside the source roots exists.
