#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C29 Incomplete migration: removing a public export leaves text references that the comparison reports.
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
mkdir -p src docs
printf '{ "name": "pkg", "version": "1.0.0", "exports": { ".": "./src/index.ts" } }\n' > package.json
printf "export { legacyName } from './api';\n" > src/index.ts
printf 'export function legacyName() { return 1; }\n' > src/api.ts
printf 'Use legacyName from the API.\n' > docs/guide.md
git add -A
git commit -qm base
printf 'export function currentName() { return 1; }\n' > src/api.ts
printf "export { currentName } from './api';\n" > src/index.ts
git add -A
git commit -qm head
node "$CLI" inspect --summary --ref HEAD --base HEAD~1 --store "$WORK/store" > "$WORK/summary.json" 2> "$WORK/err.txt"
status=$?
if [ "$status" -ne 0 ]; then
  echo "FAIL C29: inspect --summary failed (exit $status). stderr: $(cat "$WORK/err.txt" 2>/dev/null)"
  exit 1
fi
if jq -e '.impact.references.total >= 1' "$WORK/summary.json" >/dev/null 2>&1 \
  && jq -e '[.impact.references.examples[]? | select(.term.name == "legacyName")] | length >= 1' "$WORK/summary.json" >/dev/null 2>&1; then
  total="$(jq -r '.impact.references.total' "$WORK/summary.json")"
  place="$(jq -r '.impact.references.examples[0].place' "$WORK/summary.json")"
  echo "PASS C29: removed export legacyName leaves $total stale text reference(s), the first in a $place file"
  exit 0
fi
echo "FAIL C29: no stale reference to legacyName found. references: $(jq -c '.impact.references.terms' "$WORK/summary.json" 2>/dev/null)"
exit 1
