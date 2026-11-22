#!/bin/bash
# Registry row: the installed land, before or after main's step-29 power bake (no overlay, no delta folder).
# Manual rehearsal only: POWER_DELTA_ROOT=<validated delta> serves it through a temporary overlay
# (rehearse.py); "budget" then runs the full budget, mutations and both traffic selections on that overlay.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
DELTA="${POWER_DELTA_ROOT:-}"
if [[ "${1:-}" == budget ]]; then
  [[ -n "$DELTA" ]] || { echo 'power-network budget rehearsal needs POWER_DELTA_ROOT=<validated delta>; the registry budget rows cover installed land' >&2; exit 2; }
  EVIDENCE="${OUT:-/tmp}/evidence/power-network-budget"
  mkdir -p "$EVIDENCE"
  status=0
  run_budget() {
    local name="$1"; shift
    set +e
    python3 tools/power-network/rehearse.py "$DELTA" tools/check-budget.sh "$@" 2>&1 | tee "$EVIDENCE/$name.log"
    local code=${PIPESTATUS[0]}
    set -e
    [[ "$code" == 0 ]] || status=1
  }
  run_budget full
  run_budget mutations --mutations
  export FRAME_BUDGET_TRAFFIC=1 FRAME_BUDGET_BASELINE="$ROOT/tools/baseline/frame-budget-traffic.json"
  run_budget traffic --scene new-player-start --scene highway19-far-land
  run_budget traffic-desktop --scene new-player-start --scene highway19-far-land --mode desktop-mail --mode desktop-explore-truck
  exit "$status"
fi
# Two views: the church (no line since 21 Nov 2026) and River Denys Road by Highway 19, where real house drops hang.
VIEWS="power|area=judique&at=630770.2,5080667.56,83.8&vehicle=truck power-drop|area=judique&at=617629.05,5081495.89,80&vehicle=truck"
if [[ -n "$DELTA" ]]; then
  RUN=power-network-browser.mjs VIEWS="$VIEWS" python3 tools/power-network/rehearse.py "$DELTA" tools/yard-shots.sh 1400 950
else
  RUN=power-network-browser.mjs VIEWS="$VIEWS" tools/yard-shots.sh 1400 950
fi
