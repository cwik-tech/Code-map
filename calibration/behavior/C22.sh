#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C22 - Boundary-case coverage: a JSON Schema (integer minimum/maximum) and a JSDoc range
# annotation must each produce just-below/at/just-above boundary values with expected outcomes.
set -u
CLI="$CODE_MAP_ROOT/bin/code-map.mjs"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/repo" "$T/store"
cd "$T/repo"
git init -q
git config user.email a@b.c
git config user.name a
mkdir -p src
printf '{"type":"integer","minimum":18,"maximum":65}\n' > age.schema.json
printf '/** @minimum 18 @maximum 65 */\nexport const age = (x) => x >= 18 && x <= 65;\n' > src/age.ts
git add -A && git commit -qm base

ID=$(node "$CLI" inspect --summary --ref HEAD --store "$T/store" 2>/dev/null | jq -r .analysis.id)
node "$CLI" inspect --analysis "$ID" --part models.boundaries --store "$T/store" > "$T/b.json" 2>/dev/null

SOURCES=$(jq -r '[.page.items[].source] | sort | unique | join(",")' "$T/b.json")
VALUES=$(jq -r '[.page.items[] | select(.source == "json-schema") | .fields[0].values[].value] | join(",")' "$T/b.json")

if [ "$SOURCES" = "json-schema,range-annotation" ] && [ "$VALUES" = "17,18,19,64,65,66" ]; then
  echo "PASS C22: boundaries generated from JSON Schema and JSDoc ranges ($SOURCES), values=$VALUES"
  exit 0
else
  echo "FAIL C22: sources=$SOURCES values=$VALUES (expected both sources and values 17,18,19,64,65,66)"
  exit 1
fi
