#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C07 - Change-impact reachability: a changed source file must show its reverse dependencies (importers)
# in the impact.affected walk of the base/head comparison.
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
export function calc(a: number): number { return a + 1; }
EOF
cat > src/consumer.ts <<'EOF'
import { calc } from './lib';
export const v = calc(1);
EOF
git add -A
git commit -qm base
cat > src/lib.ts <<'EOF'
export function calc(a: number): number { return a + 2; }
EOF
git add -A
git commit -qm head

node "$CODE_MAP_ROOT/bin/code-map.mjs" \
  inspect --summary --ref HEAD --base HEAD~1 --store "$TMP/store" \
  > "$TMP/out.json" 2> "$TMP/err.txt"

if jq -e '.impact.affected.total >= 1' "$TMP/out.json" > /dev/null 2>&1; then
  IMPORTER="$(jq -r '[.impact.affected.examples[] | select(.test == false)][0].path' "$TMP/out.json")"
  echo "PASS C07: impact.affected reaches reverse dependency $IMPORTER at depth 1"
  exit 0
else
  echo "FAIL C07: impact.affected reports no reverse dependency (total = $(jq -r '.impact.affected.total // "missing"' "$TMP/out.json"))"
  exit 1
fi
