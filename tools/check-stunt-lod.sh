#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mmm-stunt-lod-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
cd "$ROOT/web"
ROOT="$ROOT" WORK="$WORK" node --input-type=module <<'JS'
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const root=process.env.ROOT,ref=execFileSync('git',['rev-parse',process.env.STUNT_LOD_BASE??'origin/main'],{encoding:'utf8'}).trim();
await build({stdin:{contents:`export {makeGround} from '${root}/tools/phone-ground.mjs';`,resolveDir:root},bundle:true,platform:'node',format:'esm',outfile:process.env.WORK+'/main.mjs',logLevel:'silent',plugins:[{name:'main-land',setup(b){b.onLoad({filter:/[/\\]web[/\\]src[/\\].*\.ts$/},a=>({contents:execFileSync('git',['show',ref+':'+a.path.slice(root.length+1)],{cwd:root,encoding:'utf8'}),loader:'ts'}));}}]});
await build({entryPoints:[root+'/tools/stunt-lod-check.mjs'],bundle:true,platform:'node',format:'esm',outfile:process.env.WORK+'/check.mjs',logLevel:'silent',plugins:process.env.STUNT_LOD_MUTANT?[{name:'ordinary-terrain-fault',setup(b){b.onLoad({filter:/[/\\]web[/\\]src[/\\]terrain\.ts$/},a=>{
  const source=readFileSync(a.path,'utf8'),anchor='ground[k] = g;';
  if(source.split(anchor).length!==2)throw Error('main-path mutant anchor must be unique');
  return{contents:source.replace(anchor,'ground[k] = g + (sites.length===0 ? .1 : 0);'),loader:'ts'};
});}}]:[]});
JS
STUNT_LOD_MAIN="$WORK/main.mjs" node --expose-gc "$WORK/check.mjs"
