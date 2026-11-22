#!/usr/bin/env bash
# Actual public game, local A/B publisher, real worker, bounded timer/visibility probes and served mutants.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports "$@"
OUT="${OUT:-$ROOT/data/work/version-browser}"
OUT="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$OUT")"; mkdir -p "$OUT"
SITE_OUT="$OUT/site" RADIO=0 "$ROOT/tools/build_site.sh" > "$OUT/build.log" 2>&1
cd "$ROOT/web"
start_check 390 844 none
CDP_PORT="$CDP" run_check node "$ROOT/tools/version-notice-browser.mjs" "$OUT"
