#!/usr/bin/env bash
# The multiplayer check: starts the room server on this machine (wrangler dev, nothing leaves the computer),
# runs simulated players against it (tools/mp-check.mjs), and stops the server.
#   MP_PORT=5262 tools/check-mp.sh
#   tools/check-mp.sh --mutations   proves the motion part judges the game, not the machine: real stalls of this
#                                   process and of the room's runtime pass; a room or a game that is really late fails.
# WRANGLER wins; otherwise choose the highest installed cache version, with PATH as a last resort.
# It never installs one, never logs in and never deploys.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${MP_PORT:-5262}"
source "$ROOT/tools/wrangler.sh"
mmm_select_wrangler || exit $?
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mmm-mp-check-XXXXXX")"
MUTATIONS=0; [[ "${1:-}" == --mutations ]] && { MUTATIONS=1; shift; }
SERVERS=""; STOPPER=""
tree() { local p; for p in $(pgrep -P "$1" || true); do echo "$p"; tree "$p"; done; }
# Under set -e a failing command in the EXIT trap would end it early: every step here may fail and go on.
cleanup() {
  [[ -z "$STOPPER" ]] || kill "$STOPPER" 2>/dev/null || true
  for pid in $SERVERS; do
    # A room server stopped by --mutations goes on before it is shut down.
    for p in $(tree "$pid"); do kill -CONT "$p" 2>/dev/null || true; done
    kill "$pid" 2>/dev/null || true
  done
  rm -rf "$WORK" || true
}
trap cleanup EXIT
node "$ROOT/tools/mp-liveness-check.mjs"
cd "$ROOT/server"
# Strict TypeScript for the server, against the runtime's own types (written to the scratch folder, not the repository).
WRANGLER_SEND_METRICS=false "$WRANGLER" types "$WORK/worker-configuration.d.ts" > "$WORK/types.log" 2>&1 || { cat "$WORK/types.log" >&2; exit 2; }
cat > "$WORK/tsconfig.json" <<JSON
{ "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler", "strict": true, "noUnusedLocals": true,
    "skipLibCheck": true, "lib": ["ES2022"], "noEmit": true, "types": [] },
  "files": ["$WORK/worker-configuration.d.ts", "$ROOT/server/src/index.ts"] }
