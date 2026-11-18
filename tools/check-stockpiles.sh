#!/usr/bin/env bash
# The Point Tupper stockpiles on the CPU: the committed pack and its state on the baked land, the bake's mask
# rules, and the game's geometry rules. No browser. See tools/stockpiles-delta/README.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
python3 tools/stockpiles-delta-check.py
if python3 -c 'import osgeo' 2>/dev/null; then python3 tools/stockpiles-bake-check.py
else echo 'NOT RUN: bake mask fixture (tools/stockpiles-bake-check.py) needs GDAL (osgeo), which this host lacks'; fi
CHECK="$(mktemp -d "${MMM_CHECK_OUT:-${TMPDIR:-/tmp}}/stockpiles-check-XXXXXX")"
trap 'rm -rf "$CHECK"' EXIT
web/node_modules/.bin/esbuild tools/stockpiles-check.mjs --bundle --platform=node --format=esm --outfile="$CHECK/check.mjs" --log-level=warning
MMM_STOCKPILE_FILE="${MMM_STOCKPILE_FILE:-tools/stockpiles-delta/stockpiles.json}" node "$CHECK/check.mjs"
