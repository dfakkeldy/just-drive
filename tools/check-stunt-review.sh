#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-stunt-review-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT/web"
export ROOT CHECK_DIR
node --input-type=module <<'JS'
import {build} from 'esbuild';import{execFileSync}from'node:child_process';
const root=process.env.ROOT,ref=process.env.STUNT_REVIEW_BASE;
await build({entryPoints:[`${root}/tools/stunt-review-regressions.mjs`],bundle:true,platform:'node',format:'esm',outfile:`${process.env.CHECK_DIR}/check.mjs`,plugins:ref?[{name:'frozen-review',setup(b){b.onLoad({filter:/[/\\]tools[/\\]phone-ground\.mjs$/},a=>({contents:execFileSync('git',['show',ref+':tools/phone-ground.mjs'],{cwd:root,encoding:'utf8'}),loader:'js'}));b.onLoad({filter:/[/\\]web[/\\]src[/\\].*\.ts$/},a=>({contents:execFileSync('git',['show',`${ref}:${a.path.slice(root.length+1)}`],{cwd:root,encoding:'utf8'}),loader:'ts'}));}}]:[]});
JS
node "$CHECK_DIR/check.mjs"
