#!/usr/bin/env bash
# Native GPU fallback capture for the read-only ground rehearsal server.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports "$@"
OUT="${OUT:-$ROOT/data/work/ground-classes-pictures}"
GROUND_VIEWS="${GROUND_VIEWS:-$ROOT/data/work/threads/ground-classes/phase2/views.json}"
GROUND_WORK_ROOT="${GROUND_WORK_ROOT:-$ROOT/data/work/bakes/ground-classes}"
unset SOFTWARE_GL
cd "$ROOT/web"
browser_typecheck
start_check 1280 720 none
start_owned server "$BROWSER_LOG_DIR/vite.log" node "$ROOT/tools/ground-preview.mjs" "$GROUND_WORK_ROOT" "$WEB"
SERVER="$OWNED_PID"
for attempt in $(seq 1 60); do
  if curl --max-time 1 -fsS -o /dev/null "http://127.0.0.1:$WEB/"; then break; fi
  sleep .25
done
GROUND_URL="http://127.0.0.1:$WEB" CDP_PORT="$CDP" run_check node "$ROOT/tools/ground-capture.mjs" "$OUT" "$GROUND_VIEWS"
