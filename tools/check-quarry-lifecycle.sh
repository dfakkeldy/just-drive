#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mmm-quarry-lifecycle-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
cd "$ROOT"
web/node_modules/.bin/esbuild tools/quarry-lifecycle-check.mjs --bundle --platform=node --format=esm --define:import.meta.env.DEV=false --log-level=warning --outfile="$WORK/check.mjs"
node "$WORK/check.mjs"
