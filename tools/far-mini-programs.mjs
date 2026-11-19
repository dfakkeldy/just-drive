// Hardware program counts only. Frame-ms acceptance belongs to the MacBook window.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {cdp,cdpFetch,sleep} from './cdp.mjs';
const freeze=process.env.FAR_FREEZE==='1';
const[out,base]=process.argv.slice(2),port=process.env.CDP_PORT,rows=[];mkdirSync(out,{recursive:true});
for(const low of [false,true])for(const baseline of [true,false]){
 let tab,c;
 try{
  await fetch(base+'/__far-views-source?mode='+(baseline?'main':'head'));await fetch(base+'/__far-views-mode?mode='+(baseline?'before':'after'));
  tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();c=await cdp(tab.webSocketDebuggerUrl);await c.send('Page.enable');await c.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  await c.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__holdBus=true;const raf=requestAnimationFrame;window.__nativeRAF=raf;window.requestAnimationFrame=f=>{window.__busMainFrame=f;return raf(t=>{if(window.__holdBus&&window.mmm?.shift)mmm.shift.elapsed=-60;f(t);});};`});
  const read=async expression=>{const r=await c.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.error||r.result.exceptionDetails)throw Error(JSON.stringify(r));return r.result.result.value;};
  await c.send('Page.navigate',{url:`${base}/?area=mabou&at=623766,5103484,45&scene=0&res=1&hud=0&radio=0&shadows=1&q=${low?'low':'high'}&far=full`});
  let since=Date.now();while(!await read("document.documentElement.dataset.mmmReady==='true'&&!!window.mmm?.schoolBus")){assert.ok(Date.now()-since<240000,'bus boot');await sleep(300);}
  await read("document.getElementById('titleStart')?.click();document.activeElement?.blur();");
  if(!baseline){since=Date.now();while(!await read('!!mmm.farLand')){assert.ok(Date.now()-since<240000,'far content load');await sleep(300);}}
  await read('requestAnimationFrame=()=>0');await sleep(150);
  const result=await read(`(async()=>{const{scene:s,camera:c,renderer:r,terrain:t,schoolBus:b,shift,vehicle:v,trees,roads,water}=mmm;
   if(b.art)throw Error('bus art appeared before controlled first appearance');
   const T=await import('/node_modules/three/build/three.module.js'),h=b.solid.heading,y=()=>t.heightAt(b.solid.x,b.solid.z);
   v.place(b.solid.x-20*Math.sin(h),b.solid.z+20*Math.cos(h),h);c.position.set(b.solid.x-24*Math.sin(h)-12*Math.cos(h),(y()??0)+7,b.solid.z+24*Math.cos(h)-12*Math.sin(h));c.lookAt(b.solid.x,(y()??0)+2,b.solid.z);c.updateMatrixWorld();
   for(let i=0;i<120;i++){t.update(c);trees?.update(t.drawnFine,c.position);roads.update(c.position);water?.update(c);r.render(s,c);water?.settle();water?.afterRender(c);await new Promise(r=>setTimeout(r,30));if(i>30&&!t.pending&&!(trees?.pending??0)&&y()!==null)break;}
   const inventory=()=>r.info.programs.map(p=>({id:p.id,family:r.getContext().getShaderSource(p.vertexShader)?.match(/#define SHADER_TYPE ([^\\n]+)/)?.[1]??p.name??'unknown'}));
   let timing=null,before;
   if(${freeze}){window.__holdBus=false;const frames=[];let start,last,appearance,beforeIds;await new Promise(resolve=>{const tick=t=>{start??=t;const active=t-start>=3000;shift.elapsed=active?0:-60;if(active&&!beforeIds){beforeIds=inventory();b.rules.wait=20;}const was=!!b.art,begin=performance.now();window.__busMainFrame(t);const cpuMs=performance.now()-begin;if(!was&&b.art)appearance=t;frames.push({t,cpuMs,gapMs:last===undefined?0:t-last,art:!!b.art});last=t;if(t-start<5000)window.__nativeRAF(tick);else resolve();};window.__nativeRAF(tick);});if(appearance===undefined)throw Error('bus never appeared in real frame loop');before=beforeIds;const around=frames.filter(f=>f.t>=appearance-1000&&f.t<=appearance+1000);timing={appearanceMs:appearance-start,frames:around,longestFrameMs:Math.max(...around.map(f=>Math.max(f.cpuMs,f.gapMs))),over100:around.filter(f=>Math.max(f.cpuMs,f.gapMs)>100).length,scope:'real game frame callbacks; one second before/after first visible art'};}
   else{before=inventory();shift.elapsed=0;b.rules.wait=20;b.update(c);if(!b.art||!b.group.visible)throw Error('bus first art not visible');r.render(s,c);}
   const after=inventory(),ids=new Set(before.map(p=>p.id)),added=after.filter(p=>!ids.has(p.id)),families={};for(const p of added)families[p.family]=(families[p.family]??0)+1;
   const materials=[];b.group.traverse(o=>{if(o.material)materials.push({type:o.material.type,key:o.material.customProgramCacheKey(),version:o.material.version});});
   return{timing,before,after,added,families,materials,low:mmm.low,visible:b.group.visible,camera:c.position.toArray(),bus:b.art.root.position.toArray(),image:r.domElement.toDataURL('image/png'),programErrors:r.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).map(p=>p.diagnostics)};})()`);
  const source=baseline?'main-f965706':'head',detail=low?'LOW':'desktop';writeFileSync(`${out}/bus-${source}-${detail}.png`,Buffer.from(result.image.split(',')[1],'base64'));delete result.image;assert.deepEqual(result.programErrors,[]);rows.push({source,detail,...result});writeFileSync(out+'/bus-programs.json',JSON.stringify(rows,null,2));console.log('BUS PROGRAMS',JSON.stringify(rows.at(-1)));
 }finally{c?.close();if(tab)await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});}
}
const timingDeltas=[];if(freeze)for(const detail of ['desktop','LOW']){const main=rows.find(r=>r.detail===detail&&r.source.startsWith('main')),head=rows.find(r=>r.detail===detail&&r.source.startsWith('head'));const delta={detail,mainLongestMs:main.timing.longestFrameMs,headLongestMs:head.timing.longestFrameMs,mainOver100:main.timing.over100,headOver100:head.timing.over100};timingDeltas.push(delta);}writeFileSync(out+'/bus-freeze-deltas.json',JSON.stringify(timingDeltas,null,2));
const deltas=[];for(const detail of ['desktop','LOW']){const main=rows.find(r=>r.detail===detail&&r.source.startsWith('main')),head=rows.find(r=>r.detail===detail&&r.source.startsWith('head'));for(const family of new Set([...Object.keys(main.families),...Object.keys(head.families)])){const delta=(head.families[family]??0)-(main.families[family]??0);deltas.push({detail,family,main:main.families[family]??0,head:head.families[family]??0,delta});assert.ok(delta<=1,'bus first appearance at most one extra program per family');}}
writeFileSync(out+'/bus-program-deltas.json',JSON.stringify({baseline:'f965706',head:'current checkout (see runtime.json)',deltas,frameTiming:freeze?timingDeltas:'Not measured: MacBook-only gate'},null,2));

if(freeze)for(const row of timingDeltas)assert.ok(row.headOver100<=row.mainOver100,'no new frame over 100 ms versus same-MacBook main');
