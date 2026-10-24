#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
set -uo pipefail
CLI="$CODE_MAP_ROOT/bin/code-map.mjs"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/repo" "$T/store"
cd "$T/repo"
git init -q
git config user.email a@b.c
git config user.name a
mkdir -p src
cat > src/negate.mjs <<'EOF'
export function negate(q) {
  return -q;
}
export function nonnegative(input, output) {
  return output >= 0;
}
EOF
git add -A && git commit -qm init
cat > harness.json <<'EOF'
{
  "harnessVersion": 1,
  "subject": { "file": "src/negate.mjs", "export": "negate" },
  "mode": "property",
  "seed": 42,
  "count": 100,
  "generator": { "type": "integer", "min": 0, "max": 100 },
  "invariant": { "file": "src/negate.mjs", "export": "nonnegative" }
}
EOF
AUTH=$(node "$CLI" authorize --store "$T/store" --command node .code-map-harness/runtime.mjs 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)['authorizationId'])")
SUM=$(node "$CLI" harness --authorization "$AUTH" --store "$T/store" --spec harness.json 2>"$T/herr.txt")
if [ -z "$SUM" ]; then echo "FAIL C17: harness produced no summary: $(cat "$T/herr.txt")"; exit 1; fi
ART=$(echo "$SUM" | python3 -c "import json,sys;print(json.load(sys.stdin)['files']['artifact'])")
MODE=$(python3 -c "import json;print(json.load(open('$ART'))['mode'])")
SEED=$(python3 -c "import json;print(json.load(open('$ART'))['seed'])")
GENVER=$(python3 -c "import json;print(json.load(open('$ART'))['generatorVersion'])")
SHRUNK=$(python3 -c "import json;f=json.load(open('$ART'))['failures'][0];print('shrunkInput' in f and f['shrunkInput'] is not None)")
KIND=$(python3 -c "import json;print(json.load(open('$ART'))['failures'][0]['kind'])")
if [ "$MODE" = "property" ] && [ "$SEED" = "42" ] && [ "$GENVER" = "mulberry32-v1" ] && [ "$KIND" = "property" ] && [ "$SHRUNK" = "True" ]; then
  echo "PASS C17: property testing used a seeded generator ($GENVER, seed $SEED) and recorded a counterexample with a shrunk input"
  exit 0
else
  echo "FAIL C17: mode=$MODE seed=$SEED genver=$GENVER kind=$KIND shrunk=$SHRUNK"
  exit 1
fi
