#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C03 - Public API compatibility: a removed export between base and head must show as REMOVED in the
# export comparison, with its remaining consumers.
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
export function removed(): number { return 1; }
export function kept(): number { return 2; }
EOF
cat > src/consumer.ts <<'EOF'
import { removed } from './lib';
export const r = removed;
EOF
git add -A
git commit -qm base
cat > src/lib.ts <<'EOF'
export function kept(): number { return 2; }
EOF
git add -A
git commit -qm head

node "$CODE_MAP_ROOT/bin/code-map.mjs" \
  inspect --summary --ref HEAD --base HEAD~1 --store "$TMP/store" \
  > "$TMP/out.json" 2> "$TMP/err.txt"

if jq -e '.api.module.counts.removed >= 1' "$TMP/out.json" > /dev/null 2>&1; then
  NAME="$(jq -r '[.api.module.examples[] | select(.status == "REMOVED")][0].name' "$TMP/out.json")"
  CONS="$(jq -r '[.api.module.examples[] | select(.status == "REMOVED")][0].consumers.total' "$TMP/out.json")"
  echo "PASS C03: export '$NAME' reported REMOVED with $CONS remaining consumer(s)"
  exit 0
else
  echo "FAIL C03: the api comparison does not report the removed export (counts.removed = $(jq -r '.api.module.counts.removed // "missing"' "$TMP/out.json"))"
  exit 1
fi
