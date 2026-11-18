#!/usr/bin/env bash
# Large buildings as blocks and tanks: the measurement on made-up heights, then the game's side (no block in a
# hand-built site, closed roofs, tree clearing). MMM_BAKED=<folder> reads a rehearsed data/baked instead.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-big-check-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
python3 "$ROOT/pipeline/27_check_big.py"
cd "$ROOT/web"
if [[ "${MMM_SKIP_TYPECHECK:-0}" != 1 ]]; then npx tsc --noEmit; fi
node_modules/.bin/esbuild "$ROOT/tools/big-buildings-check.mjs" --bundle --platform=node --format=esm --log-level=warning --outfile="$CHECK_DIR/big-buildings-check.mjs"
MMM_ROOT="$ROOT" node "$CHECK_DIR/big-buildings-check.mjs"
