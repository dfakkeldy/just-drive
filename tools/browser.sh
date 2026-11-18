# macOS proves the listener PID; Linux permits a listener only in its recorded owned group/session.
# Linux uses a native Chromium binary (CHROMIUM_BIN or PATH), never the Flatpak: Flatpak Chromium starts its
# children through the flatpak-portal D-Bus service, outside the owned group, so ownership could not be proved.
# MMM_BROWSER_GL=nvidia-egl (Linux): the NVIDIA GPU through ANGLE/EGL on the session's X display (proved on Linux).
# Every start reads the WebGL renderer once (tools/gpu-proof.mjs, OUT/browser-logs-*/gpu.json) and exits 2
# "no hardware GPU" on a software renderer unless the row is marked software ok (MMM_SOFTWARE_OK=1).
# Python 3.11+ is required; scripts select python3 from PATH. Logs stream live and remain in OUT/browser-logs-*.
# MMM_BROWSER_SLOTS=2; MMM_BROWSER_WAIT=900 seconds; N=0 disables slots; a FIFO queue reports holders each minute.
# When the wait runs out with every slot still held, the start FAILS by default: browser-slots prints "ERROR wait cap ...
# not starting a browser" and the check exits 2 (busy), so the machine never runs more browsers than MMM_BROWSER_SLOTS.
#   MMM_BROWSER_OVERFLOW=fail  (default; empty means the same)  fail at the wait cap.
#   MMM_BROWSER_OVERFLOW=run   old behaviour: print a WARNING and start WITHOUT a slot, past the limit. Only for a
#                              one-off run where an extra browser is acceptable and a hang is not.
#   Any other value is refused (exit 2). With MMM_BROWSER_WAIT=0, a start that finds no free slot fails at once.
# Recovery: python3 tools/browser_process.py stop <lease>; python3 tools/browser-slots.py reap <lease>
# Ports: 5600/9600 + cksum(checkout path)%380 unless explicit; exit 0 pass, 1 failure, 2 busy/invalid startup.
BROWSER_TOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BROWSER_SLOT_HELPER="$BROWSER_TOOLS/browser-slots.py"
BROWSER_PROCESS_HELPER="$BROWSER_TOOLS/browser_process.py"
BROWSER_PID=''; SERVER=''; PROFILE=''; OWN_BROWSER_WS=''; BROWSER_SLOT_LEASE=''; BROWSER_SLOT_KEEPER_PID=''; BROWSER_CHECK_SEQ=0

