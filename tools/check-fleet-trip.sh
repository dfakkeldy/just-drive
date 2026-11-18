#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node tools/fleet-trip-matrix.mjs "${1:-functional}"
