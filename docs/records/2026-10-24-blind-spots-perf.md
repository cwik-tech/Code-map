# Entry and helper scan performance, 2026-10-24

Source: the `blind-spots-perf` brief and the measurements for this change.
The work uses branch `cwik-tech/blind-spots`, based on `32c439b`.

## Method

Every timing run holds the machine-wide `heavy-run --label code-map` lock.
Each group has three runs. The tables report every measured run and its median.
Times exclude the wait for the lock. Other codebases retain CPU priority.

The `main` analyzer uses frozen source from `aed649d`.
The before analyzer uses frozen source from `32c439b`.
The after analyzer uses the source in this change.
All analyzers use the same installed TypeScript dependency and Node runtime.
The target repositories stay read-only. The private fixture has 568 code files.
This record contains no private file names, paths or code.

Cold runs use `inspect --ref HEAD --summary --no-cache`.
Each analyzer then primes its file cache with `inspect --ref HEAD --summary`.
Warm runs use `inspect --ref HEAD~1 --summary` with that store.
The harness removes stored analyses before each run and retains the file cache.
Thus each warm run collects a new analysis. It never reuses a complete stored analysis.
Each mode uses one unchanged target revision throughout its three runs.

## Summary timings

All values are seconds.

| Repository | Mode | Analyzer | Run 1 | Run 2 | Run 3 | Median |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Code-map | cold | main | 4.073 | 4.083 | 4.029 | 4.073 |
| Code-map | cold | before | 5.869 | 5.813 | 5.850 | 5.850 |
| Code-map | cold | after | 4.500 | 4.359 | 4.468 | 4.468 |
| Code-map | warm | main | 1.439 | 1.388 | 1.355 | 1.388 |
| Code-map | warm | before | 3.435 | 3.352 | 3.333 | 3.352 |
| Code-map | warm | after | 1.419 | 1.361 | 1.366 | 1.366 |
| private-568 | cold | main | 7.235 | 6.881 | 6.878 | 6.881 |
| private-568 | cold | before | 8.960 | 8.956 | 9.032 | 8.960 |
| private-568 | cold | after | 7.384 | 7.441 | 7.313 | 7.384 |
| private-568 | warm | main | 3.688 | 3.596 | 3.615 | 3.615 |
| private-568 | warm | before | 5.922 | 5.901 | 5.941 | 5.922 |
| private-568 | warm | after | 3.501 | 3.495 | 3.562 | 3.501 |

The cold limit is 10% above the main median. The warm limit is 5% above the main median.

| Repository | Mode | After versus main | Limit met |
| --- | --- | ---: | --- |
| Code-map | cold | +9.70% | Yes |
| Code-map | warm | -1.59% | Yes |
| private-568 | cold | +7.31% | Yes |
| private-568 | warm | -3.15% | Yes |

## Cache priming timings

The harness measured these setup runs too. All values are seconds.

| Repository | Main | Before | After |
| --- | ---: | ---: | ---: |
| Code-map | 4.390 | 6.170 | 4.777 |
| private-568 | 7.015 | 9.296 | 7.429 |

## Standalone path scan timings

The standalone scan reads the same texts as the supplied entry timing script.
Each run calls `pathEntries` without cached file facts. All values are milliseconds.

| Repository | Analyzer | Run 1 | Run 2 | Run 3 | Median |
| --- | --- | ---: | ---: | ---: | ---: |
| Code-map | before | 593 | 598 | 611 | 598 |
| Code-map | after | 265 | 269 | 268 | 268 |
| private-568 | before | 790 | 769 | 760 | 769 |
| private-568 | after | 328 | 351 | 347 | 347 |

## Result comparison

The before and after analyses match on both repositories at `HEAD~1`.
The comparison covers the complete analysis facts and the findings.
It excludes only the generated `tests.coverage.mapped` timestamp.
Entry points, unknown starts, test cases and helper bindings match.
The standalone scans also retain identical entry and unknown counts.

## Cache regression

`test/blind-spots-perf.test.mjs` checks reuse across two snapshots with unchanged code.
Cache statistics confirm that the second collection does no per-file analysis.
The test then edits one helper and checks that only its facts change.
Cross-file binding updates the failure targets without rescanning the test file.
Further cases check local wrappers, custom assertions, the binding limit and files outside source roots.

The [status section](../status.md#entry-and-helper-scan-cache) holds the gate results.
The cache guide is in [retrieval](../retrieval.md#the-file-cache).
Raw measurements and reports remain in the external task folder.

## Typed collection compatibility

The initial timings above precede one compatibility guard in `collect`.
The guard retains the paths read before the optional compiler collection.
Files loaded only for compiler facts cannot become assertion helpers.
`test/blind-spots-perf.test.mjs` checks this rule with a real compiler collection and a shared file cache.
The guard does not change the path scanner or the standalone timings above.

## Final source timing repeat

The final source includes the typed collection guard.
The same protocol repeats all summary and cache-priming runs.
Both passes and the standalone scan give 96 measured timings in this record.
All values below are seconds.

| Repository | Mode | Analyzer | Run 1 | Run 2 | Run 3 | Median |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Code-map | cold | main | 4.130 | 4.075 | 4.080 | 4.080 |
| Code-map | cold | before | 5.849 | 5.858 | 5.864 | 5.858 |
| Code-map | cold | after | 4.426 | 4.371 | 4.414 | 4.414 |
| Code-map | warm | main | 1.389 | 1.363 | 1.380 | 1.380 |
| Code-map | warm | before | 3.375 | 3.381 | 3.542 | 3.381 |
| Code-map | warm | after | 1.372 | 1.377 | 1.411 | 1.377 |
| private-568 | cold | main | 7.227 | 6.812 | 6.852 | 6.852 |
| private-568 | cold | before | 9.189 | 9.012 | 9.026 | 9.026 |
| private-568 | cold | after | 7.573 | 7.291 | 7.309 | 7.309 |
| private-568 | warm | main | 3.659 | 3.686 | 3.787 | 3.686 |
| private-568 | warm | before | 6.171 | 6.054 | 6.044 | 6.054 |
| private-568 | warm | after | 3.630 | 3.589 | 3.654 | 3.630 |

| Repository | Mode | After versus main | Limit met |
| --- | --- | ---: | --- |
| Code-map | cold | +8.19% | Yes |
| Code-map | warm | -0.22% | Yes |
| private-568 | cold | +6.67% | Yes |
| private-568 | warm | -1.52% | Yes |

Final cache-priming runs:

| Repository | Main | Before | After |
| --- | ---: | ---: | ---: |
| Code-map | 4.466 | 6.122 | 4.670 |
| private-568 | 6.981 | 9.372 | 7.360 |

The final before/after comparison again matches every analysis fact and finding on both repositories.
The comparison again excludes only the generated coverage timestamp.
The warm after runs reuse all 517 file entries for Code-map and all 568 for the private fixture.
No complete stored analysis supplies a warm result.
