#!/usr/bin/env node
// Serial, native-GPU before/after captures. Use RUN=sidewalks-pictures.mjs tools/yard-shots.sh.
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
import {cdp,cdpFetch,sleep} from './cdp.mjs';
const [outDir,first]=process.argv.slice(2), origin=new URL(first).origin,port=process.env.CDP_PORT;
const samples=[['village','mabou','mabou-village',.45],['harbour-church','mabou','harbour-corner',.72],['porthood-main','porthood','porthood-main',.42],['reeves','pointtupper','reeves-ne',.45]];
const reports=existsSync(`${outDir}/pictures.json`)?JSON.parse(readFileSync(`${outDir}/pictures.json`,'utf8')):[];
for(const [name,area,run,fraction] of samples.filter(s=>!process.env.SIDEWALK_SAMPLES||process.env.SIDEWALK_SAMPLES.split(',').includes(s[0]))) {
 let tab,c;
 try {
  tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();c=await cdp(tab.webSocketDebuggerUrl);await c.send('Page.enable');
  const evalJS=async expression=>{const r=await c.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.result.exceptionDetails,JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
  const navigate=async query=>{
   await c.send('Page.navigate',{url:`${origin}/?test=1&mode=explore&radio=0&hud=0&shadows=1&still=1&${query}`});
   const end=Date.now()+240000;let state;
   while(Date.now()<end){await sleep(800);state=await evalJS('document.title');if(state==='settled')break;}
   assert.equal(state,'settled',name+' settled');await sleep(700);
  };
  // Locate a genuine baked centreline pose; the brief's approximate camera limits are not vehicle poses.
  await navigate(`area=${area}&at=${area==='mabou'?'624300,5103250,0':area==='porthood'?'613750,5096500,0':'628200,5052800,0'}`);
  const pose=await evalJS(`(()=>{const w=mmm.sidewalks,p=w.plan.pieces.filter(p=>p.run.id===${JSON.stringify(run)}),s=p[Math.floor(p.length*${fraction})].a,n=s.normal;return {east:s.centre[0]+n[0]*1.15,north:s.centre[1]+n[1]*1.15,heading:Math.atan2(-n[1],n[0])*180/Math.PI};})()`);
  for(const view of ['chase','seat'])for(const enabled of process.env.SIDEWALK_AFTER_ONLY?[true]:[false,true]) {
   const label=`${name}-${view}-${enabled?'after':'before'}`;
   await navigate(`area=${area}&at=${pose.east},${pose.north},${pose.heading}&view=${view}&sidewalks=${enabled?1:0}`);
   const report=await evalJS('(()=>{const w=mmm.sidewalks;return {title:document.title,walks:w?.audit??null,draws:mmm.renderer.info.render,low:mmm.low,vehicle:{x:mmm.vehicle.x,z:mmm.vehicle.z},camera:{x:mmm.camera.position.x,y:mmm.camera.position.y,z:mmm.camera.position.z},errors:document.querySelector("#page-error")?.textContent??null};})()');
   assert.equal(!!report.walks,enabled,'before/after layer');if(enabled)assert.ok(report.walks.triangles>0&&report.walks.draws<=2,'walks drawn');
   const shot=await c.send('Page.captureScreenshot',{format:'png'});const file=`${outDir}/${label}.png`;writeFileSync(file,Buffer.from(shot.result.data,'base64'));const old=reports.findIndex(r=>r.label===label);if(old>=0)reports.splice(old,1);reports.push({label,pose,...report});writeFileSync(`${outDir}/pictures.json`,JSON.stringify(reports,null,2)+'\n');assert.ok(!c.logs.some(l=>/Shader Error|VALIDATE_STATUS|ERROR: 0:/.test(l)),'no shader compile errors');console.log(file,JSON.stringify(report.walks));
  }
 } finally {c?.close();if(tab)await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});}
}
writeFileSync(`${outDir}/pictures.json`,JSON.stringify(reports,null,2)+'\n');
