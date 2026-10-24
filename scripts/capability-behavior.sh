#!/bin/bash
# Runs one behavior script for each capability C01 to C45 of the plan (calibration/behavior/). Each script builds a small
# repository in a temporary folder, runs the Code-map CLI on it, and prints PASS or FAIL. Exit 1 when one script fails.
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export CODE_MAP_ROOT="$root"
failed=0
for script in "$root"/calibration/behavior/C*.sh; do
  line="$(bash "$script" 2>&1 | tail -1)"; code=${PIPESTATUS[0]}
  echo "$line"
  [ "$code" -eq 0 ] || failed=1
done
exit $failed
