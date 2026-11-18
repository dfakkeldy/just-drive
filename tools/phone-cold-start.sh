#!/usr/bin/env bash
# Phone LOW cold start, throttled: build an isolated production site, serve it, measure (tools/phone-cold-start.mjs).
# The site is hard-linked from data/baked into the result folder and removed at the end; nothing is written to
# data/site or data/baked. Results stay in COLD_OUT (default data/work/phone-cold-start/<commit>), because a
# passing check-all row deletes its own evidence folder.
# Usage: tools/phone-cold-start.sh   (env: COLD_JOBS="forward turn", DRIVE_SECONDS=60, COLD_NETWORK=local)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports "$@"
COLD_OUT="${COLD_OUT:-$ROOT/data/work/phone-cold-start/$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo tree)-$(date -u +%Y%m%dT%H%M%S)}"
mkdir -p "$COLD_OUT"
SITE_DIR="$COLD_OUT/site"
RADIO=0 SITE_OUT="$SITE_DIR" "$ROOT/tools/build_site.sh" > "$COLD_OUT/build.log" 2>&1 || { tail -40 "$COLD_OUT/build.log" >&2; exit 2; }
printf '%s\n' "$SITE_DIR" > "$COLD_OUT/root.txt"
OUT="$COLD_OUT"
cleanup_site() { rm -rf "$SITE_DIR"; }
start_check 844 390 none
trap 'r=$?; cleanup_site; finish_check $r' EXIT
start_owned server "$BROWSER_LOG_DIR/static.log" node "$ROOT/tools/pwa-server.mjs" "$COLD_OUT/root.txt" "$WEB"
for attempt in $(seq 1 40); do curl --max-time 1 -fsS -o /dev/null "http://127.0.0.1:$WEB/" 2>/dev/null && break; sleep .25; done
echo "phone-cold-start: results in $COLD_OUT"
CDP_PORT="$CDP" run_check node "$ROOT/tools/phone-cold-start.mjs" "$COLD_OUT" "http://127.0.0.1:$WEB"
