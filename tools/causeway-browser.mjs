// Drive over the baked span, then prove the canal traffic in cansocauseway.
// RUN=causeway-browser.mjs VIEWS="crossing|area=pointtupper&demo=1&exag=1.5" tools/yard-shots.sh
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { open, sleep } from './truck-cdp.mjs';
import { cdp, cdpFetch } from './cdp.mjs';
import { PHONE_CAP } from './frame-budget-policy.mjs';
// A page that keeps driving never settles (a demo counts as busy until its budget is spent): open it bare and wait
// for the canal and the land under the car instead.
async function openLive(url) {
  const port = process.env.CDP_PORT ?? '9471';
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const c = await cdp(tab.webSocketDebuggerUrl, { deadline: 180000 });
  const close = async () => { try { await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); } finally { c.close(); } };
  const read = async expression => {
    const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.ok(!r.error && !r.result.exceptionDetails, JSON.stringify(r.error ?? r.result.exceptionDetails)); return r.result.result.value;
  };
  try {
    await c.send('Page.enable'); await c.send('Page.navigate', { url });
    let ready = false;
    for (let i = 0; i < 240 && !ready; i++) { await sleep(500); ready = await read(`document.readyState==='complete'&&typeof mmm!=='undefined'&&!!mmm.canal&&mmm.terrain.pending===0`).catch(() => false); }
    assert.ok(ready, 'live page loaded: ' + c.errors.join(' | '));
    return { read, send: c.send, errors: c.errors, close };
  } catch (error) { await close().catch(() => {}); throw error; }
}
const [out,...urls]=process.argv.slice(2);mkdirSync(out,{recursive:true});
for (const url of urls) {
  const area=new URL(url).searchParams.get('area')??'pointtupper';
  const page=await open(url);
  try {
    const setup=await page.read(`(() => {
      const m=mmm,v=m.vehicle,[east,north]=m.terrain.manifest.village;
      if(m.area.id!==${JSON.stringify(area)})throw Error('wrong area');
      const hit=m.roads.nearest(623670.57-east,north-5056096.30,20,r=>r.bridge&&r.name==='Highway 104');
      if(!hit)throw Error('Canso movable bridge is absent from baked road data');
      const points=hit.road.pts,a=points[0],b=points.at(-1),dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
      const ux=dx/length,uz=dz/length;
      const start=m.roads.nearest(a[0]-ux*35,a[1]-uz*35,20,r=>r.kind===1&&!r.bridge);
      if(!start)throw Error('bridge approach road missing');
      const heading=Math.atan2(ux,-uz);v.place(start.x,start.z,heading);v.damageActive=false;
      if(m.canal)m.canal.seconds=0;   // the scripted crossing meets an open road
      window.causewayProbe={a,b,ux,uz,length,start:{x:start.x,z:start.z,roadId:start.road.id}};return window.causewayProbe;
    })()`);
    let deck=null;
    for(let i=0;i<240;i++) {
      await sleep(250);
      deck=await page.read(`(() => {const p=causewayProbe,m=mmm;return m.terrain.pending===0?m.roads.deckHeight((p.a[0]+p.b[0])/2,(p.a[1]+p.b[1])/2):null})()`);
      if(Number.isFinite(deck)&&deck>.5)break;
    }
    assert.ok(Number.isFinite(deck)&&deck>.5,'loaded bridge deck stands above the canal: '+deck);
    const result=await page.read(`(async () => {
      const {autopilot}=await import('/src/vehicle.ts'),m=mmm,v=m.vehicle,p=causewayProbe;
      let maximumSunk=0,deckSamples=0,minimumDeck=Infinity,steps=0,progress=-Infinity;
      for(;steps<2400;steps++) {
        m.driveVehicle(1/120,autopilot(v,m.roads,12));
        maximumSunk=Math.max(maximumSunk,v.sunk);
        const h=m.roads.deckHeight(v.x,v.z);
        if(h!==null){deckSamples++;minimumDeck=Math.min(minimumDeck,h);}
        progress=(v.x-p.a[0])*p.ux+(v.z-p.a[1])*p.uz;
        if(progress>p.length+25)break;
      }
      const final={x:v.x,z:v.z,y:v.y};v.place(v.x,v.z,v.heading);
      return {area:m.area.id,progress,length:p.length,maximumSunk,deckSamples,minimumDeck,steps,final};
    })()`);
    assert.equal(result.area,area);
    assert.ok(result.progress>result.length+25,'car reaches the far approach: '+JSON.stringify(result));
    assert.equal(result.maximumSunk,0,'car never enters water');
    assert.ok(result.deckSamples>200&&result.minimumDeck>.5,'car uses the real bridge deck');
    assert.ok(Number.isFinite(result.final.y),'finite car height');
    assert.deepEqual(page.errors,[]);
    await sleep(1000);
    await page.shot(`${out}/causeway-drive.png`);
    if (area === 'cansocauseway') {
      // The game's own frames advance the canal (main.ts physics step, beside the traffic), by real seconds; a hidden tab
      // and fly mode freeze it. A demo stops driving (and stepping) once its budget is spent, so this page drives for
      // ten minutes, from the approach and heading away, never back on the span.
      let framesResult;
      const live = await openLive(url.replace(/demo=[^&]*/, 'demo=600'));
      try {
        await live.read(`(() => {
          // As the crossing above: the approach road 35 m before the span, but heading away from it.
          const m=mmm,c=m.canal,p=c.point(-c.halfLength-35,0),road=m.roads.nearest(p.x,p.y,20,r=>r.kind===1&&!r.bridge);
          if(!road)throw Error('approach road missing');m.vehicle.place(road.x,road.z,Math.atan2(-c.along.x,c.along.y));
        })()`);
        let pending = -1;
        for (let i = 0; i < 240 && pending !== 0; i++) { await sleep(250); pending = await live.read('mmm.terrain.pending'); }
        const frames = { from: await live.read(`(() => {const c=mmm.canal;c.seconds=11;return c.seconds})()`) };
        await sleep(2500);
        Object.assign(frames, await live.read(`(() => {const c=mmm.canal,v=mmm.vehicle;return {seconds:c.seconds,queue:c.queues.count,closed:c.arms.every(a=>a.rotation.x===0),speed:v.speed,along:c.project(v.x,v.z).along}})()`));
        assert.ok(frames.seconds > 12 && frames.seconds < 14.5 && frames.queue > 0 && frames.closed, 'game frames run the canal: ' + JSON.stringify(frames));
        await live.read(`Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))`);
        await sleep(300); frames.hidden = await live.read('mmm.canal.seconds'); await sleep(1500);
        assert.equal(await live.read('mmm.canal.seconds'), frames.hidden, 'a hidden tab freezes the canal');
        await live.read(`delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))`);
        for (const type of ['keyDown', 'keyUp']) await live.send('Input.dispatchKeyEvent', { type, key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80 });
        await sleep(1500); frames.resumed = await live.read('mmm.canal.seconds');
        assert.ok(frames.resumed > frames.hidden + .5, 'the canal runs again after the pause: ' + JSON.stringify(frames));
        // Fly mode stops the traffic's physics step, and the canal clock with it (they must never run apart).
        const fly = async () => { for (const type of ['keyDown', 'keyUp']) await live.send('Input.dispatchKeyEvent', { type, key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70 }); };
        await fly(); await sleep(500); frames.fly = await live.read('mmm.canal.seconds'); await sleep(1500);
        assert.equal(await live.read('mmm.canal.seconds'), frames.fly, 'fly mode holds the canal clock');
        await fly(); await sleep(1500); frames.driving = await live.read('mmm.canal.seconds');
        assert.ok(frames.driving > frames.fly + .5, 'driving runs the canal clock again: ' + JSON.stringify(frames));
        // Live mid-swing rotation plus pause/resume while swinging.
        await live.read(`(() => {const c=mmm.canal;c.seconds=20.5;c.update(0,mmm.vehicle,true);})()`);
        const swingStart = await live.read(`(() => ({s:mmm.canal.bridge.swing,y:mmm.canal.bridge.spanMesh.rotation.y}))()`);
        await sleep(1600);
        const swingMid = await live.read(`(() => ({s:mmm.canal.bridge.swing,y:mmm.canal.bridge.spanMesh.rotation.y}))()`);
        assert.ok(swingMid.s > swingStart.s + 0.1 && swingMid.s < 0.99 && Math.abs(swingMid.y - swingStart.y) > 0.1, 'live frames rotate the swing bridge: ' + JSON.stringify({swingStart, swingMid}));
        for (const type of ['keyDown', 'keyUp']) await live.send('Input.dispatchKeyEvent', { type, key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80 });
        await sleep(300);
        const swingPaused = await live.read(`(() => ({s:mmm.canal.bridge.swing,y:mmm.canal.bridge.spanMesh.rotation.y}))()`);
        await sleep(1200);
        const swingHeld = await live.read(`(() => ({s:mmm.canal.bridge.swing,y:mmm.canal.bridge.spanMesh.rotation.y}))()`);
        assert.equal(swingHeld.s, swingPaused.s, 'pause freezes mid-swing angle');
        assert.equal(swingHeld.y, swingPaused.y, 'pause freezes mid-swing mesh yaw');
        for (const type of ['keyDown', 'keyUp']) await live.send('Input.dispatchKeyEvent', { type, key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80 });
        await sleep(1400);
        const swingResumed = await live.read(`(() => ({s:mmm.canal.bridge.swing,y:mmm.canal.bridge.spanMesh.rotation.y}))()`);
        assert.ok(swingResumed.s > swingHeld.s + 0.05, 'resume continues swinging bridge: ' + JSON.stringify({swingHeld, swingResumed}));
        frames.swing = { swingStart, swingMid, swingPaused, swingResumed };
        assert.deepEqual(live.errors, []);
        console.log('PASS game frames run the canal and swing bridge', JSON.stringify(frames));
        framesResult = frames;
      } finally { await live.close(); }
      // Opening the second tab hid this one, and a hidden tab pauses the scene: bring it back before driving here.
      await page.send('Page.bringToFront');
      let shown = false;
      for (let i = 0; i < 40 && !shown; i++) { await sleep(250); shown = await page.read('document.visibilityState==="visible"'); }
      assert.ok(shown, 'the canal page is visible again');
      // Hiding latches the pause screen; resume as a player would.
      if (!await page.read(`document.getElementById('pauseScreen')?.hidden ?? true`))
        for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80 });
      await sleep(500);
      assert.equal(await page.read(`document.getElementById('pauseScreen')?.hidden ?? true`), true, 'the canal page is not paused');
      await page.read(`(() => {const m=mmm;m.canal.seconds=0;})()`);
      const traffic = await page.read(`(async () => {
        const m=mmm,c=m.canal,v=m.vehicle;
        if(!c)throw Error('canal traffic missing');
        const {autopilot}=await import('/src/vehicle.ts');
        c.seconds=30;c.update(0,v);
        const start=c.point(-c.halfLength-65,1.9);
        v.place(start.x,start.y,Math.atan2(c.along.x,-c.along.y));
        for(let i=0;i<1800;i++)m.driveVehicle(1/120,autopilot(v,m.roads,12));
        const stopped=c.project(v.x,v.z).along;
        if(Math.abs(stopped-(-c.halfLength-40))>.1)throw Error('queue stop failed '+JSON.stringify({stopped,p:c.project(v.x,v.z),slots:c.queueSlots,count:c.queueCount}));
        const queue=c.queues.count,boats=c.boats.filter(b=>b.visible).length;
        c.seconds=75;c.update(0,v);
        for(let i=0;i<2400;i++)m.driveVehicle(1/120,autopilot(v,m.roads,12));
        const released=c.project(v.x,v.z).along;
        // The real player stopped nose up to the arm (half a metre clear of it at their own half-diagonal), in the approach
        // lane, sees the arms come down and a vessel pass; it used to hold the barrier up for as long as they waited.
        if(m.ambientTraffic)throw Error('this page runs no ambient traffic (no trafficCheck=1)');   // none to hold an arm or the transit
        const out=9+Math.hypot(v.spec.halfLength,v.spec.halfWidth)+.5,wait=c.point(-c.halfLength-out,1.9);if(!v.place(wait.x,wait.y,Math.atan2(c.along.x,-c.along.y)))throw Error('cannot place the player at the arm');
        c.seconds=8;
        for(let i=0;i<120*14;i++)m.driveVehicle(1/120,{throttle:0,steer:0,handbrake:true});
        c.update(0,v);
        const waited={out,seconds:c.seconds,along:c.project(v.x,v.z).along,down:c.arms.map(a=>a.rotation.x===0),boats:c.boats.filter(b=>b.visible).length};
        if(!(waited.seconds>20&&waited.down.every(Boolean)&&waited.boats===1&&Math.abs(waited.along+c.halfLength+out)<1))
          throw Error('a player waiting outside the arm held the barrier '+JSON.stringify(waited));
        c.seconds=42;c.update(0,v);
        const bridgeClosedYaw=c.bridge.baseYaw, bridgeOpenYaw=c.bridge.spanMesh.rotation.y;
        const bridgeOpenDelta=Math.abs(bridgeOpenYaw-bridgeClosedYaw);
        if(!c.bridge.group.visible||c.bridge.swing!==1||bridgeOpenDelta<0.9)
          throw Error('swing bridge did not rotate open at t=42 '+JSON.stringify({visible:c.bridge.group.visible,swing:c.bridge.swing,bridgeOpenDelta}));
        // Hold the inspected transit pose for photographs only.
        c.update=c.advance=()=>{};
        const centre=c.centre,deck=c.deck;

        m.scene.onBeforeRender=(_r,_s,camera)=>{
          const scale=camera.aspect<1?1.15:1;
          camera.position.set(centre.x-130*scale,deck+85*scale,centre.y+130*scale);
          camera.fov=48;camera.updateProjectionMatrix();
          camera.lookAt(centre.x,deck,centre.y);camera.updateMatrixWorld();
        };
        return {stopped,released,halfLength:c.halfLength,queue,boats,waited,bridge:{draws:c.bridge.stats.draws,triangles:c.bridge.stats.triangles,low:c.bridge.low,swing:c.bridge.swing,openDeg:+(bridgeOpenDelta*180/Math.PI).toFixed(1)}};
      })()`);
      assert.equal(traffic.queue,6);assert.equal(traffic.boats,1);
      assert.ok(traffic.released>traffic.halfLength+25,'barrier releases the real car');
      await page.read('mmm.freeCamera()');   // the old F camera: the car held still, no drone in the picture
      await sleep(4000);
      await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
      await sleep(2500);await page.shot(`${out}/canal-desktop.png`);
      // Dedicated fresh q=low&touch=1 phone session so LOW swing bridge geometry and phone budgets are actually verified.
      const phoneUrl = new URL(url);
      phoneUrl.searchParams.set('q', 'low'); phoneUrl.searchParams.set('touch', '1');
      const phone = await open(phoneUrl.toString());
      let phoneCounts;
      try {
        await phone.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
        await phone.read(`(() => {const m=mmm,c=m.canal,p=c.point(-c.halfLength-55,1.9);m.vehicle.place(p.x,p.y,Math.atan2(c.along.x,-c.along.y));c.seconds=42;c.update(0,m.vehicle,true);c.update=c.advance=()=>{};})()`);
        for (let i = 0; i < 240; i++) { await sleep(250); if (await phone.read('mmm.terrain.pending===0&&mmm.canal.bridge.group.visible')) break; }
        await phone.read(`(() => {
          const m=mmm,c=m.canal,centre=c.centre,deck=c.deck;
          m.freeCamera();
          m.scene.onBeforeRender=(_r,_s,camera)=>{
            camera.position.set(centre.x-130*1.15,deck+85*1.15,centre.y+130*1.15);
            camera.fov=48;camera.updateProjectionMatrix();
            camera.lookAt(centre.x,deck,centre.y);camera.updateMatrixWorld();
          };
        })()`);
        await sleep(2500);
        phoneCounts = await phone.read(`(async () => {
          const r=mmm.renderer,b=mmm.canal.bridge,prev=r.info.autoReset;
          let calls=0,triangles=0,submittedCalls=0,submittedTriangles=0;
          const meshes=[b.baseMesh,b.spanMesh],saved=meshes.map(o=>[o.onBeforeRender,o.onAfterRender]);
          for(let i=0;i<meshes.length;i++){const o=meshes[i],[ob,oa]=saved[i];let c0=0,t0=0;
            o.onBeforeRender=function(...a){ob?.apply(this,a);c0=r.info.render.calls;t0=r.info.render.triangles;};
            o.onAfterRender=function(...a){submittedCalls+=r.info.render.calls-c0;submittedTriangles+=r.info.render.triangles-t0;oa?.apply(this,a);};
          }
          await new Promise(done=>requestAnimationFrame(()=>{r.info.autoReset=false;r.info.reset();submittedCalls=0;submittedTriangles=0;requestAnimationFrame(()=>{
            calls=r.info.render.calls;triangles=r.info.render.triangles;r.info.autoReset=prev;
            for(let i=0;i<meshes.length;i++){meshes[i].onBeforeRender=saved[i][0];meshes[i].onAfterRender=saved[i][1];}
            done();
          });}));
          return {low:mmm.low,bridgeLow:b.low,bridgeDraws:b.stats.draws,bridgeTriangles:b.stats.triangles,submittedCalls,submittedTriangles,swing:b.swing,calls,triangles};
        })()`);
        assert.equal(phoneCounts.low, true, 'phone session runs LOW detail');
        assert.equal(phoneCounts.bridgeLow, true, 'swing bridge uses LOW geometry on phone');
        assert.ok(phoneCounts.calls > 0 && phoneCounts.triangles > 0, 'phone frame actually rendered: ' + JSON.stringify(phoneCounts));
        assert.equal(phoneCounts.submittedCalls, 2, 'LOW swing bridge submits both draws in rendered frame: ' + JSON.stringify(phoneCounts));
        assert.equal(phoneCounts.submittedTriangles, phoneCounts.bridgeTriangles, 'LOW swing bridge submits its exact triangle count: ' + JSON.stringify(phoneCounts));
        assert.ok(phoneCounts.bridgeTriangles < 2000 && phoneCounts.swing === 1, 'LOW swing bridge open and bounded: ' + JSON.stringify(phoneCounts));
        assert.ok(phoneCounts.calls <= PHONE_CAP.calls && phoneCounts.triangles <= PHONE_CAP.triangles, 'Canso phone frame within PHONE_CAP: ' + JSON.stringify(phoneCounts));
        assert.deepEqual(phone.errors, [], 'phone LOW session has no errors');
        await phone.shot(`${out}/canal-phone.png`);
      } finally { await phone.close(); }
      writeFileSync(`${out}/canal-traffic.json`,JSON.stringify({...traffic,frames:framesResult,phone:phoneCounts},null,2));
      console.log('PASS canal barrier, queue, swing bridge, LOW phone and release',JSON.stringify({...traffic,phone:phoneCounts}));
    }
    writeFileSync(`${out}/causeway-drive.json`,JSON.stringify({setup,deck,...result,errors:page.errors},null,2));
    console.log('PASS real causeway drive',JSON.stringify(result));
  } finally {await page.close();}
}
