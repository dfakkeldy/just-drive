#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-jump-check-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
"$ROOT/web/node_modules/.bin/esbuild" "$ROOT/tools/jump-rules-check.mjs" --bundle --platform=node --format=esm --outfile="$CHECK_DIR/check.mjs"
node "$CHECK_DIR/check.mjs"
