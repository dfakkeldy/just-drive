#!/usr/bin/env bash
# Actual public artifact and default mail-brand page, entirely inside the check's work folder.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports "$@"
OUT="${OUT:-$ROOT/data/work/light-study-public}"
OUT="$(python3 -c 'import os,sys;print(os.path.abspath(sys.argv[1]))' "$OUT")"; mkdir -p "$OUT"
SITE_OUT="$OUT/site" "$ROOT/tools/build_site.sh" > "$OUT/build-public.log" 2>&1
printf '%s' "$OUT/site" > "$OUT/public-root"
cd "$ROOT/web"
browser_typecheck
start_check 1440 900 none
start_owned public "$BROWSER_LOG_DIR/public.log" node "$ROOT/tools/pwa-server.mjs" "$OUT/public-root" "$WEB"
ready=0
for _ in $(seq 1 80); do
  if python3 "$ROOT/tools/check-ports.py" --owned "$BROWSER_SLOT_LEASE/resource-public.json" "$WEB" && curl --max-time 1 -fsS -o /dev/null "http://127.0.0.1:$WEB/"; then ready=1; break; fi
  sleep .25
done
[[ "$ready" == 1 ]] || { echo 'light-study: public origin did not start' >&2; exit 2; }
LIGHT_STUDY_PUBLIC_ORIGIN="http://127.0.0.1:$WEB" CDP_PORT="$CDP" run_check node "$ROOT/tools/light-study-public-browser.mjs" "$OUT"
