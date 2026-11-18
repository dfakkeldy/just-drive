#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-phone-check-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT/web"
PHONE_CHECK_DIR="$CHECK_DIR" node "$ROOT/tools/phone-build.mjs" "$@"
PHONE_CHECK_DIR="$CHECK_DIR" PHONE_BASELINE="$CHECK_DIR/baseline.mjs" node "$CHECK_DIR/check.mjs" "$@"