JSON
"$ROOT/web/node_modules/.bin/tsc" -p "$WORK/tsconfig.json"
# The server's state folder is kept out of the repository folder.
serve() {  # serve <server folder> <port> <log>: starts a room server; its pid is in SERVED
  # GAME_ROUND_S: a 20-second room-game round, for this check only (the live room plays 3 minutes).
  (cd "$1" && exec env WRANGLER_SEND_METRICS=false "$WRANGLER" dev --local --ip 127.0.0.1 --port "$2" --persist-to "$WORK/state-$2" --var GAME_ROUND_S:20) > "$3" 2>&1 &
  SERVED=$!; SERVERS="$SERVERS $SERVED"
  for _ in $(seq 1 120); do
    grep -q "Ready on" "$3" && return 0
    kill -0 "$SERVED" 2>/dev/null || { cat "$3" >&2; exit 2; }
    perl -e 'select(undef, undef, undef, 0.25)'
  done
  cat "$3" >&2; echo "The room server did not start." >&2; exit 2
}
serve "$ROOT/server" "$PORT" "$WORK/server.log"; SERVER_PID=$SERVED
cd "$ROOT/web"
node_modules/.bin/esbuild "$ROOT/tools/mp-check.mjs" --bundle --platform=node --format=esm --log-level=warning --outfile="$WORK/check.mjs"
if [[ $MUTATIONS == 1 ]]; then
  failed=0
  # mutant <name> <pass|fail> <pattern> <command...>: the command must end as wanted, with the pattern in its output.
  mutant() {
    local name=$1 want=$2 pattern=$3 code=0; shift 3
    "$@" > "$WORK/mutant-$name.log" 2>&1 || code=$?
    if [[ $want == pass && $code == 0 ]] && grep -qE -e "$pattern" "$WORK/mutant-$name.log"; then
      echo "PASS $name: passes ($(grep -m1 -oE -e "$pattern" "$WORK/mutant-$name.log"))"
    elif [[ $want == fail && $code != 0 ]] && grep -qE -e "$pattern" "$WORK/mutant-$name.log"; then
      echo "PASS $name: fails ($(grep -m1 -e AssertionError "$WORK/mutant-$name.log" | sed 's/^AssertionError \[ERR_ASSERTION\]: //' | cut -c1-220))"
    else
      echo "FAIL $name: exit $code, wanted to $want with /$pattern/" >&2; tail -25 "$WORK/mutant-$name.log" >&2; failed=1
    fi
  }
  # The room's runtime stops (SIGSTOP) for a while, as on a machine with too few processors, then goes on.
  stop_room() {
    local p stopped=""
    for p in $(tree "$SERVER_PID"); do ps -o comm= -p "$p" | grep -q workerd && stopped="$stopped $p"; done
    [[ -n "$stopped" ]] || { echo "no workerd process under the room server" >&2; exit 2; }
    kill -STOP $stopped 2>/dev/null || true; perl -e "select(undef, undef, undef, $1)"; kill -CONT $stopped 2>/dev/null || true
    echo "$stopped" >> "$WORK/stops"
  }
  check() { MP_SERVER="ws://127.0.0.1:${PORT_USED:-$PORT}" node "$@" --motion-only; }
  # 1. A busy machine: this process stalls three times for 0.7 s, the room's runtime three times. The check passes,
  #    says it measured both kinds of stall, and that it judged frames after them.
  (sleep 8.5; stop_room 0.7; sleep 3.3; stop_room 0.7; sleep 6.3; stop_room 0.7) & STOPPER=$!
  MP_STALLS=6500:700,10500:700,15000:700 mutant stalls-of-the-machine pass '([3-9]|[1-9][0-9]+) of this process, ([3-9]|[1-9][0-9]+) of the room.s runtime alone, [0-9]+ of the room.s code alone; [1-9][0-9]* judged frames came after a stall' \
    check --import "$ROOT/tools/mp-stalls.mjs" "$WORK/check.mjs"
  wait "$STOPPER" 2>/dev/null || true; STOPPER=""
  [[ $(wc -l < "$WORK/stops" 2>/dev/null || echo 0) -eq 3 ]] || { echo "FAIL stalls-of-the-machine: the room's runtime was not stopped three times" >&2; failed=1; }
  # 2. A machine that never stops stalling: no frames to judge fairly, so the check fails rather than excuse them all.
  MP_STALLS=every:600:250 mutant always-stalling fail 'frames free of stalls' check --import "$ROOT/tools/mp-stalls.mjs" "$WORK/check.mjs"
  # A copy of the room and the game to change.
  M="$WORK/mutant"; mkdir -p "$M/server" "$M/web" "$M/tools"
  cp -R "$ROOT/server/src" "$M/server/src"; cp "$ROOT/server/wrangler.jsonc" "$M/server/"; cp -R "$ROOT/web/src" "$M/web/src"
  ln -s "$ROOT/web/node_modules" "$M/web/node_modules"; cp "$ROOT/tools/mp-check.mjs" "$ROOT/tools/mp-race-check.mjs" "$ROOT/tools/mp-tag-check.mjs" "$M/tools/"
  # 3. A room that holds every car's report back for 0.6 s before it passes it on. Its runtime answers pings at
  #    once, so nothing is excused: the cars are drawn too far in the past.
  perl -0pi -e 's/  private toOthers\(from: WebSocket, data: string \| ArrayBuffer\): void \{\n/  private toOthers(from: WebSocket, data: string | ArrayBuffer): void {\n    if (data instanceof ArrayBuffer) { setTimeout(() => this.passOn(from, data), 600); return; }\n    this.passOn(from, data);\n  }\n  private passOn(from: WebSocket, data: string | ArrayBuffer): void {\n/' "$M/server/src/index.ts"
  grep -q 'setTimeout(() => this.passOn' "$M/server/src/index.ts" || { echo "the late-room mutant did not apply" >&2; exit 2; }
  serve "$M/server" "$((PORT + 1))" "$WORK/mutant-server.log"
  PORT_USED=$((PORT + 1)) mutant late-room fail 'ms in the past' check "$WORK/check.mjs"
  kill "$SERVED" 2>/dev/null || true; SERVERS=" $SERVERS "; SERVERS="${SERVERS/ $SERVED / }"
  # 4. A game that draws the others half a second further in the past than it does.
  perl -pi -e 's/^const DELAY_MIN = SEND_MS \* 1\.25, DELAY_MAX = 900;/const DELAY_MIN = SEND_MS * 1.25 + 500, DELAY_MAX = 1400;/' "$M/web/src/mp/net.ts"
  grep -q 'SEND_MS \* 1.25 + 500' "$M/web/src/mp/net.ts" || { echo "the late-game mutant did not apply" >&2; exit 2; }
  node_modules/.bin/esbuild "$M/tools/mp-check.mjs" --bundle --platform=node --format=esm --log-level=warning --outfile="$WORK/late-game.mjs"
  mutant late-game fail 'ms in the past' check "$WORK/late-game.mjs"
  # 5. A game that adds half a second to the delay it works out, and stalls this process for 0.3 s once, while that
  #    delay is still rising: the allowance for the delay a stall adds is used, and must not cover it.
  cp "$ROOT/web/src/mp/net.ts" "$M/web/src/mp/net.ts"
  perl -pi -e 's/^(\s*const want = clamp\(DELAY_MIN \+ 2 \* this\.jitter, DELAY_MIN, DELAY_MAX\));/$1 + 500;/;
    s/^(\s*this\.delay \+= clamp\(want - this\.delay, -50 \* dt, 250 \* dt\);)/$1 if (this.delay > 400 \&\& !(globalThis as any).stalled) { (globalThis as any).stalled = 1; const end = performance.now() + 300; while (performance.now() < end); }/' "$M/web/src/mp/net.ts"
  grep -q 'DELAY_MAX) + 500;' "$M/web/src/mp/net.ts" && grep -q 'stalled = 1' "$M/web/src/mp/net.ts" || { echo "the late-after-a-stall mutant did not apply" >&2; exit 2; }
  node_modules/.bin/esbuild "$M/tools/mp-check.mjs" --bundle --platform=node --format=esm --log-level=warning --outfile="$WORK/late-after-stall.mjs"
  mutant late-after-a-stall fail '[1-9][0-9]* frames had a delay allowance' check "$WORK/late-after-stall.mjs"
  [[ $failed == 0 ]] || exit 1
  echo "PASS mp mutations: the motion part passes on a stalling machine and fails a late room, a late game (also after a stall) and a machine that never stops stalling"
  exit 0
