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
cat > src/f.mjs <<'EOF'
export function inRange(n, lo, hi) {
  return n >= lo && n <= hi;
}
EOF
cat > test/f.test.mjs <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert';
import { inRange } from '../src/f.mjs';
test('inRange', () => {
  assert.equal(inRange(5, 0, 10), true);
  assert.equal(inRange(-1, 0, 10), false);
});
EOF
git add -A && git commit -qm base
BASE=$(git rev-parse HEAD)
cat > src/f.mjs <<'EOF'
export function inRange(n, lo, hi) {
  return n >= lo && n < hi;
}
EOF
git add -A && git commit -qm head
AUTH=$(node "$CLI" authorize --store "$T/store" --command node --test --test-reporter=tap 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)['authorizationId'])")
SUM=$(node "$CLI" mutate --authorization "$AUTH" --store "$T/store" --base "$BASE" --head HEAD --max 20 --seed 0 -- node --test --test-reporter=tap 2>"$T/merr.txt")
if [ -z "$SUM" ]; then echo "FAIL C15: mutate produced no summary: $(cat "$T/merr.txt")"; exit 1; fi
ART=$(echo "$SUM" | python3 -c "import json,sys;print(json.load(sys.stdin)['files']['artifact'])")
STATUSES=$(python3 -c "import json;r=json.load(open('$ART'));print(','.join(sorted(set(m['status'] for f in r['files'].values() for m in f['mutants']))))")
SELECTED=$(echo "$SUM" | python3 -c "import json,sys;print(json.load(sys.stdin)['selected'])")
if echo "$STATUSES" | grep -q "Killed" && echo "$STATUSES" | grep -q "Survived"; then
  echo "PASS C15: mutation testing classified $SELECTED changed-line mutants with statuses: $STATUSES"
  exit 0
else
  echo "FAIL C15: statuses=$STATUSES selected=$SELECTED"
  exit 1
fi
