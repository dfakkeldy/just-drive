#!/usr/bin/env bash
# The brooks: look-up, tile field, cut, culvert mouths, and the baked file. The exit code is the verdict.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-streams-check-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT/web"
if [[ "${MMM_SKIP_TYPECHECK:-0}" != 1 ]]; then npx tsc --noEmit; fi
node_modules/.bin/esbuild "$ROOT/tools/streams-check.mjs" --bundle --platform=node --format=esm --log-level=warning --outfile="$CHECK_DIR/streams-check.mjs"
# The bundle runs from a temporary folder, so it is told where the land is.
MMM_ROOT="$ROOT" node "$CHECK_DIR/streams-check.mjs"
