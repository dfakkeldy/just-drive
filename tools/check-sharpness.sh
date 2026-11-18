#!/usr/bin/env bash
# The reckoning of the sharpness governor against simulated computers. The exit code is the verdict.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-sharpness-check-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT/web"
npx tsc --noEmit
node_modules/.bin/esbuild "$ROOT/tools/sharpness-check.mjs" --bundle --platform=node --format=esm --log-level=warning --outfile="$CHECK_DIR/sharpness-check.mjs"
node "$CHECK_DIR/sharpness-check.mjs"
