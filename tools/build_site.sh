#!/usr/bin/env bash
# Assemble the public site in data/site/: the game page, the script, and the baked terrain as single files.
# The terrain is hard-linked, so the folder takes no extra disk space. Deploy it with deploy/wrangler.jsonc.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 "$ROOT/tools/radio_catalogue.py"
# Check before compiling or clearing an existing site. A missing radio folder is still an optional no-radio build.
AUDIO_SITE="${AUDIO_SITE:-$ROOT/data/audio/site}"
if [ "${RADIO:-1}" != "0" ] && [ -d "$AUDIO_SITE" ]; then
  python3 "$ROOT/tools/radio-site-preflight.py" "$AUDIO_SITE"
fi
SITE="${SITE_OUT:-${SITE:-$ROOT/data/site}}"
# Keep the private bundle out of data/pack when a caller selects an isolated site.
SITE="$(python3 -c 'import os,sys;print(os.path.abspath(sys.argv[1]))' "$SITE")"
mkdir -p "$(dirname "$SITE")"
BUNDLE="$(mktemp -d "$SITE-bundle-XXXXXX")"
trap 'rm -rf "$BUNDLE"' EXIT
# Validate the full public history before compiling or clearing an existing site.
python3 "$ROOT/tools/changelog.py" --output "$BUNDLE/CHANGELOG.md" --html "$BUNDLE/changes/index.html"
cd "$ROOT/web"
npx tsc --noEmit
MMM_PUBLIC=1 ARTIFACT_OUT="$BUNDLE" npx vite build -c vite.artifact.config.ts >/dev/null
mkdir -p "$SITE"
find "$SITE" -mindepth 1 -maxdepth 1 -exec rm -r {} +
# The temporary bundle is beside the site root, so output cleaning cannot remove it.
cp "$BUNDLE/app.js" "$SITE/app.js"
mkdir -p "$SITE/changes"
cp "$BUNDLE/changes/index.html" "$SITE/changes/index.html"
cp "$BUNDLE/quarry-feature.json" "$SITE/quarry-feature.json"
# The models (web/public/models): small site files beside the land. The game goes on without one that is missing.
if [ -d "$BUNDLE/models" ]; then cp -R "$BUNDLE/models" "$SITE/models"; fi
cp -al "$ROOT/data/baked/terrain" "$SITE/terrain"
# Area packs are published only after the baker marks a complete folder READY.
# Leave no areas directory or header behind when none are ready.
AREAS=()
for area in "$ROOT"/data/baked/areas/*; do
  [ -d "$area" ] && [ -f "$area/manifest.json" ] && [ -f "$area/READY" ] && [ ! -s "$area/READY" ] || continue
  id="${area##*/}"
  # A ready backup folder is not a public area under its backup name.
  python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])).get("area",{}).get("id")==sys.argv[2] else 1)' "$area/manifest.json" "$id" || continue
  mkdir -p "$SITE/areas/$id"
  for file in "$area"/* "$area"/.[!.]* "$area"/..?*; do
    [ -e "$file" ] || continue
    [ "${file##*/}" = READY ] && continue
    cp -al "$file" "$SITE/areas/$id/"
  done
  AREAS+=("$id")
done
if [ "${#AREAS[@]}" -gt 0 ]; then printf 'areas: %s\n' "${AREAS[*]}"; else echo 'areas: none'; fi
# The radio: only the songs that tools/build_radio.py marked for the public site (data/audio/site/). RADIO=0 leaves the
# radio out. AUDIO_SITE selects an isolated public radio build for rehearsals. The list is copied, not linked, because the next build_radio.py run writes a new one.
if [ "${RADIO:-1}" != "0" ] && { [ -f "$AUDIO_SITE/radio.json" ] || [ -f "$AUDIO_SITE/radio-just.json" ]; }; then
  mkdir "$SITE/audio"
  if [ -f "$AUDIO_SITE/radio.json" ]; then cp "$AUDIO_SITE/radio.json" "$SITE/audio/"; fi
  # The same stations, with the drive-around game's own starting dial. It shares the song files.
  if [ -f "$AUDIO_SITE/radio-just.json" ]; then cp "$AUDIO_SITE/radio-just.json" "$SITE/audio/"; fi
  cp -l "$AUDIO_SITE"/*.mp3 "$SITE/audio/"
fi
# The page: the same markup as the test build, inside a full document. Search engines are asked to stay away
# while this is a preview.
{
  cat <<'HEAD'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Mabou Mail Madness</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no">
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="A driving game about a rural mail route on the real roads around Mabou, Cape Breton. Preview build.">
<meta name="theme-color" content="#0b1620">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%230b1620'/%3E%3Cpath d='M12 22h40v24H12z' fill='%23eef2f6'/%3E%3Cpath d='M12 22l20 15 20-15' fill='none' stroke='%23d0632e' stroke-width='4'/%3E%3C/svg%3E">
<style>html{color-scheme:dark}body{margin:0}img{max-width:100%}[hidden]{display:none!important}
:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}</style>
</head>
<body>
HEAD
  # The same page serves the private test copy; on the public site its credit line must not call itself private.
  sed '/^<title>Mabou Mail Madness<\/title>$/d;s/ · A private test build/ · Preview build/' "$ROOT/artifact/page.html"
  printf '</body>\n</html>\n'
} > "$SITE/index.html"
cp "$ROOT/deploy/_headers" "$SITE/_headers"
if [ "${#AREAS[@]}" -gt 0 ]; then printf '/areas/*\n  Cache-Control: no-cache\n' >> "$SITE/_headers"; fi
python3 "$ROOT/tools/pwa-icons.py" "$SITE/offline/icons"
node "$ROOT/tools/build-pwa.mjs" "$SITE"
# The About and Help pages of each brand (served at /about and /help on each host by the Worker).
node "$ROOT/tools/about-pages.mjs" "$SITE"
for page in about help; do for brand in mail just; do [ -s "$SITE/$page/$brand/index.html" ] || { echo "$page: $brand page missing" >&2; exit 1; }; done; done
# Just Listen: the radio alone, one light page at /listen/ on both hosts. It reads the audio folder above and is in no
# offline download (build-pwa.mjs has already made its list of files).
node "$ROOT/tools/listen-page.mjs" "$SITE"
[ -s "$SITE/listen/index.html" ] || { echo 'listen: page missing' >&2; exit 1; }
rm -r "$BUNDLE"
# The count is done in node: GNU and BSD find, du and stat do not share the options for it.
node -e '
const fs = require("fs"), path = require("path");
let files = 0, bytes = 0, largest = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else { const n = fs.statSync(p).size; files++; bytes += n; if (n > largest) largest = n; }
  }
})(process.argv[1]);
console.log(`site: ${files} files, ${(bytes / 1048576).toFixed(0)} MB, largest ${largest} bytes`);
' "$SITE"
