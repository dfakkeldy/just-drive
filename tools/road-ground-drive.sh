#!/usr/bin/env bash
# Measure fixed drives on this checkout's baked Mabou land (see road-ground-drive.mjs). DRIVE_OUT=<file.json> keeps the rows.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-road-ground-drive-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT/web"
node_modules/.bin/esbuild "$ROOT/tools/road-ground-drive.mjs" --bundle --platform=node --format=esm --log-level=warning --outfile="$CHECK_DIR/drive.mjs"
node "$CHECK_DIR/drive.mjs" "$@"
