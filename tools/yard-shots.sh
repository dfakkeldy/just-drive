#!/usr/bin/env bash
# Serve the game and take settled screenshots with a headless browser (tools/browser.sh picks it).
# Output: data/work/shots/<name>.png
# Usage: tools/yard-shots.sh [width height] [extra query for every view, e.g. "exag=1"]
#   VIEWS="name|query ..." picks the views; the default is the fixed landscape views.
#   RUN=<script>.mjs runs a check script from tools/ in place of the picture taker (ui-check, radio-check, layout-check,
#   relief-check, fps-check); its exit code is this script's exit code.
#   Example: VIEWS="drive-village|demo=6 seat|demo=6&view=seat" tools/yard-shots.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
W="${1:-1600}"; H="${2:-1200}"; Q="${3:-}"
browser_ports "$@"
OUT="${OUT:-$ROOT/data/work/shots}"; mkdir -p "$OUT"
cd "$ROOT/web"
browser_typecheck
start_check "$W" "$H"
URLS=()
for v in ${VIEWS:-shot-1|shot=1 shot-2|shot=2 shot-3|shot=3 shot-4|shot=4}; do
  URLS+=("http://127.0.0.1:$WEB/?name=${v%%|*}&${v#*|}&hud=${HUD:-0}&shadows=${SHADOWS:-1}${Q:+&$Q}")
done
CDP_PORT="$CDP" run_check node "$ROOT/tools/${RUN:-shot.mjs}" "$OUT" "${URLS[@]}"
