#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-trailer-check-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT/web"
if [[ "${TRAILER_ROUND3_ONLY:-}" != "1" && -z "${TRAILER_BASELINE:-}" ]]; then
  TRAILER_ROUND3_ONLY=1 "$ROOT/tools/check-trailer.sh"
fi
if [[ "${TRAILER_ROUND3_ONLY:-}" == "1" ]]; then
  ROOT="$ROOT" CHECK_DIR="$CHECK_DIR" node --input-type=module <<'JS'
import {build} from 'esbuild';import ts from 'typescript';import{readFileSync}from'node:fs';import{execFileSync}from'node:child_process';
const root=process.env.ROOT,ref=process.env.TRAILER_BASELINE;
const hot=new Set(['control','hitch','ground','step','correctGround','solveCoupler','attitude','fitPlane','prepareProbe','bodies','pairClear','snapshot','rememberValid','restoreValid','collide','projectTrailer','update','checkpointGround','lateralCirclesInBounds','deckHeight']);
function instrument(text,path){let expressions=0;const src=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true),insert=new Map();const add=(at,s)=>insert.set(at,(insert.get(at)??'')+s);const walk=n=>{if(ts.isMethodDeclaration(n)&&n.name&&hot.has(n.name.getText(src))){const visit=x=>{if(ts.isNewExpression(x)||ts.isArrayLiteralExpression(x)||ts.isObjectLiteralExpression(x)||ts.isArrowFunction(x)||ts.isFunctionExpression(x)||ts.isFunctionDeclaration(x)){if(path.endsWith('/towing.ts')||n.name.getText(src)==='checkpointGround'||path.endsWith('/roads.ts')&&n.name.getText(src)==='deckHeight')expressions++;add(x.getStart(src),'(globalThis.__towAllocations++,');add(x.end,')');}ts.forEachChild(x,visit);};if(n.body)visit(n.body);}else ts.forEachChild(n,walk);};walk(src);for(const[at,s]of[...insert].sort((a,b)=>b[0]-a[0]))text=text.slice(0,at)+s+text.slice(at);if(path.endsWith('/towing.ts'))text+='\nglobalThis.__towHotSourceExpressions='+expressions+';';if(path.endsWith('/roads.ts'))text+='\nglobalThis.__towDeckSourceExpressions='+expressions+';';return text;}
await build({entryPoints:[`${root}/tools/trailer-physics.mjs`],bundle:true,platform:'node',format:'esm',outfile:`${process.env.CHECK_DIR}/check.mjs`,plugins:[{name:'round3',setup(b){if(ref)b.onResolve({filter:/^\.\/wheel-support$/},()=>({path:`${root}/web/src/wheel-support.ts`}));b.onLoad({filter:/[/\\]web[/\\]src[/\\].*\.ts$/},a=>{let text=ref?execFileSync('git',['show',`${ref}:${a.path.slice(root.length+1)}`],{cwd:root,encoding:'utf8'}):readFileSync(a.path,'utf8');if(/[/\\](towing|vehicle|roads)\.ts$/.test(a.path))text=instrument(text,a.path);return{contents:text,loader:'ts'};});}}]});
JS
  node "$CHECK_DIR/check.mjs"
  exit
fi
if [[ -n "${TRAILER_BASELINE:-}" ]]; then
  ROOT="$ROOT" CHECK_DIR="$CHECK_DIR" node --input-type=module <<'JS'
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
const root=process.env.ROOT,ref=process.env.TRAILER_BASELINE;
await build({entryPoints:[`${root}/tools/trailer-physics.mjs`],bundle:true,platform:'node',format:'esm',outfile:`${process.env.CHECK_DIR}/check.mjs`,plugins:[{name:'review-baseline',setup(b){if(ref)b.onResolve({filter:/^\.\/wheel-support$/},()=>({path:`${root}/web/src/wheel-support.ts`}));b.onLoad({filter:/[/\\]web[/\\]src[/\\].*\.ts$/},args=>{const relative=args.path.slice(`${root}/`.length);if(relative==='web/src/sxs.ts'){try{execFileSync('git',['cat-file','-e',`${ref}:${relative}`],{cwd:root,stdio:'ignore'});}catch{return;}}return{contents:execFileSync('git',['show',`${ref}:${relative}`],{cwd:root,encoding:'utf8'}),loader:'ts'};});}}]});
JS
else
  node_modules/.bin/esbuild "$ROOT/tools/trailer-physics.mjs" --bundle --platform=node --format=esm --outfile="$CHECK_DIR/check.mjs"
fi
if [[ "${TRAILER_REGRESSIONS_ONLY:-}" != "1" && -z "${TRAILER_BASELINE:-}" ]]; then
  ROOT="$ROOT" CHECK_DIR="$CHECK_DIR" node --input-type=module <<'JS'
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
const root=process.env.ROOT,ref=execFileSync('git',['rev-parse',process.env.TRAILER_MAIN_REF??'origin/main'],{cwd:root,encoding:'utf8'}).trim();
console.log('MAIN ORACLE BASE',ref);
await build({stdin:{contents:`export {Vehicle,autopilot} from '${root}/web/src/vehicle.ts';`,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:`${process.env.CHECK_DIR}/stock.mjs`,plugins:[{name:'stock-oracle',setup(b){b.onLoad({filter:/[/\\]web[/\\]src[/\\].*\.ts$/},args=>({contents:execFileSync('git',['show',`${ref}:${args.path.slice(root.length+1)}`],{cwd:root,encoding:'utf8'}),loader:'ts'}));}}]});
JS
  export TRAILER_TRUCK_ORACLE="$CHECK_DIR/stock.mjs"
fi
node "$CHECK_DIR/check.mjs" "$@"
