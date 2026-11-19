#!/usr/bin/env bash
# Today's board on the real Worker: starts the server on this machine (wrangler dev, nothing leaves the computer),
# posts and reads (tools/board-worker-check.mjs), restarts it on the same storage, then runs it with BOARD:off and with
# a two-second alarm. It never installs Wrangler, never logs in and never deploys.
#   BOARD_PORT=5392 tools/check-board.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${BOARD_PORT:-5392}"
source "$ROOT/tools/wrangler.sh"
mmm_select_wrangler || exit $?
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mmm-board-check-XXXXXX")"
SERVED=""
stop() { [[ -z "$SERVED" ]] || { kill "$SERVED" 2>/dev/null || true; wait "$SERVED" 2>/dev/null || true; SERVED=""; }; }
cleanup() { stop; rm -rf "$WORK" || true; }
trap cleanup EXIT
cd "$ROOT/server"
# Strict TypeScript for the server, against the runtime's own types (written to the scratch folder, not the repository).
WRANGLER_SEND_METRICS=false "$WRANGLER" types "$WORK/worker-configuration.d.ts" > "$WORK/types.log" 2>&1 || { cat "$WORK/types.log" >&2; exit 2; }
cat > "$WORK/tsconfig.json" <<JSON
{ "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler", "strict": true, "noUnusedLocals": true,
    "skipLibCheck": true, "lib": ["ES2022"], "noEmit": true, "types": [] },
  "files": ["$WORK/worker-configuration.d.ts", "$ROOT/server/src/index.ts"] }
JSON
"$ROOT/web/node_modules/.bin/tsc" -p "$WORK/tsconfig.json"
# serve <state folder> <log> [--var K:V ...]: starts the board server; its pid is in SERVED.
serve() {
  local state=$1 log=$2; shift 2
  (exec env WRANGLER_SEND_METRICS=false "$WRANGLER" dev --local --ip 127.0.0.1 --port "$PORT" --persist-to "$state" "$@") > "$log" 2>&1 &
  SERVED=$!
  for _ in $(seq 1 120); do
    grep -q "Ready on" "$log" && return 0
    kill -0 "$SERVED" 2>/dev/null || { cat "$log" >&2; exit 2; }
    perl -e 'select(undef, undef, undef, 0.25)'
  done
  cat "$log" >&2; echo "The board server did not start." >&2; exit 2
}
"$ROOT/web/node_modules/.bin/esbuild" "$ROOT/tools/board-worker-check.mjs" --bundle --platform=node --format=esm --log-level=warning --outfile="$WORK/check.mjs"
check() { (cd "$ROOT/web" && BOARD_SERVER="http://127.0.0.1:$PORT" PHASE=$1 node "$WORK/check.mjs"); }
serve "$WORK/state" "$WORK/server.log"
check main | tee "$WORK/main.out" | grep -v '^STATE '
STATE="$(sed -n 's/^STATE //p' "$WORK/main.out")"
stop
serve "$WORK/state" "$WORK/server-off.log" --var BOARD:off
check off
stop
serve "$WORK/state" "$WORK/server-again.log"
STATE="$STATE" check restart
stop
serve "$WORK/state-expiry" "$WORK/server-expiry.log" --var BOARD_TEST_EXPIRY_MS:2000
check expiry
stop
if grep -h -E "Uncaught|Error:" "$WORK"/server*.log | grep -v -E "^\s*$" ; then echo "FAIL the board server logged errors" >&2; exit 1; fi
echo "PASS Today's board on a local Worker: posts, reads, refusals, top 100 in SQLite across a restart, off switch, 60-day alarm"
