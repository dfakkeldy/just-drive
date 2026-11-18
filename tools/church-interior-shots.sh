#!/usr/bin/env bash
# Serve the game and take settled pictures of the church interior with a headless browser (tools/browser.sh picks it).
# Output: $MMM_CHECK_OUT/evidence/church-interior-shots/ under check-all (remote-check brings it back), else data/work/shots/.
# Usage: tools/church-interior-shots.sh [width height]
#   VIEWS="name|query ..." overrides the views. inspect= is used only by the capture script.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports "$@"
W="${1:-1200}"; H="${2:-900}"
OUT="${MMM_CHECK_OUT:+$MMM_CHECK_OUT/evidence/church-interior-shots}"; OUT="${OUT:-$ROOT/data/work/shots}"; mkdir -p "$OUT"
cd "$ROOT/web"
mem_report
browser_typecheck
start_check "$W" "$H" dev
# The first view stops a car on the grass 4 m from the step foot (EPSG:2961), outside the mail game.
STEPS="area=judique&at=630830.52,5080646.36,117"
URLS=()
for v in ${VIEWS:-church-steps|$STEPS church-door|area=judique&interior=church&inspect=door church-altar|area=judique&interior=church&inspect=altar church-vestry|area=judique&interior=church&inspect=vestry church-gallery|area=judique&interior=church&inspect=gallery church-phone|area=judique&interior=church&inspect=door&touch=1&q=low&shotw=420&shoth=860}; do
  URLS+=("http://127.0.0.1:$WEB/?name=${v%%|*}&${v#*|}&hud=${HUD:-1}")
done
CDP_PORT="$CDP" SHOT_WIDTH="$W" SHOT_HEIGHT="$H" run_check node "$ROOT/tools/church-interior-shot.mjs" "$OUT" "${URLS[@]}"
