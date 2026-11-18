#!/usr/bin/env bash
# Anonymous map polygons, deterministic stones, open gates, and all six baked packs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/data/work/map-data/cemeteries"   # a fresh host has no such folder yet
CHECK_DIR="$(mktemp -d "$ROOT/data/work/map-data/cemeteries/check-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT"
python3 tools/cemeteries-bake-fixture.py --out "$CHECK_DIR/bake-fixture.json" "$@"
export MMM_CEMETERY_FIXTURE="$CHECK_DIR/bake-fixture.json" MMM_CEMETERY_CHECK_DIR="$CHECK_DIR"
web/node_modules/.bin/esbuild tools/cemeteries-check.mjs --bundle --platform=node --format=esm --log-level=warning --outfile="$CHECK_DIR/check.mjs"
node "$CHECK_DIR/check.mjs" "$@"
