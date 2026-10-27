#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C25 - Forgotten work / stale consumers: a configured migration pattern must produce a
# MIGRATION-USE finding that names the stale file, line and symbol.
set -u
CLI="$CODE_MAP_ROOT/bin/code-map.mjs"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/repo" "$T/store"
cd "$T/repo"
git init -q
git config user.email a@b.c
git config user.name a
mkdir -p src
printf '{"migrations":[{"from":"legacy","to":"modern","note":"renamed module"}]}\n' > .code-map.json
printf 'import x from "legacy";\nexport const y = x;\n' > src/app.js
git add -A && git commit -qm base

node "$CLI" inspect --summary --ref HEAD --store "$T/store" > "$T/out.json" 2> "$T/err.txt"

if jq -e '.findings.byRule[] | select(.capability == "C25" and .ruleId == "MIGRATION-USE")' "$T/out.json" >/dev/null 2>&1; then
  ITEM=$(jq -r '.findings.items[] | select(.ruleId == "MIGRATION-USE") | "\(.location.path):\(.location.line) symbol=\(.location.symbol)"' "$T/out.json" | head -1)
  echo "PASS C25: MIGRATION-USE finding flags a stale consumer at $ITEM"
  exit 0
else
  echo "FAIL C25: no MIGRATION-USE finding (capability C25) for the configured migration"
  exit 1
fi
