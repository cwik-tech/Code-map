#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C33 Documentation/API clarity: a public export without JSDoc is reported, and a changed public
# export without a docs update produces a documentation lead.
set -u
CLI="$CODE_MAP_ROOT/bin/code-map.mjs"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
REPO="$WORK/repo"
mkdir -p "$REPO"
cd "$REPO"
git init -q -b main
git config user.name audit
git config user.email audit@example.com
mkdir -p src
printf '{ "name": "pkg", "version": "1.0.0", "exports": { ".": "./src/index.ts" } }\n' > package.json
printf "export { format } from './format';\nexport const undoc = 1;\n" > src/index.ts
printf '/** A documented function. */\nexport function format(x: string) { return x; }\n' > src/format.ts
git add -A
git commit -qm base
printf '/** A documented function. */\nexport function format(x: string, y: number) { return x + y; }\n' > src/format.ts
git add -A
git commit -qm head
node "$CLI" inspect --summary --ref HEAD --base HEAD~1 --store "$WORK/store" > "$WORK/summary.json" 2> "$WORK/err.txt"
status=$?
if [ "$status" -ne 0 ]; then
  echo "FAIL C33: inspect --summary failed (exit $status). stderr: $(cat "$WORK/err.txt" 2>/dev/null)"
  exit 1
fi
if jq -e '.documentation.undocumented >= 1' "$WORK/summary.json" >/dev/null 2>&1 \
  && jq -e '[.impact.docs.examples[]? | select(.name == "format" and .status == "CHANGED")] | length >= 1' "$WORK/summary.json" >/dev/null 2>&1; then
  echo "PASS C33: undocumented public export 'undoc' reported, and changed export 'format' has a CHANGED documentation lead"
  exit 0
fi
echo "FAIL C33: undocumented export or CHANGED doc lead missing. documentation: $(jq -c '.documentation' "$WORK/summary.json" 2>/dev/null)"
exit 1
