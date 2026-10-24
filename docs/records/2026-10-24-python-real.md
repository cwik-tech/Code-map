# Python real-repository corrections

Date: 2026-10-24.
Scope: five defects from the supplied Python brief.
Source: the brief, independent regression fixtures and read-only repository scans.
Use R1, R2 and R3 for the repositories in the order in the brief.
Repository names, source paths and source text stay outside this repository.

## Reference audit

| Document | Previous gap | Update source |
| --- | --- | --- |
| `docs/python.md` | Assertion APIs were absent | `lib/python/facts.py`, `assertion` |
| `docs/python.md` | Batch limits led directly to skipped files | `lib/python/parse.mjs`, `parsePython` |
| `docs/python.md` | Test path membership had no separate flag | `lib/python/project.mjs`, `pythonTestSelector` |
| `docs/python.md` | Optional imports had no rule or counter | `lib/python/collect.mjs`, `collectPython` |
| `docs/python.md` | The cycle description omitted self imports | `lib/python/collect.mjs`, `convert` |

The reference now describes each rule and report field.
The changelog has one entry for each fix.
The trace maps the regression cases to C01, C05, C10 and C27.
No configuration, dependency or irreversible architecture choice changed.
No architecture decision record is needed.

## Evidence method

The regression fixtures cover each reported defect.
The timeout case uses a real blocked child process.
The output-limit case uses a real child that exceeds the output limit.
The retry tests retain all production limits.
Each successful retry runs the shipped parser.
The safety test bodies moved unchanged to `test/python-safety.test.mjs`.
This split keeps each changed code module within 300 lines.

Each real-repository scan selects committed `HEAD` and uses a fresh external store.
The scan compares `git status --porcelain --ignored` before and after.
The supplied baseline counts describe an earlier scan, not a fresh baseline run.
Refer to [the status section](../status.md#python-real-repository-corrections-on-2026-10-24) for measurements and gate results.

## Five remaining assertion findings in R3

These observations describe committed source, not executed tests.
The identifiers come from the retained scan.
The descriptions omit repository paths, symbols and source text.

| Finding | What the case does |
| --- | --- |
| `TEST-NO-ASSERTIONS-def027638d` | Cancels a nonexistent session. An escaping exception fails the case. It has no explicit assertion. |
| `TEST-NO-ASSERTIONS-a6b6e9e75f` | Calls server registration with an absent list and an empty list. It expects both calls to return without an exception. |
| `TEST-NO-ASSERTIONS-90b9e657cd` | Injects a registration failure and awaits the handler. It checks for no escaping exception. It does not inspect the warning output. |
| `TEST-NO-ASSERTIONS-db1deb7fcc` | Updates metadata for a nonexistent database session. It expects the update to return without an exception. |
| `TEST-NO-ASSERTIONS-15cda093bf` | Starts a client against a server that exits after initialization. It sends a request with a timeout and then shuts down. It accepts success or any exception, including timeout. It does not distinguish a timeout from another failure. |

The scanner retains these findings because none contains a recognized assertion.
A no-assertion finding is a static lead, not proof that a case cannot fail.
