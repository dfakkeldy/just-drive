#!/usr/bin/env bash
# Stand-in integration fixture: real port locks, lease, watchdogs and shared startup, no renderer.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports "$@"
start_check 600 400
python3 - "$BROWSER_SLOT_LEASE" "$MMM_PROOF_STATE" <<'PY'
import json, pathlib, sys
lease=pathlib.Path(sys.argv[1]); path=pathlib.Path(sys.argv[2])
value=json.loads((lease/'ready.json').read_text()); value['lease']=str(lease)
path.write_text(json.dumps(value))
PY
run_check node "$ROOT/tools/check-ports-probe.mjs" "${OUT:-/tmp}" "http://127.0.0.1:$WEB/?name=proof&x=1"
exit "${PROBE_EXIT:-0}"
