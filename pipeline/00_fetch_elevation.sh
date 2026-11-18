#!/usr/bin/env bash
# Lossless HRDEM 1 m source-grid fetch for MMM_AREA (default mabou).
# --dry-run prints native windows, pixel counts and the complete-area size estimate.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/tools/bake.sh" fetch_elevation.py "$@"
