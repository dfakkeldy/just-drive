#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DENSITY_TMP="$(mktemp -d "${TMPDIR:-/tmp}/mmm-density-XXXXXX")"
trap 'rm -rf "$DENSITY_TMP"' EXIT
cd "$ROOT"
if [[ "${1:-}" == --fingerprints || "${1:-}" == --validate || "${1:-}" == --trades || "${1:-}" == --generated ]]; then
  node tools/era-density-bundle.mjs tools/era-density-fingerprint-check.mjs "$DENSITY_TMP/fingerprints.mjs"
  MMM_ROOT="$ROOT" node "$DENSITY_TMP/fingerprints.mjs"
  if [[ "${1:-}" == --fingerprints ]]; then exit; fi
fi
if [[ "${1:-}" == --round4 ]]; then
  node tools/era-density-bundle.mjs tools/era-density-round4-check.mjs "$DENSITY_TMP/round4.mjs"
  (cd web && MMM_ROOT="$ROOT" node "$DENSITY_TMP/round4.mjs")
  exit
fi
if [[ "${1:-}" == --round3 ]]; then
  node tools/era-density-bundle.mjs tools/era-density-round3-check.mjs "$DENSITY_TMP/round3.mjs"
  (cd web && MMM_ROOT="$ROOT" node "$DENSITY_TMP/round3.mjs")
  exit
fi
if [[ "${1:-}" == --review ]]; then
  node tools/era-density-bundle.mjs tools/era-density-review.mjs "$DENSITY_TMP/review.mjs"
  (cd web && MMM_ROOT="$ROOT" node "$DENSITY_TMP/review.mjs")
  node tools/era-density-door-proof.mjs
  exit
fi
node tools/era-density-bundle.mjs tools/era-density-check.mjs "$DENSITY_TMP/check.mjs"
(cd web && MMM_ROOT="$ROOT" node "$DENSITY_TMP/check.mjs" "$@")
