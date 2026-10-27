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
cat > src/parse.mjs <<'EOF'
export function parse(input) {
  if (input === '' || input === 'a') {
    throw new Error('boom');
  }
  return input.length;
}
EOF
git add -A && git commit -qm init
cat > harness.json <<'EOF'
{
  "harnessVersion": 1,
  "subject": { "file": "src/parse.mjs", "export": "parse" },
  "mode": "fuzz",
  "seed": 7,
  "timeBudgetMs": 1500,
  "generator": { "type": "string", "minLength": 0, "maxLength": 1, "alphabet": "ab" },
  "allowedErrors": []
}
EOF
AUTH=$(node "$CLI" authorize --store "$T/store" --command node .code-map-harness/runtime.mjs 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)['authorizationId'])")
SUM=$(node "$CLI" harness --authorization "$AUTH" --store "$T/store" --spec harness.json 2>"$T/herr.txt")
if [ -z "$SUM" ]; then echo "FAIL C18: harness produced no summary: $(cat "$T/herr.txt")"; exit 1; fi
ART=$(echo "$SUM" | python3 -c "import json,sys;print(json.load(sys.stdin)['files']['artifact'])")
MODE=$(python3 -c "import json;print(json.load(open('$ART'))['mode'])")
FINITE=$(python3 -c "import json;print(json.load(open('$ART'))['finite'])")
MEASURE=$(python3 -c "import json;print(json.load(open('$ART'))['coverage']['measure'])")
BLOCKS=$(python3 -c "import json;print(json.load(open('$ART'))['coverage']['coveredBlocks'])")
CSIZE=$(python3 -c "import json;print(json.load(open('$ART'))['corpus']['size'])")
CRASH=$(python3 -c "import json;print(sum(1 for f in json.load(open('$ART'))['failures'] if f['kind']=='crash'))")
if [ "$MODE" = "fuzz" ] && [ "$FINITE" = "True" ] && [ "$MEASURE" = "v8-block" ] && [ "$BLOCKS" -ge 1 ] && [ "$CSIZE" -ge 1 ] && [ "$CRASH" -ge 1 ]; then
  echo "PASS C18: fuzz testing recorded $CRASH crash(es), $BLOCKS covered V8 blocks, corpus size $CSIZE, finite run"
  exit 0
else
  echo "FAIL C18: mode=$MODE finite=$FINITE measure=$MEASURE blocks=$BLOCKS corpus=$CSIZE crashes=$CRASH"
  exit 1
fi
