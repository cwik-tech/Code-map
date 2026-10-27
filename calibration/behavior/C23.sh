#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C23 - State-transition coverage: a declared state model must report unreachable states,
# dead ends and unhandled events from its declared transitions.
set -u
CLI="$CODE_MAP_ROOT/bin/code-map.mjs"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/repo" "$T/store"
cd "$T/repo"
git init -q
git config user.email a@b.c
git config user.name a
mkdir -p .code-map/models
cat > .code-map/models/order.json <<'EOF'
{ "modelVersion": 1, "name": "order", "states": ["new","paid","shipped","cancelled","orphan"], "initial": "new", "final": ["shipped","cancelled"], "transitions": [
  { "from": "new", "event": "PAY", "to": "paid" },
  { "from": "paid", "event": "SHIP", "to": "shipped" }
] }
EOF
git add -A && git commit -qm base

ID=$(node "$CLI" inspect --summary --ref HEAD --store "$T/store" 2>/dev/null | jq -r .analysis.id)
node "$CLI" inspect --analysis "$ID" --part models.states --store "$T/store" > "$T/s.json" 2>/dev/null

UNREACH=$(jq -r '[.page.items[0].unreachable[]] | sort | join(",")' "$T/s.json")
DEAD=$(jq -r '[.page.items[0].deadEnds[]] | sort | join(",")' "$T/s.json")
UNHANDLED=$(jq -r '[.page.items[0].unhandled[].events[]] | sort | unique | join(",")' "$T/s.json")
TRANSITIONS=$(jq -r '[.page.items[0].transitions[].event] | join(",")' "$T/s.json")

if [ "$TRANSITIONS" = "PAY,SHIP" ] && [ "$UNREACH" = "cancelled,orphan" ] && [ "$DEAD" = "orphan" ] && [ -n "$UNHANDLED" ]; then
  echo "PASS C23: state model reports transitions=$TRANSITIONS, unreachable=[$UNREACH], deadEnds=[$DEAD], unhandled events=[$UNHANDLED]"
  exit 0
else
  echo "FAIL C23: transitions=$TRANSITIONS unreachable=[$UNREACH] deadEnds=[$DEAD] unhandled=[$UNHANDLED]"
  exit 1
fi
