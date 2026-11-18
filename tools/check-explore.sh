#!/usr/bin/env bash
# Pure rules plus real-page mode/places/phone checks. --pure skips the browser.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-explore-check-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT/web"
if [[ "${MMM_SKIP_TYPECHECK:-0}" != 1 ]]; then npx tsc --noEmit; fi
node_modules/.bin/esbuild "$ROOT/tools/explore-rules-check.mjs" --bundle --platform=node --format=esm --outfile="$CHECK_DIR/check.mjs"
MMM_ROOT="$ROOT" node "$CHECK_DIR/check.mjs"
if [[ "${1:-}" == --pure ]]; then exit 0; fi
cd "$ROOT"
# yard-shots.sh owns the machine-wide browser slot.
OUT="${OUT:-$ROOT/data/work/threads/explore/stage1}" RUN=explore-check.mjs HUD=1 VIEWS="explore|mode=explore" "$ROOT/tools/yard-shots.sh" 1600 1000
