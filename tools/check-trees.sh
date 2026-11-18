#!/usr/bin/env bash
# Same-page fixed/moving camera pixels and runtime bound mutations; hardware GPU only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# Match check-budget.sh: deterministic per-checkout defaults, with explicit overrides.
PORT_SLOT=$(( $(printf '%s' "$ROOT" | cksum | cut -d' ' -f1) % 380 ))
export WEB_PORT="${WEB_PORT:-$((5600 + PORT_SLOT))}" CDP_PORT="${CDP_PORT:-$((9600 + PORT_SLOT))}"
[[ -z "${SOFTWARE_GL:-}" ]] || { echo 'Unset SOFTWARE_GL: this check requires the hardware GPU' >&2; exit 2; }
# Shared all-address probe; yard-shots owns the FIFO slot and port locks.
python3 "$ROOT/tools/check-ports.py" --probe "$WEB_PORT" "$CDP_PORT"
SCRATCH=''
if [[ -z "${OUT:-}" ]]; then SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/mmm-tree-culling-XXXXXX")"; export OUT="$SCRATCH"; fi
cleanup() { if [[ -n "$SCRATCH" ]]; then rm -rf -- "$SCRATCH"; fi; }
trap cleanup EXIT
START=$SECONDS
set +e
RUN=tree-culling-check.mjs "$ROOT/tools/yard-shots.sh" 1400 950
RESULT=$?
set -e
echo "tree-culling: browser job $((SECONDS - START))s, exit $RESULT"
exit "$RESULT"
