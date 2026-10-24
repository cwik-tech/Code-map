#!/usr/bin/env bash
CODE_MAP_ROOT="${CODE_MAP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# C36 Performance: sizes reads Next.js build assets, and bench measures controlled command timings with
# median / MAD / minimum in the restricted worker.
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
mkdir -p .next/static/chunks .next/static/css .next/static/media
printf 'fixture-build\n' > .next/BUILD_ID
printf 'shared' > .next/static/chunks/shared.js
printf 'home' > .next/static/chunks/home.js
printf 'poly' > .next/static/chunks/poly.js
printf 'app' > .next/static/chunks/app.js
printf 'body{}' > .next/static/css/main.css
printf '<svg/>' > .next/static/media/logo.svg
cat > .next/build-manifest.json <<'EOF'
{ "pages": { "/_app": ["static/chunks/app.js"], "/home": ["static/chunks/home.js", "static/chunks/shared.js"] },
  "rootMainFiles": ["static/chunks/shared.js"], "polyfillFiles": ["static/chunks/poly.js"] }
EOF
printf 'console.log("bench");\n' > bench.js
printf '.next/\n' > .gitignore
git add -A
git commit -qm base

node "$CLI" sizes --dir .next --out "$WORK/sizes.json" > "$WORK/out1.txt" 2> "$WORK/err1.txt"
sstatus=$?
sizes_ok=0
if [ "$sstatus" -eq 0 ] && jq -e '.reportType == "code-map-sizes" and (.routes | length) >= 1 and (.totals.chunks.bytes | type == "number")' "$WORK/sizes.json" >/dev/null 2>&1; then
  sizes_ok=1
fi

AUTH="$(node "$CLI" authorize --store "$WORK/store" --command node bench.js | jq -r '.authorizationId' 2>/dev/null)"
node "$CLI" bench --store "$WORK/store" --authorization "$AUTH" --runs 3 --warmup 1 -- node bench.js > "$WORK/bench-summary.json" 2> "$WORK/err2.txt"
bstatus=$?
bench_ok=0
if [ -f "$WORK/bench-summary.json" ]; then
  artifact="$(jq -r '.files.artifact // empty' "$WORK/bench-summary.json" 2>/dev/null)"
  if [ -n "$artifact" ] && jq -e '.reportType == "code-map-bench" and (.samples | length) >= 3 and (.statistics.medianMs | type == "number") and (.statistics.madMs | type == "number") and (.statistics.minimumMs | type == "number")' "$artifact" >/dev/null 2>&1; then
    bench_ok=1
  fi
fi

if [ "$sizes_ok" = 1 ] && [ "$bench_ok" = 1 ]; then
  routes="$(jq -r '.routes | length' "$WORK/sizes.json")"
  median="$(jq -r '.statistics.medianMs' "$(jq -r '.files.artifact' "$WORK/bench-summary.json")")"
  echo "PASS C36: sizes read $routes route(s) with totals, and bench measured a median of ${median}ms with MAD and minimum"
  exit 0
fi
echo "FAIL C36: sizes_ok=$sizes_ok bench_ok=$bench_ok (sizes exit $sstatus, bench exit $bstatus). err1: $(cat "$WORK/err1.txt" 2>/dev/null) err2: $(cat "$WORK/err2.txt" 2>/dev/null)"
exit 1
