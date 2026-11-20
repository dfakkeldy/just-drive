// Real flat SITE command and bytes, served without Vite transforms. Audit mode is collection, not a release PASS.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync,unlinkSync,readdirSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {cdp,cdpFetch,sleep} from './cdp.mjs';
const root=resolve(import.meta.dirname,'..'),gate=process.env.SIDEWALK_FLAT_GATE==='1',port=process.env.CDP_PORT;
let [out]=process.argv.slice(2);if(out===process.env.MMM_CHECK_OUT){out=mkdtempSync(resolve(root,'data/work/checks/checks-sidewalks-flat-'));console.log('Evidence kept at '+out);}mkdirSync(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex'),run=(cmd,args,options={})=>execFileSync(cmd,args,{cwd:root,stdio:'pipe',maxBuffer:32*1024*1024,...options});
const report={gate,method:'Exact build_site.sh Vite command (MMM_PUBLIC=1,VITE_MP=1), scratch ARTIFACT_OUT/SITE_OUT; unmodified app.js and chunks served with real published markup and read-only public land; no PWA inventory claim',builds:[],pages:[]},save=()=>writeFileSync(out+'/flat-audit.json',JSON.stringify(report,null,2)+'\n');
const roles=gate||process.env.SIDEWALK_FLAT_WORKING_ONLY==='1'?[['working',null]]:[...(process.env.SIDEWALK_REVIEW_REPLAYS==='1'?[['main0e','0e798a9fa5f50d92f38558726c89b9747fc5ebf0'],['b7','b7a712986fe2dd06f806abe7d2416dfd1c7c9be8']]:[]),['working',null]],trees=[];
let server,selected;
try{
 for(const [role,ref]of roles){
  let tree=root;
  if(ref){tree=resolve(out,'source-'+role);run('git',['worktree','add','--detach',tree,ref]);trees.push(tree);run('ln',['-s',resolve(root,'web/node_modules'),tree+'/web/node_modules']);}
  const dest=resolve(out,'build-'+role);mkdirSync(dest,{recursive:true});
  const env={...process.env,MMM_PUBLIC:'1',VITE_MP:'1',ARTIFACT_OUT:dest,SITE_OUT:dest};delete env.MMM_MUTATION;
  const log=run('npx',['--no-install','vite','build','-c','vite.artifact.config.ts'],{cwd:tree+'/web',env});writeFileSync(out+'/build-'+role+'.log',log);
  // The published script is app.js and its chunks (web/area-chunks-build.ts); a build from before the split has none.
  const bytes=readFileSync(dest+'/app.js'),chunkDir=dest+'/chunks',chunks=Object.fromEntries((existsSync(chunkDir)?readdirSync(chunkDir):[]).filter(name=>name.endsWith('.js')).sort().map(name=>['/chunks/'+name,sha(readFileSync(chunkDir+'/'+name))]));
  report.builds.push({role,ref:ref??'working tree at '+run('git',['rev-parse','HEAD']).toString().trim(),dest,appBytes:bytes.length,gzipBytes:gzipSync(bytes,{level:9}).length,sha256:sha(bytes),chunks});save();
 }
 const markup='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'+readFileSync(root+'/artifact/page.html','utf8')+'</body></html>';
 const mime={'.js':'application/javascript','.json':'application/json','.html':'text/html','.png':'image/png','.bin':'application/octet-stream','.glb':'model/gltf-binary','.css':'text/css'};
 server=createServer((req,res)=>{
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);res.setHeader('Cache-Control','no-store');
  if(path==='/'){res.setHeader('Content-Type','text/html');res.end(markup);return;}
  const roots=[selected.dest,...(process.env.SIDEWALK_ASSET_WORK_ROOT?[resolve(process.env.SIDEWALK_ASSET_WORK_ROOT,'data/baked')]:[]),root+'/web/public'];
  for(const base of roots){const file=resolve(base,'.'+path);if(!file.startsWith(resolve(base)+'/')||!existsSync(file))continue;
   try{const b=readFileSync(file);res.setHeader('Content-Type',mime[extname(file)]??'application/octet-stream');res.end(b);return;}catch{}
  }res.statusCode=404;res.end('Not found');
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const poses={mabou:'624450,5103340,55',porthood:'613770,5096500,0',pointtupper:'628180,5052820,130'};
 for(const build of report.builds){selected=build;
  for(const area of Object.keys(poses))for(const low of [false,true]){
   const tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();let c,appRequest,loader;const chunkRequests=new Map(),finished=new Set();
   try{
    c=await cdp(tab.webSocketDebuggerUrl,{onEvent:e=>{
     if(e.method==='Page.frameNavigated'&&!e.params.frame.parentId)loader=e.params.frame.loaderId;
     if(e.method==='Network.responseReceived'){const path=new URL(e.params.response.url).pathname;if(path==='/app.js')appRequest=e.params.requestId;else if(path.startsWith('/chunks/'))chunkRequests.set(path,e.params.requestId);}
     if(e.method==='Network.loadingFinished')finished.add(e.params.requestId);
    }});
    await c.send('Page.enable');if(!gate)await c.send('Runtime.disable'); // Audit records expected broken pages; the release gate keeps fatal transport errors.
    await c.send('Network.enable',{maxTotalBufferSize:64*1024*1024,maxResourceBufferSize:24*1024*1024});await c.send('Network.setCacheDisabled',{cacheDisabled:true});
    // Record real page errors without suppressing or repairing the game's rejected promise.
    await c.send('Page.addScriptToEvaluateOnNewDocument',{source:'globalThis.__flatErrors=[];addEventListener("error",e=>__flatErrors.push(e.message));addEventListener("unhandledrejection",e=>__flatErrors.push(e.reason?.stack??String(e.reason)));'});
    const nav=await c.send('Page.navigate',{url:`${origin}/?test=1&area=${area}&at=${poses[area]}&mode=explore&q=${low?'low':'high'}&radio=0&still=1&hud=0&shadows=1`});let state={ready:false,errors:[]};const end=Date.now()+120000;
    while(Date.now()<end){await sleep(100);if(loader!==nav.result.loaderId)continue;const r=await c.send('Runtime.evaluate',{expression:'({ready:document.documentElement?.dataset.mmmReady==="true",errors:globalThis.__flatErrors??[]})',returnByValue:true});state=r.result.result.value;if(state.ready||state.errors.length)break;}
    const received=async requestId=>{for(let i=0;i<50&&!finished.has(requestId);i++)await sleep(100);if(!finished.has(requestId))return null;const body=await c.send('Network.getResponseBody',{requestId});assert.ok(body.result,JSON.stringify(body.error));return sha(body.result.base64Encoded?Buffer.from(body.result.body,'base64'):Buffer.from(body.result.body));};
    const appHash=appRequest?await received(appRequest):null;assert.ok(appHash,'real app.js downloaded');assert.equal(appHash,build.sha256,'browser receives exact unmodified SITE app.js');
    // Every chunk the page fetched is the exact SITE file, and a split build always fetches its core chunk.
    const core=Object.keys(build.chunks).filter(path=>/^\/chunks\/core-[^/]+\.js$/.test(path));assert.ok(core.length===(Object.keys(build.chunks).length?1:0),'a split build has exactly one core chunk');
    if(core.length)assert.ok(chunkRequests.has(core[0])&&await received(chunkRequests.get(core[0])),'real core chunk downloaded');
    const chunksSeen={};for(const [path,requestId]of chunkRequests){assert.ok(path in build.chunks,'browser asks only for SITE chunks: '+path);const hash=await received(requestId);if(hash===null)continue;assert.equal(hash,build.chunks[path],'browser receives exact unmodified SITE '+path);chunksSeen[path]=hash;}
    const row={role:build.role,area,low,chunks:Object.keys(chunksSeen),...state,verdict:state.ready&&!state.errors.length?'PASS':'FAIL'};report.pages.push(row);save();console.log('FLAT OBSERVATION',JSON.stringify(row));
    if(gate){assert.equal(row.verdict,'PASS','flat SITE must boot without a page error');assert.ok(!c.logs.some(l=>/Sidewalk.*(?:unavailable|failed)/i.test(l)),'normal SITE has no sidewalk failure warning');}
   }finally{c?.close();await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});}
  }
 }
 if(!gate&&report.builds.some(b=>b.role==='main0e'))assert.equal(report.pages.filter(p=>p.role==='main0e').length,6,'main checked independently in every area/quality');
 console.log(gate?'PASS flat SITE real-land boot gate':'COLLECTED flat audit; per-page failures remain release blockers, not application PASS');
}finally{
 save();if(server)await new Promise(resolve=>server.close(resolve));
 for(const tree of trees){const link=tree+'/web/node_modules';unlinkSync(link);run('git',['worktree','remove',tree]);}
}
