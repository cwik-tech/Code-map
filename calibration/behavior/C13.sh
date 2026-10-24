#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
set -uo pipefail
CLI="$CODE_MAP_ROOT/bin/code-map.mjs"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/repo" "$T/store" "$T/outdir"
cd "$T/repo"
git init -q
git config user.email a@b.c
git config user.name a
mkdir -p src coverage
printf 'coverage/\n' > .gitignore
cat > src/calc.mjs <<'EOF'
export function classify(n) {
  if (n > 0) {
    return 'positive';
  }
  return 'non-positive';
}
EOF
git add -A && git commit -qm base
BASE=$(git rev-parse HEAD)
cat > src/calc.mjs <<'EOF'
export function classify(n) {
  if (n > 0) {
    return 'positive';
  }
  if (n === 0) {
    return 'zero';
  }
  return 'negative';
}
EOF
git add -A && git commit -qm head
# LCOV with FN/FNDA for the changed function `classify`.
cat > coverage/lcov.info <<'EOF'
SF:src/calc.mjs
DA:1,1
DA:2,1
DA:3,1
DA:4,1
DA:5,1
DA:6,1
DA:7,1
DA:8,1
DA:9,1
LF:9
LH:9
FN:1,classify
FNDA:1,classify
FNF:1
FNH:1
end_of_record
EOF
node "$CLI" manifest --artifact coverage/lcov.info --kind lcov --exit-status 0 --out coverage/lcov.manifest.json -- node --test >/dev/null 2>&1
cat > request.json <<EOF
{
  "requestType": "code-map-verification-request",
  "schemaVersion": 1,
  "base": "$BASE",
  "head": "HEAD",
  "intent": "Add a zero branch to classify.",
  "acceptanceCriteria": [],
  "allowedPaths": ["src/**"],
  "changeType": "feature",
  "profileId": "static-baseline-v0",
  "ratingRulesVersion": "ratings-v0",
  "reportInputs": [
    { "artifact": "coverage/lcov.info", "manifest": "coverage/lcov.manifest.json" }
  ],
  "execution": { "enabled": false, "authorization": null, "budgets": { "wallClockSeconds": 600, "memoryMegabytes": 2048, "outputMegabytes": 64, "concurrency": 1 } }
}
EOF
node "$CLI" verify --request request.json --store "$T/store" --out-dir "$T/outdir" > "$T/vsummary.json" 2>"$T/verr.txt"
RUN=$(python3 -c "import json;print(json.load(open('$T/vsummary.json'))['runId'])")
RES="$T/outdir/runs/$RUN/verification-results.json"
MEASURE=$(python3 -c "import json;print(json.load(open('$RES'))['coverage']['changedFunctions']['measure'])")
COVERED=$(python3 -c "import json;print(json.load(open('$RES'))['coverage']['changedFunctions']['covered'])")
TOTAL=$(python3 -c "import json;print(json.load(open('$RES'))['coverage']['changedFunctions']['total'])")
EXACT=$(python3 -c "import json;print(json.load(open('$RES'))['coverage']['changedFunctions']['join']['exact'])")
if [ "$MEASURE" = "function coverage" ] && [ "$COVERED" = "1" ] && [ "$TOTAL" = "1" ] && [ "$EXACT" = "1" ]; then
  echo "PASS C13: function coverage from LCOV FN/FNDA: $COVERED/$TOTAL changed functions, $EXACT exact AST join"
  exit 0
else
  echo "FAIL C13: measure=$MEASURE covered=$COVERED total=$TOTAL exact=$EXACT"
  exit 1
fi
