#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-fishing-check-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
"$ROOT/web/node_modules/.bin/esbuild" "$ROOT/tools/fishing-rules-check.mjs" --bundle --platform=node --format=esm --outfile="$CHECK_DIR/check.mjs"
node "$CHECK_DIR/check.mjs"

node "$ROOT/tools/fishing-mutations.mjs"

node "$ROOT/tools/fishing-contact-check.mjs"
node "$ROOT/tools/fishing-contact-mutations.mjs"
node "$ROOT/tools/fishing-shader-mutations.mjs"
