#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C06 - Architecture rules: an import that breaks a declared "from -> to" rule in .code-map.json must
# give an ARCH-RULE finding with the rule and the two files.
set -u
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
REPO="$TMP/repo"
mkdir -p "$REPO"
cd "$REPO" || exit 1
git init -q
git config user.email "a@b.c"
git config user.name "audit"
mkdir -p src/engine src/verify
cat > .code-map.json <<'EOF'
{ "rules": ["verify -> engine"] }
EOF
cat > src/engine/util.ts <<'EOF'
export function util(): number { return 1; }
EOF
cat > src/verify/check.ts <<'EOF'
import { util } from '../engine/util';
export const c = util();
EOF
git add -A
git commit -qm base

node "$CODE_MAP_ROOT/bin/code-map.mjs" \
  inspect --summary --ref HEAD --store "$TMP/store" \
  > "$TMP/out.json" 2> "$TMP/err.txt"

if jq -e '[.findings.byRule[] | select(.capability == "C06" and .ruleId == "ARCH-RULE")] | length > 0' "$TMP/out.json" > /dev/null 2>&1; then
  LOC="$(jq -r '[.findings.items[] | select(.ruleId == "ARCH-RULE")][0].location.path' "$TMP/out.json")"
  TEXT="$(jq -r '[.findings.items[] | select(.ruleId == "ARCH-RULE")][0].text' "$TMP/out.json")"
  echo "PASS C06: ARCH-RULE at $LOC: $TEXT"
  exit 0
else
  echo "FAIL C06: no ARCH-RULE finding (capability C06) in the summary"
  exit 1
fi
