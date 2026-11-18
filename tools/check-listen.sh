#!/usr/bin/env bash
# Just Listen in a real browser: the built page, the real songs, and a server that sends only whole files, as the
# public host does. No Vite and no land. The site folder here holds the page, the audio folder and the game's service
# worker, so the check also proves that a saved game's worker lets the page and its songs through.
# Output: $OUT/listen-<width>x<height>.png (the layout at each phone size) and $OUT/listen-playing.png.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports "$@"
OUT="${OUT:-$ROOT/data/work/listen}"
OUT="$(python3 -c 'import os,sys;print(os.path.abspath(sys.argv[1]))' "$OUT")"; mkdir -p "$OUT"
[ -f "$ROOT/data/audio/out/radio.json" ] || { echo 'listen: no songs (data/audio/out/radio.json); run python3 tools/build_radio.py' >&2; exit 2; }
SITE="$OUT/listen-site"
# Only this check's own folder is cleared; the songs are a link and are not followed.
if [ -e "$SITE" ]; then find "$SITE" -mindepth 1 -maxdepth 1 -exec rm -r {} +; fi
mkdir -p "$SITE/offline/icons"
python3 "$ROOT/tools/pwa-icons.py" "$SITE/offline/icons"
node "$ROOT/tools/listen-page.mjs" "$SITE"
ln -s "$ROOT/data/audio/out" "$SITE/audio"
cp "$ROOT/deploy/_headers" "$SITE/_headers"
# The worker as tools/build-pwa.mjs writes it, and a page at the root that registers it as an installed game does.
{ printf 'const JUST_AREAS = [];\nconst JUST_ALIASES = {};\nconst JUST_META = {};\n'; cat "$ROOT/web/pwa/sw.js"; } > "$SITE/sw.js"
printf '<!doctype html><title>worker</title><script>navigator.serviceWorker.register("/sw.js")</script>\n' > "$SITE/index.html"
PUBLIC_PORT="${LISTEN_PORT:-$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')}"
printf '%s' "$SITE" > "$OUT/listen-root"
cd "$ROOT/web"
browser_typecheck
start_check 390 844 none
start_owned public "$BROWSER_LOG_DIR/public.log" node "$ROOT/tools/pwa-server.mjs" "$OUT/listen-root" "$PUBLIC_PORT"
ready=0
for _ in $(seq 1 80); do
  if python3 "$ROOT/tools/check-ports.py" --owned "$BROWSER_SLOT_LEASE/resource-public.json" "$PUBLIC_PORT" && curl --max-time 1 -fsS -o /dev/null "http://127.0.0.1:$PUBLIC_PORT/listen/index.html"; then ready=1; break; fi
  sleep .25
done
[[ "$ready" == 1 ]] || { echo 'listen: cannot start the owned site server' >&2; exit 2; }
LISTEN_ORIGIN="http://127.0.0.1:$PUBLIC_PORT" CDP_PORT="$CDP" run_check node "$ROOT/tools/listen-browser.mjs" "$OUT"
