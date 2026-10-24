#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C42 - Generated-test evaluation: targeted changed-line mutants run in fresh isolated workers;
# a numeric mutant of a changed line is killed by a node:test assertion.
set -u
CLI="node $CODE_MAP_ROOT/bin/code-map.mjs"
if [ ! -x /usr/bin/sandbox-exec ]; then
  echo "FAIL C42: needs /usr/bin/sandbox-exec"
  exit 1
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
REPO="$TMP/repo"
mkdir -p "$REPO"
cd "$REPO" || exit 1
git init -q -b main
git config user.email "audit-e@local"
git config user.name "audit-e"
mkdir -p src test
printf '{ "rules": [] }\n' > .code-map.json
cat > src/sum.mjs <<'EOF'
export function sum(a, b) { return a + b; }
EOF
git add -A && git commit -qm base && git tag base
cat > src/sum.mjs <<'EOF'
export function sum(a, b) { return a + b + 0; }
export const n = 1 + 2;
EOF
cat > test/n.test.mjs <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { n } from '../src/sum.mjs';
test('n', () => assert.equal(n, 3));
EOF
git add -A && git commit -qm head

$CLI authorize --store "$TMP/store" --command node --test --test-reporter=tap > "$TMP/auth.json" 2> "$TMP/auth.err"
AUTH="$(jq -r '.authorizationId // empty' "$TMP/auth.json" 2>/dev/null)"
if [ -z "$AUTH" ]; then
  echo "FAIL C42: authorize failed: $(cat "$TMP/auth.err")"
  exit 1
fi
$CLI mutate --authorization "$AUTH" --base base --head HEAD --max 10 --seed 0 --store "$TMP/store" -- node --test --test-reporter=tap \
  > "$TMP/mutate.json" 2> "$TMP/mutate.err"
ART="$(jq -r '.files.artifact // empty' "$TMP/mutate.json" 2>/dev/null)"
if [ -z "$ART" ] || [ ! -s "$ART" ]; then
  echo "FAIL C42: mutate produced no report: $(cat "$TMP/mutate.err")"
  exit 1
fi
KILLED="$(jq -r '[.files["src/sum.mjs"].mutants[]? | select(.status == "Killed")] | length' "$ART" 2>/dev/null)"
if [ "$KILLED" -ge 1 ] 2>/dev/null; then
  echo "PASS C42: changed-line numeric mutant of src/sum.mjs is Killed ($KILLED killed mutant)"
  exit 0
else
  echo "FAIL C42: no killed mutant (mutants=$(jq -c '.files["src/sum.mjs"].mutants' "$ART" 2>/dev/null))"
  exit 1
fi
