#!/usr/bin/env bash
# The heart of Judique (the project brief): site rules against the baked land. The browser proof is judique-village-browser.mjs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-judique-village-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT"
web/node_modules/.bin/esbuild tools/judique-village-check.mjs --bundle --platform=node --format=esm --log-level=warning --outfile="$CHECK_DIR/check.mjs"
node "$CHECK_DIR/check.mjs"
