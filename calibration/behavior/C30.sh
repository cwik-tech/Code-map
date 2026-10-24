#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C30 Complexity: a changed function with more branches grows in cyclomatic and cognitive complexity.
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
printf 'export function f(x: number) { return x; }\n' > src/a.ts
git add -A
git commit -qm base
cat > src/a.ts <<'EOF'
export function f(x: number) {
  if (x) {
    if (x > 1) {
      return 2;
    }
  }
  return x;
}
EOF
git add -A
git commit -qm head
node "$CLI" inspect --summary --ref HEAD --base HEAD~1 --store "$WORK/store" > "$WORK/summary.json" 2> "$WORK/err.txt"
status=$?
if [ "$status" -ne 0 ]; then
  echo "FAIL C30: inspect --summary failed (exit $status). stderr: $(cat "$WORK/err.txt" 2>/dev/null)"
  exit 1
fi
if jq -e '.comparison.complexity.counts.grew >= 1 and .comparison.complexity.grew[0].delta.cyclomatic >= 1' "$WORK/summary.json" >/dev/null 2>&1; then
  delta="$(jq -c '.comparison.complexity.grew[0].delta' "$WORK/summary.json")"
  echo "PASS C30: function f grew in complexity, delta $delta"
  exit 0
fi
echo "FAIL C30: no complexity growth detected. counts: $(jq -c '.comparison.complexity.counts' "$WORK/summary.json" 2>/dev/null)"
exit 1
