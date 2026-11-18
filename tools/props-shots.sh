#!/usr/bin/env bash
# Serve the game and take settled screenshots with a headless browser (tools/browser.sh picks it).
# Output: data/work/shots/<name>.png
# Usage: tools/props-shots.sh [width height] [extra query for every view, e.g. "exag=1"]
#   VIEWS="name|query ..." picks the views; the default is the five roadside prop views.
#   Example: VIEWS="drive-village|demo=6 seat|demo=6&view=seat" tools/props-shots.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports "$@"
W="${1:-1600}"; H="${2:-1200}"; Q="${3:-}"
OUT="$ROOT/data/work/shots"; mkdir -p "$OUT"
cd "$ROOT/web"
browser_typecheck
# The dev server reads the baked tiles through the public/terrain link, so nothing is copied.
start_check "$W" "$H" dev
URLS=()
for v in ${VIEWS:-props-harbour|demo=10&road=Mabou%20Harbour%20Road&f=0.35 props-glenora|demo=10&road=Glenora%20Falls%20Road&f=0.5 props-village|demo=7 props-rankinville|demo=10&road=Rankinville%20Road&f=0.6 props-252|demo=10&road=Highway%20252&f=0.3}; do
  URLS+=("http://127.0.0.1:$WEB/?name=${v%%|*}&${v#*|}&hud=${HUD:-0}${Q:+&$Q}")
done
CDP_PORT="$CDP" run_check node "$ROOT/tools/${RUN:-shot.mjs}" "$OUT" "${URLS[@]}"
