#!/usr/bin/env bash
# Harbour Ridge steel plant package run: rules, 3D scene budget/normals, door reach, and Shift bonus integration.
# Pictures and browser checks come from tools/plant-shots.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-plant-check-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT/web"
if [[ "${MMM_SKIP_TYPECHECK:-0}" != 1 ]]; then npx tsc --noEmit; fi
node_modules/.bin/esbuild "$ROOT/tools/plant-check.mjs" --bundle --platform=node --format=esm --outfile="$CHECK_DIR/plant-check.mjs"
node "$CHECK_DIR/plant-check.mjs"
