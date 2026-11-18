#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-horse-check-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT/web"
node_modules/.bin/esbuild "$ROOT/tools/horse-check.mjs" --bundle --platform=node --format=esm --outfile="$CHECK_DIR/check.mjs"
node "$CHECK_DIR/check.mjs"


node_modules/.bin/esbuild "$ROOT/tools/horse-coarse-check.mjs" --bundle --platform=node --format=esm --outfile="$CHECK_DIR/coarse.mjs"
node "$CHECK_DIR/coarse.mjs"
