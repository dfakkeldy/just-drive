#!/usr/bin/env bash
# Port Hawkesbury (the project brief): site rules against the baked land. The browser proof is port-hawkesbury-browser.mjs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-port-hawkesbury-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT"
web/node_modules/.bin/esbuild tools/port-hawkesbury-check.mjs --bundle --platform=node --format=esm --log-level=warning --outfile="$CHECK_DIR/check.mjs"
node "$CHECK_DIR/check.mjs"
