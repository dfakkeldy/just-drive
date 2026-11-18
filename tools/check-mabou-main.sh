#!/usr/bin/env bash
# Mabou main street (the project brief): site rules against the baked land. The browser proof is mabou-main-browser.mjs.
# MMM_BAKED=<folder> checks a rehearsed land instead (a folder holding terrain/ like data/baked).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-mabou-main-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT"
web/node_modules/.bin/esbuild tools/mabou-main-check.mjs --bundle --platform=node --format=esm --log-level=warning --outfile="$CHECK_DIR/check.mjs"
node "$CHECK_DIR/check.mjs"
