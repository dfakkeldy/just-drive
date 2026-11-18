#!/usr/bin/env bash
# Pure era rules, real map siting, shader isolation and fixed-step surface checks; no browser.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-era-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT"
web/node_modules/.bin/esbuild tools/era-check.mjs --bundle --platform=node --format=esm --outfile="$CHECK_DIR/check.mjs"
(cd web && MMM_ROOT="$ROOT" node "$CHECK_DIR/check.mjs")
# Negative control: with home:false removed from areaInEra, the era check must fail on the Red Roof by the Brook house in 1884.
ERA_HOME_POISON=1 ERA_REVIEW_ENTRY=tools/era-check.mjs ERA_REVIEW_OUT="$CHECK_DIR/home-poison.mjs" node tools/era-review-build.mjs
if (cd web && MMM_ROOT="$ROOT" node "$CHECK_DIR/home-poison.mjs") >"$CHECK_DIR/home.log" 2>&1; then echo 'FAIL author house escaped into 1884'; exit 1; fi
grep -q '1884 home' "$CHECK_DIR/home.log"
echo 'PASS negative control: removing home:false fails the 1884 house check'
web/node_modules/.bin/esbuild tools/era-initialization-check.mjs --bundle --platform=node --format=esm --outfile="$CHECK_DIR/init.mjs"
node "$CHECK_DIR/init.mjs"
node tools/era-shader-check.mjs

ERA_REVIEW_OUT="$CHECK_DIR/review.mjs" node tools/era-review-build.mjs
node "$CHECK_DIR/review.mjs"
ERA_INIT_POISON=1 ERA_REVIEW_ENTRY=tools/era-initialization-check.mjs ERA_REVIEW_OUT="$CHECK_DIR/init-poison.mjs" node tools/era-review-build.mjs
if node "$CHECK_DIR/init-poison.mjs" >"$CHECK_DIR/poison.log" 2>&1; then echo 'FAIL random-spy negative control'; exit 1; fi
ERA_STOP_WHEEL=1 ERA_REVIEW_OUT="$CHECK_DIR/wheel-poison.mjs" node tools/era-review-build.mjs
if ERA_REVIEW_CASE=wheel-progress node "$CHECK_DIR/wheel-poison.mjs" >"$CHECK_DIR/wheel.log" 2>&1; then echo 'FAIL wheel negative control'; exit 1; fi
echo 'PASS rejected injected import random draw and stopped wheel'
web/node_modules/.bin/esbuild tools/era-deck-check.mjs --bundle --platform=node --format=esm --outfile="$CHECK_DIR/decks.mjs"
(cd web && node "$CHECK_DIR/decks.mjs")
# Judique 1884: its own layout, labels, privacy and keep-clear; Mabou frozen; the same deck cases on Judique's bridges.
web/node_modules/.bin/esbuild tools/era-judique-check.mjs --bundle --platform=node --format=esm --outfile="$CHECK_DIR/judique.mjs"
(cd web && MMM_ROOT="$ROOT" node "$CHECK_DIR/judique.mjs")
(cd web && ERA_AREA=judique node "$CHECK_DIR/decks.mjs")

ERA_REVIEW_ENTRY=tools/era-third-check.mjs ERA_REVIEW_OUT="$CHECK_DIR/third.mjs" node tools/era-review-build.mjs
node "$CHECK_DIR/third.mjs"
ERA_SKIP_REFIT=1 ERA_REVIEW_OUT="$CHECK_DIR/refit-poison.mjs" node tools/era-review-build.mjs
if ERA_REVIEW_CASE=offscreen-fit node "$CHECK_DIR/refit-poison.mjs" >"$CHECK_DIR/refit.log" 2>&1; then echo 'FAIL disabled refit escaped'; exit 1; fi
grep -q 'offscreen-to-drawn footing gap' "$CHECK_DIR/refit.log"
ERA_BRIDGE_GRASS=1 ERA_REVIEW_ENTRY=tools/era-deck-check.mjs ERA_REVIEW_OUT="$CHECK_DIR/grass.mjs" node tools/era-review-build.mjs
if (cd web && ERA_DECK_ID=28 node "$CHECK_DIR/grass.mjs") >"$CHECK_DIR/grass.log" 2>&1; then echo 'FAIL grass bridge escaped'; exit 1; fi
grep -q 'bridge uses a loose surface, got grass' "$CHECK_DIR/grass.log"
echo 'PASS negative controls reject a disabled refit and grass on a bridge'

node tools/era-offline-check.mjs

ERA_SKIP_ART_REFIT=1 ERA_REVIEW_OUT="$CHECK_DIR/art-refit-poison.mjs" node tools/era-review-build.mjs
if ERA_REVIEW_CASE=offscreen-fit node "$CHECK_DIR/art-refit-poison.mjs" >"$CHECK_DIR/art-refit.log" 2>&1; then echo 'FAIL stale accessory escaped'; exit 1; fi
grep -q 'arriving land refits the anvil accessory too' "$CHECK_DIR/art-refit.log"
echo 'PASS accessory-only stale geometry negative control'

ERA_REVIEW_ENTRY=tools/era-final-check.mjs ERA_REVIEW_OUT="$CHECK_DIR/final.mjs" node tools/era-review-build.mjs
node "$CHECK_DIR/final.mjs"

ERA_REVIEW_ENTRY=tools/era-road-grid-check.mjs ERA_REVIEW_OUT="$CHECK_DIR/road-grid.mjs" node tools/era-review-build.mjs
node "$CHECK_DIR/road-grid.mjs"

for fault in TIE ALLOC DUP; do
  env "ERA_GRID_${fault}_POISON=1" ERA_REVIEW_ENTRY=tools/era-road-grid-check.mjs ERA_REVIEW_OUT="$CHECK_DIR/grid-$fault.mjs" node tools/era-review-build.mjs
  if node "$CHECK_DIR/grid-$fault.mjs" >"$CHECK_DIR/grid-$fault.log" 2>&1; then echo "FAIL shared grid $fault fault escaped"; exit 1; fi
  grep -q 'AssertionError' "$CHECK_DIR/grid-$fault.log"
done
echo 'PASS shared-grid negative controls reject era tie changes, hit allocations and repeated candidates'
