#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C32 Dead code / dependencies: dropping an import orphans a source file and a dependency, both labeled NEW.
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
cat > package.json <<'EOF'
{ "name": "app", "version": "1.0.0", "main": "src/index.ts", "dependencies": { "used-pkg": "1.0.0", "later-pkg": "1.0.0" } }
EOF
cat > src/index.ts <<'EOF'
import { feature } from './feature';
import { used } from 'used-pkg';
export const app = [feature, used];
EOF
printf 'export const feature = 1;\n' > src/feature.ts
printf 'export const old = 1;\n' > src/old.ts
git add -A
git commit -qm base
cat > src/index.ts <<'EOF'
import { later } from 'later-pkg';
export const app = [later];
EOF
git add -A
git commit -qm head
node "$CLI" inspect --summary --ref HEAD --base HEAD~1 --store "$WORK/store" > "$WORK/summary.json" 2> "$WORK/err.txt"
status=$?
if [ "$status" -ne 0 ]; then
  echo "FAIL C32: inspect --summary failed (exit $status). stderr: $(cat "$WORK/err.txt" 2>/dev/null)"
  exit 1
fi
if jq -e '[.findings.items[]? | select(.ruleId == "FILE-ORPHANED" and .location.path == "src/feature.ts" and .baseline == "NEW")] | length >= 1' "$WORK/summary.json" >/dev/null 2>&1 \
  && jq -e '[.findings.items[]? | select(.ruleId == "PACKAGE-UNUSED" and .location.symbol == "used-pkg" and .baseline == "NEW")] | length >= 1' "$WORK/summary.json" >/dev/null 2>&1; then
  echo "PASS C32: src/feature.ts becomes a NEW FILE-ORPHANED lead and used-pkg a NEW PACKAGE-UNUSED lead"
  exit 0
fi
echo "FAIL C32: expected NEW orphaned-file/unused-package leads not found."
exit 1
