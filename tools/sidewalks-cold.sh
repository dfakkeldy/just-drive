#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:?set OUT for cold evidence}"
for n in 0 1 2;do
  for side in main current;do
    mkdir -p "$OUT/$n-$side"
    if [[ -n "${SIDEWALK_CAPACITY_SCRIPT:-}" ]];then python3 "$SIDEWALK_CAPACITY_SCRIPT" --running 0 > "$OUT/$n-$side/capacity-before.json";fi
    OUT="$OUT/$n-$side" SIDEWALK_RUNTIME_PHASE=cold SIDEWALK_COLD_SIDE="$side" MMM_SKIP_TYPECHECK=1 "$ROOT/tools/sidewalks-fix-browser.sh"
    if [[ -n "${SIDEWALK_CAPACITY_SCRIPT:-}" ]];then python3 "$SIDEWALK_CAPACITY_SCRIPT" --running 0 > "$OUT/$n-$side/capacity-after.json";fi
  done
done
node "$ROOT/tools/sidewalks-cold.mjs" --aggregate "$OUT"
