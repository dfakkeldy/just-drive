#!/usr/bin/env bash
# Deterministic whole-frame counts; no frame-rate measurement or software GPU.
# --update lowers only; --raise explicitly accepts increases. Both measure five fresh runs.
# --phone is the pre-PR subset. --scene ID / --mode ID are explicit, validated subsets.
# --mutations proves both the failure and savings messages in the running page.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# Each checkout gets its own default ports (from its path), so that two threads never meet on one pair.
PORT_SLOT=$(( $(printf '%s' "$ROOT" | cksum | cut -d' ' -f1) % 380 ))
export WEB_PORT="${WEB_PORT:-$((5600 + PORT_SLOT))}" CDP_PORT="${CDP_PORT:-$((9600 + PORT_SLOT))}"
export FRAME_BUDGET_ARGS="$(node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' -- "$@")"
node --input-type=module - "$FRAME_BUDGET_ARGS" <<'JS'
import {parseArgs} from './tools/frame-budget-policy.mjs';
parseArgs(JSON.parse(process.argv[2]));
JS
[[ -z "${SOFTWARE_GL:-}" ]] || { echo 'Unset SOFTWARE_GL: this check requires the hardware GPU' >&2; exit 2; }
# One all-address probe implementation; yard-shots holds its port locks through startup.
python3 "$ROOT/tools/check-ports.py" --probe "$WEB_PORT" "$CDP_PORT"
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/mmm-frame-budget-XXXXXX")"
# The shared start-up keeps its browser logs in OUT, so the scratch folder is not empty at exit.
trap 'rm -rf -- "$SCRATCH"' EXIT
START=$SECONDS
set +e
OUT="$SCRATCH" RUN=frame-budget-check.mjs "$ROOT/tools/yard-shots.sh" 1400 950
RESULT=$?
set -e
echo "frame-budget: browser job $((SECONDS - START))s, exit $RESULT"
exit "$RESULT"
