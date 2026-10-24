#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C34 Supply-chain: sbom exports a CycloneDX 1.5 document from the npm lockfile with components.
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
{ "name": "pkg", "version": "1.0.0", "main": "src/index.ts", "dependencies": { "left-pad": "1.3.0", "lodash": "4.17.21" } }
EOF
printf 'export const app = 1;\n' > src/index.ts
cat > package-lock.json <<'EOF'
{
  "name": "pkg", "version": "1.0.0", "lockfileVersion": 2,
  "packages": {
    "": { "name": "pkg", "version": "1.0.0", "dependencies": { "left-pad": "1.3.0", "lodash": "4.17.21" } },
    "node_modules/left-pad": { "version": "1.3.0", "resolved": "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz", "integrity": "sha512-XI5MPzVNApjAyhQzQ==" },
    "node_modules/lodash": { "version": "4.17.21", "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz", "integrity": "sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==" }
  }
}
EOF
git add -A
git commit -qm base
node "$CLI" sbom --ref HEAD --out "$WORK/sbom.json" > "$WORK/out.txt" 2> "$WORK/err.txt"
status=$?
if [ "$status" -ne 0 ]; then
  echo "FAIL C34: sbom failed (exit $status). stderr: $(cat "$WORK/err.txt" 2>/dev/null)"
  exit 1
fi
if jq -e '.bomFormat == "CycloneDX" and .specVersion == "1.5" and (.components | length) >= 2' "$WORK/sbom.json" >/dev/null 2>&1 \
  && jq -e '[.components[] | select(.name == "left-pad" and .version == "1.3.0" and (.purl | startswith("pkg:npm/"))) ] | length >= 1' "$WORK/sbom.json" >/dev/null 2>&1; then
  spec="$(jq -r '.specVersion' "$WORK/sbom.json")"
  n="$(jq -r '.components | length' "$WORK/sbom.json")"
  echo "PASS C34: sbom exported CycloneDX $spec with $n components incl. left-pad@1.3.0"
  exit 0
fi
echo "FAIL C34: sbom output not CycloneDX 1.5 with expected components. head: $(jq -c '{bomFormat,specVersion,n:(.components|length)}' "$WORK/sbom.json" 2>/dev/null)"
exit 1
