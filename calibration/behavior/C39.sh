#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C39 - Sandboxing: an authorized command runs only in the isolated Seatbelt worker with no
# credentials in its environment and no network, and it records its budgets.
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
printf '{ "rules": [] }\n' > .code-map.json
cat > probe.mjs <<'EOF'
import { connect } from 'node:net';
const what = process.argv[2];
if (what === 'env') { console.log(JSON.stringify(process.env)); process.exit(0); }
if (what === 'net') {
  const socket = connect({ host: '127.0.0.1', port: 9 });
  socket.setTimeout(1500);
  socket.on('connect', () => { console.log('allowed'); process.exit(0); });
  socket.on('error', (e) => { console.log(e.code); process.exit(0); });
  socket.on('timeout', () => { console.log('timeout'); process.exit(0); });
}
EOF
git add -A && git commit -qm base

$CLI authorize --store "$TMP/store" --command node probe.mjs env > "$TMP/auth-env.json" 2> "$TMP/auth-env.err"
AUTH_ENV="$(jq -r '.authorizationId // empty' "$TMP/auth-env.json" 2>/dev/null)"
$CLI authorize --store "$TMP/store" --command node probe.mjs net > "$TMP/auth-net.json" 2> "$TMP/auth-net.err"
AUTH_NET="$(jq -r '.authorizationId // empty' "$TMP/auth-net.json" 2>/dev/null)"
if [ -z "$AUTH_ENV" ] || [ -z "$AUTH_NET" ]; then
  echo "FAIL C39: authorize failed: $(cat "$TMP/auth-env.err" "$TMP/auth-net.err")"
  exit 1
fi

CODE_MAP_TEST_TOKEN=secret-token $CLI run --authorization "$AUTH_ENV" --store "$TMP/store" -- node probe.mjs env \
  > "$TMP/run-env.json" 2> "$TMP/run-env.err"
$CLI run --authorization "$AUTH_NET" --store "$TMP/store" -- node probe.mjs net \
  > "$TMP/run-net.json" 2> "$TMP/run-net.err"

POLICY="$(jq -r '.policy // empty' "$TMP/run-env.json" 2>/dev/null)"
BACKEND="$(jq -r '.backend // empty' "$TMP/run-env.json" 2>/dev/null)"
REC="$(jq -r '.files.record // empty' "$TMP/run-env.json" 2>/dev/null)"
NETWORK="$(jq -r '.network // empty' "$REC" 2>/dev/null)"
BUDGETS="$(jq -r '.budgets | has("wallClockSeconds") and has("memoryMegabytes") and has("outputMegabytes") and has("concurrency")' "$REC" 2>/dev/null)"
STDOUT="$(jq -r '.files.stdout // empty' "$TMP/run-env.json" 2>/dev/null)"
LEAKED="$(grep -c 'CODE_MAP_TEST_TOKEN' "$STDOUT" 2>/dev/null)"
NET_STDOUT="$(jq -r '.files.stdout // empty' "$TMP/run-net.json" 2>/dev/null)"
NET_ALLOWED="$(grep -c 'allowed' "$NET_STDOUT" 2>/dev/null)"

if [ "$POLICY" = "isolated" ] && [ "$BACKEND" = "seatbelt" ] && [ "$NETWORK" = "denied" ] && [ "$BUDGETS" = "true" ] && [ "$LEAKED" = "0" ] && [ "$NET_ALLOWED" = "0" ]; then
  echo "PASS C39: run is isolated ($BACKEND), network denied, no parent token leaked into the environment, budgets recorded"
  exit 0
else
  echo "FAIL C39: policy=$POLICY backend=$BACKEND network=$NETWORK budgets=$BUDGETS tokenLeak=$LEAKED netAllowed=$NET_ALLOWED"
  exit 1
fi
