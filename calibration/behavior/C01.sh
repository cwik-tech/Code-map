#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C01 - Broken imports: a relative import that resolves to no file must give an IMPORT-UNRESOLVED finding
# with the file, span and the unresolved specifier.
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
cat > src/a.ts <<'EOF'
export function present(): number { return 1; }
EOF
cat > src/b.ts <<'EOF'
import { present } from './a';
import { gone } from './not-here';
export const x = present();
EOF
git add -A
git commit -qm base

node "$CODE_MAP_ROOT/bin/code-map.mjs" \
  inspect --summary --ref HEAD --store "$TMP/store" \
  > "$TMP/out.json" 2> "$TMP/err.txt"

if jq -e '[.findings.byRule[] | select(.capability == "C01" and .ruleId == "IMPORT-UNRESOLVED")] | length > 0' "$TMP/out.json" > /dev/null 2>&1; then
  LOC="$(jq -r '[.findings.items[] | select(.ruleId == "IMPORT-UNRESOLVED")][0].location.path' "$TMP/out.json")"
  LINE="$(jq -r '[.findings.items[] | select(.ruleId == "IMPORT-UNRESOLVED")][0].location.line' "$TMP/out.json")"
  EV="$(jq -r '[.findings.items[] | select(.ruleId == "IMPORT-UNRESOLVED")][0].evidence[0].text' "$TMP/out.json")"
  echo "PASS C01: IMPORT-UNRESOLVED at $LOC:$LINE ($EV)"
  exit 0
else
  echo "FAIL C01: no IMPORT-UNRESOLVED finding (capability C01) in the summary"
  exit 1
fi
