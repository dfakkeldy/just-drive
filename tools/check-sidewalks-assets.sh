#!/usr/bin/env bash
# Staged-data tests only. Never installs the six companions into the real baked tree.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
case "${1:-}" in
 requests-installed) unset SIDEWALK_ASSET_WORK_ROOT; RUN=sidewalks-quality-browser.mjs VIEWS='quality|x=1' tools/yard-shots.sh 1400 900; exit ;;
 flat-installed) unset SIDEWALK_ASSET_WORK_ROOT; SIDEWALK_FLAT_GATE=1 RUN=sidewalks-flat-browser.mjs VIEWS='flat|x=1' tools/yard-shots.sh 1400 900; exit ;;
esac
mkdir -p "$ROOT/data/work/checks"
WORK="$(mktemp -d "$ROOT/data/work/checks/checks-sidewalk-assets-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
node tools/sidewalks-low-bake.mjs --work-root "$WORK"
cmp "$WORK/web/src/sidewalks-assets.ts" "$ROOT/web/src/sidewalks-assets.ts"
export SIDEWALK_ASSET_WORK_ROOT="$WORK"
case "${1:-}" in
 requests) RUN=sidewalks-quality-browser.mjs VIEWS='quality|x=1' tools/yard-shots.sh 1400 900 ;;
 flat) SIDEWALK_FLAT_GATE=1 RUN=sidewalks-flat-browser.mjs VIEWS='flat|x=1' tools/yard-shots.sh 1400 900 ;;
 size) node tools/sidewalks-app-size-check.mjs ;;
 *) echo 'expected requests, flat or size' >&2;exit 2 ;;
esac
