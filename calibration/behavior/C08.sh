#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C08 - Test-to-code relationships: a changed source file imported by a test must show that test in
# the impact.affected.tests list of the base/head comparison.
set -u
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
REPO="$TMP/repo"
mkdir -p "$REPO"
cd "$REPO" || exit 1
git init -q
git config user.email "a@b.c"
git config user.name "audit"
mkdir -p src test
cat > src/lib.ts <<'EOF'
export function calc(a: number): number { return a + 1; }
EOF
cat > test/lib.test.ts <<'EOF'
import { calc } from '../src/lib';
export const t = calc(1);
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

if jq -e '.impact.affected.tests.total >= 1' "$TMP/out.json" > /dev/null 2>&1; then
  TEST="$(jq -r '.impact.affected.tests.items[0].path' "$TMP/out.json")"
  echo "PASS C08: impact.affected.tests links the changed source to $TEST"
  exit 0
else
  echo "FAIL C08: impact.affected.tests reports no test that imports the changed source (total = $(jq -r '.impact.affected.tests.total // "missing"' "$TMP/out.json"))"
  exit 1
fi
