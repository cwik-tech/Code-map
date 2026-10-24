#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C43 - Calibration: the seeded calibration corpus reports a confusion matrix per check with
# precision and recall, and a total duration. It exercises code-map verify on real cases.
set -u
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP" || exit 1
CALIB="node $CODE_MAP_ROOT/scripts/calibrate.mjs"
$CALIB --out "$TMP/report.json" > "$TMP/calib.txt" 2> "$TMP/calib.err"
CODE=$?
if [ $CODE -ne 0 ]; then
  echo "FAIL C43: calibration run ended with code $CODE: $(tail -5 "$TMP/calib.err" 2>/dev/null); $(tail -3 "$TMP/calib.txt" 2>/dev/null)"
  exit 1
fi
if [ ! -s "$TMP/report.json" ]; then
  echo "FAIL C43: no JSON report written"
  exit 1
fi
NCHECKS="$(jq -r '.metrics | keys | length' "$TMP/report.json" 2>/dev/null)"
PREC="$(jq -r '[.metrics[] | select(.precision != null)] | length' "$TMP/report.json" 2>/dev/null)"
RECALL="$(jq -r '[.metrics[] | select(.recall != null)] | length' "$TMP/report.json" 2>/dev/null)"
DUR="$(jq -r '.totalDurationMs' "$TMP/report.json" 2>/dev/null)"
if [ "$NCHECKS" -ge 1 ] 2>/dev/null && [ "$PREC" -ge 1 ] 2>/dev/null && [ "$RECALL" -ge 1 ] 2>/dev/null; then
  echo "PASS C43: calibration corpus reports confusion matrices with precision/recall across $NCHECKS checks in $DUR ms"
  exit 0
else
  echo "FAIL C43: checks=$NCHECKS precisionRows=$PREC recallRows=$RECALL duration=$DUR"
  exit 1
fi
