# Evidence-v1 reference

The user accepted this rule set on 2026-10-23. The [proposal](work/2026-10-23-verify-profile-v1/proposal.md) defines its checks.
The recommended answers in section 8 apply. `static-baseline-v0` stays the default rule set. This rule set stays opt-in.

## Select the rule set

Set these two fields in an otherwise valid [verification request](verify.md#the-request):

```json
{ "profileId": "evidence-v1", "ratingRulesVersion": "ratings-v1" }
```

The result, summary, completion manifest and model context contain `profileStatus: "accepted"`.

The shared structural and consumer checks use the [verification limits](verify.md#limits).
This includes settings drift, dynamic imports, unreadable test renames and Git index flags.

## Added and changed checks

| Check | Evidence |
| --- | --- |
| Public interface | Public export comparison, consumer compiler diagnostics, and definite argument-count breaks without compiler evidence |
| Refactor preservation | An isolated differential run of twenty inputs, or matching isolated reference runs of unchanged reaching test cases |
| Bug reproduction | At least one named regression case fails on the isolated reference |
| Regression | Every named regression case passes on the isolated head |
| Each acceptance criterion | A passed tagged case and a current human oracle record. A failed tagged case fails the check |
| Harness runs | Bound property, fuzz, differential, decision-table and state-model outcomes. Failure is optional and does not block |
| Migrations and documentation | A schema change needs a new migration. A removed or changed public export needs a Markdown change |
| Stale references | Removed export names and removed or renamed paths in code, tests, JSON, YAML or configuration |
| Dependency policy | New packages with denied licenses, disallowed hosts, missing integrity, or forbidden install scripts |

The public-interface check applies to every change type. It replaces the feature consumer-contract placeholder.
The migration and documentation check stays optional. No dependency policy means NOT_APPLICABLE.
Set `supplyChain.forbidInstallScripts: true` in `.code-map.json` to reject new packages with install scripts.
Without that flag, install scripts stay information. Invalid flag values fail configuration validation.

Failures precede missing evidence. A missing report cannot clear a demonstrated failure.
A self-attested report still counts for other ratings and blocking failures.

## Rating levels

The levels are cumulative. V0 requirements still apply unless the proposal replaces them.

| Category | Level 5 additions |
| --- | --- |
| Structural Integrity | An unfiltered head compiler report has no error, and the public export comparison has no UNKNOWN |
| Verification Coverage | Isolated coverage measures at least 90% of changed statements and runs every measured changed function |
| Behavioral Confidence | At least 60% mutation detection among at least ten measured changed-code mutants |
| Change Completeness | Every changed-export consumer is changed or has no error in a bound compiler report |

Behavioral Confidence needs an isolated head test report and an independent reference.
An independent reference is an isolated base run, an isolated differential run, or a current oracle for a case that ran.
Level 1 records a new test failure, failed preservation check, or failed regression check.
Changes without required behavioral checks still need completed test evidence and an independent reference.
Level 3 needs the required checks and no new failure. Level 4 also needs an unfiltered isolated head and passing criteria.
Completeness level 4 needs passing migration, documentation and stale-reference checks.

READY needs every required check to pass and all four ratings to reach three.
Every bound test report used in those ratings must be isolated. Other states keep the existing precedence and exit codes.

## Record a human oracle

An oracle record confirms the expected result of one test case for one criterion.
Only a person can supply this confirmation. A model must not create a record for itself.

1. Analyze the current code with `code-map inspect --summary --worktree`.
2. Select a case from the stored test cases. Its index gives the evidence ID `case:0`, `case:1`, and so on.
3. After checking the expected result, run:

   ```sh
   code-map oracle --case case:0 --criterion AC1 --method "Compared with the acceptance specification" --confirmed-by "Reviewer name"
   ```

Use the same `--store` for both commands when you select a custom store.
The command also accepts the case evidence ID from a verification result when it identifies one current stored case.
Refresh the analysis after changing the code or writing an unignored oracle file.
A record names the file, suite, case name, criterion, SHA-256 digest, confirmation method, person, and UTC calendar date.
The command replaces the record for the same case and criterion through an atomic rename.
It refuses a changed oracle file during the write, unsafe paths, unknown fields, duplicate records and invalid dates.

The file has `oracleVersion: 1` and an `entries` array. Its limit is 4 MiB and 10000 entries.
Each entry has `file`, `suite`, `name`, `criterion`, `digest`, `method`, `confirmedBy`, and `date`.
The suite is a string or null. The digest has 64 lowercase hexadecimal characters.
An unreadable test file or a changed test digest makes a record stale. A stale record cannot close an acceptance check.
Verification reads records from the working folder and binds each digest to the selected head snapshot.
A local record names a person. Code-map does not authenticate that identity.

## Evidence gaps

- A compiler report lists diagnostics, not the files it checked. Excluded files remain a compiler-evidence limitation.
- Reference runs match cases through renames and compare case text inside edited test files. Missing case classification keeps preservation UNKNOWN.
- An unreadable schema keeps the migration check UNKNOWN unless a demonstrated failure takes precedence.
- A missing or unreadable lockfile keeps the dependency check UNKNOWN when a policy exists.
- An inferred public-type change stays UNKNOWN. No runtime type inference is collected.
- Missing statement coverage, function coverage, or ambiguous function joins prevents coverage level 5.
- Stale-reference scanning skips short names, large files, binaries, symlinks, build output and dependency folders.
- Harness execution is finite. A passed corpus does not prove behavior for every input.
- Mutation survivors can be equivalent. The score counts killed and timed-out mutants as detected.
- Without a working sandbox, isolated runs cannot supply evidence. Worker calibration cases skip with an explicit message.

## Human weakening reviews

The `evidence-v1` profile requires current human reviews for assertion and runner weakening.
The `static-baseline-v0` results stay unchanged.
A model must not write a review record.
A person uses `code-map review-weakening --entry <weakening ID> --reason <text> --reviewed-by <name>`.
Add `--base <ref>` to match a verification base other than HEAD.
Refer to [weakening reviews](weakening-reviews.md) for record fields and limits.
