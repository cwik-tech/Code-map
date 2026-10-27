# Static-baseline-v0 compatibility fixtures

These JSON files preserve output from the historical implementations used by the compatibility tests.
The tests run the current CLI against fresh Git fixtures and compare the same fields as before.
They need no historical Git objects, so they also run from shallow clones and source archives.

- `results-446cc65.json`: the complete result from commit `446cc657cea4db9cb4b35e267878aa00ec1f6f6f`, using the request and project in `test/evidence-v1-cli.test.mjs`.
- `trust-c60f5aa.json`: exit status, ratings, readiness and obligations from commit `c60f5aae247a83cb90b8d836755ad85bffe7c4f3`, using the bound imported report in `test/trust-cli.test.mjs`.

The outputs were captured by running those archived versions against the unchanged test fixtures.
Analysis IDs are normalized to `BASE` and `HEAD`. The full result omits its run ID and timestamp;
the test supplies the fresh fixture's base and head commit SHAs. Existing comparisons still check
all legacy fields and separately assert the newer informational fields.

Do not regenerate these files from the current implementation. A compatibility change needs an
explicit review of the old behavior and of each changed expectation.
