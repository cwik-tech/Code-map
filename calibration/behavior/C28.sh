#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C28 Scope creep: allowedPaths constrain the changed files; an out-of-scope change fails.
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
printf '{}\n' > .code-map.json
printf 'export function engine() { return 1; }\n' > src/engine.ts
git add -A
git commit -qm base
git tag base
printf 'export const extra = 1;\n' > src/other.ts
git add -A
git commit -qm head
cat > "$WORK/request.json" <<'EOF'
{
  "requestType": "code-map-verification-request",
  "schemaVersion": 1,
  "base": "base",
  "head": "HEAD",
  "intent": "Add an out-of-scope helper.",
  "acceptanceCriteria": [],
  "allowedPaths": ["src/engine.ts"],
  "changeType": "other",
  "profileId": "static-baseline-v0",
  "ratingRulesVersion": "ratings-v0",
  "reportInputs": [],
  "execution": { "enabled": false, "authorization": null, "budgets": { "wallClockSeconds": 60, "memoryMegabytes": 512, "outputMegabytes": 8, "concurrency": 1 } }
}
EOF
node "$CLI" verify --request "$WORK/request.json" --store "$WORK/store" --out-dir "$WORK/out" > "$WORK/summary.json" 2> "$WORK/err.txt"
status=$?
if [ -f "$WORK/summary.json" ] && jq -e '(.failed // []) | index("scope.allowed-paths") != null' "$WORK/summary.json" >/dev/null 2>&1; then
  echo "PASS C28: out-of-scope change src/other.ts fails the scope.allowed-paths obligation (verify exit $status)"
  exit 0
fi
echo "FAIL C28: scope.allowed-paths did not fail (verify exit $status). stderr: $(cat "$WORK/err.txt" 2>/dev/null)"
exit 1
