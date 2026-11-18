#!/usr/bin/env bash
# Named, reproducible evidence for all four live-bull frame-budget modes.
# --refresh-desktop records five repeats of the two changed desktop rows.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${HIGHLAND_BUDGET_OUT:-$ROOT/data/work/threads/highland-budget}"
mkdir -p "$OUT"
ARGS=(--scene animal-home)
NAME=measurements
if [[ "${1:-}" == --refresh-desktop ]]; then
  ARGS+=(--raise --mode desktop-mail --mode desktop-explore-truck)
  NAME=desktop-five-repeats
elif [[ $# != 0 ]]; then
  echo 'Usage: check-highland-budget.sh [--refresh-desktop]' >&2; exit 2
fi
{
  echo "Highland budget HEAD=$(git -C "$ROOT" rev-parse HEAD)"
  printf 'Command: tools/check-budget.sh'; printf ' %q' "${ARGS[@]}"; printf '\n'
  "$ROOT/tools/check-budget.sh" "${ARGS[@]}"
} 2>&1 | tee "$OUT/$NAME.log"
