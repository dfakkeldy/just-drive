#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-fleet-review-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT/web"
ROOT="$ROOT" CHECK_DIR="$CHECK_DIR" node --input-type=module <<'JS'
import {build} from 'esbuild';import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
const root=process.env.ROOT,ref=process.env.BASELINE_REF;const overrides=[['fleet.ts',process.env.FLEET_SOURCE],['fleet-motion.ts',process.env.MOTION_SOURCE],['fleet-surface.ts',process.env.SURFACE_SOURCE],['fleet-checkpoint.ts',process.env.CHECKPOINT_SOURCE]].filter(([,p])=>p);
await build({entryPoints:[root+'/tools/'+(process.env.REVIEW_ENTRY??'fleet-round2-check.mjs')],bundle:true,platform:'node',format:'esm',outfile:process.env.CHECK_DIR+'/check.mjs',plugins:[... (overrides.length?[{name:'fleet-movement-fault',setup(b){b.onLoad({filter:/[/\\]web[/\\]src[/\\]fleet(?:-motion|-surface|-checkpoint)?\.ts$/},a=>{const path=overrides.find(([n])=>a.path.endsWith('/'+n))?.[1];return path?{contents:readFileSync(path,'utf8'),loader:'ts'}:undefined})}}]:[]),... (ref?[{name:'reviewed-production-source',setup(b){b.onLoad({filter:/[/\\]tools[/\\]phone-ground\.mjs$/},a=>({contents:execFileSync('git',['show',ref+':tools/phone-ground.mjs'],{cwd:root,encoding:'utf8'}),loader:'js'}));b.onLoad({filter:/[/\\]web[/\\]src[/\\].*\.ts$/},a=>({contents:execFileSync('git',['show',ref+':'+a.path.slice(root.length+1)],{cwd:root,encoding:'utf8'}),loader:'ts'}))}}]:[])]});
JS
node --expose-gc "$CHECK_DIR/check.mjs"
