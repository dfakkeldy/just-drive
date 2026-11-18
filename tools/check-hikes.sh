#!/usr/bin/env bash
# Explore planning: pure data checks, then real input, map, phone, path and area checks.
# --pure skips the browser. SHOTS=1 writes the requested pictures; HIKES_MUTATIONS=1 proves browser failures.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-hikes-check-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT/web"
npx tsc --noEmit
node_modules/.bin/esbuild "$ROOT/tools/hikes-rules-check.mjs" --bundle --platform=node --format=esm --outfile="$CHECK_DIR/check.mjs"
MMM_ROOT="$ROOT" node "$CHECK_DIR/check.mjs"
if [[ "${1:-}" == --pure ]]; then exit 0; fi
cd "$ROOT"
for _ in 1 2 3 4; do
  ACTIVE="$(pgrep -fl remote-debugging-port | awk '$1 ~ /^[0-9]+$/ && $2 !~ /^(\/bin\/(ba|z)sh|.*python.*|awk|pgrep)$/ && /--headless=new --remote-debugging-port=/ {print $1}' || true)"
  if [[ -z "$ACTIVE" ]]; then break; fi
  echo "Waiting for browser job $ACTIVE"
  sleep 45
done
if [[ "${SHOTS:-0}" == 1 ]]; then OUT="${HIKES_SHOTS_OUT:-$ROOT/data/work/threads/explore/pictures}"; fi
RUNNER=hikes-check.mjs
if [[ "${HIKES_MUTATIONS:-0}" == 1 ]]; then RUNNER=hikes-mutations.mjs; fi
OUT="${OUT:-$ROOT/data/work/threads/explore/stage3a}" RUN="$RUNNER" HUD=1 VIEWS="hikes|mode=explore" WEB_PORT="${WEB_PORT:-5243}" CDP_PORT="${CDP_PORT:-9443}" "$ROOT/tools/yard-shots.sh" 1600 1000
