#!/usr/bin/env bash
# Staged-data tests only. Never installs the six companions into the real baked tree.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
case "${1:-}" in
 requests-installed) unset SIDEWALK_ASSET_WORK_ROOT; RUN=sidewalks-quality-browser.mjs VIEWS='quality|x=1' tools/yard-shots.sh 1400 900; exit ;;
 flat-installed) unset SIDEWALK_ASSET_WORK_ROOT; SIDEWALK_FLAT_GATE=1 RUN=sidewalks-flat-browser.mjs VIEWS='flat|x=1' tools/yard-shots.sh 1400 900; exit ;;
esac
mkdir -p "$ROOT/data/work/checks"
WORK="$(mktemp -d "$ROOT/data/work/checks/checks-sidewalk-assets-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
node tools/sidewalks-low-bake.mjs --work-root "$WORK"
if ! cmp -s "$WORK/web/src/sidewalks-assets.ts" "$ROOT/web/src/sidewalks-assets.ts";then
  # Another platform's zlib can write the same LOW graph in other gzip bytes. Only the app-size row (no companion served)
  # accepts that, after checking that desktop descriptors match and each LOW decodes to the pinned graph.
  [[ "${1:-}" == size ]]||{ echo 'staged sidewalk descriptors differ from web/src/sidewalks-assets.ts' >&2;exit 1; }
  node --input-type=module -e '
import assert from "node:assert/strict";import {readFileSync} from "node:fs";import {resolve} from "node:path";
const [root,work]=process.argv.slice(1),{areas,areaBase,unpack,graphHashes}=await import(resolve(root,"tools/sidewalks-low-bake.mjs"));
const parse=t=>JSON.parse(t.slice(t.indexOf("= ")+2,t.lastIndexOf(";"))),pins=JSON.parse(readFileSync(resolve(root,"tools/baseline/sidewalks-quality-hashes.json"))).areas;
const s=parse(readFileSync(work+"/web/src/sidewalks-assets.ts","utf8")),c=parse(readFileSync(root+"/web/src/sidewalks-assets.ts","utf8"));
for(const a of areas){assert.deepEqual(s[a].desktop,c[a].desktop,a+": desktop descriptor");assert.deepEqual(graphHashes(unpack(readFileSync(resolve(work,"data/baked",areaBase(a),"sidewalks-low.json")))),pins[a].low,a+": LOW graph");}
console.log("NOTE LOW gzip bytes differ on this platform; desktop descriptors exact and LOW graphs equal to the pins");' "$ROOT" "$WORK"
fi
export SIDEWALK_ASSET_WORK_ROOT="$WORK"
case "${1:-}" in
 requests) RUN=sidewalks-quality-browser.mjs VIEWS='quality|x=1' tools/yard-shots.sh 1400 900 ;;
 flat) SIDEWALK_FLAT_GATE=1 RUN=sidewalks-flat-browser.mjs VIEWS='flat|x=1' tools/yard-shots.sh 1400 900 ;;
 size) node tools/sidewalks-app-size-check.mjs ;;
 *) echo 'expected requests, flat or size' >&2;exit 2 ;;
esac
