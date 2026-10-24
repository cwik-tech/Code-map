#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C20 - API contract verification: a route harness must run the handler inside the worker and
# report a response that violates a declared numeric bound (age minimum 18) as a problem.
set -uo pipefail
CLI="$CODE_MAP_ROOT/bin/code-map.mjs"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/repo" "$T/store"
cd "$T/repo"
git init -q
git config user.email a@b.c
git config user.name a
mkdir -p 'app/items/[id]'
cat > 'app/items/[id]/route.mjs' <<'EOF'
export async function GET(request, context) { const { id } = await context.params; return Response.json({ id, age: 1 }); }
EOF
cat > openapi.json <<'EOF'
{ "openapi": "3.0.3", "paths": { "/items/{id}": { "parameters": [ { "in": "path", "name": "id", "required": true, "example": "abc" } ], "get": { "responses": { "200": { "content": { "application/json": { "schema": { "type": "object", "required": ["id","age"], "properties": { "id": { "type": "string" }, "age": { "type": "integer", "minimum": 18 } } } } } } } } } } }
EOF
cat > spec.json <<'EOF'
{ "harnessVersion": 1, "mode": "route", "subject": { "file": "app/items/[id]/route.mjs", "export": "GET" }, "contract": "openapi.json", "path": "/items/{id}", "callTimeoutMs": 3000 }
EOF
git add -A && git commit -qm base

AUTH=$(node "$CLI" authorize --store "$T/store" --wall-clock-seconds 180 --command node .code-map-harness/runtime.mjs 2>/dev/null | jq -r .authorizationId)
if [ -z "$AUTH" ] || [ "$AUTH" = "null" ]; then echo "FAIL C20: could not authorize the harness command"; exit 1; fi

node "$CLI" harness --store "$T/store" --authorization "$AUTH" --spec spec.json > "$T/hsummary.json" 2> "$T/herr.txt"
ARTIFACT=$(jq -r '.files.artifact' "$T/hsummary.json")

PROBLEMS=$(jq -r '[.calls[0].result.output.checks[].problems[]] | join(",")' "$ARTIFACT" 2>/dev/null)

if printf '%s' "$PROBLEMS" | grep -q 'minimum:age'; then
  echo "PASS C20: route harness flagged the response as $PROBLEMS"
  exit 0
else
  echo "FAIL C20: expected a minimum:age problem, got problems=[$PROBLEMS]"
  exit 1
fi
