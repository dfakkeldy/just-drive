#!/usr/bin/env bash
# A rehearsal of the public site on this machine: the LIVE configuration (deploy/wrangler.jsonc: the built site in
# data/site plus the multiplayer script and rooms) run by `wrangler dev`. Nothing leaves the computer.
# It checks that files are served as before, that addresses which are no file still give 404, and then runs the
# simulated players of tools/mp-check.mjs against it.
#   MP_PORT=5262 tools/rehearse-site.sh
#   SITE_OUT=<folder> (or SITE=<folder>) rehearses a built site in another place than data/site.
#
# The local server cannot start on the whole site: Wrangler 4.160 fails with "spawn EBADF" above some number of
# files (measured 12 Nov 2026 with one-byte files: 10,000 start, 13,500 do not; it is the count, not the size and
# not the shell's open-file limit). So the rehearsal serves a REDUCED copy: every file of the site outside the big
# land and song folders (terrain/, areas/, audio/), and from those folders a few sample files, so that "a land file
# is served" still means something. What is rehearsed is the script, the routing, the 404 rule and the headers;
# those do not depend on how many land files there are. REHEARSE_FULL=1 serves the whole folder (small sites only).
# Only two things differ from the live configuration: the list of pages that may join (the live list names the real
# address) and, while the simulated players run, GAME_ROUND_S:20: a 20-second parcel-tag round as in tools/check-mp.sh
# (the live round plays 3 minutes, longer than the players wait for it to end). The live config must not set it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${MP_PORT:-5262}"
source "$ROOT/tools/wrangler.sh"
mmm_select_wrangler --require-origin-flag || exit $?
SITE_PATH="${SITE_OUT:-${SITE:-$ROOT/data/site}}"
SITE_PATH="$(python3 -c 'import os,sys;print(os.path.abspath(sys.argv[1]))' "$SITE_PATH")"
[[ -f "$SITE_PATH/index.html" ]] || { echo "No built site in $SITE_PATH. Run tools/build_site.sh first." >&2; exit 2; }
# The short round is the rehearsal's own: a live config that shortened the round would be a fault.
if grep -qE '"GAME_ROUND_S"[[:space:]]*:' "$ROOT/deploy/wrangler.jsonc"; then echo "FAIL deploy/wrangler.jsonc sets GAME_ROUND_S; it is for local checks only" >&2; exit 1; fi
WORK="$(mktemp -d "${REHEARSAL_WORK_ROOT:-${TMPDIR:-/tmp}}/mmm-rehearse-XXXXXX")"
WORK="$(cd "$WORK" && pwd -P)"   # absolute: the steps below change folder
LIVE_ORIGINS="$(python3 - "$ROOT/deploy/wrangler.jsonc" <<'PY_ORIGINS'
import json, re, sys
print(json.loads(re.search(r'"ORIGINS":\s*("[^"\n]*")', open(sys.argv[1]).read())[1]))
PY_ORIGINS
)"
REHEARSAL_ORIGINS="$LIVE_ORIGINS,http://localhost:*,http://127.0.0.1:*"
SERVER_PID=""
cleanup() { [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT
# The folder that is served, and the sample files that are asked for further down.
SERVED="$SITE_PATH"
if [[ "${REHEARSE_FULL:-0}" != "1" ]]; then
  SERVED="$WORK/site"
  python3 - "$SITE_PATH" "$SERVED" > "$WORK/samples" <<'PY'
import os, shutil, sys
src, dst = sys.argv[1], sys.argv[2]
BIG = ('terrain', 'areas', 'audio')
def put(rel):
    to = os.path.join(dst, rel)
    os.makedirs(os.path.dirname(to), exist_ok=True)
    if os.environ.get('REHEARSE_LINK_INPUTS') == '1':
        if os.path.lexists(to): os.unlink(to)
        os.link(os.path.join(src, rel), to)
    else:
        shutil.copyfile(os.path.join(src, rel), to)
def walk(top):
    """Like os.walk through linked folders (folders first sorted), but it never enters a folder that it is already
    inside: a link that points back up. A folder reached by two names is walked under both."""
    def go(folder, inside):
        real = os.path.realpath(folder)
        if real in inside:
            return
        names = sorted(os.listdir(folder))
        dirs = [n for n in names if os.path.isdir(os.path.join(folder, n))]
        files = [n for n in names if not os.path.isdir(os.path.join(folder, n))]
        yield folder, dirs, files
        for d in dirs:   # the caller may have pruned the list
            yield from go(os.path.join(folder, d), inside | {real})
    yield from go(top, frozenset())
os.makedirs(dst)
for root, dirs, files in walk(src):
    rel = os.path.relpath(root, src)
    if rel == '.':
        dirs[:] = [d for d in dirs if d not in BIG]
    for f in files:
        put(os.path.normpath(os.path.join(rel, f)))
# From each big folder: its list files at the top, and the first file found deeper down (a real land tile or song).
samples = []
def sample(folder):
    top = os.path.join(src, folder)
    if not os.path.isdir(top):
        return
    for f in sorted(os.listdir(top)):
        if os.path.isfile(os.path.join(top, f)) and f.endswith('.json'):
            samples.append(f'{folder}/{f}')
    for root, dirs, files in walk(top):
        if root == top and dirs:
            continue   # a tile from inside the tree, not the cover picture beside the lists
        deep = [f for f in sorted(files) if not f.endswith('.json')]
        if deep:
            samples.append(os.path.relpath(os.path.join(root, deep[0]), src))
            return
sample('terrain'); sample('audio')
# areas/ holds one tree for each area: the lists at its own top, then each area as terrain/ above.
sample('areas')
areas = os.path.join(src, 'areas')
if os.path.isdir(areas):
    for area in sorted(os.listdir(areas)):
        if os.path.isdir(os.path.join(areas, area)):
            sample(f'areas/{area}')
for rel in dict.fromkeys(samples):
    put(rel); print(rel)
PY
fi
count() { find "$1" -type f | wc -l | tr -d ' '; }
if [[ "$SERVED" == "$SITE_PATH" ]]; then echo "serving the whole site: $SITE_PATH ($(count "$SITE_PATH") files)"
else echo "serving a reduced copy of $SITE_PATH: $(count "$SERVED") of its $(find -L "$SITE_PATH" -type f | wc -l | tr -d ' ') files (all but terrain/, areas/ and audio/, plus $(wc -l < "$WORK/samples" | tr -d ' ') samples from those)"; fi
(cd "$ROOT" && WRANGLER_SEND_METRICS=false exec "$WRANGLER" dev -c deploy/wrangler.jsonc --assets "$SERVED" --local --infer-origin-from-routes=false --ip 127.0.0.1 --port "$PORT" \
  --persist-to "$WORK/state" --var "ORIGINS:$REHEARSAL_ORIGINS" --var GAME_ROUND_S:20) > "$WORK/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 240); do
  grep -q "Ready on" "$WORK/server.log" && break
  kill -0 "$SERVER_PID" 2>/dev/null || break
  perl -e 'select(undef, undef, undef, 0.25)'
done
grep -q "Ready on" "$WORK/server.log" || { cat "$WORK/server.log" >&2; echo "The site did not start." >&2; exit 2; }
echo "rehearsal: source $SITE_PATH; serving $SERVED"
BASE="http://127.0.0.1:$PORT"
fail=0
expect() {   # expect <status> <path> [what]
  local got; got="$(curl -s -o "$WORK/body" -w '%{http_code}' "$BASE$2")"
  if [[ "$got" == "$1" ]]; then echo "ok   $2 gives $got"; else echo "FAIL $2 gives $got, not $1 ${3:-}"; fail=1; fi
}
expect 200 /
expect 200 /app.js
cmp -s "$WORK/body" "$SITE_PATH/app.js" && echo "ok   /app.js is the built script, byte for byte" || { echo "FAIL /app.js differs from $SITE_PATH/app.js"; fail=1; }
# Exact root dispatch selects the HTML brand; all other real assets still win first.
node "$ROOT/tools/site-http-check.mjs" "$BASE" "$SITE_PATH" "${HTTP_TABLE_OUT:-$WORK/http-table.json}"
# Relative page/code paths have root resolution at the canonical non-slash address.
node --input-type=module - <<'JS'
import assert from 'node:assert/strict';
for (const part of ['./app.js', './terrain/manifest.json', 'terrain/tile.bin', './areas/judique/manifest.json', './audio/radio.json', './audio/radio-just.json', '/manifest-just.webmanifest', '/offline/app.hash.js']) {
  for (const address of ['mabou','mabou-1884']) assert.equal(new URL(part,'https://justdrive.fakkeldy.ca/'+address).pathname,new URL(part,'https://justdrive.fakkeldy.ca/').pathname);
}
console.log('ok   app, BASE_URL land/audio, literal terrain, manifest and immutable shell resolve at root');
JS
expect 200 /terrain/manifest.json
# The sample files from the big folders, each byte for byte.
if [[ -f "$WORK/samples" ]]; then
  while IFS= read -r rel; do
    # The address is the path with each part encoded (a space, "#" or "?" in a file name would change its meaning).
    expect 200 "/$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$rel")"
    cmp -s "$WORK/body" "$SITE_PATH/$rel" || { echo "FAIL /$rel differs from the built file"; fail=1; }
  done < "$WORK/samples"
fi
expect 404 /packs.json "(an address that is no file)"
expect 404 /no/such/file.png
expect 404 /mp/ "(a room address that is not one)"
expect 426 /mp/v1/mabou/world "(a room address asked for as a page)"
# The cache rule that the site's own _headers file gives for a file must be the one that is served.
cache_rule() {   # cache_rule <_headers rule> <path>
  local want got
  want="$(tr -d '\r' < "$SITE_PATH/_headers" | awk -v rule="$1" '$1 == rule { hit = 1; next } hit && /^[^ \t]/ { hit = 0 } hit && tolower($1) == "cache-control:" { sub(/^[ \t]*[^ \t]+[ \t]+/, ""); print; exit }')"
  [[ -n "$want" ]] || { echo "FAIL no Cache-Control rule for $1 in $SITE_PATH/_headers"; fail=1; }
  got="$(curl -sI "$BASE$2" | tr -d '\r' | awk 'tolower($1) == "cache-control:" { sub(/^[^ ]+ /, ""); print; exit }')"
  [[ -n "$want" && "$got" == "$want" ]] && echo "ok   the _headers file still rules the cache of $2 ($got)" || { echo "FAIL $2 is served with cache-control '$got', the _headers file says '$want'"; fail=1; }
}
cache_rule /app.js /app.js
# The published script is app.js and its chunks (web/area-chunks-build.ts): the core chunk and one offline copy of a
# chunk, each byte for byte and with its folder's cache rule.
CORE="$(cd "$SITE_PATH" && find chunks -maxdepth 1 -name 'core-*.js' 2>/dev/null | sort | head -1)"
OFFLINE_CHUNK="$(cd "$SITE_PATH" && find offline/chunks -maxdepth 1 -name '*.js' 2>/dev/null | sort | head -1)"
if [[ -n "$CORE" && -n "$OFFLINE_CHUNK" ]]; then
  for rel in "$CORE" "$OFFLINE_CHUNK"; do
    expect 200 "/$rel"
    cmp -s "$WORK/body" "$SITE_PATH/$rel" && echo "ok   /$rel is the built chunk, byte for byte" || { echo "FAIL /$rel differs from $SITE_PATH/$rel"; fail=1; }
  done
  cache_rule '/chunks/*' "/$CORE"
  cache_rule '/offline/chunks/*' "/$OFFLINE_CHUNK"
else echo "FAIL $SITE_PATH has no chunks/core-*.js or no offline/chunks/*.js"; fail=1; fi
cd "$ROOT/web"
node_modules/.bin/esbuild "$ROOT/tools/mp-check.mjs" --bundle --platform=node --format=esm --log-level=warning --outfile="$WORK/check.mjs"
# The simulated players have time limits. A very busy machine can miss one without a real fault, so a failed run is
# tried once more, and the output says so. Two failures fail the rehearsal.
players() { MP_ORIGIN="https://justdrive.fakkeldy.ca" MP_SERVER="ws://127.0.0.1:$PORT" node "$WORK/check.mjs" > "$WORK/players.log" 2>&1; local code=$?; grep -E "^PASS [a-z]|multiplayer check|Assert" "$WORK/players.log" || true; return $code; }
if ! players; then
  echo "the simulated players failed once (above); trying once more"
  players || { echo "FAIL the simulated players failed twice"; fail=1; }
fi
# The switch that closes every room without a new build.
kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true
(cd "$ROOT" && WRANGLER_SEND_METRICS=false exec "$WRANGLER" dev -c deploy/wrangler.jsonc --assets "$SERVED" --local --infer-origin-from-routes=false --ip 127.0.0.1 --port "$PORT" \
  --persist-to "$WORK/state" --var "ORIGINS:$REHEARSAL_ORIGINS" --var MP:off) > "$WORK/server2.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 240); do grep -q "Ready on" "$WORK/server2.log" && break; perl -e 'select(undef, undef, undef, 0.25)'; done
expect 503 /mp/v1/mabou/world "(MP:off closes the rooms)"
expect 200 /app.js "(and the game is still served)"
[[ "$fail" == 0 ]] && echo "rehearsal: passed" || echo "rehearsal: FAILED"
exit "$fail"
