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
cat > src/price.mjs <<'EOF'
export function price(input) {
  return input.quantity * 10;
}
EOF
cat > cases.json <<'EOF'
[{"quantity":1},{"quantity":2}]
EOF
git add -A && git commit -qm base
BASE=$(git rev-parse HEAD)
cat > src/price.mjs <<'EOF'
export function price(input) {
  return input.quantity * 11;
}
EOF
git add -A && git commit -qm head
cat > harness.json <<EOF
{
  "harnessVersion": 1,
  "subject": { "file": "src/price.mjs", "export": "price" },
  "mode": "differential",
  "base": "$BASE",
  "inputs": "cases.json",
  "ignoreFields": ["id", "createdAt"]
}
EOF
AUTH=$(node "$CLI" authorize --store "$T/store" --command node .code-map-harness/runtime.mjs 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)['authorizationId'])")
SUM=$(node "$CLI" harness --authorization "$AUTH" --store "$T/store" --spec harness.json 2>"$T/herr.txt")
if [ -z "$SUM" ]; then echo "FAIL C16: harness produced no summary: $(cat "$T/herr.txt")"; exit 1; fi
ART=$(echo "$SUM" | python3 -c "import json,sys;print(json.load(sys.stdin)['files']['artifact'])")
MODE=$(python3 -c "import json;print(json.load(open('$ART'))['mode'])")
EXEC=$(python3 -c "import json;print(json.load(open('$ART'))['executed'])")
DIFF=$(python3 -c "import json;print(sum(1 for f in json.load(open('$ART'))['failures'] if f['kind']=='difference'))")
if [ "$MODE" = "differential" ] && [ "$EXEC" = "4" ] && [ "$DIFF" -ge 1 ]; then
  echo "PASS C16: differential replay compared base and head on 2 shared inputs ($EXEC paired calls) and recorded $DIFF output difference(s)"
  exit 0
else
  echo "FAIL C16: mode=$MODE executed=$EXEC differences=$DIFF"
  exit 1
fi
