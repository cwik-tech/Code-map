#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
set -uo pipefail
CLI="$CODE_MAP_ROOT/bin/code-map.mjs"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/repo" "$T/store"
cd "$T/repo"
git init -q
git config user.email a@b.c
git config user.name a
mkdir -p src test
cat > src/add.mjs <<'EOF'
export function add(a, b) { return a + b; }
export function sub(a, b) { return a - b; }
EOF
cat > test/add.test.mjs <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert';
import { add, sub } from '../src/add.mjs';
test('adds two numbers', () => { assert.equal(add(1, 2), 3); });
test('skipped case', { skip: true }, () => { assert.equal(add(2, 2), 5); });
test('focused case', { only: true }, () => { assert.equal(sub(5, 3), 2); });
EOF
git add -A && git commit -qm init
node "$CLI" inspect --summary --worktree --store "$T/store" > "$T/summary.json" 2>"$T/err.txt"
CASES=$(python3 -c "import json;print(json.load(open('$T/summary.json'))['scope']['testCases'])")
PARKED=$(python3 -c "import json;print(any(r['ruleId']=='TEST-PARKED' and r['capability']=='C10' for r in json.load(open('$T/summary.json'))['findings']['byRule']))")
FOCUSED=$(python3 -c "import json;print(any(r['ruleId']=='TEST-FOCUSED' and r['capability']=='C10' for r in json.load(open('$T/summary.json'))['findings']['byRule']))")
if [ "$CASES" -ge 3 ] && [ "$PARKED" = "True" ] && [ "$FOCUSED" = "True" ]; then
  echo "PASS C10: discovered $CASES test cases; TEST-PARKED (skipped) and TEST-FOCUSED (.only) findings, both capability C10"
  exit 0
else
  echo "FAIL C10: cases=$CASES parked=$PARKED focused=$FOCUSED"
  exit 1
fi
