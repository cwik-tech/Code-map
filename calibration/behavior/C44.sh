#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C44 - LLM layer: code-map verify --context prints a bounded context, and code-map review sends
# it to a user program, validates typed hypotheses and saves only the validated file.
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
mkdir -p src
printf '{ "rules": [] }\n' > .code-map.json
cat > src/a.ts <<'EOF'
export function a(): number { return 1; }
EOF
git add -A && git commit -qm base && git tag base
cat > src/a.ts <<'EOF'
export function a(): number { return 2; }
EOF
git add -A && git commit -qm head

cat > request.json <<'EOF'
{ "requestType": "code-map-verification-request", "schemaVersion": 1, "base": "base", "head": "HEAD",
  "intent": "Change a().", "acceptanceCriteria": [], "allowedPaths": ["src/**"],
  "changeType": "other", "profileId": "static-baseline-v0", "ratingRulesVersion": "ratings-v0",
  "reportInputs": [], "execution": { "enabled": false, "authorization": null,
  "budgets": { "wallClockSeconds": 60, "memoryMegabytes": 512, "outputMegabytes": 8, "concurrency": 1 } } }
EOF
$CLI verify --request request.json --store "$TMP/store" --out-dir "$TMP/out" > "$TMP/verify.json" 2> "$TMP/verify.err"
RUNID="$(jq -r '.runId // empty' "$TMP/verify.json" 2>/dev/null)"
if [ -z "$RUNID" ]; then
  echo "FAIL C44: verify produced no run: $(cat "$TMP/verify.err")"
  exit 1
fi

$CLI verify --context "$RUNID" --out-dir "$TMP/out" > "$TMP/context.json" 2> "$TMP/context.err"
CTX_OK="$(jq -r '.reportType == "code-map-verification-context" and (.ratings | type == "object") and (.checks | type == "object")' "$TMP/context.json" 2>/dev/null)"

cat > model.mjs <<'EOF'
let s = '';
process.stdin.on('data', (c) => { s += c; });
process.stdin.on('end', () => {
  const ctx = JSON.parse(s);
  process.stdout.write(JSON.stringify({ hypothesesVersion: 1, model: 'audit-model', items: [
    { id: 'risk', kind: 'risk', claim: 'ctx run ' + ctx.runId ?? '?', evidenceIds: ['request:intent'] },
    { id: 'lead', kind: 'other', claim: 'An ungrounded lead.', evidenceIds: ['absent-id'] }
  ] }));
});
EOF
$CLI review --run "$RUNID" --out-dir "$TMP/out" --model-command node model.mjs > "$TMP/review.json" 2> "$TMP/review.err"
REV_OK="$(jq -e '.reportType == "code-map-model-review" and .grounded >= 1 and .ungrounded >= 1' "$TMP/review.json" 2>/dev/null)"
SAVED="$(jq -r '.path // empty' "$TMP/review.json" 2>/dev/null)"
SAVED_OK="false"
[ -n "$SAVED" ] && [ -s "$SAVED" ] && SAVED_OK="true"

if [ "$CTX_OK" = "true" ] && [ "$REV_OK" = "true" ] && [ "$SAVED_OK" = "true" ]; then
  G="$(jq '.grounded' "$TMP/review.json")"; U="$(jq '.ungrounded' "$TMP/review.json")"
  echo "PASS C44: context printed; review validated and saved hypotheses (grounded=$G ungrounded=$U)"
  exit 0
else
  echo "FAIL C44: context=$CTX_OK review=$REV_OK saved=$SAVED_OK; err=$(cat "$TMP/review.err")"
  exit 1
fi
