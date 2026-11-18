#!/usr/bin/env bash
# One owned browser, exact archived main and branch on the same machine/run.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# Under check-all, write into its kept evidence folder: a pass keeps tmp/evidence/<row>/ and removes the rest.
if [[ -n "${MMM_CHECK_OUT:-}" ]]; then OUT="$MMM_CHECK_OUT/evidence/wharves-browser"; fi
OUT="${OUT:-$ROOT/data/work/wharf-pictures}"; mkdir -p "$OUT"
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/mmm-wharf-browser-XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT
BASELINE="$(git rev-parse origin/main)"
mkdir -p "$SCRATCH/main" "$SCRATCH/main/data/audio"
git archive "$BASELINE" web tools/mutation-source.mjs | tar -x -C "$SCRATCH/main"
ln -s "$ROOT/web/node_modules" "$SCRATCH/main/web/node_modules"
ln -s "$ROOT/data/baked" "$SCRATCH/main/data/baked"
ln -s "$ROOT/data/audio/out" "$SCRATCH/main/data/audio/out"
export WHARF_MAIN_ROOT="$SCRATCH/main" WHARF_MAIN_SHA="$BASELINE" WHARF_HEAD_SHA="$(git rev-parse HEAD)"
OUT="$OUT" RUN=wharf-browser.mjs VIEWS='wharf|area=judique&radio=0&mode=explore' "$ROOT/tools/yard-shots.sh" 1280 720
