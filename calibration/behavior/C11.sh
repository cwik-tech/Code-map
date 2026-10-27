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
# Istanbul JSON (coverage-final.json) for the head. Statements 3 and 4 touch the
# changed lines (5 and 6) and are uncovered; statement 5 touches changed line 8 and is covered.
cat > coverage/coverage-final.json <<'EOF'
{
  "src/calc.mjs": {
    "path": "src/calc.mjs",
    "statementMap": {
      "0": { "start": { "line": 1, "column": 0 }, "end": { "line": 1, "column": 30 } },
      "1": { "start": { "line": 2, "column": 0 }, "end": { "line": 2, "column": 15 } },
      "2": { "start": { "line": 3, "column": 0 }, "end": { "line": 3, "column": 21 } },
      "3": { "start": { "line": 5, "column": 0 }, "end": { "line": 5, "column": 15 } },
      "4": { "start": { "line": 6, "column": 0 }, "end": { "line": 6, "column": 17 } },
      "5": { "start": { "line": 8, "column": 0 }, "end": { "line": 8, "column": 19 } }
    },
    "s": { "0": 1, "1": 1, "2": 1, "3": 0, "4": 0, "5": 1 },
    "fnMap": {
      "0": { "name": "classify", "decl": { "start": { "line": 1, "column": 0 }, "end": { "line": 1, "column": 30 } }, "loc": { "start": { "line": 1, "column": 0 }, "end": { "line": 9, "column": 1 } } }
    },
    "f": { "0": 1 },
    "branchMap": {
      "0": { "type": "if", "loc": { "start": { "line": 2, "column": 0 }, "end": { "line": 2, "column": 15 } }, "locations": [ { "start": { "line": 2, "column": 0 }, "end": { "line": 2, "column": 15 } }, { "start": { "line": 2, "column": 0 }, "end": { "line": 2, "column": 15 } } ] },
      "1": { "type": "if", "loc": { "start": { "line": 5, "column": 0 }, "end": { "line": 5, "column": 15 } }, "locations": [ { "start": { "line": 5, "column": 0 }, "end": { "line": 5, "column": 15 } }, { "start": { "line": 5, "column": 0 }, "end": { "line": 5, "column": 15 } } ] }
    },
    "b": { "0": [1, 0], "1": [0, 0] }
  }
}
EOF
node "$CLI" manifest --artifact coverage/coverage-final.json --kind istanbul-json --exit-status 0 --out coverage/istanbul.manifest.json -- node --test >/dev/null 2>&1
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
    { "artifact": "coverage/coverage-final.json", "manifest": "coverage/istanbul.manifest.json" }
  ],
  "execution": { "enabled": false, "authorization": null, "budgets": { "wallClockSeconds": 600, "memoryMegabytes": 2048, "outputMegabytes": 64, "concurrency": 1 } }
}
EOF
node "$CLI" verify --request request.json --store "$T/store" --out-dir "$T/outdir" > "$T/vsummary.json" 2>"$T/verr.txt"
RUN=$(python3 -c "import json;print(json.load(open('$T/vsummary.json'))['runId'])")
RES="$T/outdir/runs/$RUN/verification-results.json"
MEASURE=$(python3 -c "import json;d=json.load(open('$RES'))['coverage'];print(d['changedStatements']['measure'] if d and d['changedStatements'] else 'null')")
COVERED=$(python3 -c "import json;d=json.load(open('$RES'))['coverage'];print(d['changedStatements']['covered'] if d and d['changedStatements'] else 'null')")
TOTAL=$(python3 -c "import json;d=json.load(open('$RES'))['coverage'];print(d['changedStatements']['total'] if d and d['changedStatements'] else 'null')")
if [ "$MEASURE" = "statement coverage" ] && [ "$COVERED" != "null" ] && [ "$TOTAL" != "null" ]; then
  echo "PASS C11: statement coverage from Istanbul JSON report: $COVERED/$TOTAL changed statements covered ($MEASURE)"
  exit 0
else
  echo "FAIL C11: measure=$MEASURE covered=$COVERED total=$TOTAL"
  exit 1
fi
