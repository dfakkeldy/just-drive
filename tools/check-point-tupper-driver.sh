#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_AI="$(mktemp -d)"
trap 'rm -rf "$TMP_AI"' EXIT
"$ROOT/web/node_modules/.bin/esbuild" "$ROOT/tools/point-tupper-driver-check.mjs" --bundle --platform=node --format=esm --outfile="$TMP_AI/check.mjs"
node "$TMP_AI/check.mjs"
