// Bundle a TypeScript-importing Node check without touching the source tree.
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const [entry,...args]=process.argv.slice(2),dir=mkdtempSync(join(tmpdir(),'mmm-node-check-'));
try {
  await build({entryPoints:[resolve(entry)],bundle:true,platform:'node',format:'esm',outfile:dir+'/check.mjs',logLevel:'warning',plugins:[{name:'node-check-paths',setup(b){
    b.onResolve({filter:/esbuild\/lib\/main\.js$/},a=>({path:resolve(a.resolveDir,a.path),external:true}));
    b.onLoad({filter:/\.mjs$/},a=>({contents:readFileSync(a.path,'utf8').replaceAll('import.meta.url',JSON.stringify(pathToFileURL(a.path).href)).replaceAll('import.meta.dirname',JSON.stringify(dirname(a.path))),loader:'js'}));
  }}]});
  const run=spawnSync(process.execPath,[dir+'/check.mjs',...args],{stdio:'inherit',env:{...process.env,MMM_ROOT:process.cwd()}});
  process.exitCode=run.status??1;
} finally { rmSync(dir,{recursive:true,force:true}); }
