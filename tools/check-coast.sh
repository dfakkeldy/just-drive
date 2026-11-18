#!/usr/bin/env bash
# CPU/source rules. Browser/ray/pixel checks: RUN=coast-browser.mjs tools/yard-shots.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-coast-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT"
(cd web && if [[ "${MMM_SKIP_TYPECHECK:-0}" != 1 ]]; then npx tsc --noEmit; fi)
node tools/coast-source-check.mjs
node tools/water-source-check.mjs
node tools/coast-mutations.mjs
python3 tools/coast-survey.py --trees
web/node_modules/.bin/esbuild tools/coast-tree-check.mjs --bundle --platform=node --format=esm --outfile="$CHECK_DIR/tree.mjs"
node "$CHECK_DIR/tree.mjs"
