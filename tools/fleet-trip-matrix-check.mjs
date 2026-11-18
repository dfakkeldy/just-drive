// Exercise the real matrix entry point with a tiny bake and stubbed child processes; no browser starts.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=process.cwd(),ref=process.env.FLEET_MATRIX_SOURCE_REF;
const source=ref?execFileSync('git',['show',ref+':tools/fleet-trip-matrix.mjs'],{encoding:'utf8'}):readFileSync('tools/fleet-trip-matrix.mjs','utf8');
const workspace=mkdtempSync(join(tmpdir(),'fleet-matrix-check-')),head='1234567890123456789012345678901234567890';
const definitions=['unmeasured','no-result','spawn-error-with-result','bad-zero-receipt','bad-zero-samples','bad-missing-case-file','bad-unmeasured-receipt','missing-timeout','timeout-fallback','valid-zero-failures','measured-failure'];
const selected=process.env.FLEET_MATRIX_REGRESSION_CASE;let failures=0;
try{
 for(const name of definitions.filter(n=>!selected||n===selected)){
  try{
   const dir=join(workspace,name),out=join(dir,'out'),bin=join(dir,'bin');mkdirSync(join(dir,'data/baked/areas/westbay'),{recursive:true});mkdirSync(out);mkdirSync(bin);
   const bytes=Buffer.from('tiny survey fixture');writeFileSync(join(dir,'data/baked/areas/westbay/tiny.bin'),bytes);
   const bakeHash=createHash('sha256').update('/data/baked/areas/westbay/tiny.bin').update(bytes).digest('hex');
   if(name!=='missing-timeout')for(const tool of name==='timeout-fallback'?['timeout']:['gtimeout','timeout']){const file=join(bin,tool);writeFileSync(file,'#!/bin/sh\nexit 99\n');chmodSync(file,0o755);}
   const record=(run,low,hill)=>({run,low,hill,end:{driver:'truck',attached:true,states:[{id:'truck',state:'DRIVEN'},{id:'sxs',state:'STRAPPED'},{id:'bike',state:'STRAPPED'}],steps:120,contactStats:{samples:64,failures:0,functionalFailures:0,debtFailures:0}}});
   if(name.startsWith('bad-')){
    const planted=join(out,'planted');mkdirSync(planted);const rows=[];
    for(const run of['A','B'])for(const low of[false,true])for(const hill of[1,1.5,2,2.5]){
     const folder=join(planted,run+'-'+low+'-'+hill);mkdirSync(folder);const r=record(run,low,hill);
     if(['bad-zero-receipt','bad-zero-samples'].includes(name))r.end.contactStats.samples=0;
     else if(name==='bad-unmeasured-receipt'){delete r.end;r.error='browser case failed before receipt, exit 2';}
     if(name!=='bad-missing-case-file')writeFileSync(join(folder,'combined-results.json'),JSON.stringify([r]));rows.push({...r,caseDirectory:folder,jobExit:name==='bad-unmeasured-receipt'?2:0});
    }
    writeFileSync(join(planted,'combined-results.json'),JSON.stringify(rows));writeFileSync(join(out,'receipt.json'),JSON.stringify({head,bakeHash,runDir:planted,assertions:name==='bad-zero-receipt'?0:1024}));
   }
   const preload=join(dir,'stub.mjs');writeFileSync(preload,`
import cp from 'node:child_process';import{syncBuiltinESMExports}from'node:module';import{EventEmitter}from'node:events';import{writeFileSync,mkdirSync}from'node:fs';import{basename,join}from'node:path';
const calls=[];cp.execFileSync=(file,args)=>{if(file!=='git')throw Error('Unexpected executable '+file);if(args[0]==='rev-parse')return ${JSON.stringify(head)}+'\\n';if(args[0]==='status')return '';throw Error('Unexpected git command')};
cp.spawn=(file,args,options)=>{if(!['gtimeout','timeout'].includes(basename(file)))throw Error('Unexpected spawn '+file);const child=new EventEmitter();calls.push({program:basename(file),out:options.env.OUT});writeFileSync(${JSON.stringify(join(dir,'calls.json'))},JSON.stringify(calls));queueMicrotask(()=>{
 const run=JSON.parse(options.env.COMBINED_RUNS)[0],{low,hill}=JSON.parse(options.env.COMBINED_VARIANTS)[0],name=${JSON.stringify(name)};
 if(!['unmeasured','no-result','bad-zero-receipt','bad-zero-samples','bad-missing-case-file','bad-unmeasured-receipt'].includes(name)){
  const bad=name==='measured-failure';const r={run,low,hill,end:{driver:'truck',attached:true,states:[{id:'truck',state:'DRIVEN'},{id:'sxs',state:'STRAPPED'},{id:'bike',state:'STRAPPED'}],steps:120,contactStats:{samples:64,failures:bad?1:0,functionalFailures:bad?1:0,debtFailures:0}}};mkdirSync(options.env.OUT,{recursive:true});writeFileSync(join(options.env.OUT,'combined-results.json'),JSON.stringify([r]));
 }
 if(['unmeasured','spawn-error-with-result','bad-zero-receipt','bad-zero-samples','bad-missing-case-file','bad-unmeasured-receipt'].includes(name))child.emit('error',Object.assign(Error('spawn gtimeout ENOENT'),{code:'ENOENT'}));else child.emit('exit',['measured-failure','no-result'].includes(name)?1:0);
 });return child};syncBuiltinESMExports();const timer=globalThis.setTimeout;globalThis.setTimeout=(fn,_delay,...args)=>timer(fn,0,...args);
`);
   const entry=join(dir,'matrix.mjs');writeFileSync(entry,source.replaceAll("'./fleet-trip-verdict.mjs'",JSON.stringify(pathToFileURL(resolve('tools/fleet-trip-verdict.mjs')).href)));
   const env={...process.env,PATH:bin,FLEET_MATRIX_OUT:out};delete env.BROWSER_CAPACITY_CHECK;
   const result=spawnSync(process.execPath,['--import',preload,entry,name.startsWith('bad-')?'contact-debt':'functional'],{cwd:dir,env,encoding:'utf8',timeout:15000,maxBuffer:1024*1024});const output=result.stdout+result.stderr;
   assert.equal(result.error,undefined,String(result.error));const receipt=join(out,'receipt.json'),calls=existsSync(join(dir,'calls.json'))?JSON.parse(readFileSync(join(dir,'calls.json'),'utf8')):[];
   if(['unmeasured','no-result','spawn-error-with-result'].includes(name)){
    assert.equal(result.status,2,name+' is invalid startup, not a feature verdict: '+output);assert.equal(existsSync(receipt),false,'unmeasured run must write no receipt');assert.equal(calls.length,1,'stop at the first unmeasured case');assert.match(output,/A-HIGH-1/);
   }else if(name.startsWith('bad-')){
    assert.equal(result.status,2,'bad receipt must be rejected: '+output);assert.ok(calls.length>0,'planted bad receipt must not skip measurement');assert.equal(existsSync(receipt),false,'bad receipt must not survive failed startup');assert.match(output,/reject.*receipt/i);
   }else if(name==='missing-timeout'){
    assert.equal(result.status,2,'missing timeout fails before any case: '+output);assert.equal(calls.length,0);assert.equal(existsSync(receipt),false);assert.match(output,/needs gtimeout \(brew install coreutils\) or timeout/);
   }else{
    assert.equal(result.status,name==='measured-failure'?1:0,output);assert.equal(calls.length,16);assert.ok(existsSync(receipt));const saved=JSON.parse(readFileSync(receipt,'utf8'));assert.equal(saved.assertions,1024,'assertions count observations, not failures');
    if(name==='timeout-fallback')assert.ok(calls.every(c=>c.program==='timeout'),'use timeout when gtimeout is absent');
    if(name==='valid-zero-failures'){
     rmSync(join(dir,'calls.json'));const again=spawnSync(process.execPath,['--import',preload,entry,'contact-debt'],{cwd:dir,env,encoding:'utf8',timeout:15000});assert.equal(again.status,0,again.stdout+again.stderr);assert.equal(existsSync(join(dir,'calls.json')),false,'reuse genuine measured evidence even with zero failures');
    }
   }
   console.log('PASS matrix harness',name);
  }catch(error){failures++;console.error('FAIL matrix harness',name,error.message);}
 }
 assert.ok(!selected||definitions.includes(selected),'unknown regression case');
}finally{rmSync(workspace,{recursive:true,force:true});}
process.exitCode=failures?1:0;
