#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mmm-quarry-review-XXXXXX")"; trap 'rm -rf "$WORK"' EXIT
node --input-type=module - "$WORK/check.mjs" <<'JS'
import {build} from './web/node_modules/esbuild/lib/main.js';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const ref=process.env.QUARRY_REVIEW_REF;
await build({stdin:{contents:readFileSync('tools/quarry-review-check.mjs','utf8').replace('../web/node_modules/typescript/lib/typescript.js',process.cwd()+'/web/node_modules/typescript/lib/typescript.js'),resolveDir:process.cwd()+'/tools',sourcefile:'quarry-review-check.mjs'},bundle:true,platform:'node',format:'esm',define:{'import.meta.env.DEV':'false','import.meta.env.BASE_URL':JSON.stringify('/')},outfile:process.argv[2],logLevel:'warning',external:[process.cwd()+'/web/node_modules/typescript/lib/typescript.js'],plugins:ref?[{name:'reviewed-source',setup(b){if(ref==='6b31d98')b.onResolve({filter:/quarry-route$/},args=>({path:process.cwd()+'/web/src/quarry-trip.ts'}));b.onLoad({filter:/web\/src\/.*\.ts$/},args=>({contents:execFileSync('git',['show',ref+':'+args.path.slice(process.cwd().length+1)],{encoding:'utf8'}),loader:'ts',resolveDir:args.path.slice(0,args.path.lastIndexOf('/'))}));}}]:[]});
JS
QUARRY_ROOT="$ROOT" node "$WORK/check.mjs"
