#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-stunt-shader-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT"
node tools/coast-source-check.mjs
ROOT="$ROOT" CHECK_DIR="$CHECK_DIR" node --input-type=module <<'JS'
import{build}from'./web/node_modules/esbuild/lib/main.js';
await build({entryPoints:[process.env.ROOT+'/tools/stunt-shader-check.mjs'],bundle:true,platform:'node',format:'esm',outfile:process.env.CHECK_DIR+'/check.mjs',plugins:[{name:'native-pin-reader',setup(b){b.onResolve({filter:/^\.\/coast-programs\.mjs$/},()=>({path:process.env.ROOT+'/tools/coast-programs.mjs',external:true}));}}]});
JS
cd "$ROOT/web"
MMM_ROOT="$ROOT" node "$CHECK_DIR/check.mjs"
