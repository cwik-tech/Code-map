#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C05 - Dependency cycles: two files that import each other must give a CYCLE-VALUE finding that
# names the files in the strongly connected component.
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
cat > src/x.ts <<'EOF'
import { b } from './y';
export function a(): number { return b(); }
EOF
cat > src/y.ts <<'EOF'
import { a } from './x';
export function b(): number { return a(); }
EOF
git add -A
git commit -qm base

node "$CODE_MAP_ROOT/bin/code-map.mjs" \
  inspect --summary --ref HEAD --store "$TMP/store" \
  > "$TMP/out.json" 2> "$TMP/err.txt"

if jq -e '[.findings.byRule[] | select(.capability == "C05" and .ruleId == "CYCLE-VALUE")] | length > 0' "$TMP/out.json" > /dev/null 2>&1; then
  FILES="$(jq -r '[.findings.items[] | select(.ruleId == "CYCLE-VALUE")][0].evidence | map(.path) | unique | join(", ")' "$TMP/out.json")"
  echo "PASS C05: CYCLE-VALUE finding shows the cycle among $FILES"
  exit 0
else
  echo "FAIL C05: no CYCLE-VALUE finding (capability C05) in the summary"
  exit 1
fi
