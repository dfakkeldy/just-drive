#!/bin/bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec python3 "$ROOT/tools/remote_runner.py" "$@"
