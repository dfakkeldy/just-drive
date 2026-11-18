#!/usr/bin/env bash
# Serve the game and take settled screenshots with a headless browser (tools/browser.sh picks it).
# Output: data/work/shots/<name>.png
# Usage: tools/animals-shots.sh [width height] [extra query for every view, e.g. "exag=1"]
#   VIEWS="name|query ..." picks views; defaults cover the new animals, driver seats and panther sign.
#   DETAILS=1 adds close views and prints model sizes and encounter state.
#   CHECKS=1 with DETAILS=1 also checks behaviour against the running game.
#   Example: VIEWS="drive-village|demo=6 seat|demo=6&view=seat" tools/animals-shots.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
browser_ports "$@"
W="${1:-1600}"; H="${2:-1200}"; Q="${3:-}"
OUT="${OUT:-$ROOT/data/work/shots}"; mkdir -p "$OUT"
mem_report
cd "$ROOT/web"
browser_typecheck
# The dev server reads the baked tiles through the public/terrain link, so nothing is copied.
start_check "$W" "$H" dev
URLS=()
for v in ${VIEWS:-animals-guardian|animal=guardian&demo=8 animals-guardian-seat|animal=guardian&demo=8&view=seat animals-panther-sign|animal=guardian&demo=8&inspect=sign animals-bernese|animal=bernese&demo=8 animals-cow|animal=cow&demo=8 animals-cow-seat|animal=cow&demo=8&view=seat animals-farm|animal=farm&demo=6}; do
  URLS+=("http://127.0.0.1:$WEB/?name=${v%%|*}&${v#*|}&hud=${HUD:-0}${Q:+&$Q}")
done
if [[ "${DETAILS:-0}" != 1 ]]; then
  CDP_PORT="$CDP" run_check node "$ROOT/tools/${RUN:-shot.mjs}" "$OUT" "${URLS[@]}"
else
  # Optional close views use the actual scene and models, through CDP. No game debug globals.
  CDP_PORT="$CDP" run_check node --input-type=module - "$OUT" "${URLS[@]}" <<'JS'
