// Exercise the actual flat-build config; no land, audio or site folder is needed.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build,loadConfigFromFile} from '../web/node_modules/vite/dist/node/index.js';

const root=fileURLToPath(new URL('..',import.meta.url)),web=join(root,'web');
const work=mkdtempSync(join(process.env.OUT??tmpdir(),'bridge-worker-package-'));
const previous=process.cwd();process.chdir(web);
process.env.MMM_PUBLIC='1';

async function bundle(name,external=false){
 const loaded=await loadConfigFromFile({command:'build',mode:'production'},join(web,'vite.artifact.config.ts'));
 assert.ok(loaded,'real artifact configuration');
 const plugins=loaded.config.plugins??[];
 if(external)assert.equal(plugins.filter(p=>p?.name==='inline-road-cut-worker').length,1,'one worker packaging plugin');
 const out=resolve(work,name);
 await build({...loaded.config,configFile:false,root:web,logLevel:'silent',
  plugins:external?plugins.filter(p=>p?.name!=='inline-road-cut-worker'):plugins,
  build:{...loaded.config.build,outDir:out}});
 return out;
}

function flatWorker(out){
 const app=readFileSync(join(out,'app.js'),'utf8');
 const external=readdirSync(out,{recursive:true}).filter(name=>/road-cut-worker.*\.js$/.test(name));
 assert.deepEqual(external,[],'flat bridge worker must not depend on an uncopied external asset');
 assert.ok(app.includes('data:text/javascript;base64,'),'flat build contains an inline worker constructor');
 const workers=[...app.matchAll(/["']([A-Za-z0-9+/]{400,}={0,2})["']/g)]
  .map(m=>Buffer.from(m[1],'base64').toString('utf8'))
  .filter(code=>code.includes('onmessage')&&code.includes('postMessage')&&code.includes('triangles')&&code.includes('bounds'));
 assert.equal(workers.length,1,'the bridge raster worker code travels in app.js');
}

try{
 flatWorker(await bundle('flat'));
 console.log('PASS actual flat artifact carries its bridge raster worker in app.js');
 if(process.argv.includes('--mutations')){
  const external=await bundle('external',true);
  assert.throws(()=>flatWorker(external),/uncopied external asset/,'removing worker inlining must fail');
  console.log('KILLED external bridge worker omitted by the single-file site builder');
 }
}finally{process.chdir(previous);rmSync(work,{recursive:true,force:true});}
