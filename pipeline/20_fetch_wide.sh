#!/usr/bin/env bash
# 16 m horizon for the area's quadtree root; areas on the same root share paths.
# --dry-run prints pixel counts, sizes and existing/shared files without fetching.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/tools/bake.sh" fetch_elevation.py --wide "$@"
