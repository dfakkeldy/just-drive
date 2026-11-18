#!/usr/bin/env bash
# Isolated car views. Usage: tools/car-shots.sh [width height] [extra query]
# VIEWS='front side' OUT=... tools/car-shots.sh is useful for model iterations.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports "$@"
W="${1:-1440}"; H="${2:-1000}"; Q="${3:-}"
OUT="${OUT:-$ROOT/data/work/car}"; mkdir -p "$OUT"
mem_report
cd "$ROOT/web"
if [[ "${MMM_CHECK_STANDIN:-0}" != 1 ]]; then
  if [[ "${CAR_PREVIEW_ONLY:-0}" == 1 ]]; then
    # Isolated asset studies need no terrain or audio copies (the full public directory is gigabytes).
    node --input-type=module -e 'import { build } from "vite"; await build({configFile:false,base:"./",publicDir:false,build:{target:"es2022",rollupOptions:{input:"car.html"}}});' >/dev/null
    cp dist/car.html dist/index.html # The shared startup probes / before opening car.html.
    if [[ -d public/models ]]; then mkdir -p dist/models; cp public/models/*.glb dist/models/; fi
  else npx vite build >/dev/null; fi
fi
# Launch Vite directly so the saved PID is the server, rather than an npx wrapper.
# A distinct profile prevents Chromium from handing the request to the terrain browser.
start_check "$W" "$H" preview
URLS=()
for view in ${VIEWS:-front rear side top driver far}; do URLS+=("http://127.0.0.1:$WEB/car.html?name=shot-$view&view=$view${Q:+&$Q}"); done
CDP_PORT="$CDP" run_check node "$ROOT/tools/${RUN:-shot.mjs}" "$OUT" "${URLS[@]}"
