#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C41 - False-positive management: a person suppresses a finding; the triage file records the
# fingerprint, state, reason, owner and expiry, and the next summary hides that finding.
set -u
CLI="node $CODE_MAP_ROOT/bin/code-map.mjs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
REPO="$TMP/repo"
mkdir -p "$REPO"
cd "$REPO" || exit 1
git init -q -b main
git config user.email "audit-e@local"
git config user.name "audit-e"
mkdir -p src/core src/ui
printf '{ "rules": ["core -> ui"] }\n' > .code-map.json
cat > src/ui/view.ts <<'EOF'
export function view() { return 1; }
EOF
cat > src/core/engine.ts <<'EOF'
import { view } from '../ui/view';
export function engine() { return view(); }
EOF
git add -A && git commit -qm base

$CLI inspect --summary --ref HEAD --store "$TMP/store" > "$TMP/sum1.json" 2> "$TMP/err1.txt"
AID="$(jq -r '.analysis.id // empty' "$TMP/sum1.json" 2>/dev/null)"
FIND="$(jq -r '[.findings.items[] | select(.ruleId == "ARCH-RULE")][0].id // empty' "$TMP/sum1.json" 2>/dev/null)"
if [ -z "$AID" ] || [ -z "$FIND" ]; then
  echo "FAIL C41: no ARCH-RULE finding to triage (analysis=$AID finding=$FIND)"
  exit 1
fi
EXPIRES="$(node -e 'console.log(new Date(Date.now()+30*864e5).toISOString().slice(0,10))')"

$CLI triage --store "$TMP/store" --analysis "$AID" --finding "$FIND" --state suppressed \
  --reason "The new layer lands next week." --owner "audit-e" --expires "$EXPIRES" \
  > "$TMP/triage.json" 2> "$TMP/triage.err"
if [ ! -s "$TMP/triage.json" ]; then
  echo "FAIL C41: triage command failed: $(cat "$TMP/triage.err")"
  exit 1
fi

$CLI inspect --summary --ref HEAD --store "$TMP/store" > "$TMP/sum2.json" 2> "$TMP/err2.txt"
HIDDEN="$(jq -r '.findings.hidden.suppressed // 0' "$TMP/sum2.json" 2>/dev/null)"
STILL="$(jq -e '[.findings.items[] | select(.ruleId == "ARCH-RULE")] | length > 0' "$TMP/sum2.json" 2>/dev/null)"
FILE_OK="$(jq -e '.entries[0].state == "suppressed" and (.entries[0].reason | length > 0) and .entries[0].owner == "audit-e" and (.entries[0].expires | length > 0) and (.entries[0].fingerprint | test("^[0-9a-f]{16}$"))' .code-map-triage.json 2>/dev/null)"

if [ "$HIDDEN" = "1" ] && [ "$STILL" = "false" ] && [ "$FILE_OK" = "true" ]; then
  echo "PASS C41: suppressed finding $(jq -r '.entries[0].fingerprint' .code-map-triage.json) hidden; triage records state, reason, owner and expiry"
  exit 0
else
  echo "FAIL C41: hidden=$HIDDEN stillShown=$STILL fileOk=$FILE_OK"
  exit 1
fi
