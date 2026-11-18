#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports
OUT="${OUT:-$(realpath "$ROOT/data/baked")/../work/threads/far-views}"; mkdir -p "$OUT"; export OUT
DATA_ROOT="$(cd "$ROOT/data/baked/.." && pwd -P)"
# A symlink's parent is the checkout; resolve the data directory from the target.
DATA_ROOT="$(dirname "$(realpath "$ROOT/data/baked")")"
cd "$ROOT/web"
browser_typecheck
PACK_ROOT="${FAR_VIEWS_BAKE:-$(node --input-type=module -e "import {farPack} from '$ROOT/tools/far-pack.mjs'; console.log(farPack('$ROOT')??'')")}";
if [[ -z "$PACK_ROOT" || ! -f "$PACK_ROOT/terrain/far-land.json" ]]; then echo 'CANNOT RUN: missing far-view rehearsal pack' >&2; exit 2; fi
PACK_ROOT="$(realpath "$PACK_ROOT")"
start_check 1920 1080 none
start_owned server "$BROWSER_LOG_DIR/far-overlay.log" node "$ROOT/tools/far-views-serve.mjs" --data-root "$DATA_ROOT" --bake-root "$PACK_ROOT" --port "$WEB"
SERVER="$OWNED_PID"
python3 - "$WEB" <<'PYREADY'
import sys,time,urllib.request
for i in range(100):
 try:
  urllib.request.urlopen('http://127.0.0.1:'+sys.argv[1]+'/__far-views-mode?mode=after',timeout=1).read();break
 except OSError:
  if i==99:raise
  time.sleep(.1)
PYREADY
run_check node "$ROOT/tools/${FAR_TEST:-far-views-browser.mjs}" "$OUT" "http://127.0.0.1:$WEB"
