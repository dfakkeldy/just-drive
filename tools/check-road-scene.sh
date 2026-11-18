#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-road-scene-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT/web"
if [[ "${MMM_SKIP_TYPECHECK:-0}" != 1 ]]; then npx tsc --noEmit; fi
node_modules/.bin/esbuild "$ROOT/tools/road-scene-check.mjs" --bundle --platform=node --format=esm --outfile="$CHECK_DIR/check.mjs"
node "$CHECK_DIR/check.mjs"
node_modules/.bin/esbuild "$ROOT/tools/road-scene-world-check.mjs" --bundle --platform=node --format=esm --outfile="$CHECK_DIR/world.mjs"
node "$CHECK_DIR/world.mjs"
node_modules/.bin/esbuild "$ROOT/tools/road-scene-placement-check.mjs" --bundle --platform=node --format=esm --outfile="$CHECK_DIR/placement.mjs"
node "$CHECK_DIR/placement.mjs"
node_modules/.bin/esbuild "$ROOT/tools/road-scene-sea-check.mjs" --bundle --platform=node --format=esm --outfile="$CHECK_DIR/sea.mjs"
node "$CHECK_DIR/sea.mjs"
