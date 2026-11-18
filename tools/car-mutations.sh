#!/usr/bin/env bash
# One owned hardware browser for served car source mutants; no production build.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports "$@"
OUT="${OUT:-$ROOT/data/work/car-mutations}"; mkdir -p "$OUT"
cd "$ROOT/web"
start_check 1440 1000 dev
CDP_PORT="$CDP" run_check node "$ROOT/tools/car-mutations.mjs" "$OUT" "http://127.0.0.1:$WEB/car.html?view=rear"
