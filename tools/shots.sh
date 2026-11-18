#!/usr/bin/env bash
# The picture entry point uses the same owned ports, browser and cleanup as check runs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/tools/yard-shots.sh" "$@"
