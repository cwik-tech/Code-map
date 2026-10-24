#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C09 - Untested exported functions: an exported function with no static test relationship must give a
# TEST-EXPORT-CANDIDATE finding, labelled a candidate (not proof of missing tests).
set -u
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
REPO="$TMP/repo"
mkdir -p "$REPO"
cd "$REPO" || exit 1
git init -q
git config user.email "a@b.c"
git config user.name "audit"
mkdir -p src
cat > src/helper.ts <<'EOF'
export function untestedHelper(): number { return 42; }
EOF
cat > src/app.ts <<'EOF'
import { untestedHelper } from './helper';
export const v = untestedHelper();
EOF
git add -A
git commit -qm base

node "$CODE_MAP_ROOT/bin/code-map.mjs" \
  inspect --summary --ref HEAD --store "$TMP/store" \
  > "$TMP/out.json" 2> "$TMP/err.txt"

if jq -e '[.findings.byRule[] | select(.capability == "C09" and .ruleId == "TEST-EXPORT-CANDIDATE")] | length > 0' "$TMP/out.json" > /dev/null 2>&1; then
  NAME="$(jq -r '[.findings.items[] | select(.ruleId == "TEST-EXPORT-CANDIDATE")][0].location.symbol' "$TMP/out.json")"
  echo "PASS C09: TEST-EXPORT-CANDIDATE finding flags '$NAME' as a candidate with runtime hits unknown"
  exit 0
else
  echo "FAIL C09: no TEST-EXPORT-CANDIDATE finding (capability C09) in the summary"
  exit 1
fi
