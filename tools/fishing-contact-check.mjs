#!/usr/bin/env node
// Real PNG tiles, production Terrain/Vehicle and independent THREE rays. No browser or GPU.
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(join(tmpdir(),'mmm-fishing-contact-'));
const ref=process.env.FISHING_TEST_REF,mutation=process.env.FISHING_CONTACT_MUTATION;
try{
 await build({entryPoints:[join(root,'tools/fishing-contact-cases.mjs')],bundle:true,platform:'node',format:'esm',outfile:join(dir,'check.mjs'),logLevel:'silent',plugins:[{name:'real-tiles-without-browser',setup(b){
  b.onLoad({filter:/\/web\/src\/.*\.ts$/},args=>{
   const relative=args.path.slice(root.length+1);let source=ref?execFileSync('git',['show',`${ref}:${relative}`],{cwd:root,encoding:'utf8'}):readFileSync(args.path,'utf8');
   if(relative==='web/src/terrain.ts'){
    source=source.replace(/async function readPng\(base: string, path: string\): Promise<Uint8ClampedArray> \{[\s\S]*?\n\}/,'async function readPng(base:string,path:string):Promise<Uint8ClampedArray>{return globalThis.__fishingReadPng(base,path);}');
    if(mutation==='surface')source=source.replace('if (surface && site.deckDriving)','if (false && surface && site.deckDriving)');
    if(mutation==='mesh')source=source.replaceAll('if (this.groundContact && this.wantsDrawnContact(x,z))','if (false && this.groundContact && this.wantsDrawnContact(x,z))');
   }
   return {contents:source,loader:'ts'};
  });
 }}]});
 const run=spawnSync(process.execPath,[join(dir,'check.mjs')],{cwd:root,env:{...process.env,FISHING_CONTACT_ROOT:root},stdio:'inherit'});process.exitCode=run.status??1;
}finally{rmSync(dir,{recursive:true,force:true});}
