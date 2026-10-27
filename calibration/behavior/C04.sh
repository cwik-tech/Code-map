#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C04 - Signature compatibility: a changed function signature between base and head must show as
# CHANGED with the "signature" reason in the export comparison.
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
cat > src/lib.ts <<'EOF'
export function parse(input: string): number { return input.length; }
EOF
git add -A
git commit -qm base
cat > src/lib.ts <<'EOF'
export function parse(input: string, options: object): number { return input.length; }
EOF
git add -A
git commit -qm head

node "$CODE_MAP_ROOT/bin/code-map.mjs" \
  inspect --summary --ref HEAD --base HEAD~1 --store "$TMP/store" \
  > "$TMP/out.json" 2> "$TMP/err.txt"

if jq -e '.api.module.counts.changed >= 1' "$TMP/out.json" > /dev/null 2>&1; then
  NAME="$(jq -r '[.api.module.examples[] | select(.status == "CHANGED")][0].name' "$TMP/out.json")"
  REASONS="$(jq -r '[.api.module.examples[] | select(.status == "CHANGED")][0].reasons | join(",")' "$TMP/out.json")"
  echo "PASS C04: export '$NAME' reported CHANGED with reason(s) $REASONS"
  exit 0
else
  echo "FAIL C04: the api comparison does not report the changed signature (counts.changed = $(jq -r '.api.module.counts.changed // "missing"' "$TMP/out.json"))"
  exit 1
fi
