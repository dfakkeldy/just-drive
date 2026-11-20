#!/usr/bin/env node
import { cdp, cdpFetch } from './cdp.mjs';
// Exact deck + real Vehicle/Yard integration, on loaded game terrain in desktop, named, closed and phone modes.
// WEB_PORT=5213 CDP_PORT=9413 OUT=data/work/ramp RUN=ramp-check.mjs VIEWS='ramp|x=1' tools/yard-shots.sh 1400 950
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const [out, first] = process.argv.slice(2), origin = new URL(first).origin;
const port = process.env.CDP_PORT ?? '9413';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, {method:'PUT'})).json();
const errors=[], assemblyCounts=[];
const { ws, send } = await cdp(tab.webSocketDebuggerUrl, { deadline: 180000, onEvent: m => {if(m.method==='Runtime.consoleAPICalled'){const line=m.params.args.map(a=>a.value??'').join(' '),match=/\[yard-ramp\] (\d+) assembly triangles/.exec(line);if(match)assemblyCounts.push(+match[1]);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);} });
const read=async expression=>{const m=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(m.error||m.result.exceptionDetails)throw Error(JSON.stringify(m));return m.result.result.value;};
const shot=async name=>{const m=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${name}.png`,Buffer.from(m.result.data,'base64'));};
try {
  await send('Runtime.enable'); await send('Page.enable');
  const reports=[];
  for(const mode of ['invented','named','closed','phone']) {
    if(mode==='phone')await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await send('Page.navigate',{url:`${origin}/?cam=620525.19624,5099315.85697,3.2,-34.25384,-5,55&camground=1&hud=0&yard=${mode==='phone'?'invented':mode}${mode==='phone'?'&q=low&touch=1':''}`});
    let settled=false;
    for(let n=0;n<160;n++){await sleep(500);if(await read(`document.title.startsWith('settled') && !!window.mmm?.yard?.triangles`)){settled=true;break;}}
    assert.ok(settled,`${mode}: terrain/yard loaded`);
    // Freeze only this page's animation loop. Every simulated frame below runs the production controller and yard.
    await read('window.requestAnimationFrame=()=>0'); await sleep(100);
    await read(`(async()=>{
      const {SLIP_RAMP:r,slipLift}=await import('/src/yard-site.ts');
      const {vehicle:car,yard,terrain,camera}=mmm,site=yard.site;
      // This suite isolates the deck/crib physics. jump-check drives the staged load with its collision intact.
      yard.jumpLoad = [];
      window.rampTest={r,slipLift,car,yard,terrain,camera,site};
      rampTest.place=(u,v,du,dv)=>{
        const p=site.world(u,v);
        if(!car.place(p.x,p.z,site.heading(du,dv)))throw Error('yard rejected ramp test placement '+JSON.stringify({u,v,du,dv}));
        car.assist=0;car.steerAngle=0;
      };
      rampTest.contact=run=>terrain.withGroundContact?terrain.withGroundContact(car,run):run();
      rampTest.frame=(dt,input)=>{if(mmm.driveVehicle)mmm.driveVehicle(dt,input);else car.update(dt,input);yard.update(dt,car,camera.position);};
      rampTest.step=(throttle=0,steer=0)=>rampTest.frame(1/120,{throttle,steer,handbrake:false});
      rampTest.sample=()=>{const p=site.local(car.x,car.z);return {along:r.u-p.u,v:p.v,y:car.y,vy:car.vy,air:car.airborne,speed:car.speed,h:terrain.heightAt(car.x,car.z)};};
      rampTest.view=(u,v,height,tu,tv,th=1)=>{const p=site.world(u,v),t=site.world(tu,tv);camera.position.set(p.x,terrain.heightAt(p.x,p.z)+height,p.z);camera.lookAt(t.x,terrain.heightAt(t.x,t.z)+th,t.z);camera.updateMatrixWorld();mmm.renderer.render(yard.group.parent,camera);};
    })()`);
    const heights=await read(`(()=>{const {r,site,terrain}=rampTest;return [0,1.2,5,9,13,17.19,18].map(a=>{const p=site.world(r.u-a,r.v);return {a,h:terrain.heightAt(p.x,p.z),surface:terrain.surfaceAt(p.x,p.z).ground,deck:site.deckHeight(p.x,p.z,(x,z)=>terrain.landHeightAt(x,z))}})})()`);
    for(const h of heights)assert.ok(Math.abs(h.h-h.surface)<1e-8,`${mode}: terrain and surface agree`);
    if(mode==='closed'){
      assert.ok(heights.every(h=>h.deck===null),'closed: no deck');
      const unchanged=await read(`(()=>{const {site,terrain,r}=rampTest;return Array.from({length:70},(_,i)=>{const p=site.world(r.u-i*.3,r.v);return terrain.heightAt(p.x,p.z)===terrain.landHeightAt(p.x,p.z)}).every(Boolean)})()`);
      assert.ok(unchanged,'closed: all ramp footprint heights unchanged');
      const count=await read('mmm.yard.rampBack.length'); assert.equal(count,0,'closed: no ramp collision');
      reports.push({mode,heights}); continue;
    }
    // Collect every review regression before asserting, so an unfixed head shows all failure classes.
    const regressions=await read(`(async()=>{
      const t=rampTest,{r,car,site,terrain,yard,camera}=t,failures=[];
      const check=(ok,label,detail)=>{if(!ok)failures.push({label,...detail});};
      const land=(u,v)=>{const p=site.world(u,v);return terrain.landHeightAt(p.x,p.z);};
      // Every edge and corner, including points just beyond the rotated rectangle's four corners.
      const end=r.lead+r.length,e=.001,points=[];
      for(const a of [0,end/4,end/2,3*end/4,end])for(const side of [-1,1])points.push([a,side*(r.width/2+e)]);
      for(const a of [-e,end+e])for(const z of [-r.width/2,0,r.width/2])points.push([a,z]);
      for(const a of [-e,end+e])for(const z of [-r.width/2-e,r.width/2+e])points.push([a,z]);
      for(const [a,z]of points){const p=site.world(r.u-a,r.v+z),h=terrain.landHeightAt(p.x,p.z);check(terrain.heightAt(p.x,p.z)===h&&terrain.surfaceAt(p.x,p.z).ground===h,'outside edge/corner',{a,z});}
      const {YardSite}=await import('/src/yard-site.ts'),{Yard}=await import('/src/yard.ts');
      const freshSite=new YardSite(terrain.manifest.village,site.mode),fresh=new Yard(freshSite,terrain,${mode==='phone'});
      fresh.probes=[{x:1e8,z:1e8}]; // One unavailable probe, while the ramp tile itself is loaded.
      const index=terrain.sites.indexOf(site);terrain.sites[index]=freshSite;
      try{fresh.update(0,car,camera.position);const p=site.world(-80,-21),h=terrain.landHeightAt(p.x,p.z);check(!fresh.built&&!fresh.group.visible&&terrain.heightAt(p.x,p.z)===h&&terrain.surfaceAt(p.x,p.z).ground===h,'not built yet',{lift:terrain.heightAt(p.x,p.z)-h});}finally{terrain.sites[index]=site;}
      const p=site.world(-80,-21),deck=terrain.heightAt(p.x,p.z);
      check(site.deckHeight(p.x,p.z,()=>land(r.u,r.v)+2)===deck,'stored model base',{deck,changed:site.deckHeight(p.x,p.z,()=>land(r.u,r.v)+2)});
      // Ignore collision on purpose: below-deck wheel samples must still see land, never the deck above them.
      const below=[];
      for(const [u,v,du,dv]of [[-80,-21,0,-1],[-80,-18.3,0,-1],[r.u-end-.5,r.v,1,0]]){
        t.place(u,v,du,dv);car.y=land(u,v);
        const fx=Math.sin(car.heading),fz=-Math.cos(car.heading),rx=Math.cos(car.heading),rz=Math.sin(car.heading),lifts=[];
        for(const a of [-1.31,1.31])for(const b of [-.785,.785]){
          const x=car.x+fx*a+rx*b,z=car.z+fz*a+rz*b,h=t.contact(()=>car.groundAt(x,z)),floor=terrain.landHeightAt(x,z);
          lifts.push(h-floor);check(h===floor,'below deck wheel sample',{u,v,a,b,lift:h-floor});
        }
        below.push(Math.max(...lifts));
      }
      t.place(-80,-16,0,-1);car.y=land(-80,-16);car.prevGround=car.y;
      const velocity=site.worldDir(0,-34);car.vx=velocity.x;car.vz=velocity.z;car.speed=34;
      let bypassLift=0;
      // Disable all solid resolution: the height guard must be safe by itself, including real wheel queries.
      for(let i=0;i<20;i++){t.contact(()=>car.update(1/30,{throttle:0,steer:0,handbrake:false}));bypassLift=Math.max(bypassLift,car.y-terrain.landHeightAt(car.x,car.z));}
      check(bypassLift<.5,'height guard without solids',{bypassLift});
      car.y=deck+1;
      check(t.contact(()=>car.groundAt(p.x,p.z))===deck,'above deck contact',{});
      const local=site.local,world=site.world;
      try{site.local=site.world=()=>{throw Error('allocated coordinate object');};check(site.deckHeight(site.box[2]+1,site.box[3]+1)===null,'outside fast path',{});}catch(error){check(false,'outside fast path',{error:String(error)});}finally{site.local=local;site.world=world;}
      const hits=[];
      const hit=(label,u,v,du,dv,speed,hz)=>{
        t.place(u,v,du,dv);car.y=land(u,v);car.prevGround=car.y;
        const velocity=site.worldDir(du*speed,dv*speed);car.vx=velocity.x;car.vz=velocity.z;car.speed=speed;
        let maxLift=-Infinity,onDeck=false;
        for(let i=0;i<hz*3;i++){
          t.frame(1/hz,{throttle:0,steer:0,handbrake:false});
          const floor=terrain.landHeightAt(car.x,car.z),lift=car.y-floor;maxLift=Math.max(maxLift,lift);
          const top=site.deckHeight(car.x,car.z,(x,z)=>terrain.landHeightAt(x,z));
          if(top!==null&&lift>.5&&Math.abs(car.y-top)<.15)onDeck=true;
        }
        const top=site.deckHeight(car.x,car.z,(x,z)=>terrain.landHeightAt(x,z)),floor=terrain.landHeightAt(car.x,car.z);
        const endedOnDeck=top!==null&&top-floor>.08&&Math.abs(car.y-top)<.1;
        const row={label,speed,hz,maxLift,onDeck,endedOnDeck};hits.push(row);check(maxLift<.5&&!onDeck&&!endedOnDeck,'high speed '+label,row);
      };
      // The exact review reproduction first; all directions include both signs along a fender or crib.
      hit('review side u=-80 v=-16',-80,-16,0,-1,34,30);
      for(const hz of [30,20])for(const speed of [34,45])for(const side of [-1,1])for(const angle of [30,60,90,120,150]){
        const a=angle*Math.PI/180,du=Math.cos(a),dv=-side*Math.sin(a);
        hit('side '+side+' angle '+angle,-80-du*5/Math.abs(dv),r.v+side*5,du,dv,speed,hz);
      }
      for(const hz of [30,20])for(const speed of [34,45])for(const angle of [-60,-30,0,30,60]){
        const a=angle*Math.PI/180,du=Math.cos(a),dv=Math.sin(a);
        hit('crib angle '+angle,r.u-end-5,r.v-dv*5/du,du,dv,speed,hz);
      }
      yard.tidy();
      return {failures,edgeSamples:points.length,below,bypassLift,hits,worstLift:Math.max(...hits.map(h=>h.maxLift))};
    })()`);
    console.log(mode,'review regressions',JSON.stringify({...regressions,hits:undefined}));
    assert.equal(regressions.failures.length,0,`${mode}: review regressions failed (see measurements above)`);
    for(const h of heights.filter(h=>h.a>1.2&&h.a<17.2))assert.ok(Math.abs(h.h-h.deck)<1e-8,`${mode}: exact deck`);
    const drive=async speed=>read(`(()=>{const t=rampTest,{r,car}=t;t.place(r.u+22,r.v,-1,0);const samples=[];for(let i=0;i<${speed===2?6000:1200};i++){t.step(Math.max(-1,Math.min(1,(${speed}-car.speed)*.9)));const s=t.sample();samples.push(s);if(s.along>r.lead+r.length+17)break;}return samples})()`);
    const fast=await drive(14), deck=fast.filter(s=>s.along>3&&s.along<14);
    assert.ok(deck.length>10,`${mode}: climbs from clear run-up`);
    const base=heights[0].h;
    const highClearance=await read(`(()=>{const {r,site,terrain}=rampTest,p=site.world(r.u-r.lead-r.length+.001,r.v);return terrain.heightAt(p.x,p.z)-terrain.landHeightAt(p.x,p.z)})()`);
    assert.ok(highClearance>=1.2&&highClearance<=1.6,`${mode}: high end is 1.2 to 1.6 m above the yard: ${highClearance}`);
    const plainYard=await read(`(()=>{const {r,site,terrain}=rampTest;return [3,9,15].every(a=>{const p=site.world(r.u-a,r.v),s=terrain.surfaceAt(p.x,p.z);return s.kind===10&&s.roadDist<s.halfWidth})})()`);
    assert.ok(plainYard,`${mode}: deck remains yard ground for lawn damage and complaints`);
    const error=Math.max(...deck.map(s=>Math.abs(s.y-(base+.12+(1.9-.12)*(s.along-1.2)/16))));
    assert.ok(error<.04,`${mode}: deck following error ${error}`);
    assert.ok(deck.every(s=>!s.air),`${mode}: stays grounded on deck`);
    const firstAir=fast.findIndex(s=>s.air&&s.along>14), land=fast.findIndex((s,i)=>i>firstAir&&!s.air&&s.along>18);
    assert.ok(firstAir>0&&fast[firstAir].speed>10&&fast[firstAir].vy>0,`${mode}: launch at speed`);
    assert.ok(land>firstAir&&(land-firstAir)/120<3,`${mode}: lands within 3 seconds`);
    assert.ok(fast.slice(-30).every(s=>!s.air&&Math.abs(s.y-s.h)<.05),`${mode}: settled on ground`);
    assert.ok(fast.at(-1).along>32,`${mode}: clear landing run`);
    const steer=await read(`(()=>{const t=rampTest,h=t.car.heading;for(let i=0;i<60;i++)t.step(0,.6);return {yaw:Math.abs(t.car.heading-h),air:t.car.airborne}})()`);
    assert.ok(steer.yaw>.08&&!steer.air,`${mode}: steerable after landing`);
    const slow=await drive(2);let longest=0,run=0;for(const s of slow){run=s.air?run+1:0;longest=Math.max(run,longest);}
    assert.ok(slow.at(-1).along>32,`${mode}: slow roll-off completes`);
    // The car's height changes only as fast as it moves. A jump in height from one 120 Hz step to the next is a
    // teleport: the "ground changed under me" correction once took the deck going out from under a falling car for
    // new land data and dropped the car 0.7 m at once (so a hard landing read as a soft one).
    for (const [name, run2] of [['slow', slow], ['fast', fast]]) {
      let worst = 0;
      for (let i = 1; i < run2.length; i++) worst = Math.max(worst, Math.abs(run2[i].y - run2[i - 1].y) - (Math.max(Math.abs(run2[i].vy), Math.abs(run2[i - 1].vy)) + 1.5) / 120);
      // 5 cm: the car's own ground contact settles the last few centimetres of a landing in one step (measured
      // 4.6 cm on real level-7 land). The fault this guards against was 67 cm.
      assert.ok(worst < 0.05, `${mode}: ${name} drive: the car's height never jumps (worst ${worst.toFixed(3)} m beyond its own motion)`);
    }
    const slowLanding = Math.max(...slow.map((s2) => -s2.vy));
    assert.ok(slowLanding > 4.4, `${mode}: the slow roll-off is a real fall of 1.5 m (fastest downward speed ${slowLanding.toFixed(2)} m/s)`);
    assert.ok(longest/120<1,`${mode}: slow air interval ${longest/120}`);
    assert.ok(slow.slice(-120).every(s=>!s.air),`${mode}: slow landing settles`);
    const sides=await read(`(()=>{const t=rampTest,{r,site,car}=t;return [-1,1].map(side=>{t.place(r.u-9,r.v+side*9,0,-side);let closest=99;for(let i=0;i<480;i++){t.step(1);closest=Math.min(closest,Math.abs(site.local(car.x,car.z).v-r.v));}return {closest,speed:car.speed}})})()`);
    assert.ok(sides.every(s=>s.closest>3.3&&Math.abs(s.speed)<.2),`${mode}: both sides stop the car ${JSON.stringify(sides)}`);
    const back=await read(`(()=>{const t=rampTest,{r,site,car}=t;t.place(r.u-r.lead-r.length-8,r.v,1,0);let nearest=99;for(let i=0;i<480;i++){t.step(1);nearest=Math.min(nearest,r.u-r.lead-r.length-site.local(car.x,car.z).u);}return {nearest,speed:car.speed}})()`);
    assert.ok(back.nearest>2&&Math.abs(back.speed)<.2,`${mode}: crib blocks underside ${JSON.stringify(back)}`);
    const frame30=await read(`(()=>{const t=rampTest,{car,r,site,terrain,yard,camera}=t;t.place(r.u+22,r.v,-1,0);const samples=[];for(let i=0;i<400;i++){t.frame(1/30,{throttle:Math.max(-1,Math.min(1,(14-car.speed)*.9)),steer:0,handbrake:false});samples.push(t.sample());if(t.sample().along>34)break;}return samples})()`);
    assert.ok(frame30.some(s=>s.air)&&!frame30.at(-1).air&&frame30.at(-1).along>32,`${mode}: full 30 Hz frame loop launches and settles`);
    await read('mmm.yard.tidy()');
    if(mode==='invented'||mode==='phone'){
      await read(`(()=>{const t=rampTest,r=t.r;t.place(r.u-9,r.v,-1,0);for(let i=0;i<15;i++)t.step(0);t.view(r.u+5,r.v-16,5,r.u-10,r.v,0.5)})()`);
      await shot(mode==='phone'?'phone':'car-halfway');
    }
    if(mode==='invented'){
      // Re-run the same launch in small increments and render three real simulated frames.
      await read(`(()=>{const t=rampTest,r=t.r;t.place(r.u+22,r.v,-1,0);for(let i=0;i<1200;i++){t.step(Math.max(-1,Math.min(1,(14-t.car.speed)*.9)));if(t.car.airborne&&t.sample().along>14)break;}t.view(r.u-20,r.v+13,3.2,r.u-18,r.v,1)})()`);
      await shot('air-1');
      for(let frame=2;frame<=3;frame++){await read(`(()=>{const t=rampTest;for(let i=0;i<18;i++)t.step(0);t.view(t.r.u-20,t.r.v+13,3.2,t.r.u-18,t.r.v,1)})()`);await shot(`air-${frame}`);}
    }
    reports.push({mode,error,highClearance,airSeconds:(land-firstAir)/120,slowAirSeconds:longest/120,launch:fast[firstAir],landing:fast[land],sides,back,triangles:await read('mmm.yard.triangles'),heights});
  }
  assert.deepEqual(reports[0].heights,reports[1].heights,'named matches invented');
  assert.deepEqual(reports[0].heights,reports[3].heights,'phone matches desktop');
  assert.equal(errors.length,0,errors.join('\n'));
  const assembly=Math.max(...assemblyCounts),added=assembly+28+4*54; // New board (both faces) and all four cones.
  assert.ok(assembly>0&&added<3000,`added triangle budget: ${added}`);
  console.log(`Assembly: ${assembly} triangles; with new board and four cones: ${added} (before stock reductions).`);
  console.log(JSON.stringify(reports.map(({heights,...r})=>r),null,2));
  console.log('PASS: exact deck, climb, launch/landing/steering, slow roll-off, both sides/crib, closed and phone parity.');
} finally {await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);ws.close();}
