# Stored verification contract

`schemas/verification-results-v1.schema.json` defines verification results, obligations, category ratings, rubric predicates and category comparisons.
`writeRun` validates results before it creates an output folder.
`readRun` validates results before it exposes a stored run.
Validation also checks obligation applicability, completeness counters, numeric rating states and readiness exit codes.
Comparison states must agree with their bands, directions and reasons.
Invalid input stops the command with exit code 4.

## Rubric definition

Each new verification result stores `rubric` and `ratingScope`.
The rubric separates predicate definitions from predicate outcomes in `ratings`.
Each predicate has an ID and a condition.
Each category defines fundamental failures and membership of cumulative bands 3, 4 and 5.
Required obligations also contribute level-3 conditions through the unchanged rating evaluator.

`rubric` records these fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Version 1 of the rubric definition |
| `profileId`, `ratingRulesVersion` | The selected profile and rating rules |
| `evaluatorDigest` | The analyzer source digest of the bundled evaluator and its shared modules |
| `thresholds` | Coverage percentages and the evidence-v1 mutation thresholds |
| `decisionTree` | The order of assessment decisions |
| `categories` | Predicate conditions, fundamental failures and band membership for each category |
| `evidencePolicy` | Eligibility, trust, minimum assessment policy and analysis inputs |

The evaluator digest conservatively changes when any bundled analysis module changes.
The analysis policy requires configuration, source roots and analyzer environment.
The evidence policy also records effective tool trust minimums, including authorization minimums.
An empty policy cannot establish compatibility.
The digest identifies executable minimum assessment and predicate semantics alongside the stored conditions.
No result changes the accepted `static-baseline-v0` checks or thresholds.
The `evidence-v1` profile is accepted. It stays opt-in, and `static-baseline-v0` stays the default.

## Compare category bands

Add `"baselineReport": "V-<stored-run-ID>"` to a verification request.
Use a run ID printed by an earlier verification.
The command reads that run from the same `--out-dir`, or the same repository verification store.
A path is not a baseline run ID.
An invalid or missing run stops the command before analysis.

`ratingComparison` contains the baseline run ID, compatibility reasons and four independent category comparisons.
The Markdown report links to the baseline report.
The existing `comparison` field still describes static analysis compatibility.
The baseline changes no obligation, rating or readiness result.

| State | Meaning |
| --- | --- |
| `COMPARABLE` | Rubric definitions, versions, scope and evidence policy match |
| `INCOMPARABLE` | Known rubric, scope or evidence policy fields differ |
| `UNKNOWN` | A report lacks rubric, evaluator, analysis policy or scope evidence |

Scope includes repository identity, full changed paths, allowed paths, acceptance criteria and obligation IDs and flags.
It also includes allowed public changes and nominated regression or generated test declarations.
Changing a threshold prevents comparison even when the version labels match.
Changing configuration or analyzer environment also prevents comparison.
Compatibility uses exact equality independent of object key order.
It does not infer semantic equivalence between different policies.

Each category gives `COMPARED` only when both reports have an assessed numeric band.
The direction is `UP`, `DOWN` or `SAME`.
An Unassessed or Not applicable category gives `UNKNOWN` with a reason and null for its unavailable band.
An incompatible pair gives `UNKNOWN` for each category.
No total, average or arithmetic band distance exists.

## Historical reports

Schema version 1 permits historical results without rubric and scope metadata.
Their existing ratings remain readable when their core contract is valid.
Their category comparison stays `UNKNOWN` because compatibility evidence is absent.
Schema validation checks structure and state invariants.
It does not authenticate a local report author or establish oracle truth.
