#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mmm-stunt-round2-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
cd "$ROOT/web"
ROOT="$ROOT" WORK="$WORK" node --input-type=module <<'JS'
import{build}from'esbuild';import{execFileSync}from'node:child_process';import{resolve,dirname}from'node:path';
const root=process.env.ROOT,ref=process.env.STUNT_ROUND2_BASE;
await build({entryPoints:[root+'/tools/stunt-round2.mjs'],bundle:true,platform:'node',format:'esm',outfile:process.env.WORK+'/check.mjs',plugins:ref?[{name:'reviewed-game-source',setup(b){b.onLoad({filter:/[/\\]tools[/\\]phone-ground\.mjs$/},a=>({contents:execFileSync('git',['show',ref+':tools/phone-ground.mjs'],{cwd:root,encoding:'utf8'}),loader:'js'}));b.onResolve({filter:/stunt-wheel-seat$/},a=>({path:resolve(dirname(a.importer),a.path+'.ts')}));b.onLoad({filter:/[/\\]web[/\\]src[/\\].*\.ts$/},a=>({contents:execFileSync('git',['show',(a.path.endsWith('/stunt-siting.ts')?'HEAD':ref)+':'+a.path.slice(root.length+1)],{cwd:root,encoding:'utf8'}),loader:'ts'}));}}]:[]});
JS
node "$WORK/check.mjs"