browser_require_python() {
  python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3,11) else 2)' || {
    echo "browser-check: Python 3.11+ required; scripts use python3 from PATH ($(command -v python3))" >&2; return 2;
  }
}
browser_typecheck() {
  if [[ "${MMM_CHECK_STANDIN:-0}" == 1 || "${MMM_SKIP_TYPECHECK:-0}" == 1 ]]; then
    echo "browser-check: skipping TypeScript (stand-in or runner already checked it)"
  else npx tsc --noEmit; fi
}
browser_default_ports() {
  local slot
  slot=$(( $(printf '%s' "$ROOT" | cksum | cut -d' ' -f1) % 380 ))
  WEB="${WEB_PORT:-$((5600 + slot))}"; CDP="${CDP_PORT:-$((9600 + slot))}"
  export WEB_PORT="$WEB" CDP_PORT="$CDP" MMM_CHECK_ROOT="$ROOT"
}
# Every starter calls this before build/startup. Locks last through the complete run.
browser_ports() {
  browser_require_python || return $?
  browser_default_ports
  if [[ "${MMM_CHECK_PORTS_LOCKED:-}" != 1 ]]; then
    exec python3 "$BROWSER_TOOLS/check-ports.py" "$WEB" "$CDP" /bin/bash "$0" "$@"
  fi
  unset MMM_CHECK_PORTS_LOCKED
}
acquire_browser_slot() {
  [[ -z "$BROWSER_SLOT_LEASE" ]] || return 0
  BROWSER_SLOT_LEASE="$(mktemp -d "${TMPDIR:-/tmp}/mmm-browser-lease-XXXXXX")"
  python3 "$BROWSER_SLOT_HELPER" hold "$$" "${ROOT:-$PWD}" "$BROWSER_SLOT_LEASE" "$PROFILE" &
  BROWSER_SLOT_KEEPER_PID=$!
  local attempt=0
  while [[ ! -f "$BROWSER_SLOT_LEASE/ready.json" ]]; do
    if ! kill -0 "$BROWSER_SLOT_KEEPER_PID" 2>/dev/null; then
      local result=0; wait "$BROWSER_SLOT_KEEPER_PID" || result=$?
      [[ "$result" != 0 ]] || result=2
      return "$result"
    fi
    # Waiting itself is bounded by MMM_BROWSER_WAIT in the keeper.
    sleep .1
  done
}
release_browser_slot() {
  [[ -n "$BROWSER_SLOT_LEASE" ]] || return 0
  python3 "$BROWSER_SLOT_HELPER" release "$BROWSER_SLOT_LEASE" || return 1
  if [[ -d "$BROWSER_SLOT_LEASE" ]]; then
    python3 - "$BROWSER_SLOT_LEASE" <<'PY'
import pathlib, shutil, sys
path = pathlib.Path(sys.argv[1])
if not path.name.startswith('mmm-browser-lease-'): sys.exit('browser.sh: not removing unrecognised path ' + str(path))
shutil.rmtree(path, ignore_errors=True)
PY
  fi
  BROWSER_SLOT_LEASE=''; BROWSER_SLOT_KEEPER_PID=''
}
start_owned() {
  local role="$1" log="$2"; shift 2
  if [[ -n "${CHECK_STDERR:-}" ]]; then
    python3 "$BROWSER_PROCESS_HELPER" watch "$BROWSER_SLOT_LEASE" "$role" "$@" <&0 > >(tee "$log") 2> >(tee "$CHECK_STDERR" >&2) &
  else
    python3 "$BROWSER_PROCESS_HELPER" watch "$BROWSER_SLOT_LEASE" "$role" "$@" <&0 >"$log" 2>&1 &
  fi
  local watchdog=$! attempt
  OWNED_WATCHDOG_PID="$watchdog"
  for attempt in $(seq 1 100); do
    if [[ -f "$BROWSER_SLOT_LEASE/resource-$role.pid" ]]; then
      IFS= read -r OWNED_PID < "$BROWSER_SLOT_LEASE/resource-$role.pid" || true
      return 0
    fi
    kill -0 "$watchdog" 2>/dev/null || { cat "$log" >&2; return 1; }
    sleep .1
  done
  echo "browser-check: $role watchdog did not register its process" >&2; return 1
}
# Wait on a Bash child with an interruptible builtin, while its independent
# watchdog also contains any check-owned HTTP servers and other descendants.
run_check() {
  BROWSER_CHECK_SEQ=$((BROWSER_CHECK_SEQ + 1))
  local role="check-$BROWSER_CHECK_SEQ" result=0 log="$BROWSER_LOG_DIR/check-$BROWSER_CHECK_SEQ.log" err="$BROWSER_LOG_DIR/check-$BROWSER_CHECK_SEQ.err"
  MMM_CHECK_NAME="${0##*/}" CHECK_STDERR="$err" start_owned "$role" "$log" "$@" || return $?
  wait "$OWNED_WATCHDOG_PID" || result=$?
  return "$result"
}
stop_browser() {
  [[ -n "$BROWSER_SLOT_LEASE" ]] || return 0
  python3 "$BROWSER_PROCESS_HELPER" stop "$BROWSER_SLOT_LEASE" || return 1
  release_browser_slot
}
finish_check() {
  local result="$1"
  trap - EXIT INT TERM
  # Identity-safe watchdog cleanup waits for both server and browser, including descendants.
  if stop_browser; then
    if [[ -n "$PROFILE" ]]; then
      python3 - "$PROFILE" <<'PY'
import pathlib, shutil, sys
path = pathlib.Path(sys.argv[1])
if not path.name.startswith('mmm-shots-'): sys.exit('browser.sh: not removing unrecognised path ' + str(path))
shutil.rmtree(path, ignore_errors=True)
PY
    fi
  else
    echo 'browser-check: cleanup incomplete; live-resource lease kept for recovery' >&2
  fi
  exit "$result"
}
# NVIDIA through ANGLE/EGL needs the session's existing X display and the NVIDIA EGL vendor file.
# DISPLAY and XAUTHORITY change with each login: read them now (environment first, then the user
# service manager), never from a stored value. Sets BROWSER_GL_ENV; exit 2 when anything is missing.
browser_nvidia_egl_env() {
  local display="${DISPLAY:-}" xauth="${XAUTHORITY:-}" line
  local vendor="${MMM_NVIDIA_EGL_VENDOR:-/usr/share/glvnd/egl_vendor.d/10_nvidia.json}"
  if [[ -z "$display" || -z "$xauth" ]] && command -v systemctl >/dev/null 2>&1; then
    while IFS= read -r line; do
      case "$line" in
        DISPLAY=*) [[ -n "$display" ]] || display="${line#DISPLAY=}" ;;
        XAUTHORITY=*) [[ -n "$xauth" ]] || xauth="${line#XAUTHORITY=}" ;;
      esac
    done < <(systemctl --user show-environment 2>/dev/null)
  fi
  if [[ -z "$display" ]]; then
    echo "browser.sh: MMM_BROWSER_GL=nvidia-egl needs an X display; DISPLAY is not set here or in the user session (is anyone logged in?)" >&2; return 2
  fi
  if [[ -n "$xauth" && ! -r "$xauth" ]]; then echo "browser.sh: XAUTHORITY $xauth cannot be read" >&2; return 2; fi
  if [[ ! -r "$vendor" ]]; then echo "browser.sh: NVIDIA EGL vendor file $vendor is missing (set MMM_NVIDIA_EGL_VENDOR)" >&2; return 2; fi
  BROWSER_GL_ENV=(DISPLAY="$display" __EGL_VENDOR_LIBRARY_FILENAMES="$vendor" __NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia)
  if [[ -n "$xauth" ]]; then BROWSER_GL_ENV+=(XAUTHORITY="$xauth"); fi
}
start_browser() {
  local profile="$1" port="$2" w="$3" h="$4" log="${5:-${BROWSER_LOG:-${BROWSER_LOG_DIR:-$profile}/browser.log}}"
  local -a cmd gl
  local mac=0 software
  [[ "$(uname -s)" == Darwin ]] && mac=1
  if [[ -n "${CHROMIUM_BIN:-}" ]]; then
    cmd=("$CHROMIUM_BIN")
  elif [[ $mac == 1 ]]; then
    # Measured on Dan's Mac on 11 Nov 2026, with his everyday Google Chrome open:
    #   Microsoft Edge 157 and Brave 157   draw the game with the GPU (Metal) and stay up;
    #   Google Chrome 157                  gets a stop signal about 30 s after it starts, so a longer run loses it;
    #   Chrome for Testing 153 (the copy Playwright keeps)   loses its graphics process at start; the page never loads.
    # So the first two come first, and the Google builds are tried last.
    local app found=''
    for app in "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
               "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
               "/Applications/Chromium.app/Contents/MacOS/Chromium" \
               "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
               "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
      if [[ -x "$app" ]]; then found="$app"; break; fi
    done
    if [[ -z "$found" ]]; then
      echo "browser.sh: no Chromium-family browser found in /Applications; set CHROMIUM_BIN" >&2; return 2
    fi
    if [[ "$found" == *"/Google Chrome"* ]]; then
      echo "browser.sh: only a Google build was found; it may stop early or draw nothing (see the note in tools/browser.sh)" >&2
    fi
    cmd=("$found")
  else
    local bin found=''
    for bin in chromium chromium-browser google-chrome google-chrome-stable; do
      if command -v "$bin" >/dev/null 2>&1; then found="$bin"; break; fi
    done
    if [[ -z "$found" ]]; then echo "browser.sh: no Chromium found; set CHROMIUM_BIN" >&2; return 2; fi
    cmd=("$found")
  fi
  # Linux without a named GPU mode keeps the old software default; the GPU proof then refuses unmarked rows.
  if [[ -n "${SOFTWARE_GL:-}" ]]; then software="$SOFTWARE_GL"
  elif [[ $mac == 1 || -n "${MMM_BROWSER_GL:-}" ]]; then software=0
  else software=1; fi
  if [[ "$software" == 1 ]]; then
    gl=(--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist)
  elif [[ $mac == 1 ]]; then
    gl=(--use-angle=metal --ignore-gpu-blocklist)
  elif [[ "${MMM_BROWSER_GL:-}" == nvidia-egl ]]; then
    browser_nvidia_egl_env || return 2
    # env execs the browser, so the watchdog's child PID stays the browser itself.
    cmd=(env "${BROWSER_GL_ENV[@]}" "${cmd[@]}")
    gl=(--enable-gpu --ignore-gpu-blocklist --use-gl=angle --use-angle=gl-egl)
  elif [[ -n "${MMM_BROWSER_GL:-}" ]]; then
    echo "browser.sh: unknown MMM_BROWSER_GL=$MMM_BROWSER_GL (known: nvidia-egl)" >&2; return 2
  else
    gl=(--ignore-gpu-blocklist)
  fi
  if [[ "${FREE_RUN:-0}" == 1 ]]; then gl+=(--disable-gpu-vsync --disable-frame-rate-limit); fi
  # Chromium makes its SingletonSocket in TMPDIR; a Unix socket path holds at most 108 bytes on Linux, and
  # check-all's scratch TMPDIR is longer (Chrome aborts: "Socket path too long"). The browser alone gets /tmp.
  if [[ $mac == 0 ]]; then cmd=(env TMPDIR="${MMM_BROWSER_TMPDIR:-/tmp}" "${cmd[@]}"); fi
  if [[ "${MMM_BROWSER_DRY_RUN:-0}" == 1 ]]; then
    printf 'browser flags:'; printf ' %q' "${cmd[@]}" "${gl[@]}"; printf '\n'; return 0
  fi
  acquire_browser_slot || return $?
  start_owned browser "$log" "${cmd[@]}" --headless=new --remote-debugging-port="$port" --user-data-dir="$profile" --no-first-run \
    "${gl[@]}" --disable-extensions --disable-background-networking --disable-default-apps \
    --window-size="$w,$h" --hide-scrollbars about:blank || return 2
  BROWSER_PID="$OWNED_PID"; BROWSER_WATCHDOG_PID="$OWNED_WATCHDOG_PID"
}
# One shared startup: dev game, built car preview, frozen-watch styles, or browser-only PWA.
start_check() {
  local w="$1" h="$2" mode="${3:-dev}" attempt ready=0
  trap 'finish_check $?' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  mkdir -p "${OUT:-$PWD}"
  BROWSER_LOG_DIR="$(mktemp -d "${OUT:-$PWD}/browser-logs-XXXXXX")"
  echo "browser-check: logs $BROWSER_LOG_DIR"
  PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/mmm-shots-XXXXXX")"
  acquire_browser_slot
  if [[ "$mode" != none ]]; then
    if [[ "${MMM_CHECK_STANDIN:-0}" == 1 ]]; then
      start_owned server "$BROWSER_LOG_DIR/vite.log" python3 "$BROWSER_TOOLS/check-browser-standin.py" server "$WEB" "$ROOT"
    elif [[ "$mode" == styles ]]; then
      start_owned server "$BROWSER_LOG_DIR/vite.log" node --input-type=module -e 'import { createServer } from "vite"; const server=await createServer({server:{host:"127.0.0.1",port:Number(process.env.WEB_PORT),strictPort:true,hmr:false,watch:null}}); await server.listen();'
    elif [[ "$mode" == preview ]]; then
      start_owned server "$BROWSER_LOG_DIR/vite.log" node "$ROOT/web/node_modules/vite/bin/vite.js" preview --strictPort --host 127.0.0.1 --port "$WEB"
    else
      start_owned server "$BROWSER_LOG_DIR/vite.log" node "$ROOT/web/node_modules/vite/bin/vite.js" --strictPort --host 127.0.0.1 --port "$WEB"
    fi
    SERVER="$OWNED_PID"
  fi
  start_browser "$PROFILE" "$CDP" "$w" "$h" "$BROWSER_LOG_DIR/browser.log" || return 2
  for attempt in $(seq 1 80); do
    # A browser that already exited (a missing binary behind the Linux env wrapper) cannot become ready: stop waiting.
    kill -0 "${BROWSER_WATCHDOG_PID:-}" 2>/dev/null || break
    OWN_BROWSER_WS="$(sed -n 's/^DevTools listening on \(ws:\/\/.*\)/\1/p' "$BROWSER_LOG_DIR/browser.log" | head -1 | tr -d '\r')"
    if [[ "$OWN_BROWSER_WS" == "ws://127.0.0.1:$CDP/devtools/browser/"* ]] &&
       python3 "$BROWSER_TOOLS/check-ports.py" --owned "$BROWSER_SLOT_LEASE/resource-browser.json" "$CDP" &&
       { [[ "$mode" == none ]] || { python3 "$BROWSER_TOOLS/check-ports.py" --owned "$BROWSER_SLOT_LEASE/resource-server.json" "$WEB" && curl --max-time 1 -fsS -o /dev/null "http://127.0.0.1:$WEB/" 2>/dev/null; }; }; then
      ready=1; break
    fi
    sleep .25
  done
  if [[ "$ready" != 1 ]]; then
    echo 'browser-check: could not verify owned server/browser listeners' >&2
    cat "$BROWSER_LOG_DIR/"*.log >&2; return 2
  fi
  echo "browser-check: owned WEB=$WEB pid=$SERVER CDP=$CDP pid=$BROWSER_PID"
  # Stand-in browsers speak no WebGL; every real start must prove its renderer.
  if [[ "${MMM_CHECK_STANDIN:-0}" != 1 ]]; then
    node "$BROWSER_TOOLS/gpu-proof.mjs" "$CDP" "$BROWSER_LOG_DIR/gpu.json" || return 2
    if [[ ! -s "$BROWSER_LOG_DIR/gpu.json" ]]; then echo 'browser-check: the GPU proof wrote no result; refusing the start' >&2; return 2; fi
  fi
}
mem_report() {
  if command -v free >/dev/null 2>&1; then free -h
  elif command -v memory_pressure >/dev/null 2>&1; then memory_pressure 2>/dev/null | tail -1; fi
  return 0
}
