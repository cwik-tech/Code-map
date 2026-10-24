#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C24 - Decision-table coverage: a declared table must enumerate cases and report overlapping
# rules (conflict) and gaps (uncovered combinations).
set -u
CLI="$CODE_MAP_ROOT/bin/code-map.mjs"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/repo" "$T/store"
cd "$T/repo"
git init -q
git config user.email a@b.c
git config user.name a
mkdir -p .code-map/decisions src
printf 'export const discount = (m, t) => 0;\n' > src/price.ts
cat > .code-map/decisions/discount.json <<'EOF'
{ "tableVersion": 1, "name": "discount", "subject": { "file": "src/price.ts", "export": "discount" }, "conditions": [ { "name": "member", "values": [true,false] }, { "name": "total", "values": ["low","high"] } ], "rules": [
  { "when": { "member": true }, "then": 10 },
  { "when": { "member": true, "total": "high" }, "then": 15 },
  { "when": { "member": false, "total": "low" }, "then": 0 }
] }
EOF
git add -A && git commit -qm base

ID=$(node "$CLI" inspect --summary --ref HEAD --store "$T/store" 2>/dev/null | jq -r .analysis.id)
node "$CLI" inspect --analysis "$ID" --part models.decisions --store "$T/store" > "$T/d.json" 2>/dev/null

CASES=$(jq -r '.page.items[0].cases' "$T/d.json")
CONFLICT=$(jq -r '.page.items[0].overlaps | map(select(.conflict == true)) | length' "$T/d.json")
GAPS=$(jq -r '.page.items[0].gaps | length' "$T/d.json")

if [ "$CASES" -ge 1 ] && [ "$CONFLICT" -ge 1 ] && [ "$GAPS" -ge 1 ]; then
  echo "PASS C24: decision table enumerates $CASES cases, $CONFLICT conflicting overlap, $GAPS gap(s)"
  exit 0
else
  echo "FAIL C24: cases=$CASES conflicts=$CONFLICT gaps=$GAPS (expected at least one of each)"
  exit 1
fi
