#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C21 - Schema compatibility: the SQLite migration harness must run changed SQL against a
# fixture and compare results with declared assertion rows. A value-corrupting update must FAIL;
# a correct transformation must PASS.
set -uo pipefail
CLI="$CODE_MAP_ROOT/bin/code-map.mjs"

run_case() {
  local migration="$1" expect_rows="$2" want="$3" want_fail="$4" name="$5"
  local W; W=$(mktemp -d)
  mkdir -p "$W/repo" "$W/store"
  cd "$W/repo"
  git init -q
  git config user.email a@b.c
  git config user.name a
  mkdir -p prisma/migrations/001 prisma/migrations/002
  cat > prisma/schema.prisma <<'EOF'
generator client { provider = "prisma-client-js" }
datasource db { provider = "sqlite" url = env("DATABASE_URL") }
model User { id Int @id }
EOF
  printf 'CREATE TABLE User(id INTEGER PRIMARY KEY); INSERT INTO User VALUES (1), (2);\n' > fixture.sql
  git add -A && git commit -qm schema
  git branch -q before
  printf '%s\n' "$migration" > prisma/migrations/001/migration.sql
  printf 'INSERT INTO User VALUES (4);\n' > prisma/migrations/002/migration.sql
  git add -A && git commit -qm migrations
  AUTH=$(node "$CLI" authorize --store "$W/store" --wall-clock-seconds 180 --command node .code-map-harness/runtime.mjs 2>/dev/null | jq -r .authorizationId)
  cat > spec.json <<EOF
{ "harnessVersion": 1, "mode": "migrate", "base": "before", "fixture": "fixture.sql", "assertions": [ { "query": "SELECT id FROM User ORDER BY id", "rows": $expect_rows } ] }
EOF
  node "$CLI" harness --store "$W/store" --authorization "$AUTH" --spec spec.json > "$W/hsummary.json" 2> "$W/herr.txt"
  ARTIFACT=$(jq -r '.files.artifact' "$W/hsummary.json")
  local status; status=$(jq -r '.migration.status' "$ARTIFACT" 2>/dev/null)
  local fail; fail=$(jq -r '[.migration.checks[] | select(.status == "FAIL")] | length' "$ARTIFACT" 2>/dev/null)
  echo "$name: status=$status checks_failed=$fail"
  cd /; rm -rf "$W"
  [ "$status" = "$want" ] && [ "$fail" = "$want_fail" ] && return 0
  return 1
}

# Case 1: a correct migration must PASS with matching assertion rows.
run_case 'DELETE FROM User WHERE id = 1; INSERT INTO User VALUES (3);' '[{"id":2},{"id":3},{"id":4}]' 'PASS' '0' 'case-correct' || { echo "FAIL C21: correct migration did not PASS"; exit 1; }
# Case 2: a value-corrupting update must FAIL even though the SQL executes.
run_case 'UPDATE User SET id = 99 WHERE id = 1;' '[{"id":1},{"id":2},{"id":4}]' 'FAIL' '1' 'case-corrupt' || { echo "FAIL C21: corrupting update was not detected as FAIL"; exit 1; }

echo "PASS C21: correct migration PASSes and a value-corrupting update FAILs against declared assertion rows"
exit 0
