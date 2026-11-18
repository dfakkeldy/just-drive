#!/usr/bin/env bash
# Existing browser checks, one at a time, with isolated writes and the task's assigned ports.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)";cd "$ROOT"
OUT="${OUT:-$ROOT/data/work/pwa/regressions}";mkdir -p "$OUT"
export OUT
if [[ -z "${PWA_CHECKS:-}" ]];then : > "$OUT/exits.txt";fi
overall=0
for name in ${PWA_CHECKS:-ui radio layout phone-help isolation};do
  case "$name" in
    ui) RUN=ui-check.mjs VIEWS='x|demo=5' tools/yard-shots.sh 1400 950 > "$OUT/ui.log" 2>&1;;
    radio) RUN=radio-check.mjs VIEWS='radio|demo=1' tools/yard-shots.sh 1280 720 > "$OUT/radio.log" 2>&1;;
    layout) RUN=layout-check.mjs VIEWS='layout|x=1' SIZES='320x568 390x844 844x390 568x280' tools/yard-shots.sh 900 900 > "$OUT/layout.log" 2>&1;;
    phone-help) RUN=phone-help-browser.mjs VIEWS='help|x=1' tools/yard-shots.sh 900 900 > "$OUT/phone-help.log" 2>&1;;
    isolation) RUN=pwa-isolation-check.mjs VIEWS='isolation|x=1' tools/yard-shots.sh 900 900 > "$OUT/isolation.log" 2>&1;;
  esac
  result=$?;echo "$name exit=$result" | tee -a "$OUT/exits.txt"
  [[ "$result" == 0 ]] || overall=1
done
exit "$overall"
