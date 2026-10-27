#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C19 - Regression test comparison: an enabled verify with a baselineSuite and a {testFiles}
# selector must disclose an impact-plus-baseline selection and compare base vs head outcomes
# (the base run passes, the head run fails the same test).
set -uo pipefail
CLI="$CODE_MAP_ROOT/bin/code-map.mjs"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/repo" "$T/store" "$T/outdir"
cd "$T/repo"
git init -q
git config user.email a@b.c
git config user.name a
mkdir -p src test
cat > src/calc.mjs <<'EOF'
export function double(x) { return x * 2; }
EOF
cat > test/calc.test.mjs <<'EOF'
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { double } from '../src/calc.mjs';
describe('calc', () => { it('doubles', () => { assert.equal(double(2), 4); }); });
EOF
git add -A && git commit -qm base
BASE=$(git rev-parse HEAD)
cat > src/calc.mjs <<'EOF'
export function double(x) { return x * 3; }
EOF
git add -A && git commit -qm head

AUTH=$(node "$CLI" authorize --store "$T/store" --wall-clock-seconds 180 --command node --test --test-reporter=junit --test-reporter-destination=junit.xml test/calc.test.mjs 2>/dev/null | jq -r .authorizationId)
if [ -z "$AUTH" ] || [ "$AUTH" = "null" ]; then echo "FAIL C19: could not authorize the command"; exit 1; fi

cat > request.json <<EOF
{ "requestType": "code-map-verification-request", "schemaVersion": 1, "base": "$BASE", "head": "HEAD", "intent": "regression comparison", "acceptanceCriteria": [], "allowedPaths": ["src/**"], "changeType": "other", "profileId": "static-baseline-v0", "ratingRulesVersion": "ratings-v0", "reportInputs": [], "execution": { "enabled": true, "authorization": "$AUTH", "budgets": { "wallClockSeconds": 120, "memoryMegabytes": 2048, "outputMegabytes": 64, "concurrency": 1 }, "commands": [ { "id": "tests", "words": ["node","--test","--test-reporter=junit","--test-reporter-destination=junit.xml","{testFiles}"], "kind": "junit", "artifact": "junit.xml", "sides": ["base","head"], "baselineSuite": ["test/calc.test.mjs"] } ] } }
EOF

node "$CLI" verify --request request.json --store "$T/store" --out-dir "$T/outdir" > "$T/vsummary.json" 2> "$T/verr.txt"
RES="$T/outdir/$(jq -r '.results.path' "$T/outdir/latest.json")"

POLICY=$(jq -r '[.executionRuns[] | select(.selection != null) | .selection.policy] | unique | join(",")' "$RES")
IMPACT=$(jq -r '[.executionRuns[] | select(.selection != null) | .selection.impact[]] | unique | join(",")' "$RES")
BASE_FAILED=$(jq -r '[.executionRuns[] | select(.side == "base")][0].selection.observed.files[0].failed' "$RES")
HEAD_FAILED=$(jq -r '[.executionRuns[] | select(.side == "head")][0].selection.observed.files[0].failed' "$RES")
HEAD_EXIT=$(jq -r '[.executionRuns[] | select(.side == "head")][0].exitStatus' "$RES")

if [ "$POLICY" = "impact-plus-baseline-v1" ] && [ "$IMPACT" = "test/calc.test.mjs" ] && [ "$BASE_FAILED" = "0" ] && [ "$HEAD_FAILED" = "1" ] && [ "$HEAD_EXIT" = "1" ]; then
  echo "PASS C19: selection policy=$POLICY impact=[$IMPACT]; base run 0 failed, head run $HEAD_FAILED failed (exit $HEAD_EXIT) — regression compared"
  exit 0
else
  echo "FAIL C19: policy=$POLICY impact=[$IMPACT] base_failed=$BASE_FAILED head_failed=$HEAD_FAILED head_exit=$HEAD_EXIT"
  exit 1
fi
