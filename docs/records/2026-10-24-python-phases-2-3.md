# Python phases 2 and 3 close review

Date: 2026-10-24.
Scope: the bounded work in sections 9.2 and 9.3 of [the Python design](../work/2026-10-24-python/design.md).
Source: the task handover, local commits from `27593ab` through `fcb16aa`, retained scan reports, and committed source reads.
Gate results and measurements belong in [the integration status](../status.md#python-phases-2-and-3).

## Documentation audit

| Document | Previous gap | Source and action |
| --- | --- | --- |
| `docs/status.md` | Phases 2 and 3 were still listed as open | The integrated commits implement the design rows. Update the scope and record the final gates in this document only. |
| `docs/work/2026-10-24-python/design.md` | Request history had no link to final evidence | Link to the integration status. Keep the original design decisions. |
| `skills/code-map/SKILL.md` | The caution described phase 1 only | `lib/python/collect.mjs`, the Python report adapters and `docs/python.md` define the supported subset and limits. Replace the obsolete caution. |
| `docs/python.md` | Repeated top-level names were not described in the failure-path limits | `lib/test-quality.mjs`, `topLevel`, groups declarations by file and name. Document this limit. |

The Python reference, README, mutation reference, retrieval reference, verification reference and changelog already describe the integrated features.
This close review adds no code, dependency or architecture choice.
It creates no changelog entry or ADR.

## Read-only scan review

R1, R2 and R3 name the same repositories as the earlier [Python correction record](2026-10-24-python-real.md).
Repository names, source paths, source text and local evidence paths stay outside this repository.
The handover scans used a fixed copy of `fcb16aa` and selected committed `HEAD` in each repository.
Their receipts compare `git status --short` before and after; this does not check ignored files.
The source review uses the exact commit named by each saved report.
It does not execute the scanned projects or propose changes to them.

| Evidence | Source observation | Interpretation |
| --- | --- | --- |
| R3 Python `EXPORT-UNREFERENCED` and `EXPORT-TEST-ONLY` leads | Every Python name in these two lists has a literal export-list declaration or an explicit same-name re-export in committed source. | The explicit-export restriction holds for this scan. This does not prove that any export is unused at runtime. |
| `PACKAGE-UNDECLARED-973b83c44c` | The source imports the named module; the nearest project manifest does not name its distribution. | The sampled declaration mismatch is real. Transitive or external installation can still make the import work. |
| `ENV-UNDECLARED-09dc68c12b` | The source reads a name absent from the environment template. It then sets that name itself. | The template mismatch is real, but it does not establish missing deployment configuration. Application-owned variables contribute to the noise. |
| `TEST-NO-FAILURE-ASSERTION-6b0d1c2297` | The sampled source catches a read failure and raises on invalid manifest fields. | Failure exits exist. Missing static assertion links do not prove that the behavior is untested. |
| `TEST-UNREACHED-b9f7cd855d` | The sampled upload handler raises on malformed input and size violations. | Failure exits exist. Runtime test coverage remains unknown. |
| `TEST-UNREACHED-82ed499c2b` | Several top-level definitions have the same name. The shared quality model combines their exits and shows the last declaration location. | Treat the lead as an aggregate of same-name declarations. It is not evidence about one runtime function. |

Dynamic imports, plugin registration, computed settings and unresolved consumers keep their existing UNKNOWN limits.
External checker, mutation and benchmark reports need binding to the applicable snapshot.
Code-map does not install or run mypy, pyright, ruff, mutmut, Hypothesis or pytest-benchmark during inspection.
The high volume of environment-template leads remains a usability limit; this close review does not change the rule or suppress findings.

## Resource scheduling

The closing session follows the current task's machine-wide `heavy-run` rule.
The handover's older efficiency-core exception is not used for the new final gates.
An Orca resource-coordination request asked the session to finish its active booking normally and defer later bookings until other queued work gets a turn.
The session ended only its own waiting wrappers with TERM and kept the active suite and trace booking running.
This changes scheduling only; it does not change scope, test limits or the meaning of a failed result.
Source: the resource-coordination message delivered during this task and Orca message `msg_a1c0e3755473`.

## Final evidence check

The installed CLI self-inspection reads committed `fcb16aa` from the assigned checkout.
The static verification compares the complete phase 2 and 3 code range with execution disabled.
The final R3 inspection confirms that the retained analysis is current and reuses it.
Thus its elapsed time is not a new parser performance measurement.
The final results and remaining UNKNOWN checks are recorded only in the status section.
Both handover scratch worktrees were clean and removed after their processes ended.
The closing changes contain documentation only and remain uncommitted under the current task instructions.
