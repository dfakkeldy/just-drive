#!/usr/bin/env bash
# Static site pages and the production PlacesUI. Browser ownership and slots stay in browser.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports "$@"
OUT="${OUT:-$ROOT/data/work/page-access}"; mkdir -p "$OUT"
cd "$ROOT/web"
browser_typecheck
start_check 1280 800 none
CDP_PORT="$CDP" run_check node "$ROOT/tools/page-access-browser.mjs" "$OUT"
