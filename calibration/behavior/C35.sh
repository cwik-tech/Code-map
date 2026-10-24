#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C35 Operational safeguards: a fetch without a signal is a static lead, and an injected fetch hang in
# the restricted harness is observed as a missing timeout.
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
printf 'export async function request(url: string) {\n  const res = await fetch(url);\n  return res;\n}\n' > src/client.ts
cat > src/runner.mjs <<'EOF'
export async function request(url) {
  const res = await fetch(url);
  return res;
}
EOF
printf '[{"u":"http://example.com"}]\n' > cases.json
cat > harness.json <<'EOF'
{ "harnessVersion": 1, "mode": "fault", "subject": { "file": "src/runner.mjs", "export": "request" }, "inputs": "cases.json", "fault": "hang", "mustHandle": false, "callTimeoutMs": 300 }
EOF
git add -A
git commit -qm base

node "$CLI" inspect --summary --ref HEAD --store "$WORK/store" > "$WORK/summary.json" 2> "$WORK/err1.txt"
if jq -e '[.findings.items[]? | select(.ruleId == "FETCH-NO-SIGNAL")] | length >= 1' "$WORK/summary.json" >/dev/null 2>&1; then
  static_ok=1
else
  static_ok=0
fi

AUTH="$(node "$CLI" authorize --store "$WORK/store" --command node .code-map-harness/runtime.mjs | jq -r '.authorizationId' 2>/dev/null)"
node "$CLI" harness --store "$WORK/store" --authorization "$AUTH" --spec harness.json > "$WORK/harness-summary.json" 2> "$WORK/err2.txt"
hstatus=$?
fault_ok=0
if [ -f "$WORK/harness-summary.json" ]; then
  artifact="$(jq -r '.files.artifact // empty' "$WORK/harness-summary.json" 2>/dev/null)"
  if [ -n "$artifact" ] && jq -e '[.failures[]? | select(.kind == "missing-timeout")] | length >= 1' "$artifact" >/dev/null 2>&1; then
    fault_ok=1
  fi
fi

if [ "$static_ok" = 1 ] && [ "$fault_ok" = 1 ]; then
  echo "PASS C35: FETCH-NO-SIGNAL static lead reported, and injected fetch hang observed as missing-timeout in the isolated harness"
  exit 0
fi
echo "FAIL C35: static_ok=$static_ok fault_ok=$fault_ok (harness exit $hstatus). stderr2: $(cat "$WORK/err2.txt" 2>/dev/null)"
exit 1
