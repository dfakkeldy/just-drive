#!/usr/bin/env bash
# initial paving delta default-on lot pictures (Judique, Port Hood, Point Tupper; desktop and LOW; on and paved=0).
# Run from a checkout whose data/baked HAS the paved delta installed (a scratch clone, never the live land):
#   OUT=/abs/out tools/check-paved-lot-pictures.sh [/abs/six-area/paved/work/bake]
# Without a work bake it uses the committed poses in tools/paved-lot-poses.json.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
POSE_WORK="${1:-}"
browser_ports "$@"
OUT="${OUT:-$(mktemp -d "${TMPDIR:-/tmp}/paved-lots-XXXXXX")}"
cd "$ROOT/web"
browser_typecheck
start_check 1280 800
CDP_PORT="$CDP" run_check node "$ROOT/tools/paved-lot-pictures.mjs" "$OUT" "$WEB" ${POSE_WORK:+"$POSE_WORK"}
