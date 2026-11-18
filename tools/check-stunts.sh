#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/web"
exec node "$ROOT/tools/run-node-check.mjs" "$ROOT/tools/stunt-check.mjs" "$@"
