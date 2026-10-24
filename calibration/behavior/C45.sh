#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C45 - Ratings/reporting: a new architecture-rule break must give readiness BLOCKED with four
# independent category ratings, exit code 2, and a linked Markdown + JSON report.
set -u
CLI="node $CODE_MAP_ROOT/bin/code-map.mjs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
REPO="$TMP/repo"
mkdir -p "$REPO"
cd "$REPO" || exit 1
git init -q -b main
git config user.email "audit-e@local"
git config user.name "audit-e"
mkdir -p src/core src/ui
printf '{ "rules": ["core -> ui"] }\n' > .code-map.json
cat > src/ui/view.ts <<'EOF'
export function view() { return 1; }
EOF
cat > src/core/engine.ts <<'EOF'
export function engine() { return 1; }
EOF
git add -A && git commit -qm base && git tag base
cat > src/core/engine.ts <<'EOF'
import { view } from '../ui/view';
export function engine() { return view(); }
EOF
git add -A && git commit -qm head

cat > request.json <<'EOF'
{ "requestType": "code-map-verification-request", "schemaVersion": 1, "base": "base", "head": "HEAD",
  "intent": "Wire the engine to the view.", "acceptanceCriteria": [], "allowedPaths": ["src/**"],
  "changeType": "other", "profileId": "static-baseline-v0", "ratingRulesVersion": "ratings-v0",
  "reportInputs": [], "execution": { "enabled": false, "authorization": null,
  "budgets": { "wallClockSeconds": 60, "memoryMegabytes": 512, "outputMegabytes": 8, "concurrency": 1 } } }
EOF
$CLI verify --request request.json --store "$TMP/store" --out-dir "$TMP/out" > "$TMP/verify.json" 2> "$TMP/verify.err"
CODE=$?
RES="$(jq -r '.files.results // empty' "$TMP/verify.json" 2>/dev/null)"
REPORT="$(jq -r '.files.report // empty' "$TMP/verify.json" 2>/dev/null)"
if [ -z "$RES" ] || [ ! -s "$RES" ]; then
  echo "FAIL C45: verify produced no results (code=$CODE): $(cat "$TMP/verify.err")"
  exit 1
fi

READY="$(jq -r '.readiness.state' "$RES" 2>/dev/null)"
CATS="$(jq -r '[.ratings | keys[]] | length' "$RES" 2>/dev/null)"
REPORTTYPE="$(jq -r '.reportType' "$RES" 2>/dev/null)"
ARCHFAIL="$(jq -r '[.obligations[] | select(.id == "structure.architecture-rules" and .result == "FAIL")] | length' "$RES" 2>/dev/null)"
MD_OK="false"
[ -n "$REPORT" ] && [ -s "$REPORT" ] && grep -q 'BLOCKED' "$REPORT" && MD_OK="true"

if [ "$CODE" -eq 2 ] && [ "$READY" = "BLOCKED" ] && [ "$CATS" -eq 4 ] && [ "$REPORTTYPE" = "code-map-verification" ] && [ "$ARCHFAIL" -ge 1 ] && [ "$MD_OK" = "true" ]; then
  echo "PASS C45: readiness BLOCKED (exit 2), four independent ratings, architecture-rules FAIL, Markdown report links results"
  exit 0
else
  echo "FAIL C45: exit=$CODE readiness=$READY categories=$CATS reportType=$REPORTTYPE archFail=$ARCHFAIL md=$MD_OK"
  exit 1
fi
