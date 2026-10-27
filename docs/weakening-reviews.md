# Human reviews of test weakening

A weakening entry describes a detected assertion, expected-failure or runner change that checks less than the base.
A person can accept an intentional change with a review record.
A model must not write a review record.

## Record a decision

1. Run `code-map verify --request <file.json>`.
2. Read `tests.reviews.entries` in the resulting `verification-results.json`.
3. Inspect each change and its expected behavior.
4. Record one decision with this command:

```sh
code-map review-weakening --entry <weakening ID> --reason <text> --reviewed-by <name>
```

The command compares the working tree with HEAD by default.
Use `--base <ref>` to match the base of the verification request.
The command supports `--store <folder>` and `--compact`.
It rejects extra words, unknown options and IDs absent from the current comparison.
It requires `--reason` and `--reviewed-by`. It supplies the UTC calendar date.
It replaces an earlier record with the same ID. Other records stay intact.
It writes only `.code-map/reviews.json` inside the repository. Analysis caches use the selected store.

For worktree verification with restricted scope, include `.code-map/reviews.json` in the request's `allowedPaths`.
Run verification again after recording every accepted entry.
For a committed head, record the reviews while the working tree contains that head's files.
Verification binds records to the selected head, including committed heads.

## File format

`.code-map/reviews.json` is a JSON object with `reviewsVersion: 1` and an `entries` array.
The command creates it when needed. Code-map does not create acceptance records automatically.

| Entry field | Meaning |
| --- | --- |
| `id` | `weakening:` followed by a SHA-256 identity digest |
| `file` | Safe repository-relative path at review time |
| `digest` | SHA-256 of the exact head file bytes |
| `reason` | Nonempty explanation, at most 2000 characters |
| `reviewedBy` | Named person, at most 100 characters |
| `date` | Valid UTC calendar date, `YYYY-MM-DD` |

The file accepts at most 10000 records and 4 MiB.
Unknown fields, duplicate IDs, unsafe paths and invalid dates are invalid.
Code-map rejects symlinked record folders and files.
Writes use a temporary file and rename. A changed prior digest stops the write.

## Identity and freshness

Assertion identities include the base file path, suite, case name, duplicate-case ordinal and weakening kind.
They also include full assertion digests from both sides, assertion plans and the weakening's position within its case.
Truncated display text never supplies the complete identity.
Runner identities include the base path, runner, setting, change kind and base and head values.
Git-detected head renames preserve the base identity.

Each entry carries the digest of its head file.
A changed digest makes its record stale, including changes outside the edited test case.
Deleted runner files use a fixed missing-file digest. Restoring the file makes that review stale.
Unreadable targets cannot receive current reviews.
`tests.reviews.incomplete` identifies unread runner settings, including those in files with known weakening.
A current review never resolves that uncertainty.
The review list retains every detected entry, including entries beyond the comparison lists' 50-entry display limit.

## Rule sets and limits

`static-baseline-v0` uses records as information. Its existing check results remain unchanged.
In `evidence-v1`, `completeness.tests-not-weakened` fails when any detected assertion or runner weakening lacks a current review.
Current reviews satisfy this added requirement. They never override an existing v0 failure.
Unreadable comparisons or invalid record files give UNKNOWN when no detected failure takes priority.
Removed or parked cases retain their existing check behavior.

Static patterns cannot establish intent or recognize every custom assertion.
Git can miss a rename. A different base can produce different IDs.
Local records cannot authenticate the named reviewer or establish that a person wrote them.


## Expected-failure changes

Adding Vitest `.fails`, Jest `.failing` or a true `fails` or `failing` option creates an `expected-failure` entry.
The scanner retains `expected-failure` status. A dynamic option retains conditional status and requires review.
Shorthand options retain conditional status. Quoted option keys also retain the expected-failure flag.
False options add no expected-failure entry. Expected-failure suites pass the classification to their cases.
The review identity includes the case identity and assertion digests. The head file digest binds the exact test bytes.
An edit anywhere in that file makes the review stale.
The evidence-v1 check requires a current human review for each entry.
The accepted static-baseline-v0 checks and thresholds stay unchanged. These entries remain information under that rule set.
Framework packages are not installed here. These static classifications do not establish framework execution behavior.
