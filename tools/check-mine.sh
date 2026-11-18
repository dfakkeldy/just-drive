#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-mine-check-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT/web"
if [[ "${MMM_SKIP_TYPECHECK:-0}" != 1 ]]; then npx tsc --noEmit; fi
for check in mine-check mine-integration; do
  node_modules/.bin/esbuild "$ROOT/tools/$check.mjs" --bundle --platform=node --format=esm --outfile="$CHECK_DIR/$check.mjs"
  node "$CHECK_DIR/$check.mjs"
done
