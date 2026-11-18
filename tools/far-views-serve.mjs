#!/usr/bin/env node
// Read-only task overlay. Vite serves source/public files; only four generated
// far-view files and an overlaid manifest come from the private work bake.
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import {overlayManifest} from './far-manifest.mjs';
import {execFileSync} from 'node:child_process';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,all)=>i%2?a:[...a,[v,all[i+1]]],[]));
const root=resolve(import.meta.dirname,'..'),data=resolve(args['--data-root']??root+'/data'),bake=resolve(args['--bake-root']??data+'/work/bakes/far-views');
if(bake!==resolve(data,'baked')&&!bake.startsWith(resolve(data,'work/bakes')+sep))throw Error('Use a task work bake or immutable rehearsal baked snapshot');
let before=false,mainSource=false;
const server=await createServer({root:root+'/web',server:{host:'127.0.0.1',port:Number(args['--port']??5379),strictPort:true},plugins:[{name:'far-views-source-control',enforce:'pre',load(id){const path=id.split('?')[0];if(!mainSource||!path.startsWith(root+'/web/src/'))return;try{return execFileSync('git',['show','f965706:'+path.slice(root.length+1)],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']});}catch{return undefined;}}},{name:'far-views-work-overlay',configureServer(s){
 s.middlewares.use(async(req,res,next)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/__far-views-source'){mainSource=url.searchParams.get('mode')==='main';s.moduleGraph.invalidateAll();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({source:mainSource?'f965706':'head'}));return;}
  if(url.pathname==='/__far-views-mode'){before=url.searchParams.get('mode')==='before';res.setHeader('Content-Type','application/json');res.end(JSON.stringify({before}));return;}
  const match=url.pathname.match(/^\/(terrain|areas\/(?:judique|porthood|pointtupper|westbay|cansocauseway))\/(manifest\.json|tall\.json|far-land\.json|far-land-(?:desktop|low)\.bin)$/);
  if(!match)return next();
  try{
   if(match[2]==='manifest.json'){
    const bytes=await overlayManifest(data,bake,match[1],before);
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(bytes);return;
   }
   if(before)return next();
   const file=resolve(bake,match[1],match[2]);const bytes=await readFile(file);
   res.setHeader('Content-Type',match[2].endsWith('.json')?'application/json':'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(bytes);
  }catch(error){res.statusCode=404;res.end('Missing work bake file: '+error.message);}
 });
}}]});
await server.listen();console.log('Far-view read-only overlay on http://127.0.0.1:'+server.config.server.port);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0);});
