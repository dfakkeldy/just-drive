// Real Vite transform/watch integration, no browser or game-source writes.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { createServer, build } from '../web/node_modules/vite/dist/node/index.js';
import { mutationSession } from './mutation-session.mjs';
import { mutationSources, validateMutations } from './mutation-source.mjs';
const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(join(realpathSync(tmpdir()),'mmm-mutation-plugin-'));
// The inventory TMPDIR can cross the worktree's data symlink. Watch its real path.
const json=dir+'/edits.json',from="const TEST_KEYS = new Set([",to="const TEST_KEYS = new Set(['injected',";
const document={name:'visit guard',edits:[{file:'web/src/visit.ts',from,to}]};
const source=readFileSync(root+'/web/src/visit.ts','utf8');
let server;
try {
 assert.throws(()=>mutationSources(root,{edits:[{file:'server/src/index.ts',from:'x',to:'y'}]}),/outside web\/src/);
 assert.throws(()=>mutationSources(root,{edits:[{file:'web/src/../../server/src/index.ts',from:'x',to:'y'}]}),/outside web\/src/);
 assert.throws(()=>validateMutations(root,[document,{name:'stale-last',edits:[{file:'web/src/visit.ts',from:'missing-anchor-last',to:''}]}]),/missing mutation anchor stale-last in web\/src\/visit.ts: "missing-anchor-last"/);
 const literal = "$& $' $1";
 assert.ok(mutationSources(root,{edits:[{file:'web/src/visit.ts',from,to:literal}]}).get(root+'/web/src/visit.ts').includes(literal));
 assert.throws(()=>mutationSources(root,{edits:[{file:'web/src/visit.ts',from:';',to:';;'}]}),/expected exactly one anchor/);
 assert.ok(mutationSources(root,{edits:[{file:'web/src/visit.ts',from:';',to:';;',all:true}]}).get(root+'/web/src/visit.ts').includes(';;'));
 assert.throws(()=>mutationSources(root,{edits:[{file:'web/src/visit.ts',from,to:from}]}),/no-op edit/);
 const markerSource=mutationSources(root,{...document,marker:'active-mutant'}).get(root+'/web/src/visit.ts').trim().split('\n').at(-1);
 const target={};new Function('globalThis',markerSource)(target);new Function('globalThis',markerSource)(target);
 assert.deepEqual(target.__mmmMutationSources,['active-mutant'],'multi-file mutations must keep one active identity');
 // Exercise the real launcher against an authored shell fixture, with no browser.
 const fixture=dir+'/launcher';mkdirSync(fixture+'/tools',{recursive:true});
 writeFileSync(fixture+'/tools/yard-shots.sh','#!/bin/sh\necho evidence > "$OUT/result.txt"\nexit "${PROOF_EXIT:-0}"\n');
 const savedOut=process.env.OUT;
 process.env.OUT=dir+'/caller-output';process.env.PROOF_EXIT='2';
 const originalError=console.error;console.error=(...args)=>console.log('EXPECTED NEGATIVE:',...args);
 await mutationSession(fixture,'unused.mjs',[],[],'x=1');
 console.error=originalError;
 assert.equal(readFileSync(process.env.OUT+'/result.txt','utf8').trim(),'evidence');
 assert.equal(readdirSync(fixture+'/data/work/mutations').length,0,'caller OUT survives; private JSON is removed');
 delete process.env.OUT;
 console.error=(...args)=>console.log('EXPECTED NEGATIVE:',...args);
 await mutationSession(fixture,'unused.mjs',[],[],'x=1');
 console.error=originalError;
 const retained=readdirSync(fixture+'/data/work/mutations');assert.equal(retained.length,1);
 assert.equal(readFileSync(fixture+'/data/work/mutations/'+retained[0]+'/result.txt','utf8').trim(),'evidence');
 process.env.PROOF_EXIT='0';await mutationSession(fixture,'unused.mjs',[],[],'x=1');
 assert.deepEqual(readdirSync(fixture+'/data/work/mutations'),retained,'success removes its own temp folder');
 delete process.env.PROOF_EXIT;process.exitCode=0;
 if(savedOut===undefined)delete process.env.OUT;else process.env.OUT=savedOut;
 // Exercise plugin reloads with deterministic stat polling. Native macOS events can
 // coalesce the test's first edit during watcher startup; public assets are unrelated.
 writeFileSync(json,JSON.stringify(document));process.env.MMM_MUTATION=json;
 server=await createServer({root:root+'/web',configFile:root+'/web/vite.config.ts',server:{host:'127.0.0.1',port:0,strictPort:true,watch:{usePolling:true,interval:50,ignored:[root+'/web/public/**']}},logLevel:'silent'});
 const reloads=[];const originalSend=server.ws.send.bind(server.ws);server.ws.send=(...args)=>{reloads.push(args[0]);originalSend(...args);};
 await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
 assert.match(await(await fetch(origin+'/src/visit.ts')).text(),/injected/);
 // Chokidar.add() is asynchronous. Wait for this JSON file's registration before
 // writing it; otherwise a loaded Mac can fold the write into its initial scan.
 const watched=()=>Object.entries(server.watcher.getWatched()).some(([path,files])=>files.includes('edits.json')&&realpathSync(path)===realpathSync(dirname(json)));
 const readyBy=Date.now()+30000;
 while(!watched()&&Date.now()<readyBy)await new Promise(r=>setTimeout(r,50));
 assert.ok(watched(),'mutation JSON watcher registered before the live edit');
 let reload;const watch=new Promise(r=>reload=r);server.watcher.once('change',reload);
 // One write can land before the watcher has finished starting and is then never reported, so write the same
 // JSON again every second (with and without a final newline) until the change arrives or 30 s pass.
 let changed=false;watch.then(()=>{changed=true;});
 const empty=JSON.stringify({edits:[]});writeFileSync(json,empty);
 let watcherLimit,rewrite;   // a file watcher on a loaded Mac can take seconds
 let writes=1;rewrite=setInterval(()=>{if(!changed)writeFileSync(json,empty+(writes++%2?'\n':''));},1000);
 try{await Promise.race([watch,new Promise((_,reject)=>{watcherLimit=setTimeout(()=>reject(Error('mutation watcher timeout')),30000);})]);}finally{clearTimeout(watcherLimit);clearInterval(rewrite);}
 for(let i=0;i<50&&!reloads.some(m=>m.type==='full-reload');i++)await new Promise(r=>setTimeout(r,50));
 assert.ok(reloads.some(m=>m.type==='full-reload'),'JSON watcher must send reload without a transform/receipt request');
 assert.doesNotMatch(await(await fetch(origin+'/src/visit.ts')).text(),/injected/);
 // A valid update invalidates already-served modules at the receipt endpoint.
 writeFileSync(json,JSON.stringify(document));assert.equal((await fetch(origin+'/__mmm_mutation')).status,200);
 assert.match(await(await fetch(origin+'/src/visit.ts')).text(),/injected/);
 console.log('EXPECTED NEGATIVE: outside-source edit is refused with HTTP 500');
 writeFileSync(json,JSON.stringify({edits:[{file:'server/src/index.ts',from:'x',to:'y'}]}));
 assert.equal((await fetch(origin+'/__mmm_mutation')).status,500);
 // The transform must reject an invalid document too, never keep serving the last mutant.
 assert.equal((await fetch(origin+'/src/visit.ts?invalid=1')).status,500);
 assert.equal(readFileSync(root+'/web/src/visit.ts','utf8'),source);
 await server.close();server=null;
 // apply=serve remains enforced even with MMM_MUTATION set to an invalid document during build.
 const config=await import('../web/node_modules/vite/dist/node/index.js');
 console.log('EXPECTED NEGATIVE: build refuses MMM_MUTATION');
 await assert.rejects(()=>config.resolveConfig({root:root+'/web',configFile:root+'/web/vite.config.ts',logLevel:'silent'},'build'),/MMM_MUTATION is dev-only: unset it before vite build/);
 process.env.MMM_MUTATION='';
 await assert.rejects(()=>config.resolveConfig({root:root+'/web',configFile:root+'/web/vite.config.ts',logLevel:'silent'},'build'),/MMM_MUTATION is dev-only/);
 delete process.env.MMM_MUTATION;
 const resolved=await config.resolveConfig({root:root+'/web',configFile:root+'/web/vite.config.ts',logLevel:'silent'},'build');
 assert.ok(!resolved.plugins.some(p=>p.name==='mmm-served-mutation'));
 console.log('PASS mutation plugin: transforms, watcher reload, receipt invalidation, stale anchor, outside/traversal refusal, unchanged disk source and build exclusion');
} finally {if(server)await server.close();delete process.env.MMM_MUTATION;rmSync(dir,{recursive:true,force:true});}
