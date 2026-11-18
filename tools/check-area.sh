#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-area-check-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT/web"
if [[ "${MMM_SKIP_TYPECHECK:-0}" != 1 ]]; then npx tsc --noEmit; fi
for dev in true false; do
  node_modules/.bin/esbuild "$ROOT/tools/area-check.mjs" --bundle --platform=node --format=esm --define:import.meta.env.DEV="$dev" --outfile="$CHECK_DIR/area-check.mjs"
  if [ "$dev" = true ]; then AREA_DEV=1 node "$CHECK_DIR/area-check.mjs"; else AREA_DEV=0 node "$CHECK_DIR/area-check.mjs"; fi
done
