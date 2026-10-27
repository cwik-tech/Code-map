#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C26 - Configuration consistency: a Docker ARG-only declaration must NOT satisfy a runtime
# process.env read. The read must appear in deployment.missingReads and the ARG must be buildOnly.
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
printf '{"name":"pkg","main":"src/index.js"}\n' > package.json
printf 'export const yes = process.env.TOKEN;\n' > src/index.js
printf 'FROM node\nARG TOKEN=build-only\nCMD ["node", "src/index.js"]\n' > Dockerfile
git add -A && git commit -qm base

ID=$(node "$CLI" inspect --summary --ref HEAD --store "$T/store" 2>/dev/null | jq -r .analysis.id)
node "$CLI" inspect --analysis "$ID" --part deployment.missingReads --store "$T/store" > "$T/missing.json" 2>/dev/null
node "$CLI" inspect --analysis "$ID" --part deployment.documents --store "$T/store" > "$T/docs.json" 2>/dev/null

MISSING=$(jq -r '[.page.items[] | select(.name == "TOKEN")] | length' "$T/missing.json")
RUNTIME=$(jq -r '[.page.items[].names[] | select(.name == "TOKEN") | .runtime] | first' "$T/docs.json")
KIND=$(jq -r '[.page.items[].names[] | select(.name == "TOKEN") | .kind] | first' "$T/docs.json")

if [ "$MISSING" -ge 1 ] && [ "$RUNTIME" = "false" ] && [ "$KIND" = "ARG" ]; then
  echo "PASS C26: ARG-only Docker declaration leaves the TOKEN read missing (missingReads=$MISSING, kind=$KIND, runtime=$RUNTIME)"
  exit 0
else
  echo "FAIL C26: missingReads=$MISSING kind=$KIND runtime=$RUNTIME (expected ARG to not satisfy a runtime read)"
  exit 1
fi
