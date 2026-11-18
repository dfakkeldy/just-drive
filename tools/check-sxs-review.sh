#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-sxs-review-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT/web"
ROOT="$ROOT" CHECK_DIR="$CHECK_DIR" node --input-type=module <<'JS'
import { readBaseline } from '../tools/baseline-source.mjs';
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
const root=process.env.ROOT,baseline=process.env.SXS_REVIEW_BASELINE;
await build({entryPoints:[`${root}/tools/sxs-review.mjs`],bundle:true,platform:'node',format:'esm',outfile:`${process.env.CHECK_DIR}/check.mjs`,plugins:[{name:'unchanged-oracle',setup(b){b.onResolve({filter:/^sxs-previous-vehicle$/},()=>({path:'previous',namespace:'sxs-oracle'}));b.onLoad({filter:/.*/,namespace:'sxs-oracle'},()=>({contents:readBaseline('side-by-side','web/src/vehicle.ts'),loader:'ts',resolveDir:`${root}/web/src`}));}},...baseline?[{name:'review-baseline',setup(b){b.onLoad({filter:/tools\/sxs-contact\.mjs$/},()=>{let old=execFileSync('git',['show',`${baseline}:tools/sxs-browser.mjs`],{encoding:'utf8'});old=old.slice(old.indexOf('tt.contacts=()=>{')+'tt.contacts=()=>{'.length,old.indexOf(' // Drive up')).trim().slice(0,-2);old=old.replaceAll('v.car','rig').replace('[terrain.group,yard.group]','objects').replaceAll('tt.shown(n)','shown(n)').replaceAll('n===yard.group','n===objects[1]');return{contents:`export function tyreContacts(THREE,rig,objects){const shown=o=>{for(let n=o;n;n=n.parent)if(!n.visible)return false;return true;};${old}}`,loader:'js'};});b.onLoad({filter:/web\/src\/(vehicle|sxs)\.ts$/},a=>({contents:execFileSync('git',['show',`${baseline}:${a.path.slice(root.length+1)}`],{encoding:'utf8'}),loader:'ts'}));}}]:[]]});
JS
node "$CHECK_DIR/check.mjs" "$@"
