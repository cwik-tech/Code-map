# Parallel specification review check, 2026-10-22

Source: the parallel Claude terminal titled "Code map verification spec review", the external `Testing/code_map_verification_spec.md`, local HEAD `7438431`, and the live origin/main ref `57b63c8`.

Verdict: Claude's implementation inventory is substantially correct; several conclusions need qualification.

| Claim | Verdict and evidence |
| --- | --- |
| Local main has three commits absent from published main | Confirmed against Git history and the remote ref. The spec section 2 explicitly describes GitHub default-branch files; it is a valid published baseline, although unsuitable as the current local feature inventory. |
| Inspection, cycles, test links, test inventory and export usage already exist | Confirmed in `bin/code-map.mjs`, `lib/analysis.mjs` and `lib/test-scan.mjs`. These are bounded static signals, not full verification capabilities. |
| Granular coverage already exists | Partial: `lib/coverage.mjs` reads DA and BRDA for failure-exit analysis. It does not provide statement or function coverage or a general branch-coverage report. |
| Architecture rules are missing from inspection JSON | Confirmed: `lib/viewer.html` computes violations; `lib/analysis.mjs` does not include them. |
| The spec omits base/head and scoring design | It states both requirements, but leaves matching, empty-category scoring and readiness thresholds unspecified. This is missing implementation detail, not missing intent. |
| Generated tests can silently certify themselves | Overstated: spec sections 6.1, 6.6 and 10.37 explicitly require oracle provenance and independent validation. Eligibility and weighting still need concrete rules. Discounting every test added with its implementation would also penalize normal test-first development. |
| A new score reverses existing decisions | Overstated: `AI-AGENT-USE.md` says the existing test summary is not a quality score. That does not prohibit a separate calibrated verification score. |
| Running in the user's environment removes the need for a sandbox | Rejected for untrusted repositories. Spec sections 6.3 and 10.39 explicitly require isolated, opt-in execution. User environment execution does not establish isolation. |
| Output/schema inconsistencies | Filenames do differ. Numeric inspection schema version versus a string verification schema version is a compatibility question, not necessarily a defect if the reports are separate schemas. |

Existing README, inspection reference and security statement remain unchanged: this review changes no product behavior. Historical benchmark numbers in `docs/status.md` were not rerun.
