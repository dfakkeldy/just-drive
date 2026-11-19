// Execute the actual flat-build wrapper: module initializers stay deferred even with inlineDynamicImports.
import assert from 'node:assert/strict';
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.cwd(),work=mkdtempSync(join(tmpdir(),'quarry-deferred-'));
try{
 const modulePath=join(work,'plugin.mjs');await build({entryPoints:['web/quarry-lazy-build.ts'],bundle:true,platform:'node',format:'esm',outfile:modulePath,packages:'external',logLevel:'silent'});
 // Resolve the installed build tool from the plugin's original location.
 let pluginSource=(await import('node:fs')).readFileSync(modulePath,'utf8');pluginSource=pluginSource.replace('from "esbuild"','from '+JSON.stringify(root+'/web/node_modules/esbuild/lib/main.js'));
 writeFileSync(modulePath,pluginSource);
 const {quarryLazyBuild}=await import(pathToFileURL(modulePath));process.env.QUARRY_EVAL_PROBE='1';
 // import.meta.url belongs to the original config in production; the bundled test plugin points to scratch.
 const plugin=quarryLazyBuild(),entry=resolve('web/src/quarry-feature.ts');
 // Build a second copy with the factory's entry path pinned to its real source.
 pluginSource=pluginSource.replace('new URL("./src/quarry-feature.ts", import.meta.url)',JSON.stringify(pathToFileURL(entry).href));writeFileSync(join(work,'pinned.mjs'),pluginSource);
 const pinned=await import(pathToFileURL(join(work,'pinned.mjs'))),active=pinned.quarryLazyBuild();
 let data;const source=await active.load.call({emitFile(asset){data=JSON.parse(asset.source);}},entry);
 const savedFetch=globalThis.fetch;globalThis.fetch=async()=>({ok:true,json:async()=>data});assert.ok(source,'actual flat-build loader handles quarry feature');
 for(const eager of [false,true,'leaked-module']){
  const file=join(work,String(eager)+'.mjs');await build({stdin:{contents:(eager==='leaked-module'?`import ${JSON.stringify(root+'/web/src/quarry.ts')};\n`:'')+source+(eager===true?'\nawait load();':''),resolveDir:root+'/web'},bundle:true,platform:'node',format:'esm',define:{'import.meta.env.BASE_URL':'"./"'},outfile:file,logLevel:'silent',plugins:[{name:'observe-external-quarry-evaluation',setup(b){b.onLoad({filter:/web\/src\/quarry(?:-[^/]+)?\.ts$/},args=>args.path.endsWith('/quarry-trip.ts')?null:({contents:`(globalThis.__quarryEvaluations??=[]).push(${JSON.stringify('outside factory:')}+${JSON.stringify(args.path)});\n`+readFileSync(args.path,'utf8'),loader:'ts',resolveDir:args.path.slice(0,args.path.lastIndexOf('/'))}));}}]});
  globalThis.__quarryEvaluations=[];const feature=await import(pathToFileURL(file));
  if(eager){assert.throws(()=>assert.deepEqual(globalThis.__quarryEvaluations,[]));console.log('REJECTED '+(eager==='leaked-module'?'a quarry module imported outside its deferred factory':'eager initialization in the published flat build'));continue;}
  assert.deepEqual(globalThis.__quarryEvaluations,[],'Mabou mail path evaluates no quarry implementation module');
  const loaded=await feature.load();assert.equal(typeof loaded.Quarry,'function');assert.ok(globalThis.__quarryEvaluations.includes('quarry-lakes.ts'));assert.ok(globalThis.__quarryEvaluations.includes('quarry-site.ts'));assert.ok(globalThis.__quarryEvaluations.includes('quarry.ts'));assert.ok(globalThis.__quarryEvaluations.includes('quarry-stunt-park.ts'));assert.equal(typeof loaded.createQuarryStuntPark,'function');assert.equal(globalThis.__quarryEvaluations.length,10);
  const count=globalThis.__quarryEvaluations.length;assert.equal(await feature.load(),loaded);assert.equal(globalThis.__quarryEvaluations.length,count);console.log('PASS flat build defers',count,'quarry modules until the area flag calls load; initializes once');
 }
 globalThis.fetch=savedFetch;
}finally{delete process.env.QUARRY_EVAL_PROBE;rmSync(work,{recursive:true,force:true});}
