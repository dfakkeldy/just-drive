#!/usr/bin/env bash
# Serve the game and take settled screenshots with a headless browser (tools/browser.sh picks it).
# Output: data/work/shots/<name>.png
# Usage: tools/shift-shots.sh [width height] [extra query for every view, e.g. "exag=1"]
#   VIEWS="name|query ..." picks the views; the default is the shift review set.
#   Example: VIEWS="drive-village|demo=6 seat|demo=6&view=seat" tools/shift-shots.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports "$@"
W="${1:-1200}"; H="${2:-900}"; Q="${3:-day=1}"
OUT="$ROOT/data/work/shots"; mkdir -p "$OUT"
cd "$ROOT/web"
browser_typecheck
# The dev server reads the baked tiles through the public/terrain link, so nothing is copied.
# A profile of its own, and a polite close through the debugging port, so no other Chromium window is touched.
start_check "$W" "$H" dev
URLS=()
for v in ${VIEWS:-run-day1|day=1 run-day3|day=3 run-report|day=1&demo=10&throw=1&report=1}; do
  URLS+=("http://127.0.0.1:$WEB/?name=${v%%|*}&${v#*|}&hud=${HUD:-1}${Q:+&$Q}")
done
CDP_PORT="$CDP" SHOT_WIDTH="$W" SHOT_HEIGHT="$H" run_check node "$ROOT/tools/shift-shot.mjs" "$OUT" "${URLS[@]}"
