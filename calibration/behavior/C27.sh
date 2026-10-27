#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C27 - Test weakening: adding Vitest .fails to a test that asserted must produce an
# expected-failure weakening entry that needs a human review.
set -u
CLI="$CODE_MAP_ROOT/bin/code-map.mjs"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/repo" "$T/store" "$T/outdir"
cd "$T/repo"
git init -q
git config user.email a@b.c
git config user.name a
mkdir -p test src
printf 'export const x = 1;\n' > src/a.js
cat > test/case.test.js <<'EOF'
import { test, expect } from 'vitest';
test('case', () => { expect(1).toBe(2); });
EOF
git add -A && git commit -qm base
BASE=$(git rev-parse HEAD)
sed -i '' "s/test('case'/test.fails('case'/" test/case.test.js
git add -A && git commit -qm head
HEAD=$(git rev-parse HEAD)

cat > request.json <<EOF
{ "requestType": "code-map-verification-request", "schemaVersion": 1, "base": "$BASE", "head": "$HEAD", "intent": "mark an expected failure", "acceptanceCriteria": [], "allowedPaths": null, "changeType": "other", "profileId": "static-baseline-v0", "ratingRulesVersion": "ratings-v0", "reportInputs": [], "execution": { "enabled": false, "authorization": null, "budgets": { "wallClockSeconds": 600, "memoryMegabytes": 2048, "outputMegabytes": 64, "concurrency": 1 } } }
EOF

node "$CLI" verify --request request.json --store "$T/store" --out-dir "$T/outdir" > "$T/vsummary.json" 2> "$T/verr.txt"
RES="$T/outdir/$(jq -r '.results.path' "$T/outdir/latest.json")"

KIND=$(jq -r '[.tests.reviews.entries[] | select(.kind == "expected-failure")] | length' "$RES" 2>/dev/null)
UNREVIEWED=$(jq -r '.tests.reviews.unreviewed' "$RES" 2>/dev/null)

if [ "${KIND:-0}" -ge 1 ]; then
  echo "PASS C27: adding .fails produced $KIND expected-failure weakening entry (unreviewed=$UNREVIEWED)"
  exit 0
else
  echo "FAIL C27: expected-failure weakening entry missing (kind count=${KIND:-0})"
  exit 1
fi
