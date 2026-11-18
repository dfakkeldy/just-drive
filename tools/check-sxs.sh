#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-sxs-check-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT/web"
node_modules/.bin/esbuild "$ROOT/tools/sxs-check.mjs" --bundle --platform=node --format=esm --outfile="$CHECK_DIR/model.mjs"
node "$CHECK_DIR/model.mjs"
node_modules/.bin/esbuild "$ROOT/tools/sxs-physics.mjs" --bundle --platform=node --format=esm --outfile="$CHECK_DIR/physics.mjs"
node "$CHECK_DIR/physics.mjs" "$@"
# Related review/phone/truck suites have independent check-all rows.
echo 'Related suites: tools/check-all.sh --only sxs-review sxs-round2 phone truck'
