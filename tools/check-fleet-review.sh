#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-fleet-review-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT/web"
ROOT="$ROOT" CHECK_DIR="$CHECK_DIR" node --input-type=module <<'JS'
import {build} from 'esbuild';import {execFileSync} from 'node:child_process';
const root=process.env.ROOT,ref=process.env.BASELINE_REF;
await build({entryPoints:[root+'/tools/fleet-review-check.mjs'],bundle:true,platform:'node',format:'esm',outfile:process.env.CHECK_DIR+'/check.mjs',plugins:ref?[{name:'reviewed-production-source',setup(b){b.onLoad({filter:/[/\\]tools[/\\]phone-ground\.mjs$/},a=>({contents:execFileSync('git',['show',ref+':tools/phone-ground.mjs'],{cwd:root,encoding:'utf8'}),loader:'js'}));b.onLoad({filter:/[/\\]web[/\\]src[/\\].*\.ts$/},a=>({contents:execFileSync('git',['show',ref+':'+a.path.slice(root.length+1)],{cwd:root,encoding:'utf8'}),loader:'ts'}))}}]:[]});
JS
node --expose-gc "$CHECK_DIR/check.mjs"
