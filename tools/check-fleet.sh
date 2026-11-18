#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmm-fleet-check-XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$ROOT/web"
npx tsc --noEmit
if [[ -n "${FLEET_SOURCE:-}" ]]; then
  ROOT="$ROOT" CHECK_DIR="$CHECK_DIR" node --input-type=module <<'JS'
import {build} from 'esbuild';import {readFileSync} from 'node:fs';
await build({entryPoints:[process.env.ROOT+'/tools/fleet-check.mjs'],bundle:true,platform:'node',format:'esm',outfile:process.env.CHECK_DIR+'/check.mjs',plugins:[{name:'fleet-source-fault',setup(b){b.onLoad({filter:/[/\\]web[/\\]src[/\\]fleet\.ts$/},()=>({contents:readFileSync(process.env.FLEET_SOURCE,'utf8'),loader:'ts'}))}}]});
JS
else
  node_modules/.bin/esbuild "$ROOT/tools/fleet-check.mjs" --bundle --platform=node --format=esm --outfile="$CHECK_DIR/check.mjs"
fi
ROOT="$ROOT" CHECK_DIR="$CHECK_DIR" node --input-type=module <<'JS'
import {build} from 'esbuild';import {execFileSync} from 'node:child_process';
const root=process.env.ROOT,ref=execFileSync('git',['rev-parse',process.env.FLEET_MAIN_REF??'origin/main'],{cwd:root,encoding:'utf8'}).trim();
console.log('FLEET ORACLE BASE',ref);
await build({stdin:{contents:`export {GARAGE} from '${root}/web/src/garage.ts';export {Vehicle} from '${root}/web/src/vehicle.ts';export {Towing} from '${root}/web/src/towing.ts';`,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:process.env.CHECK_DIR+'/stock.mjs',plugins:[{name:'stock',setup(b){b.onLoad({filter:/[/\\]web[/\\]src[/\\].*\.ts$/},a=>({contents:execFileSync('git',['show',ref+':'+a.path.slice(root.length+1)],{cwd:root,encoding:'utf8'}),loader:'ts'}))}}]});
JS
export FLEET_STOCK_ORACLE="$CHECK_DIR/stock.mjs"
node --expose-gc "$CHECK_DIR/check.mjs" "$@"
