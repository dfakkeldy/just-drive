#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports "$@"
OUT="${OUT:-$ROOT/data/work/threads/sidewalks/counts}"
if [[ -n "${MMM_CHECK_OUT:-}" && "$OUT" == "$MMM_CHECK_OUT" ]];then
  mkdir -p "$ROOT/data/work/checks"
  OUT="$(mktemp -d "$ROOT/data/work/checks/checks-sidewalks-counts-XXXXXX")"
  echo "Evidence kept at $OUT"
fi
mkdir -p "$OUT"
cd "$ROOT/web";browser_typecheck;start_check 1400 950
BASE_TREE='';FIXTURES=''
finish_counts(){ local result="$1";trap - EXIT INT TERM;stop_browser||result=1;if [[ -n "$BASE_TREE" ]];then for link in web/node_modules data/baked;do [[ ! -L "$BASE_TREE/$link" ]]||rm "$BASE_TREE/$link";done;git -C "$ROOT" worktree remove "$BASE_TREE"||result=1;fi;[[ -z "$FIXTURES" ]]||rmdir "$FIXTURES"||true;finish_check "$result"; }
trap 'finish_counts "$?"' EXIT
# Default baseline: this tree with ?sidewalks=0 (main's page: no companion, slab, clearing or pole move), so the row
# still means something after a squash merge. SIDEWALK_COUNT_BASE_REF=<commit> compares against a separate checkout.
if [[ -n "${SIDEWALK_COUNT_BASE_REF:-}" ]];then
FIXTURES="$(mktemp -d "${TMPDIR:-/tmp}/mmm-sidewalk-counts-XXXXXX")";BASE_TREE="$FIXTURES/main"
git -C "$ROOT" worktree add --detach "$BASE_TREE" "$SIDEWALK_COUNT_BASE_REF"
mkdir -p "$BASE_TREE/data"
for link in web/node_modules data/baked;do source="$(cd "$ROOT/$link"&&pwd -P)";ln -s "$source" "$BASE_TREE/$link";done
COUNT_BASE_PORT=$((WEB+1000));COUNT_BASE_AUX_PORT=$((CDP+1000))
export SIDEWALK_MEASURE_BASE_REF="$(git -C "$BASE_TREE" rev-parse HEAD)" BASE_URL="http://127.0.0.1:$COUNT_BASE_PORT"
if grep -q loadFarViews "$BASE_TREE/web/src/main.ts";then export SIDEWALK_COUNT_BASE_FAR=1;else export SIDEWALK_COUNT_BASE_FAR=0;fi
python3 "$ROOT/tools/check-ports.py" --probe "$COUNT_BASE_PORT" "$COUNT_BASE_AUX_PORT"
start_owned baseline "$BROWSER_LOG_DIR/baseline.log" python3 "$ROOT/tools/check-ports.py" "$COUNT_BASE_PORT" "$COUNT_BASE_AUX_PORT" /bin/bash -c 'cd "$1/web"&&exec ./node_modules/.bin/vite --host 127.0.0.1 --port "$2" --strictPort' _ "$BASE_TREE" "$COUNT_BASE_PORT"
baseline_ready=0
for n in {1..100};do if curl --max-time 1 -fsS -o /dev/null "$BASE_URL/";then baseline_ready=1;break;fi;sleep .1;done
[[ "$baseline_ready" == 1 ]]||{ echo 'count baseline server did not become ready' >&2;exit 2; }
else
unset BASE_URL;export SIDEWALK_MEASURE_BASE_REF="$(git -C "$ROOT" rev-parse HEAD) with ?sidewalks=0"
fi
CDP_PORT="$CDP" run_check node "$ROOT/tools/sidewalks-counts.mjs" "$OUT" "http://127.0.0.1:$WEB/"
