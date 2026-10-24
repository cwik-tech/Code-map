#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C02 - Unresolved symbols: a file that imports a name the target does not export must give an
# IMPORT-NAME-MISSING finding with source, target and the missing name.
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
cat > src/real.ts <<'EOF'
export function present(): number { return 1; }
EOF
cat > src/user.ts <<'EOF'
import { absent } from './real';
export const x = absent;
EOF
git add -A
git commit -qm base

node "$CODE_MAP_ROOT/bin/code-map.mjs" \
  inspect --summary --ref HEAD --store "$TMP/store" \
  > "$TMP/out.json" 2> "$TMP/err.txt"

if jq -e '[.findings.byRule[] | select(.capability == "C02" and .ruleId == "IMPORT-NAME-MISSING")] | length > 0' "$TMP/out.json" > /dev/null 2>&1; then
  LOC="$(jq -r '[.findings.items[] | select(.ruleId == "IMPORT-NAME-MISSING")][0].location.path' "$TMP/out.json")"
  NAME="$(jq -r '[.findings.items[] | select(.ruleId == "IMPORT-NAME-MISSING")][0].location.symbol' "$TMP/out.json")"
  echo "PASS C02: IMPORT-NAME-MISSING: $LOC imports the missing name '$NAME'"
  exit 0
else
  echo "FAIL C02: no IMPORT-NAME-MISSING finding (capability C02) in the summary"
  exit 1
fi
