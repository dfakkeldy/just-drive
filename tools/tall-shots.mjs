#!/usr/bin/env node
// Picture proof through yard-shots.sh, one page at a time. No second browser.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
const [out,...urls]=process.argv.slice(2),port=process.env.CDP_PORT;
assert.ok(out&&urls.length);
for(const url of urls){
 let tab,c;
 try{
  tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();c=await cdp(tab.webSocketDebuggerUrl);await c.send('Page.enable');
  const read=async expression=>{const r=await c.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
  if(new URL(url).searchParams.get('name').startsWith('phone-'))await c.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await c.send('Page.navigate',{url});const start=Date.now();
  while(!await read(`document.title==='settled' && !!window.mmm?.tall`)){assert.ok(Date.now()-start<240000,'settled game with tall renderer');await sleep(1000);}
  await sleep(1200);
  assert.equal(await read('mmm.renderer.getContext().isContextLost()'),false,'live GPU context');
  // Legacy near-instancer comparison. Production far turbines use FarTurbines plus the far-land depth mesh.
  const name=new URL(url).searchParams.get('name');
  if(name.startsWith('far-')){
    await read(`(async()=>{const {TallLandmarks}=await import('/src/tall.ts');const a=mmm.tall;const data=await(await fetch('/areas/judique/tall.json')).json();const mesh=a.group.getObjectByName('tall-rotors');const shared=mesh.material.uniforms;const extra=new TallLandmarks({...data,turbines:[],towers:[],lines:[]},mmm.terrain,mmm.low,shared,false,true);mmm.scene.add(extra.group);const original=a.update.bind(a);a.update=(camera,seconds)=>{original(camera,seconds);extra.update(camera,seconds)};window.__farPreview=extra;return extra.turbineCount;})()`);
    await sleep(1000);
  }
  const info=await read(`(()=>{const m=mmm.tall,r=m.group.getObjectByName('tall-rotors');const instances=[];for(let i=0;i<r.count;i++){const a=mmm.camera.matrix.clone();r.getMatrixAt(i,a);const p=mmm.camera.position.clone().set(a.elements[12],a.elements[13],a.elements[14]);const world=p.toArray();p.project(mmm.camera);instances.push({i,world,screen:p.toArray()});}return {time:m.time.value,count:r.count,calls:mmm.renderer.info.render.calls,triangles:mmm.renderer.info.render.triangles,far:window.__farPreview?.turbineCount??0,camera:mmm.camera.position.toArray(),instances}})()`);
  const screenshot=async suffix=>{const s=await c.send('Page.captureScreenshot',{format:'png'});writeFileSync(out+'/'+name+suffix+'.png',Buffer.from(s.result.data,'base64'));};
  await screenshot('');
  if(name==='mast-night')assert.ok(await read('mmm.tall.group.children.filter(m=>m.material?.defines?.BEACON).length')>=2,'dark-hour beacon draws');
  if(name==='point-tupper-near'){
    const before=await read(`(()=>{const r=mmm.tall.group.getObjectByName('tall-rotors'),a=r.geometry.getAttribute('motion');return {t:mmm.tall.time.value,phase:a.getX(8),rate:a.getY(8),frame:mmm.renderer.info.render.frame}})()`);
    await screenshot('-rotor-a');await sleep(1000);
    const after=await read(`({t:mmm.tall.time.value,frame:mmm.renderer.info.render.frame})`);await screenshot('-rotor-b');
    assert.ok(after.t-before.t>=.9&&after.t-before.t<3,'one-second animation interval');assert.ok(after.frame>before.frame,'real GPU frames drawn');
    const delta=before.rate*(after.t-before.t);assert.ok(delta>.9,'rotor angle advances');
    writeFileSync(out+'/rotation.json',JSON.stringify({before,after,deltaRadians:delta},null,2));console.log('PASS rendered rotor motion',delta,'radians');
  }
  const errors=c.logs.filter(s=>/error|INVALID|GLSL|shader.*fail/i.test(s));assert.deepEqual(errors,[],'no browser/shader errors');
  writeFileSync(out+'/'+name+'.json',JSON.stringify({url,info,logs:c.logs},null,2));console.log(out+'/'+name+'.png',JSON.stringify({time:info.time,count:info.count,far:info.far}));
 }catch(e){console.error('tall-shots:',e.stack);process.exitCode=1;}
 finally{c?.close();if(tab)await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});}
}
