// Run through yard-shots.sh, which owns the browser slot and browser lifetime.
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {cdp,cdpFetch,sleep,exitCheck} from './cdp.mjs';
const [out,first]=process.argv.slice(2),base=new URL(first).origin,port=process.env.CDP_PORT;
for(const [area,folder] of [['mabou','terrain'],['judique','areas/judique']]){
 const manifest=JSON.parse(readFileSync(new URL(`../data/baked/${folder}/manifest.json`,import.meta.url),'utf8'));
 const tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
 const c=await cdp(tab.webSocketDebuggerUrl);
 const read=async expression=>{const r=await c.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
 async function settle(){for(let i=0;i<480;i++){if(await read("document.title==='settled'"))return;await sleep(500);}throw Error('settling deadline');}
 try{
  await c.send('Page.enable');
  await c.send('Page.navigate',{url:`${base}/?area=${area}&cam=${manifest.village[0]},${manifest.village[1]},150,0,-30,50&q=low&x=1&hud=0&res=1`});
  await settle();
  const site=await read(`(()=>{const m=mmm;return m.culverts.crossings.slice().sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z))[0];})()`);
  assert.ok(site,'real crossing exists');
  const e=manifest.village[0]+site.x,n=manifest.village[1]-site.z;
  // Load fine tiles at the crossing through the normal fixed camera link.
  await c.send('Page.navigate',{url:`${base}/?area=${area}&cam=${e},${n},5,0,-20,55&camground=1&q=low&x=1&hud=0&res=1`});
  await settle();
  for(let i=0;i<80;i++){if(await read('mmm.culverts.group.children.some(o=>o.visible)'))break;await sleep(250);}
  // Crown measured on the drawn model (pitch included), against the land at every road sample of the run.
  const facts=await read(`(()=>{const m=mmm,c=${JSON.stringify(site)},h=m.terrain.surfaceAt(c.x,c.z),model=m.culverts.group.children.find(o=>Math.hypot(o.position.x-c.x,o.position.z-c.z)<.1);
    if(!model)return {area:m.area.id,visible:false};
    model.updateMatrixWorld(true);const ml=Math.ceil(c.length/1.825)*1.825,V=model.position.constructor,top=Array.from({length:401},(_,k)=>model.localToWorld(new V(0,4.35,-ml/2+ml*k/400)));
    const fx=Math.sin(c.heading),fz=-Math.cos(c.heading);let gap=-Infinity;
    for(const p of c.cover){const s=(p.x-c.x)*fx+(p.z-c.z)*fz,q=top.reduce((a,b)=>Math.abs((b.x-c.x)*fx+(b.z-c.z)*fz-s)<Math.abs((a.x-c.x)*fx+(a.z-c.z)*fz-s)?b:a),g=m.terrain.surfaceAt(p.x,p.z);gap=Math.max(gap,q.y-g.ground);}
    return {area:m.area.id,count:m.culverts.crossings.length,visible:model.visible,crown:model.position.y+4.35*model.scale.y,crownOverRoad:gap,ground:h?.ground,level:h?.level,failed:m.terrain.failed};})()`);
  assert.equal(facts.area,area);assert.equal(facts.visible,true);assert.ok(facts.crownOverRoad<0,`drawn crown under the road at every sample (${facts.crownOverRoad})`);assert.equal(facts.failed,0);
  // Drive the real vehicle across this road with the arches shown and hidden: the same trace both times, since the
  // arches are scenery only (vehicle-nits separately pins the unchanged contact solver).
  const drive=await read(`(()=>{const m=mmm,c=${JSON.stringify(site)},p=c.cover[Math.floor(c.cover.length/2)],hit=m.roads.nearest(p.x,p.z,30,r=>r.id===c.road),heading=hit.heading;
    function run(){m.vehicle.restart(hit.x-Math.sin(heading)*8,hit.z+Math.cos(heading)*8,heading);m.vehicle.vx=Math.sin(heading)*5;m.vehicle.vz=-Math.cos(heading)*5;const ys=[];for(let i=0;i<240;i++){m.vehicle.update(1/120,{throttle:.25,steer:0,handbrake:false});ys.push([m.vehicle.x,m.vehicle.y,m.vehicle.z,m.vehicle.vy]);}return ys;}
    const shown=run();m.culverts.group.visible=false;const hidden=run();m.culverts.group.visible=true;
    let diff=0;shown.forEach((r,i)=>r.forEach((v,k)=>{diff=Math.max(diff,Math.abs(v-hidden[i][k]));}));
    return {finite:shown.every(r=>r.every(Number.isFinite)),travel:Math.hypot(shown.at(-1)[0]-shown[0][0],shown.at(-1)[2]-shown[0][2]),shownVsHidden:diff};})()`);
  assert.ok(drive.finite,'finite vehicle contact state');assert.ok(drive.travel>8,'car crosses site');assert.ok(drive.shownVsHidden<1e-9,`arches do not touch wheel contact (${drive.shownVsHidden})`);
  console.log('PASS culverts browser',JSON.stringify({facts,drive}));
  // Keep the camera near the stream mouth. Renderer callback only affects this test page.
  await read(`(()=>{const m=mmm,c=${JSON.stringify(site)},fx=Math.sin(c.heading),fz=-Math.cos(c.heading),half=c.length/2;
   const a=m.terrain.heightAt(c.x+fx*half,c.z+fz*half),b=m.terrain.heightAt(c.x-fx*half,c.z-fz*half),sign=a<b?1:-1;
   const y=Math.min(a,b)-.05;
   m.scene.onBeforeRender=(_r,_s,cam)=>{cam.position.set(c.x+fx*sign*(half+2.5)+Math.cos(c.heading)*.6,y+.8,c.z+fz*sign*(half+2.5)+Math.sin(c.heading)*.6);cam.lookAt(c.x+fx*sign*(half-.4),y+.4,c.z+fz*sign*(half-.4));cam.updateMatrixWorld();};})()`);
  for(const [label,width,height,mobile] of [['desktop',1280,720,false],['phone',390,844,true]]){
   await c.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});await sleep(1200);
   const shot=await c.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/culvert-${area}-${label}.png`,Buffer.from(shot.result.data,'base64'));
  }
  writeFileSync(`${out}/culvert-${area}.json`,JSON.stringify({facts,drive,site},null,2));
  // The upstream mouth, which a level run used to bury.
  await read(`(()=>{const m=mmm,c=${JSON.stringify(site)},fx=Math.sin(c.heading),fz=-Math.cos(c.heading),half=c.length/2;
   const a=m.terrain.heightAt(c.x+fx*half,c.z+fz*half),b=m.terrain.heightAt(c.x-fx*half,c.z-fz*half),sign=a<b?-1:1,y=Math.max(a,b)-.05;
   m.scene.onBeforeRender=(_r,_s,cam)=>{cam.position.set(c.x+fx*sign*(half+2.5)+Math.cos(c.heading)*.6,y+.8,c.z+fz*sign*(half+2.5)+Math.sin(c.heading)*.6);cam.lookAt(c.x+fx*sign*(half-.4),y+.4,c.z+fz*sign*(half-.4));cam.updateMatrixWorld();};})()`);
  await c.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});await sleep(1200);
  writeFileSync(`${out}/culvert-${area}-upstream-desktop.png`,Buffer.from((await c.send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
  // Seat survey at the eight crossings nearest the village: each mouth open and on its own bed, no leg hanging over
  // a bank that falls away. A level run seated on the lower bed buried 9 of 16 upstream mouths (survey at 729dfaef).
  const near=await read(`mmm.culverts.crossings.slice().sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z)).slice(0,8)`);
  const survey=[];
  for(const s of near){
   await read('void (mmm.scene.onBeforeRender=()=>{})');
   await c.send('Page.navigate',{url:`${base}/?area=${area}&cam=${manifest.village[0]+s.x},${manifest.village[1]-s.z},5,0,-20,55&camground=1&q=low&x=1&hud=0&res=1`});
   await settle();
   for(let i=0;i<80;i++){if(await read(`mmm.culverts.group.children.some(o=>o.visible&&Math.hypot(o.position.x-(${s.x}),o.position.z-(${s.z}))<.1)`))break;await sleep(250);}
   survey.push(await read(`(()=>{const m=mmm,c=${JSON.stringify(s)},g=(x,z)=>{const q=m.terrain.surfaceAt(x,z);return q&&q.level>=8?q.ground:null;};
    const o=m.culverts.group.children.find(o=>Math.hypot(o.position.x-c.x,o.position.z-c.z)<.1);if(!o||!o.visible)return {missing:true};
    o.updateMatrixWorld(true);const ml=Math.ceil(c.length/1.825)*1.825,V=o.position.constructor,w=(x,y,z)=>o.localToWorld(new V(x,y,z)),r=v=>+v.toFixed(3);
    const ends=[-1,1].map(e=>{const inv=w(0,0,e*ml/2),clear=w(0,4.1,e*ml/2),bed=g(inv.x,inv.z);
     const legs=[-1,1].map(side=>{const p=w(side*4.822,-6,e*ml/2),h=g(p.x,p.z);return h===null?null:r(h-p.y);});
     return {bed:r(bed),invertBelow:r(bed-inv.y),open:r(clear.y-bed),legCover:legs};});
    const covers=c.cover.map(p=>g(p.x,p.z)),minCover=Math.min(...covers),low=Math.min(...ends.map(e=>e.bed)),high=Math.max(...ends.map(e=>e.bed)),lowInvert=Math.min(low-.05,minCover-.55);
    const fx=Math.sin(c.heading),fz=-Math.cos(c.heading),aLow=g(c.x-fx*c.length/2,c.z-fz*c.length/2)<=g(c.x+fx*c.length/2,c.z+fz*c.length/2);
    const fits=c.cover.every((p,i)=>{const s=(p.x-c.x)*fx+(p.z-c.z)*fz,d=aLow?s+c.length/2:c.length/2-s;return lowInvert+(high-.05-lowInvert)*d/c.length<=covers[i]-.55+1e-6;});
    return {dia:+(c.scale*4.1).toFixed(2),len:+c.length.toFixed(1),sy:r(o.scale.y),pitch:r(o.rotation.x),ends,lowSunk:r(low-.05-lowInvert),fullGrade:fits};})()`));
  }
  console.log('SURVEY',area,JSON.stringify(survey));
  writeFileSync(`${out}/culvert-${area}-survey.json`,JSON.stringify(survey,null,1));
  for(const row of survey){
   assert.ok(!row.missing,'surveyed arch shown on fine land');
   // The low mouth sits 5 cm under its bed, deeper only by what thin road fill forces (as before the grade fix). The
   // run climbs to 5 cm under the high bed unless 0.55 m of fill under the road caps the grade.
   const [lo,hi]=row.ends.slice().sort((p,q)=>p.bed-q.bed);
   assert.ok(Math.abs(lo.invertBelow-.05-row.lowSunk)<.01,`low mouth on its bed ${JSON.stringify(row)}`);
   assert.ok(hi.invertBelow>=.04,`high invert not floating ${JSON.stringify(row)}`);
   if(row.lowSunk<.005)assert.ok(lo.open>.1,`low mouth open ${JSON.stringify(row)}`);
   if(row.fullGrade)assert.ok(Math.abs(hi.invertBelow-.05)<.01&&hi.open>.1,`high mouth open on its bed ${JSON.stringify(row)}`);
   for(const e of row.ends)assert.ok(e.legCover.every(v=>v===null||v>=0),`no leg hangs over the bank ${JSON.stringify(row)}`);
   if(row.lowSunk>=.005||!row.fullGrade)console.log('thin road fill limits this run',JSON.stringify(row));
  }
  c.assertHealthy();
 } finally {c.close();await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);}
}
exitCheck();
