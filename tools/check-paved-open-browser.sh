#!/usr/bin/env bash
# Review-only WORK overlay. No promotion and no intensity reads.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports "$@"
PAVED_WORK="${PAVED_WORK:-$(python3 "$ROOT/pipeline/paved_work.py")}"
OUT="${OUT:-$(mktemp -d "${TMPDIR:-/tmp}/paved-capture-XXXXXX")}"
cd "$ROOT/web"
browser_typecheck
start_check 1280 800 none
start_owned server "$BROWSER_LOG_DIR/vite.log" node "$ROOT/tools/paved-preview.mjs" "$PAVED_WORK" "$WEB"
SERVER="$OWNED_PID"
CDP_PORT="$CDP" run_check node "$ROOT/tools/${PAVED_CAPTURE_SCRIPT:-paved-capture.mjs}" "$OUT" "$WEB"
