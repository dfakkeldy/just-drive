import {build} from '../web/node_modules/esbuild/lib/main.js';
import {resolve} from 'node:path';
const [entry,outfile]=process.argv.slice(2),root=process.cwd();
await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',outfile,plugins:[{name:'native-esbuild-helper',setup(b){b.onResolve({filter:/era-density-pr70\.mjs$/},()=>({path:resolve(root,'tools/era-density-pr70.mjs'),external:true}));}}]});
