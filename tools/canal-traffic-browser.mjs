// Ambient highway traffic at the Canso canal barrier, on the real baked roads, in the real game page.
// Three canal cycles (300 s) run at the physics rate: the traffic pool, its spawns and the canal timer, as main.ts wires them.
// No traffic car is ever on the span while the deck is hidden, none crosses a closed gate inward, none stands in a queue
// car, cars do wait at the barrier, and every cycle still passes a vessel. A picture shows cars waiting behind the queue.
// RUN=canal-traffic-browser.mjs VIEWS="canal-traffic|area=cansocauseway&demo=1&exag=1.5&trafficCheck=1" tools/yard-shots.sh 1280 720
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { open, sleep } from './truck-cdp.mjs';
const [out, ...urls] = process.argv.slice(2); mkdirSync(out, { recursive: true });
for (const url of urls) {
  const page = await open(url);
  try {
    await page.read(`(() => {
      const m=mmm,c=m.canal,t=m.ambientTraffic;
      if(m.area.id!=='cansocauseway')throw Error('wrong area');
      if(!c||!t)throw Error('canal or traffic missing');
      // The main.ts wiring under test: the stand-ins, the spawn rule and the pool are the canal's own objects.
      if(t.others!==c.drivers||t.keepOut!==c.keepOut||c.traffic!==t.cars)throw Error('canal and traffic are not wired');
      const at=c.point(0,-30);m.vehicle.place(at.x,at.y,0);
    })()`);
    let pending = -1;
    for (let i = 0; i < 240 && pending !== 0; i++) { await sleep(250); pending = await page.read('mmm.terrain.pending'); }
    assert.equal(pending, 0, 'land around the causeway loaded');
    const result = await page.read(`(async () => {
      const m=mmm,c=m.canal,t=m.ambientTraffic,T=await import('/node_modules/three/build/three.module.js');
      const {canalState}=await import('/src/canal-timer.ts');
      // A still bystander 60 m off the road: cars spawn 100-600 m from it, and the camera looks at the sky (out of view).
      const off=c.point(0,60),player={x:off.x,z:off.y,vx:0,vz:0,speed:0,heading:0};
      const cam=new T.PerspectiveCamera(60,16/9,.1,3000);cam.position.set(player.x,600,player.z);cam.lookAt(player.x+1,2000,player.z);
      cam.updateMatrixWorld();cam.updateProjectionMatrix();
      for(const car of t.cars)car.active=car.mesh.visible=false;
      c.seconds=0;
      const band=c.halfLength+16,last=new Map(),bad=[],seen={transits:0,waitFrames:0,waitedCars:0,frames:0,spawns:0,maxQueueTraffic:0};
      let wasPassing=false,waiting=new Set();
      const check=s=>{
        const live=new Set();
        for(const car of t.cars){
          if(!car.active){last.delete(car);continue;}
          const q=c.project(car.solid.x,car.solid.z),prev=last.get(car);
          if(!prev)seen.spawns++;
          if(s.passing&&Math.abs(q.along)<c.halfLength+2.25&&Math.abs(q.across)<6)bad.push('car over the hidden deck at '+c.seconds.toFixed(2)+' s: '+JSON.stringify(q));
          if(prev&&s.closed&&Math.abs(q.across)<6&&Math.abs(prev.along)>=band&&Math.abs(q.along)<band&&Math.abs(q.along-prev.along)<5)
            bad.push('car crossed a closed gate at '+c.seconds.toFixed(2)+' s: '+JSON.stringify({prev,q}));
          for(let i=0;i<c.queueCount;i++){const slot=c.queueSlots[i];
            if(Math.abs(slot.along-q.along)<4.3&&Math.abs(slot.across-q.across)<1.8)bad.push('car inside a queue car at '+c.seconds.toFixed(2)+' s');}
          // A lowered arm is never on a car, nor across the exit of one between the arms (one that drove on as traffic
          // stopped): it waits up until the car is through.
          if(Math.abs(q.across)<6)for(const arm of c.arms){
            if(arm.rotation.x!==0)continue;const side=Math.sign(arm.userData.along),reach=c.halfLength+9;
            const toward=Math.sin(car.solid.heading)*c.along.x-Math.cos(car.solid.heading)*c.along.y;
            if(Math.abs(side*q.along-reach)<2.25||Math.abs(q.along)<reach&&side*toward>0)bad.push('lowered arm on or ahead of a car at '+c.seconds.toFixed(2)+' s: '+JSON.stringify(q));
          }
          if(s.closed&&car.speed<.5&&Math.abs(q.across)<6&&Math.abs(q.along)>=band&&Math.abs(q.along)<band+80){live.add(car);seen.waitFrames++;}
          last.set(car,{along:q.along,across:q.across});
        }
        for(const car of live)if(!waiting.has(car))seen.waitedCars++;
        waiting=live;
        if(s.passing&&!wasPassing)seen.transits++;wasPassing=s.passing;
      };
      for(let frame=0;frame<300*60;frame++){
        // As main.ts: traffic and canal clock together in each 1/120 s physics step, then the frame's draw and spawns.
        t.step(1/120,player);c.advance(1/120,player);t.step(1/120,player);c.advance(1/120,player);
        c.update(0,player);t.update(cam,player);
        check(canalState(c.seconds));seen.frames++;
        if(bad.length>5)break;
      }
      // A picture: run on to a transit with cars waiting behind a full queue, then hold that moment.
      let held=false;
      for(let frame=0;frame<400*60&&!held;frame++){
        t.step(1/120,player);c.advance(1/120,player);t.step(1/120,player);c.advance(1/120,player);c.update(0,player);t.update(cam,player);
        const s=canalState(c.seconds);check(s);
        held=s.passing&&c.queueCount===6&&waiting.size>0&&s.progress>.3&&s.progress<.7;
      }
      const shown=t.cars.filter(car=>car.active&&car.mesh.visible).length;
      t.step=()=>{};t.update=()=>{};c.update=c.advance=()=>{};
      const centre=c.centre,deck=c.deck;
      m.scene.onBeforeRender=(_r,_s,camera)=>{
        camera.position.set(centre.x-130,deck+85,centre.y+130);camera.fov=48;camera.updateProjectionMatrix();
        camera.lookAt(centre.x,deck,centre.y);camera.updateMatrixWorld();
      };
      return {...seen,held,shown,seconds:c.seconds,bad,pool:t.cars.length,drivers:c.drivers.length};
    })()`);
    writeFileSync(`${out}/canal-traffic-run.json`, JSON.stringify(result, null, 2));
    assert.deepEqual(result.bad, [], 'traffic keeps to the barrier rules');
    assert.ok(result.transits >= 3, 'a vessel passes in every cycle: ' + result.transits);
    assert.ok(result.waitedCars >= 2 && result.spawns >= 4, 'traffic came and waited at the barrier: ' + JSON.stringify(result));
    assert.ok(result.held, 'a transit with traffic waiting behind the queue for the picture');
    await page.read('mmm.freeCamera()');   // the old F camera: the car held still, no drone in the picture
    await sleep(4000);
    await page.shot(`${out}/canal-traffic-desktop.png`);
    assert.deepEqual(page.errors, []);
    console.log('PASS canal traffic', JSON.stringify({ ...result, bad: undefined }));
  } finally { await page.close(); }
}
