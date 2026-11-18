#!/usr/bin/env node
// The registered mounting mutants must fail the actual car-check at their named assertions.
// Vite transforms source in memory; files under web/src are never written.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,openSync,closeSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {carMutants} from './car-construction-check.mjs';
import {validateMutations} from './mutation-source.mjs';
import {serveMutation,child} from './mutation-session.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const cases=carMutants.filter(m=>['fit','overlap','divider','socket'].includes(m.kind)).map(m=>({...m,edits:[{file:'web/src/car.ts',from:m.from,to:m.to}]}));
validateMutations(root,cases);
if(process.argv.includes('--validate'))console.log('PASS '+cases.length+' car mounting source anchors');
else if(!process.env.MMM_MUTATION){
  const base=root+'data/work/mutations';mkdirSync(base,{recursive:true});const dir=mkdtempSync(base+'/car-'),file=dir+'/edits.json';writeFileSync(file,'{"edits":[]}');
  let success=false;
  try{const result=await child('bash',[root+'tools/car-mutations.sh'],{env:{...process.env,MMM_MUTATION:file,OUT:process.env.OUT??dir},stdio:'inherit'});success=result.code===0;process.exitCode=result.code;}
  finally{if(success||process.env.OUT)rmSync(dir,{recursive:true,force:true});else console.error('Car mutation evidence retained at '+dir);}
}else{
  const[out,url]=process.argv.slice(2),results=[];
  async function check(name,marker){
    const log=out+'/'+name+'.log',fd=openSync(log,'w');let result;
    try{result=await child(process.execPath,[root+'tools/car-check.mjs',out,url],{env:{...process.env,CAR_PHASE:name,...(marker?{CAR_EXPECT_MUTATION:marker}:{})},stdio:['ignore',fd,fd]});}
    finally{closeSync(fd);}
    if(result.signal)throw Error('Car mutation interrupted: '+result.signal);
    const text=readFileSync(log,'utf8'),line=text.split('\n').find(l=>l.startsWith('rear {'));
    const stats=line?JSON.parse(line.slice(5)):null,fit=stats?.lampStandouts??[];
    return{exit:result.code,fit,surface:stats?.lampSurfaces,text};
  }
  try{
    const control=await check('control');assert.equal(control.exit,0,control.text);console.log('PASS car-check control '+JSON.stringify(control.fit));
    for(const mutation of cases){
      const marker=mutation.name+'-'+randomUUID();await serveMutation({...mutation,marker},url);
      const result=await check(mutation.name,marker);const detected=result.exit===1&&mutation.gate.test(result.text);
      results.push({name:mutation.name,exit:result.exit,detected,fit:result.fit,surface:result.surface});
      console.log((detected?'KILLED ':'MISSED ')+mutation.name+' '+JSON.stringify(result.fit));
      assert.ok(detected,mutation.name+' must fail car-check at its named mounting gate: '+result.text.slice(-2000));
    }
  }finally{
    await serveMutation({edits:[]},url);writeFileSync(out+'/car-mutations.json',JSON.stringify(results,null,2)+'\n');
  }
  const restored=await check('restored');assert.equal(restored.exit,0,restored.text);console.log('PASS restored car-check');
}
