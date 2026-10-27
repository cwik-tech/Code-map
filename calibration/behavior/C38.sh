#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C38 - Reproducibility: a hashed run manifest binds source (commit), environment and the
# artifact digest; the machine key prints a public key and its SHA-256 fingerprint.
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
mkdir -p test reports
printf 'reports/\n' > .gitignore
printf '{ "rules": [] }\n' > .code-map.json
cat > test/a.test.mjs <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('works', () => { assert.equal(1, 1); });
EOF
git add -A && git commit -qm base

cat > reports/junit.xml <<'EOF'
<?xml version="1.0"?>
<testsuites><testsuite name="test/a.test.mjs" tests="1" failures="0"><testcase classname="test/a.test.mjs" file="test/a.test.mjs" name="works"/></testsuite></testsuites>
EOF
$CLI manifest --artifact reports/junit.xml --kind junit --exit-status 0 --out reports/junit.manifest.json -- node --test \
  > "$TMP/manifest.json" 2> "$TMP/manifest.err"
if [ ! -s reports/junit.manifest.json ]; then
  echo "FAIL C38: code-map manifest wrote nothing: $(cat "$TMP/manifest.err")"
  exit 1
fi

SHA_OK="$(jq -e '.source.sha | test("^[0-9a-f]{40}$")' reports/junit.manifest.json 2>/dev/null)"
CFG_OK="$(jq -e '.config | test("^[0-9a-f]{64}$")' reports/junit.manifest.json 2>/dev/null)"
ENV_OK="$(jq -e '(.environment.os | length > 0) and (.environment.node | length > 0) and (.environment.architecture | length > 0) and (.environment.typescript | length > 0)' reports/junit.manifest.json 2>/dev/null)"
ART_OK="$(jq -e '.artifacts[0].digest | test("^[0-9a-f]{64}$")' reports/junit.manifest.json 2>/dev/null)"
if [ "$SHA_OK" != "true" ] || [ "$CFG_OK" != "true" ] || [ "$ENV_OK" != "true" ] || [ "$ART_OK" != "true" ]; then
  echo "FAIL C38: manifest is missing binding fields (sha=$SHA_OK config=$CFG_OK env=$ENV_OK artifact=$ART_OK)"
  exit 1
fi

$CLI key --store "$TMP/store" > "$TMP/key.json" 2> "$TMP/key.err"
KEY_OK="$(jq -r '((.publicKey | test("BEGIN PUBLIC KEY")) and (.fingerprint | test("^sha256:[0-9a-f]{64}$")))' "$TMP/key.json" 2>/dev/null)"
if [ "$KEY_OK" != "true" ]; then
  echo "FAIL C38: code-map key gave no public key and fingerprint: $(cat "$TMP/key.err")"
  exit 1
fi
FP="$(jq -r '.fingerprint' "$TMP/key.json")"
echo "PASS C38: manifest binds commit $(jq -r '.source.sha' reports/junit.manifest.json | cut -c1-7), environment and artifact digest; key fingerprint $FP"
exit 0
