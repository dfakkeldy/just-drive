#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec node tools/run-node-check.mjs tools/light-study-check.mjs "$@"
