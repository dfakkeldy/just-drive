#!/usr/bin/env bash
# Mapped shape rules, property identity, and the rendered wing roof coverage.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-wings-check-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
python3 "$ROOT/pipeline/27_check_wings.py"
cd "$ROOT/web"
if [[ "${MMM_SKIP_TYPECHECK:-0}" != 1 ]]; then npx tsc --noEmit; fi
node_modules/.bin/esbuild "$ROOT/tools/wings-check.mjs" --bundle --platform=node --format=esm --log-level=warning --outfile="$CHECK_DIR/wings-check.mjs"
MMM_ROOT="$ROOT" node "$CHECK_DIR/wings-check.mjs"
