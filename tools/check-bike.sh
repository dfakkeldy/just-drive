#!/usr/bin/env bash
# Fixed-step bike rules/model tests, then real-page integration and phone layout.
# --pure skips browser. BIKE_CASE selects a physics group; BIKE_FAMILY selects a browser group.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-bike-check-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT/web"
if [[ "${MMM_SKIP_TYPECHECK:-0}" != 1 ]]; then npx tsc --noEmit; fi
node_modules/.bin/esbuild "$ROOT/tools/bike-physics-check.mjs" --bundle --platform=node --format=esm --outfile="$CHECK_DIR/check.mjs"
MMM_ROOT="$ROOT" node "$CHECK_DIR/check.mjs"
if [[ "${1:-}" == --pure ]]; then exit 0; fi
cd "$ROOT"
OUT="${OUT:-$ROOT/data/work/threads/explore/stage2}" RUN=bike-browser-check.mjs HUD=1 VIEWS="bike|mode=explore&vehicle=bike" "$ROOT/tools/yard-shots.sh" 1600 1000
