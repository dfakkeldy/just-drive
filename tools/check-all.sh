#!/usr/bin/env bash
# Serial inventory runner. See --help; checks.tsv is the sole check registry.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec python3 "$ROOT/tools/check-all.py" "$@"
