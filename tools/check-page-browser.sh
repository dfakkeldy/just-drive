#!/usr/bin/env bash
# page-state-browser.mjs documents two origins: an actual public build and a dev page.
# Use the shared yard startup's default window; the check sets its own page metrics.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports "$@"
OUT="${OUT:-$ROOT/data/work/page-state}"
OUT="$(python3 -c 'import os,sys;print(os.path.abspath(sys.argv[1]))' "$OUT")"; mkdir -p "$OUT"
SITE_OUT="$OUT/site" "$ROOT/tools/build_site.sh"
PUBLIC_PORT="${G3_PUBLIC_PORT:-$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')}"
printf '%s' "$OUT/site" > "$OUT/public-root"
cd "$ROOT/web"
browser_typecheck
start_check 1600 1200
start_owned public "$BROWSER_LOG_DIR/public.log" node "$ROOT/tools/pwa-server.mjs" "$OUT/public-root" "$PUBLIC_PORT"
ready=0
for _ in $(seq 1 80); do
  if python3 "$ROOT/tools/check-ports.py" --owned "$BROWSER_SLOT_LEASE/resource-public.json" "$PUBLIC_PORT" && curl --max-time 1 -fsS -o /dev/null "http://127.0.0.1:$PUBLIC_PORT/"; then ready=1; break; fi
  sleep .25
done
[[ "$ready" == 1 ]] || { echo 'page-state: cannot start owned public origin' >&2; exit 2; }
G3_DEV_ORIGIN="http://127.0.0.1:$WEB" G3_PUBLIC_ORIGIN="http://127.0.0.1:$PUBLIC_PORT" CDP_PORT="$CDP" run_check node "$ROOT/tools/page-state-browser.mjs"