import { writeFileSync } from 'node:fs';
const [out, ...urls] = process.argv.slice(2);
const port = process.env.CDP_PORT;
const delay = ms => new Promise(r => setTimeout(r, ms));
for (const url of urls) {
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {method:'PUT'})).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r,j) => { ws.onopen=r; ws.onerror=j; });
  let id=0; const pending=new Map();
  ws.onmessage=e => { const m=JSON.parse(e.data); if(m.id) { pending.get(m.id)?.resolve(m); pending.delete(m.id); } };
  ws.onclose=()=>{for(const p of pending.values())p.reject(new Error('Screenshot browser closed'));pending.clear()};
  const send=(method,params={}) => new Promise((resolve,reject) => {
    const requestId=++id,timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('Screenshot command timed out: '+method))},45000);
    pending.set(requestId,{resolve:m=>{clearTimeout(timer);resolve(m)},reject:e=>{clearTimeout(timer);reject(e)}});ws.send(JSON.stringify({id:requestId,method,params}));
  });
  const run=async expression => {
    const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  try {
    await send('Page.enable');
    await send('Page.navigate',{url}); await delay(800);
    const arm=()=>run(`import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/animals.ts')?.name??'/src/animals.ts').then(({Animals})=>{
      const update=Animals.prototype.update;
      Animals.prototype.update=function(dt,v,c){window.animalInspection={animals:this,vehicle:v,camera:c};return update.call(this,dt,v,c)};
    })`);
    await arm();
    let settled=false;
    for(let i=0;i<160;i++) {
      await delay(1500);
      if(!await run('!!window.animalInspection')) {await arm();continue;}
      if(await run("document.title==='settled'&&(new URLSearchParams(location.search).get('animal')!=='cow'||!window.animalInspection.animals.roads.guardrails.audit.pending)")) {settled=true;break;}
    }
    if(!settled) throw new Error(`Did not settle: ${url}`);
    const name=new URL(url).searchParams.get('name');
    const save=async suffix => {
      const r=await send('Page.captureScreenshot',{format:'png'});
      const path=`${out}/${name}${suffix}.png`;writeFileSync(path,Buffer.from(r.result.data,'base64'));console.log(path);
    };
    await save('');
    console.log(JSON.stringify(await run(`(()=>{
      const {animals:a,vehicle:v}=window.animalInspection;
      return {speed:v.speed,car:{x:v.x,z:v.z},brake:a.influence(v).brake,spawnReady:a.spawnReady,models:a.residents.map(r=>{
        let triangles=0;r.rig?.root.traverse(o=>{if(o.isMesh)triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3});
        return {kind:r.kind,road:r.place.road,along:r.along,state:r.state,triangles,position:r.rig?.root.position,home:r.home,herd:r.herd.map(g=>({kind:g.kind,position:g.rig.root.position}))};
      })};
    })()`)));
    await run(`(async()=>{
      const moduleURL=performance.getEntriesByType('resource').find(e=>e.name.includes('/deps/three.js'))?.name;
      await import(moduleURL);
      const {animals:a,vehicle:v}=window.animalInspection;
      const key=new URLSearchParams(location.search).get('animal'),kind=key==='spaniel'?'bernese':key,r=a.residents.find(r=>r.kind===kind);
      if(!r?.rig) throw new Error('Animal model did not load');
      // Stop at the yard to inspect the welcome. This does not change the production autopilot.
      if(kind==='retriever'||kind==='bernese'||kind==='roofcat') {
        r.state='home';r.timer=0;r.rig.root.position.x=r.home.x;r.rig.root.position.z=r.home.z;a.haveLastVehicle=false;
        v.place(r.spot.x-Math.sin(r.spot.heading)*8,r.spot.z+Math.cos(r.spot.heading)*8,r.spot.heading);v.speed=0;
        for(let i=0;i<900;i++)a.update(.05,v,window.animalInspection.camera);
      }
      const scene=v.car.root.parent;
      scene.onBeforeRender=function(renderer,scene,cam){
        const p=r.rig.root.position,y=r.rig.root.rotation.y,d=kind==='guardian'?3.4:kind==='cow'?5:kind==='farm'?19:kind==='retriever'||kind==='bernese'?2.8:1.3;
        if(new URLSearchParams(location.search).get('inspect')==='sign') {
          const sign=r.decor.children[0],h=r.spot.heading;
          cam.fov=43;cam.updateProjectionMatrix();
          cam.position.set(r.spot.x-Math.sin(h)*15,sign.position.y+1.7,r.spot.z+Math.cos(h)*15);
          cam.lookAt(sign.position.x,sign.position.y+1.7,sign.position.z);cam.updateMatrixWorld();return;
        }
        cam.fov=43;cam.near=.03;cam.updateProjectionMatrix();
        if(kind==='bernese') {
          // A driver's-eye close view of the jump, above the open window sill.
          r.timer=Math.PI/12;a.animate(r,1,v,0);v.car.driverEye.getWorldPosition(cam.position);
          const head=r.rig.head.getWorldPosition(r.rig.head.position.clone());cam.lookAt(head);cam.updateMatrixWorld();return;
        }
        if(kind==='retriever'||kind==='bernese')
          cam.position.set(p.x-Math.cos(v.heading)*.9+Math.sin(v.heading)*2.8,p.y+.85,p.z-Math.sin(v.heading)*.9-Math.cos(v.heading)*2.8);
        else cam.position.set(p.x-Math.sin(y)*d+Math.cos(y)*d*.28,p.y+d*.38,p.z-Math.cos(y)*d-Math.sin(y)*d*.28);
        cam.lookAt(p.x,p.y+(kind==='cow'?1:kind==='guardian'?.6:kind==='farm'?.6:(kind==='retriever'||kind==='bernese')?.4:.18),p.z);
        cam.updateMatrixWorld();
      };
      return {kind,state:r.state,sign15m:new URLSearchParams(location.search).get('inspect')==='sign'};
    })()`);
    await delay(300);await save('-detail');
    if(process.env.CHECKS==='1') console.log(JSON.stringify(await run(`(async()=>{
      const {animals:a,vehicle:v,camera:c}=window.animalInspection;
      const key=new URLSearchParams(location.search).get('animal'),kind=key==='spaniel'?'bernese':key,r=a.residents.find(r=>r.kind===kind);
      const testURL=new URL(location.href);testURL.searchParams.delete('cat');history.replaceState(null,'',testURL);
      const checks=[];
      const assert=(ok,name)=>{if(!ok)throw new Error(kind+': '+name+' '+JSON.stringify({state:r.state,position:r.rig.root.position,home:r.home,car:{x:v.x,z:v.z},ground:a.terrain.heightAt(r.rig.root.position.x,r.rig.root.position.z)}));checks.push(name)};
      const stop=(gap=8)=>{v.place(r.spot.x-Math.sin(r.spot.heading)*gap,r.spot.z+Math.cos(r.spot.heading)*gap,r.spot.heading);v.speed=0;};
      const step=seconds=>{for(let i=0;i<Math.round(seconds/.05);i++)a.update(.05,v,c)};
      r.rig.root.position.x=r.home.x;r.rig.root.position.z=r.home.z;r.state='home';r.timer=r.away=r.pause=0;r.met=false;r.honks=0;r.down=0;r.sit=kind==='cat'?0:1;
      stop();a.haveLastVehicle=false;
      if(kind==='cat'||kind==='pom') {
        const wait=kind==='cat'?20:6;
        step(wait-1);assert(r.state==='home','waits for a full stop');
        if(kind==='cat') {a.honk(v);step(19);assert(r.state==='home'&&r.honks===1,'horn resets patience and hardens stare');}
        if(kind==='cat') {
          a.honk(v);step(.5);assert(r.honks===2&&r.down>.8,'second horn lies down');
          a.honk(v);step(.5);assert(r.honks===3&&r.rig.eyes.every(e=>!e.visible),'third horn closes eyes');
          step(18);assert(r.state==='home','lying cat waits after latest horn');
          step(2);assert(r.state==='rise','rises before walking');
          step(3);assert(r.state==='rise','takes time to rise and stretch');
          step(2);
        } else step(1.2);
        assert(r.state==='yield','yields after the quiet wait');
        step(25);assert(r.state==='shoulder','walks to shoulder');
        stop(110);step(kind==='cat'?3.2:30.2);assert(r.state==='return','returns only after car leaves');
        step(25);assert(r.state==='home','returns to original road position');
        if(kind==='cat') {stop();step(.1);stop(100);step(.1);assert(r.state==='yield','backs away beyond 60 metres');}
        if(kind==='cat') {
          r.state='home';r.timer=0;r.rig.root.position.x=r.home.x;r.rig.root.position.z=r.home.z;
          stop(20);v.speed=12;v.vx=Math.sin(v.heading)*12;v.vz=-Math.cos(v.heading)*12;a.haveLastVehicle=false;
          let minGap=Infinity,braked=false;
          for(let i=0;i<360;i++) {
            const brake=a.influence(v).brake;braked ||= brake>0;
            if(brake&&Math.abs(v.speed)<.15){v.place(v.x,v.z,v.heading);v.speed=0;}
            else v.update(1/60,{throttle:brake?-Math.sign(v.speed)*brake:1,steer:0,handbrake:brake>0});
            a.update(1/60,v,c);minGap=Math.min(minGap,Math.hypot(v.x-r.home.x,v.z-r.home.z));
          }
          assert(braked&&Math.abs(v.speed)<.15&&minGap>=4.6,'real vehicle brakes and cannot creep into cat');
        }
        // Try to put the real car on the animal. The safety rule must keep them apart.
        r.state='home';r.rig.root.position.x=r.home.x;r.rig.root.position.z=r.home.z;
        v.place(r.home.x,r.home.z,r.spot.heading);v.speed=0;a.haveLastVehicle=false;step(.1);
        assert(Math.hypot(v.x-r.home.x,v.z-r.home.z)>=4.6,'keeps two metres beyond the bumper');
        const rx=Math.cos(r.spot.heading),rz=Math.sin(r.spot.heading);
        v.place(r.home.x+rx*5-Math.sin(r.spot.heading)*8,r.home.z+rz*5+Math.cos(r.spot.heading)*8,r.spot.heading);v.speed=0;
        assert(a.influence(v).brake===0,'allows a route around on grass');
      } else if(kind==='retriever'||kind==='bernese') {
        step(45);assert(r.state==='visit','walks to stopped car');
        const side=(r.rig.root.position.x-v.x)*Math.cos(v.heading)+(r.rig.root.position.z-v.z)*Math.sin(v.heading);
        assert(side>1.35&&side<1.8,'visits right driver door');
        v.speed=3;v.vx=Math.sin(v.heading)*3;v.vz=-Math.cos(v.heading)*3;a.update(.05,v,c);
        assert(r.state==='chase'&&r.timer<.1,'starts a fresh chase after a long visit');
        let maxTravel=0;
        for(let i=0;i<600;i++) {v.x+=v.vx*.05;v.z+=v.vz*.05;a.update(.05,v,c);maxTravel=Math.max(maxTravel,r.travel);}
        assert(maxTravel<(kind==='bernese'?81:7),'limits chase distance');
        v.vx=v.vz=v.speed=0;stop(150);step(150);assert(r.state==='home','walks home after chase');
      } else if(kind==='guardian') {
        step(10);assert(r.state==='guard','walks from yard into road');
        step(10);assert(r.state==='shoulder','gives stopped car room to creep');
        v.speed=5;v.vx=Math.sin(v.heading)*5;v.vz=-Math.cos(v.heading)*5;step(.1);
        assert(r.state==='chase','chases when car starts again');
        let maxStep=0,maxTravel=0;
        for(let i=0;i<1100;i++){v.x+=v.vx*.05;v.z+=v.vz*.05;const x=r.rig.root.position.x,z=r.rig.root.position.z;a.update(.05,v,c);maxStep=Math.max(maxStep,Math.hypot(r.rig.root.position.x-x,r.rig.root.position.z-z));maxTravel=Math.max(maxTravel,r.travel)}
        assert(maxStep<=12.5*.05+.001&&maxTravel<=251,'caps running speed and chase distance');
        assert(r.state==='watch'||r.state==='return','watches then returns');
        stop(290);v.speed=v.vx=v.vz=0;step(240);assert(r.state==='home','walks home after car leaves');
        // Repeat from the other direction.
        v.place(r.spot.x+Math.sin(r.spot.heading)*55,r.spot.z-Math.cos(r.spot.heading)*55,r.spot.heading+Math.PI);a.haveLastVehicle=false;
        step(10);assert(r.state==='guard'&&r.direction===-1,'blocks a second pass from the other direction');
        r.state='return';r.rig.root.position.x=r.spot.x+Math.sin(r.spot.heading)*120;r.rig.root.position.z=r.spot.z-Math.cos(r.spot.heading)*120;r.lastActiveAt=a.time;
        stop(600);step(180);stop(55);step(10);assert(r.state==='guard','returns home while culled and re-arms the next pass');
      } else if(kind==='cow') {
        const {cowBody,cowRailGap}=await import('/src/cow-rest.ts');
        const body=cowBody(r.home.x,r.home.z,r.homeHeading??r.spot.heading,(x,z)=>a.terrain.heightAt(x,z));
        assert(body,'resting cow has sampled support');
        const spans=a.roads.guardrails.chunks.flatMap(c=>c.spans);assert(spans.length>0,'real rail spans loaded at cow');
        const railGap=Math.min(...spans.map(s=>cowRailGap(body,s.a,s.b)));
        assert(Number.isFinite(railGap)&&railGap>0,'whole resting cow stays on road side of continuous rails');
        step(2.8);assert(r.state==='home','chews beside rail until three seconds stopped');
        step(15);assert(r.state==='guard','walks to road centre after waiting');
        const subject=a.photoSubjects[a.residents.indexOf(r)];assert(subject.active&&subject.blocking,'road cow is photographable blocking evidence');
        step(41);step(20);assert(r.state==='home','returns to rail after forty seconds');
        stop(40);step(.1);stop();step(20);assert(r.state==='guard','can block again after car leaves');
        stop(40);step(20);assert(r.state==='home','returns when car backs away thirty metres');
        assert(r.herd.length===4&&r.herd.filter(g=>g.kind==='highland').length===2,'four field cattle include two Highland cattle');
        r.state='guard';r.rig.root.position.x=r.spot.x;r.rig.root.position.z=r.spot.z;r.lastActiveAt=a.time;stop(600);step(50);stop();step(.1);assert(r.state==='home','returns to the rail while culled');
      } else if(kind==='farm') {
        step(80);assert(r.herd.length===9&&r.herd.filter(g=>g.kind==='lamb').length===3,'six ewes and three lambs');
        assert(r.herd.every(g=>Math.hypot(g.rig.root.position.x-g.home.x,g.rig.root.position.z-g.home.z)<2),'flock stays in its field');
        assert(r.herd.every(g=>a.terrain.surfaceAt(g.home.x,g.home.z).canopy<1.5),'flock stands on open ground');
        a.pasture(1,r,v,false);assert(r.rig.neck.rotation.x< -1.5&&r.herd[0].rig.head.rotation.x<0,'horse and sheep lower their heads to graze');
        a.pasture(1,r,v,true);assert(Math.abs(r.rig.neck.rotation.x)<.01,'horse lifts its head for a stopped car');
      } else if(kind==='roofcat') {
        const before=r.rig.root.position.clone();step(5);
        assert(r.timer>0,'looks when driver stops nearby');
        assert(before.distanceTo(r.rig.root.position)<.05,'stays on the roof');
        assert(Math.abs(r.rig.root.position.y-a.terrain.heightAt(r.home.x,r.home.z)-r.roof)<.001,'uses true roof height above terrain');
      }
      if(kind==='guardian') {
        const {Evidence}=await import('/src/evidence.ts');const evidence=new Evidence();a.registerEvidence(evidence);
        r.state='guard';r.timer=0;r.rig.root.position.x=r.spot.x;r.rig.root.position.z=r.spot.z;stop(16);a.haveLastVehicle=false;step(.05);
        c.position.set(v.x,v.y+1.4,v.z);c.lookAt(r.spot.x,r.rig.root.position.y+.8,r.spot.z);c.updateMatrixWorld();
        const photo=evidence.take(1,v.x,v.z,v.heading,c);
        assert(photo.facts.some(f=>f.kind==='animal'&&f.blocking),'camera records road-blocking animal evidence');
        let braked=false,minGap=Infinity;v.speed=12;v.vx=Math.sin(v.heading)*12;v.vz=-Math.cos(v.heading)*12;
        for(let i=0;i<120;i++) {
          const brake=a.influence(v).brake;braked ||= brake>0;
          if(brake&&Math.abs(v.speed)<.15){v.place(v.x,v.z,v.heading);v.speed=0;}
          else v.update(1/60,{throttle:brake?-Math.sign(v.speed)*brake:1,steer:0,handbrake:brake>0});
          a.update(1/60,v,c);minGap=Math.min(minGap,Math.hypot(v.x-r.rig.root.position.x,v.z-r.rig.root.position.z));
        }
        assert(braked&&minGap>=5,'real car brakes before reaching animal');
      }
      const animals=[{rig:r.rig,radius:kind==='cow'||kind==='farm'?1.2:kind==='guardian'?.55:kind==='bernese'||kind==='retriever'?.4:.25},...r.herd.map(g=>({rig:g.rig,radius:g.kind==='cow'||g.kind==='highland'?1.2:.5}))];
      if(kind!=='roofcat') for(const animal of animals) {
        const p=animal.rig.root.position,heading=r.spot.heading+.3;
        v.place(p.x,p.z,heading);v.speed=-12;a.haveLastVehicle=false;a.protect(v);
        const dx=p.x-v.x,dz=p.z-v.z,f=dx*Math.sin(heading)-dz*Math.cos(heading),side=dx*Math.cos(heading)+dz*Math.sin(heading);
        assert(Math.abs(f)>=4.6+animal.radius-.001||Math.abs(side)>=1.05+animal.radius-.001,'car cannot overlap '+animal.rig.root.name);
      }
      if(kind==='cow'||kind==='farm') {
        const stock=[r.rig,...r.herd.map(g=>g.rig)];
        for(const rig of stock) {
          const drawn=kind==='bull'&&rig===r.rig;a.groundRig(rig,true,drawn);rig.root.updateMatrixWorld(true);
          const tip=rig.shoulder*(rig.root.name==='sheep'||rig.root.name==='lamb'?.63:.635);
          assert(rig.legs.every((leg,i)=>{const p=leg.localToWorld(rig.hoofSoles?.[i]?.clone()??rig.root.position.clone().set(0,-tip,0));const ground=(drawn?a.terrain.meshHeightAt(p.x,p.z,true):null)??a.terrain.heightAt(p.x,p.z);return Math.abs(p.y-ground)<.025}),'hooves touch terrain for '+rig.root.name);
        }
      }
      return {kind,checks};
    })()`)));

  } finally {
    await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);ws.close();
  }
}
JS
fi
