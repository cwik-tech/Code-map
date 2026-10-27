#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C40 - Analyzer completeness: the summary must publish a completeness table with per-stack
# discovered/supported/parsed/skipped/malformed/dynamicallyUnresolved counts, and gaps.
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
mkdir -p src data
printf '{ "rules": [] }\n' > .code-map.json
cat > src/a.js <<'EOF'
export function load(name) { return import(name); }
export const fixed = 1;
EOF
cat > src/b.ts <<'EOF'
export function typed(x: number): number { return x + 1; }
EOF
cat > src/c.tsx <<'EOF'
export const El = () => <div>hi</div>;
EOF
cat > data/good.json <<'EOF'
{ "ok": true }
EOF
printf '{ "broken": ' > data/bad.json
cat > style.css <<'EOF'
body { margin: 0; }
EOF
git add -A && git commit -qm base

$CLI inspect --summary --ref HEAD --store "$TMP/store" > "$TMP/out.json" 2> "$TMP/err.txt"

TS_OK="$(jq -e '[.completeness[] | select(.stack == "TypeScript" and .discovered >= 1 and .parsed >= 1)] | length > 0' "$TMP/out.json" 2>/dev/null)"
JS_OK="$(jq -e '[.completeness[] | select(.stack == "JavaScript" and .discovered >= 1 and .parsed >= 1)] | length > 0' "$TMP/out.json" 2>/dev/null)"
CSS_OK="$(jq -e '[.completeness[] | select(.stack == "CSS" and .discovered >= 1)] | length > 0' "$TMP/out.json" 2>/dev/null)"
MAL_OK="$(jq -e '[.completeness[] | select(.stack == "JSON" and .malformed >= 1)] | length > 0' "$TMP/out.json" 2>/dev/null)"
GAPS_OK="$(jq -e '(.gaps | type == "array" and length > 0)' "$TMP/out.json" 2>/dev/null)"

if [ "$TS_OK" = "true" ] && [ "$JS_OK" = "true" ] && [ "$CSS_OK" = "true" ] && [ "$MAL_OK" = "true" ] && [ "$GAPS_OK" = "true" ]; then
  SUM="$(jq -c '[.completeness[] | {stack, discovered, parsed, skipped, malformed, dynamicallyUnresolved}]' "$TMP/out.json")"
  echo "PASS C40: completeness table per stack and a non-empty gaps list present: $SUM"
  exit 0
else
  echo "FAIL C40: ts=$TS_OK js=$JS_OK css=$CSS_OK malformed=$MAL_OK gaps=$GAPS_OK; completeness=$(jq -c '.completeness' "$TMP/out.json" 2>/dev/null)"
  exit 1
fi