fi
node_modules/.bin/esbuild "$ROOT/tools/mp-social-check.mjs" --bundle --platform=node --format=esm --log-level=warning --outfile="$WORK/social.mjs"
node "$WORK/social.mjs"
MP_SERVER="ws://127.0.0.1:$PORT" node "$WORK/check.mjs" "$@"
MP_SERVER="ws://127.0.0.1:$PORT" node "$ROOT/tools/mp-race-compat.mjs"
# The published script carries multiplayer by default; VITE_MP=0 builds one with none of it (the way back).
npx vite build -c vite.artifact.config.ts --outDir "$WORK/with" --logLevel error
VITE_MP=0 npx vite build -c vite.artifact.config.ts --outDir "$WORK/plain" --logLevel error
if grep -q -e mpChip -e '/mp/v' "$WORK/plain/app.js"; then echo "FAIL the VITE_MP=0 build carries multiplayer code" >&2; exit 1; fi
grep -q mpChip "$WORK/with/app.js" || { echo "FAIL the published build has no multiplayer code" >&2; exit 1; }
echo "PASS the published build: multiplayer is in it ($(wc -c < "$WORK/with/app.js" | tr -d ' ') bytes); VITE_MP=0 leaves it out ($(wc -c < "$WORK/plain/app.js" | tr -d ' ') bytes)"
