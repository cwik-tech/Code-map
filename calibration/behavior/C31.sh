#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C31 Architecture erosion: a new prohibited edge in the head is a NEW ARCH-RULE finding, and the base
# policy applied to the head shows the new violation while the base shows none.
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
mkdir -p src/core src/ui
printf '{ "rules": ["core -> ui"] }\n' > .code-map.json
printf 'export function engine() { return 1; }\n' > src/core/engine.ts
printf "export function view() { return 'v'; }\n" > src/ui/view.ts
git add -A
git commit -qm base
cat > src/core/engine.ts <<'EOF'
import { view } from '../ui/view';
export function engine() { return view().length; }
EOF
git add -A
git commit -qm head
node "$CLI" inspect --summary --ref HEAD --base HEAD~1 --store "$WORK/store" > "$WORK/summary.json" 2> "$WORK/err.txt"
status=$?
if [ "$status" -ne 0 ]; then
  echo "FAIL C31: inspect --summary failed (exit $status). stderr: $(cat "$WORK/err.txt" 2>/dev/null)"
  exit 1
fi
if jq -e '[.findings.items[]? | select(.ruleId == "ARCH-RULE" and .baseline == "NEW")] | length >= 1' "$WORK/summary.json" >/dev/null 2>&1 \
  && jq -e '.comparison.policy.evaluations.basePolicy.head.violations | length >= 1' "$WORK/summary.json" >/dev/null 2>&1 \
  && jq -e '.comparison.policy.evaluations.basePolicy.base.violations | length == 0' "$WORK/summary.json" >/dev/null 2>&1; then
  echo "PASS C31: new core->ui import is a NEW ARCH-RULE finding; base policy sees 1 head violation and 0 base violations"
  exit 0
fi
echo "FAIL C31: no NEW ARCH-RULE finding or policy delta. rules: $(jq -c '.comparison.policy.rules' "$WORK/summary.json" 2>/dev/null)"
exit 1
