#!/usr/bin/env bash
# Multiplayer in the real game: starts the local room server, then runs tools/mp-game-check.mjs in the headless
# browser through tools/yard-shots.sh. One picture goes to OUT (default data/work/mp/mp-game.png).
#   WEB_PORT=5261 CDP_PORT=9461 MP_PORT=5262 tools/check-mp-game.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${MP_PORT:-5262}"
source "$ROOT/tools/wrangler.sh"
mmm_select_wrangler || exit $?
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mmm-mp-game-XXXXXX")"
SERVER_PID=""
cleanup() { [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT
(cd "$ROOT/server" && WRANGLER_SEND_METRICS=false exec "$WRANGLER" dev --local --ip 127.0.0.1 --port "$PORT" --persist-to "$WORK/state") > "$WORK/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 120); do
  grep -q "Ready on" "$WORK/server.log" && break
  perl -e 'select(undef, undef, undef, 0.25)'
done
grep -q "Ready on" "$WORK/server.log" || { cat "$WORK/server.log" >&2; echo "The room server did not start." >&2; exit 2; }
export OUT="${OUT:-$ROOT/data/work/mp}"
mkdir -p "$OUT"
MP_SERVER="ws://127.0.0.1:$PORT" RUN="${RUN:-mp-game-check.mjs}" VIEWS="x|x=1" "$ROOT/tools/yard-shots.sh" 1280 720
