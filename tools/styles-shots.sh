#!/usr/bin/env bash
# Serve the game and take settled screenshots with a headless browser (tools/browser.sh picks it).
# Output: data/work/shots/<name>.png
# Usage: tools/styles-shots.sh [width height] [extra query for every view, e.g. "exag=1"]
#   VIEWS="name|query ..." picks the views; defaults park on roads facing the targets.
#   Example: VIEWS="styles-drive-village|demo=6 styles-seat|demo=6&view=seat" tools/styles-shots.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports "$@"
W="${1:-1600}"; H="${2:-1200}"; Q="${3:-}"
OUT="$ROOT/data/work/shots"; mkdir -p "$OUT"
cd "$ROOT/web"
# Set SKIP_TYPECHECK=1 only when another concurrent task temporarily breaks its own file.
if [[ "${SKIP_TYPECHECK:-0}" != 1 ]]; then browser_typecheck; fi
# Read baked tiles through public/terrain. Freeze file watching during a batch so
# concurrent animal edits cannot reload a camera halfway through a screenshot.
# A profile of its own, and a polite close through the debugging port, so no other Chromium window is touched.
start_check "$W" "$H" styles
URLS=()
for v in ${VIEWS:-styles-air|shot=2 styles-village|day=1&at=624467.095,5103372.288,328 styles-seniors|at=623745.57,5103510.03,95 styles-brook|at=631532.062,5101166.095,321 styles-farm|at=627171.62,5104224.53,112 styles-harbour|at=618603.471,5105131.159,190}; do
  URLS+=("http://127.0.0.1:$WEB/?name=${v%%|*}&${v#*|}&hud=${HUD:-0}${Q:+&$Q}")
done
CDP_PORT="$CDP" run_check node "$ROOT/tools/${RUN:-shot.mjs}" "$OUT" "${URLS[@]}"
