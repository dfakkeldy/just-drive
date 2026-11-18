#!/usr/bin/env bash
# Read-only site, route, collision, water, shader and mutation checks. Real-page checks use quarry-browser.mjs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mmm-quarry-check-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
cd "$ROOT"
(cd web && if [[ "${MMM_SKIP_TYPECHECK:-0}" != 1 ]]; then npx tsc --noEmit; fi)
node --input-type=module - "$WORK/check.mjs" <<'JS'
import {build} from './web/node_modules/esbuild/lib/main.js';
import {execFileSync} from 'node:child_process';
const ref=process.env.QUARRY_TREE_BASE_REF;
await build({entryPoints:['tools/quarry-check.mjs'],bundle:true,platform:'node',format:'esm',outfile:process.argv[2],logLevel:'warning',plugins:ref?[{name:'tree-regression-control',setup(b){b.onLoad({filter:/web\/src\/trees\.ts$/},args=>({contents:execFileSync('git',['show',ref+':web/src/trees.ts'],{encoding:'utf8'}),loader:'ts',resolveDir:new URL('./web/src/',import.meta.url).pathname}));}}]:[]});
JS
QUARRY_ROOT="$ROOT" node "$WORK/check.mjs"
node tools/coast-source-check.mjs
node tools/water-source-check.mjs

/bin/bash tools/check-quarry-review.sh
node tools/quarry-deferred-check.mjs
node tools/run-node-check.mjs tools/quarry-coast-parity.mjs
