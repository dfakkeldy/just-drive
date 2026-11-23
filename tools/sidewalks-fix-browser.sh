#!/usr/bin/env bash
# One hardware browser and owned source-only baseline worktrees. No baked/site writes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
export SIDEWALK_RUNTIME_PHASE="${SIDEWALK_RUNTIME_PHASE:-settle}"
browser_ports "$@"
OUT="${OUT:-$ROOT/data/work/threads/sidewalks/fix-pass1}"
# check-all removes its success scratch; keep requested pictures and raw proof in
# a separate named output that remote-check knows how to copy and remove.
if [[ ( "$SIDEWALK_RUNTIME_PHASE" == proof || "$SIDEWALK_RUNTIME_PHASE" == diagnostic ) && -n "${MMM_CHECK_OUT:-}" && "$OUT" == "$MMM_CHECK_OUT" ]];then
  mkdir -p "$ROOT/data/work/checks"
  OUT="$(mktemp -d "$ROOT/data/work/checks/checks-sidewalks-$SIDEWALK_RUNTIME_PHASE-XXXXXX")"
  echo "Evidence kept at $OUT"
fi
mkdir -p "$OUT"
FIXTURES=''; OWN_BASE=''; OWN_BEFORE=''
finish_sidewalks() {
  local result="$1";trap - EXIT INT TERM
  stop_browser || result=1
  if [[ -n "$OWN_BEFORE" && "${SIDEWALK_RUNTIME_PHASE:-loads}" != proof ]];then
    git -C "$OWN_BEFORE" restore -- web/src/sidewalks.ts || result=1
  fi
  for tree in "$OWN_BASE" "$OWN_BEFORE";do
    [[ -n "$tree" ]] || continue
    for link in web/node_modules data/baked data/audio data/work/areas;do [[ ! -L "$tree/$link" ]] || rm "$tree/$link";done
    git -C "$ROOT" worktree remove "$tree" || result=1
  done
  [[ -z "$FIXTURES" ]] || rmdir "$FIXTURES" || true
  finish_check "$result"
}
cd "$ROOT/web";browser_typecheck;start_check 1400 900
trap 'finish_sidewalks "$?"' EXIT
trap 'exit 130' INT TERM
fixture() {
  local tree="$1" ref="$2"
  git -C "$ROOT" worktree add --detach "$tree" "$ref"
  mkdir -p "$tree/data/work"
  for link in web/node_modules data/baked data/audio data/work/areas;do
    if [[ ! -d "$ROOT/$link" ]];then
      case "$link" in web/node_modules|data/baked) echo "missing required fixture input: $link" >&2;return 2;; esac
      continue
    fi
    local source;source="$(cd "$ROOT/$link" && pwd -P)";ln -s "$source" "$tree/$link"
  done
}
if [[ "$SIDEWALK_RUNTIME_PHASE" != settle ]];then
  if [[ -z "${SIDEWALK_BASE_ROOT:-}" || -z "${SIDEWALK_BEFORE_ROOT:-}" ]];then FIXTURES="$(mktemp -d "${TMPDIR:-/tmp}/mmm-sidewalk-baselines-XXXXXX")";fi
  if [[ -z "${SIDEWALK_BASE_ROOT:-}" ]];then OWN_BASE="$FIXTURES/base";fixture "$OWN_BASE" "${SIDEWALK_BASE_REF:-$(git -C "$ROOT" merge-base HEAD origin/main)}";SIDEWALK_BASE_ROOT="$OWN_BASE";fi
  if [[ "$SIDEWALK_RUNTIME_PHASE" != diagnostic && "$SIDEWALK_RUNTIME_PHASE" != frames && "$SIDEWALK_RUNTIME_PHASE" != cold && ( "$SIDEWALK_RUNTIME_PHASE" != proof || "${SIDEWALK_REVIEWED_BASELINE:-0}" == 1 ) && -z "${SIDEWALK_BEFORE_ROOT:-}" ]];then
    OWN_BEFORE="$FIXTURES/before"
    if [[ "${SIDEWALK_RUNTIME_PHASE:-all}" == proof ]];then
      fixture "$OWN_BEFORE" 2cd5725
      export SIDEWALK_MEASURE_REPLAY='reviewed implementation 2cd5725'
    else
      # Align every unrelated source file (including current main) and replay only
      # the exact pre-eager-mask implementation. Its compiled geometry is identical.
      fixture "$OWN_BEFORE" HEAD
      git -C "$ROOT" show a32cfa3:web/src/sidewalks.ts > "$OWN_BEFORE/web/src/sidewalks.ts"
      replay_blob="$(git -C "$ROOT" rev-parse a32cfa3:web/src/sidewalks.ts)"
      [[ "$(git -C "$OWN_BEFORE" hash-object web/src/sidewalks.ts)" == "$replay_blob" ]]
      export SIDEWALK_MEASURE_REPLAY="a32cfa3:web/src/sidewalks.ts blob=$replay_blob; all other code=$(git -C "$ROOT" rev-parse HEAD)"
    fi
    SIDEWALK_BEFORE_ROOT="$OWN_BEFORE"
  fi
  export SIDEWALK_MEASURE_BASE_REF="$(git -C "$SIDEWALK_BASE_ROOT" rev-parse HEAD)"
  export BASE_URL=http://127.0.0.1:5488 BEFORE_URL=http://127.0.0.1:5489
  if [[ "$SIDEWALK_RUNTIME_PHASE" == frames ]];then export BEFORE_URL="$BASE_URL";fi
  python3 "$ROOT/tools/check-ports.py" --probe 5488 5489
  start_owned base "$BROWSER_LOG_DIR/base.log" /bin/bash -c 'cd "$1/web" && exec ./node_modules/.bin/vite --host 127.0.0.1 --port 5488 --strictPort' _ "$SIDEWALK_BASE_ROOT"
  python3 - "$BASE_URL" <<'PY'
import sys,time,urllib.request
for attempt in range(100):
    try:
        with urllib.request.urlopen(sys.argv[1],timeout=1) as response:
            if response.status==200:break
    except OSError:pass
    time.sleep(.1)
else:raise SystemExit('baseline HTTP did not become ready')
PY
  if [[ -n "${SIDEWALK_BEFORE_ROOT:-}" ]];then start_owned before "$BROWSER_LOG_DIR/before.log" /bin/bash -c 'cd "$1/web" && exec ./node_modules/.bin/vite --host 127.0.0.1 --port 5489 --strictPort' _ "$SIDEWALK_BEFORE_ROOT";fi
fi
if [[ "${SIDEWALK_RUNTIME_PHASE:-loads}" == diagnostic ]];then
  CDP_PORT="$CDP" run_check node "$ROOT/tools/sidewalks-diagnostic.mjs" "$OUT" "http://127.0.0.1:$WEB/"
elif [[ "${SIDEWALK_RUNTIME_PHASE:-loads}" == settle ]];then
  CDP_PORT="$CDP" run_check node "$ROOT/tools/sidewalks-settle.mjs" "$OUT" "http://127.0.0.1:$WEB/"
elif [[ "$SIDEWALK_RUNTIME_PHASE" == cold ]];then
  CDP_PORT="$CDP" run_check node "$ROOT/tools/sidewalks-cold.mjs" "$OUT" "http://127.0.0.1:$WEB/"
else
  CDP_PORT="$CDP" run_check node "$ROOT/tools/sidewalks-runtime.mjs" "$OUT" "http://127.0.0.1:$WEB/"
fi
