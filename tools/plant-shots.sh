#!/usr/bin/env bash
# Serve the game and take settled screenshots of the Harbour Ridge steel plant package run.
# Output: data/work/shots/<name>.png (or $OUT)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports "$@"
W="${1:-1280}"; H="${2:-800}"; Q="${3:-day=1}"
OUT="${OUT:-$ROOT/data/work/shots}"; mkdir -p "$OUT"
cd "$ROOT/web"
mem_report
browser_typecheck
start_check "$W" "$H" dev
URLS=()
for v in ${VIEWS:-plant-door|at=620583.66,5099389.52,137&demo=1 plant-bay1|interior=plant&inspect=start plant-bay2|interior=plant&inspect=hotfloor plant-bay3|interior=plant&inspect=cranes plant-win|interior=plant&inspect=win plant-loss|interior=plant&inspect=loss plant-phone-portrait|interior=plant&inspect=start&touch=1&q=low&shotw=390&shoth=844 plant-phone-landscape|interior=plant&inspect=start&touch=1&q=low&shotw=844&shoth=390}; do
  URLS+=("http://127.0.0.1:$WEB/?name=${v%%|*}&${v#*|}&hud=${HUD:-1}${Q:+&$Q}")
done
CDP_PORT="$CDP" SHOT_WIDTH="$W" SHOT_HEIGHT="$H" run_check node "$ROOT/tools/plant-shot.mjs" "$OUT" "${URLS[@]}"
