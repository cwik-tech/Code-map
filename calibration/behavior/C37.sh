#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C37 - Oracle provenance: a test case whose name tags an acceptance criterion ([AC:login])
# must be labeled "spec-linked" in the verify provenance and link to that criterion.
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
mkdir -p src test reports
printf 'reports/\n' > .gitignore
printf '{ "rules": [] }\n' > .code-map.json
cat > src/login.ts <<'EOF'
export function login(name: string) { return name; }
EOF
git add -A && git commit -qm base && git tag base
cat > test/login.test.ts <<'EOF'
import { test, expect } from 'vitest';
import { login } from '../src/login';

test('signs in [AC:login]', () => { expect(login('a')).toBe('a'); });
EOF
git add -A && git commit -qm head

cat > reports/junit.xml <<'EOF'
<?xml version="1.0"?>
<testsuites><testsuite name="test/login.test.ts" tests="1" failures="0"><testcase classname="test/login.test.ts" file="test/login.test.ts" name="signs in [AC:login]"/></testsuite></testsuites>
EOF
$CLI manifest --artifact reports/junit.xml --kind junit --exit-status 0 --out reports/junit.manifest.json -- npx vitest run --reporter=junit \
  > "$TMP/manifest.json" 2> "$TMP/manifest.err"

cat > request.json <<'EOF'
{ "requestType": "code-map-verification-request", "schemaVersion": 1, "base": "base", "head": "HEAD",
  "intent": "Add a login test.", "acceptanceCriteria": [{ "id": "login", "text": "A user can sign in." }],
  "allowedPaths": ["src/**", "test/**"], "changeType": "other", "profileId": "static-baseline-v0", "ratingRulesVersion": "ratings-v0",
  "reportInputs": [{ "artifact": "reports/junit.xml", "manifest": "reports/junit.manifest.json" }],
  "execution": { "enabled": false, "authorization": null, "budgets": { "wallClockSeconds": 60, "memoryMegabytes": 512, "outputMegabytes": 8, "concurrency": 1 } } }
EOF
$CLI verify --request request.json --store "$TMP/store" --out-dir "$TMP/out" \
  > "$TMP/verify.json" 2> "$TMP/verify.err"
RES="$(jq -r '.files.results // empty' "$TMP/verify.json" 2>/dev/null)"
if [ -z "$RES" ]; then
  echo "FAIL C37: verify produced no results file: $(cat "$TMP/verify.err")"
  exit 1
fi
if jq -e '.provenance.counts["spec-linked"] >= 1 and ([.provenance.criteria[] | select(.id == "login" and .linked >= 1)] | length > 0)' "$RES" > /dev/null 2>&1; then
  N="$(jq '.provenance.counts["spec-linked"]' "$RES")"
  echo "PASS C37: provenance labels $N case spec-linked and links acceptance criterion 'login'"
  exit 0
else
  echo "FAIL C37: provenance did not label the tagged case spec-linked (counts=$(jq -c '.provenance.counts' "$RES"))"
  exit 1
fi
