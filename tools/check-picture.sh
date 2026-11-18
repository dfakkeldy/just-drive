#!/usr/bin/env bash
# The one measurement that picks the Picture setting at a first visit, against simulated computers.
# The exit code is the verdict. (The setting in a browser: RUN=picture-check.mjs through tools/yard-shots.sh.)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-picture-check-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT/web"
if [[ "${MMM_SKIP_TYPECHECK:-0}" != 1 ]]; then npx tsc --noEmit; fi
node_modules/.bin/esbuild "$ROOT/tools/picture-first-check.mjs" --bundle --platform=node --format=esm --log-level=warning --outfile="$CHECK_DIR/picture-first-check.mjs"
node "$CHECK_DIR/picture-first-check.mjs"
