#!/usr/bin/env bash
# No Vite: exercise the actual public build, on this task's isolated ports and data root.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports "$@"
cd "$ROOT"
OUT="${OUT:-$ROOT/data/work/pwa}";mkdir -p "$OUT"
# A host that holds only data/audio/out (the remote runner sends own hosts no other audio folder, and apple-check-host keeps only it)
# would build a site with no radio, and the radio sub-checks would fail there. Make the public radio folder from it
# for this build only; it equals build_radio.py's data/audio/site (radio-catalogue-check.py proves that).
if [[ "${RADIO:-1}" != 0 && -z "${AUDIO_SITE:-}" && ! -d "$ROOT/data/audio/site" && -f "$ROOT/data/audio/out/radio.json" ]];then
  rm -rf "$OUT/audio-site"
  # A missing or stale out folder exits 2 (CANNOT RUN); a bug in the script exits 1 (FAIL).
  python3 "$ROOT/tools/radio-public-from-out.py" "$ROOT/data/audio/out" "$OUT/audio-site" || exit $?
  export AUDIO_SITE="$OUT/audio-site"
fi
# The browser checks read the real public build from $OUT/site. Build it here, every time, so that the check
# stands on its own and never tests a stale build. It never touches data/site (the folder the live site uses).
SITE_OUT="$OUT/site" tools/build_site.sh > "$OUT/build-for-check.log" 2>&1 || { tail -5 "$OUT/build-for-check.log" >&2; echo "FAIL the public build for the check" >&2; exit 1; }
export PWA_OUT="$OUT"
node tools/pwa-area-check.mjs --mutations
node tools/pwa-shell-check.mjs --mutations
node tools/pwa-prime-check.mjs --mutations
node tools/pwa-complete-check.mjs --mutations
node tools/pwa-opt-in-check.mjs --mutations
node tools/pwa-worker-check.mjs --mutations
node tools/pwa-ui-check.mjs
node tools/pwa-migration-check.mjs --mutations
start_check 1400 950 none
printf '%s\n' "$PROFILE" >> "$OUT/owned-profiles-pass3.txt"
if [[ -z "${PWA_BROWSER_SCRIPTS:-}" ]];then
  run_check node -e "const fs=require('node:fs'),p=process.argv[1]+'/opt-in-pass3-browser-baseline.json';if(fs.existsSync(p))fs.renameSync(p,p+'.previous')" "$OUT"
  if CDP_PORT="$CDP" run_check node "$ROOT/tools/pwa-opt-in-browser.mjs" "$OUT" --baseline > "$OUT/opt-in-browser-baseline-pass3.log" 2>&1;then
    echo 'FAIL baseline ordinary visitor escaped';exit 1
  fi
  run_check node -e "const i=require(process.argv[1]+'/opt-in-pass3-browser-baseline.json').info;if(!(i.registrations>0&&i.firstLand>=2000))throw Error('baseline did not reproduce registration/startup delay')" "$OUT"
  echo 'PASS 54c2e80 ordinary visitor browser check reproduces registration and startup delay'
fi
for check in ${PWA_BROWSER_SCRIPTS:-pwa-opt-in-browser.mjs pwa-browser-check.mjs pwa-desktop-check.mjs pwa-migration-browser.mjs pwa-area-browser.mjs};do
  CDP_PORT="$CDP" run_check node "$ROOT/tools/$check" "$OUT"
done
