// One hardware browser case at a time. Both verdicts use the same complete, fingerprinted observations.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync,accessSync,statSync,unlinkSync,openSync,closeSync,constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {resolve,join,delimiter} from 'node:path';
import {tripVerdict,unmeasuredStartupFailure} from './fleet-trip-verdict.mjs';
const root=process.cwd(),out=resolve(process.env.FLEET_MATRIX_OUT??'data/work/west-bay/fleet/checks/quarry-trip'),mode=process.argv[2]??'functional';
const cases=['A','B'].flatMap(run=>[false,true].flatMap(low=>[1,1.5,2,2.5].map(hill=>({run,low,hill}))));
const key=r=>r.run+'/'+r.low+'/'+r.hill,label=r=>r.run+'-'+(r.low?'LOW':'HIGH')+'-'+r.hill;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function timeoutProgram(){
 for(const name of ['gtimeout','timeout'])for(const folder of (process.env.PATH??'').split(delimiter)){
  const file=resolve(folder||'.',name);
  try{accessSync(file,constants.X_OK);if(statSync(file).isFile())return file;}catch{}
 }
 return null;
}
function samples(row){return row?.end?.contactStats?.samples??row?.stopped?.stats?.samples??0;}
function measured(row){
 return row&&!row.spawnError&&!/failed before receipt/i.test(row.error??'')&&Number.isSafeInteger(samples(row))&&samples(row)>0
  &&(!row.end||Number.isSafeInteger(row.end.steps)&&row.end.steps>0);
}
function measuredRecords(records){
 assert.ok(Array.isArray(records)&&records.length===cases.length,'incomplete measured matrix');let assertions=0;
 for(const expected of cases){
  const name=label(expected),matches=records.filter(r=>key(r)===key(expected));assert.equal(matches.length,1,'missing or duplicate '+name);
  const row=matches[0];assert.ok(measured(row),'unmeasured '+name);assert.equal(typeof row.caseDirectory,'string','missing case file '+name);
  const original=JSON.parse(readFileSync(row.caseDirectory+'/combined-results.json','utf8'));
  assert.ok(Array.isArray(original)&&original.length===1&&key(original[0])===key(expected)&&measured(original[0]),'unmeasured browser result '+name);
  assert.equal(samples(original[0]),samples(row),'changed measurement count '+name);assertions+=samples(row);
 }
 assert.ok(Number.isSafeInteger(assertions)&&assertions>0,'zero assertions');return assertions;
}
const bake=()=>{
 const hash=createHash('sha256');
 function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  if(e.name==='reference')continue;const p=join(dir,e.name);
  if(e.isDirectory())walk(p);else if(e.isFile()){hash.update(p.slice(root.length));hash.update(readFileSync(p));}
 }}
 walk(root+'/data/baked/areas/westbay');return hash.digest('hex');
};
async function main(){
 assert.ok(['functional','contact-debt'].includes(mode));mkdirSync(out,{recursive:true});
 const timeout=timeoutProgram();
 if(!timeout){console.error('INVALID STARTUP: needs gtimeout (brew install coreutils) or timeout on PATH');return 2;}
 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'','commit source before matrix execution');
 const bakeHash=bake(),receiptFile=out+'/receipt.json';let receipt,records;
 const discardReceipt=()=>{for(const name of ['receipt.json','functional-verdict.json','contact-debt-verdict.json']){const p=out+'/'+name;if(existsSync(p))unlinkSync(p);}};
 if(existsSync(receiptFile))try{
  receipt=JSON.parse(readFileSync(receiptFile,'utf8'));
  assert.equal(receipt.head,head,'head changed');assert.equal(receipt.bakeHash,bakeHash,'bake changed');
  assert.ok(Number.isSafeInteger(receipt.assertions)&&receipt.assertions>0,'zero or missing assertions');
  records=JSON.parse(readFileSync(receipt.runDir+'/combined-results.json','utf8'));
  assert.equal(receipt.assertions,measuredRecords(records),'receipt assertion count changed');
 }catch(error){console.error('REJECTED RECEIPT:',error.message);discardReceipt();receipt=records=undefined;}
 if(!receipt){
  const capacity=()=>{if(process.env.BROWSER_CAPACITY_CHECK)execFileSync('/bin/bash',['-c',process.env.BROWSER_CAPACITY_CHECK],{cwd:root,stdio:'inherit'});};
  const runDir=out+'/'+head.slice(0,12)+'-'+Date.now();mkdirSync(runDir,{recursive:true});records=[];const jobs=[];
  for(const expected of cases){
   if(jobs.length)await pause(30000);
   const {run,low,hill}=expected,name=label(expected),caseFolder=runDir+'/'+name,attempts=[];let folder,exit,rows,spawnError,measurementError;
   for(let attempt=0;attempt<3;attempt++){
    try{capacity();}catch(error){discardReceipt();console.error('INVALID STARTUP '+name+': capacity check failed: '+error.message);return 2;}
    spawnError=measurementError=undefined;
    folder=attempt?caseFolder+'-startup-retry-'+attempt:caseFolder;mkdirSync(folder,{recursive:true});const log=openSync(folder+'/browser.log','w');
    const env={...process.env,WEB_PORT:process.env.WEB_PORT??'5273',CDP_PORT:process.env.CDP_PORT??'9473',MMM_BROWSER_SLOTS:'1',MMM_SKIP_TYPECHECK:'1',OUT:folder,RUN:'fleet-quarry-browser.mjs',VIEWS:'fleet-trip|trip=quarry-gate',FLEET_TRIP_CHECK:'functional',COMBINED_RUNS:JSON.stringify([run]),COMBINED_VARIANTS:JSON.stringify([{low,hill}])};
    try{exit=await new Promise(res=>{
     const failed=error=>{spawnError=String(error);console.error(error);res(2);};
     try{const child=spawn(timeout,['--kill-after=15s','45m','tools/yard-shots.sh','1400','950'],{cwd:root,env,stdio:['ignore',log,log]});child.on('error',failed);child.on('exit',code=>res(code??1));}catch(error){failed(error);}
    });}finally{closeSync(log);}
    const hasReceipt=existsSync(folder+'/combined-results.json');
    try{rows=JSON.parse(readFileSync(folder+'/combined-results.json','utf8'));assert.ok(Array.isArray(rows)&&rows.length===1&&key(rows[0])===key(expected)&&measured(rows[0]),'no measured browser result');}
    catch(error){rows=undefined;measurementError=error.message;}
    attempts.push({folder,exit,hasReceipt,...(spawnError?{spawnError}:{})});writeFileSync(caseFolder+'/startup-attempts.json',JSON.stringify(attempts,null,2));
    if(spawnError||!unmeasuredStartupFailure(exit,readFileSync(folder+'/browser.log','utf8'),hasReceipt))break;
    console.log('UNMEASURED STARTUP',name,'exit',exit,'attempt',attempt+1);
   }
   jobs.push({label:name,exit,attempts});writeFileSync(runDir+'/case-exits.json',JSON.stringify(jobs,null,2));
   if(spawnError||!rows){
    const reason=spawnError??measurementError??'no measured browser result';discardReceipt();
    writeFileSync(runDir+'/invalid-startup.json',JSON.stringify({case:name,reason,exit,attempts},null,2));
    console.error('INVALID STARTUP '+name+': '+reason);return 2;
   }
   records.push({...rows[0],caseDirectory:folder,jobExit:exit,startupAttempts:attempts});
   writeFileSync(runDir+'/combined-results.json',JSON.stringify(records,null,2));console.log('FUNCTIONAL CASE',name,'exit',exit);
  }
  assert.equal(bake(),bakeHash,'bake changed during matrix');
  receipt={head,bakeHash,runDir,assertions:measuredRecords(records)};writeFileSync(receiptFile,JSON.stringify(receipt,null,2));
 }
 const functional=tripVerdict(records,'functional',true),debt=tripVerdict(records,'contact-debt',true);
 const result={...receipt,mode,functionalExit:functional,contactDebtExit:debt,cases:records.length};
 writeFileSync(out+'/'+mode+'-verdict.json',JSON.stringify(result,null,2));
 console.log(mode==='functional'?'FUNCTIONAL VERDICT':'NATURAL-ROAD CONTACT DEBT',JSON.stringify(result));return mode==='functional'?functional:debt;
}
process.exitCode=await main();
