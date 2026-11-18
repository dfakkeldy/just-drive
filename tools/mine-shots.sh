#!/usr/bin/env bash
# Serve the game and take settled screenshots with a headless browser (tools/browser.sh picks it).
# Output: data/work/shots/<name>.png
# Usage: tools/mine-shots.sh [width height] [extra query for every view, e.g. "exag=1"]
#   VIEWS="mine-name|query ..." overrides the seven mine views. inspect= is used only by the capture script.
#   Example: VIEWS="mine-phone|interior=mine&inspect=start&touch=1&q=low" tools/mine-shots.sh 420 860
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports "$@"
W="${1:-1200}"; H="${2:-900}"; Q="${3:-day=1}"
OUT="$ROOT/data/work/shots"; mkdir -p "$OUT"
cd "$ROOT/web"
mem_report
browser_typecheck
# The dev server reads the baked tiles through the public/terrain link, so nothing is copied.
# A profile of its own, and a polite close through the debugging port, so no other Chromium window is touched.
start_check "$W" "$H" dev
URLS=()
for v in ${VIEWS:-mine-site|at=619561.42,5110831.53,145&demo=1 mine-prompt|at=619561.42,5110831.53,145&demo=1&view=seat mine-start|interior=mine&inspect=start mine-fork|interior=mine&inspect=fork mine-tip|interior=mine&inspect=tip mine-face|interior=mine&inspect=face mine-phone|interior=mine&inspect=start&touch=1&q=low&shotw=420&shoth=860}; do
  URLS+=("http://127.0.0.1:$WEB/?name=${v%%|*}&${v#*|}&hud=${HUD:-1}${Q:+&$Q}")
done
CDP_PORT="$CDP" SHOT_WIDTH="$W" SHOT_HEIGHT="$H" run_check node "$ROOT/tools/mine-shot.mjs" "$OUT" "${URLS[@]}"
