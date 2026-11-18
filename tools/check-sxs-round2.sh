#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-sxs-r2-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT/web"
ROOT="$ROOT" CHECK_DIR="$CHECK_DIR" node --input-type=module <<'JS'
import{build}from'esbuild';import ts from'typescript';import{readFileSync}from'node:fs';import{execFileSync}from'node:child_process';
const root=process.env.ROOT,baseline=process.env.SXS_ROUND2_BASELINE,hot=new Set(['sync','wheelTravel','cacheTravelPlane','setTravel','updateTravelNormals']);
function instrument(text,path){const src=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true),insert=new Map();const add=(at,s)=>insert.set(at,(insert.get(at)??'')+s);const walk=n=>{if((ts.isMethodDeclaration(n)||ts.isFunctionDeclaration(n))&&n.name&&hot.has(n.name.getText(src))){const visit=x=>{if(ts.isNewExpression(x)||ts.isArrayLiteralExpression(x)||ts.isObjectLiteralExpression(x)||ts.isArrowFunction(x)||ts.isFunctionExpression(x)||ts.isFunctionDeclaration(x)){add(x.getStart(src),'(globalThis.__sxsSyncAllocations++,');add(x.end,')');}ts.forEachChild(x,visit);};if(n.body)visit(n.body);}else ts.forEachChild(n,walk);};walk(src);for(const[at,s]of[...insert].sort((a,b)=>b[0]-a[0]))text=text.slice(0,at)+s+text.slice(at);return text;}
await build({entryPoints:[`${root}/tools/sxs-round2.mjs`],bundle:true,platform:'node',format:'cjs',outfile:`${process.env.CHECK_DIR}/check.cjs`,plugins:[{name:'round2-instrumentation',setup(b){if(baseline)b.onLoad({filter:/tools\/sxs-contact\.mjs$/},()=>{const helper=execFileSync('git',['show',`${baseline}:tools/sxs-contact.mjs`],{encoding:'utf8'}),browser=execFileSync('git',['show',`${baseline}:tools/sxs-browser.mjs`],{encoding:'utf8'}),predicate=browser.match(/ramp\.contacts\.every\(c=>([^\n]*?)\)/)[1];return{contents:helper+`\nexport function contactIsSeated(c,requireYard=false){return requireYard?(${predicate}):(c.ray&&c.deepest>-.04&&c.largestFloat<.04);}`,loader:'js'};});b.onLoad({filter:/web\/src\/(vehicle|sxs)\.ts$/},a=>{const text=baseline?execFileSync('git',['show',`${baseline}:${a.path.slice(root.length+1)}`],{encoding:'utf8'}):readFileSync(a.path,'utf8');return{contents:instrument(text,a.path),loader:'ts'};});}}]});
JS
node "$CHECK_DIR/check.cjs" "$@"
