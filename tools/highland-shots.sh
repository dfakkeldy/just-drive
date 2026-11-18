#!/usr/bin/env bash
# Highland bull preview: pictures, node contract and draw budgets in one owned browser.
# Usage: tools/highland-shots.sh [width height]     OUT=<folder> chooses where the pictures go.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports "$@"
W="${1:-1440}"; H="${2:-1000}"
OUT="${OUT:-$ROOT/data/work/threads/highland}"; mkdir -p "$OUT"
mem_report
cd "$ROOT/web"
if [[ "${MMM_CHECK_STANDIN:-0}" != 1 ]]; then
  # This page needs no terrain or audio (the full public folder is gigabytes): build it alone and copy the two models.
  node --input-type=module -e 'import { build } from "vite"; await build({configFile:false,base:"./",publicDir:false,build:{target:"es2022",rollupOptions:{input:"highland.html"}}});' >/dev/null
  cp dist/highland.html dist/index.html # The shared startup probes / before opening highland.html.
  mkdir -p dist/models; cp public/models/highland-bull.glb public/models/highland-bull-low.glb dist/models/
fi
start_check "$W" "$H" preview
CDP_PORT="$CDP" run_check node "$ROOT/tools/${RUN:-highland-browser.mjs}" "$OUT" "http://127.0.0.1:$WEB/highland.html"
