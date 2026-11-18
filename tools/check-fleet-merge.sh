#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mmm-fleet-merge-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
cd "$ROOT"
node --input-type=module - "$WORK/check.mjs" <<'JS'
import {build} from './web/node_modules/esbuild/lib/main.js';
await build({entryPoints:['tools/fleet-quarry-merge-check.mjs'],bundle:true,platform:'node',format:'esm',outfile:process.argv[2],logLevel:'warning'});
JS
node "$WORK/check.mjs"
node tools/fleet-dev-api-check.mjs
