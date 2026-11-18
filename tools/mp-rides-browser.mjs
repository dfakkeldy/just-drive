// Parent-run only: two actual game pages in one LOCAL room; renderer counts and PNGs from both sides.
import { multiplayerPage } from './mp-browser-page.mjs';
// WEB_PORT=5391 CDP_PORT=9791 MP_PORT=5392 RUN=mp-rides-browser.mjs OUT="$PWD/data/work/mp-real-vehicles" tools/check-mp-game.sh
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cdp, exitCheck, sleep } from './cdp.mjs';
import { sampleGameRide, rideWasReported, rideHasSettled } from './mp-rides-probe.mjs';
const [out, first]=process.argv.slice(2),base=new URL(first).origin,port=process.env.CDP_PORT,server=process.env.MP_SERVER;
assert.ok(/^ws:\/\/(127\.0\.0\.1|localhost):\d+$/.test(server),'local room server required');
mkdirSync(out,{recursive:true});
const pages=[],receipts=[];
async function open(kind,trailer=false){
  const tab=await multiplayerPage(port);
  const {ws,send,errors}=await cdp(tab.webSocketDebuggerUrl);
  const read=async (expression,focus=true)=>{if(focus)await send('Page.bringToFront');const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.result?.exceptionDetails,JSON.stringify(r.result?.exceptionDetails));return r.result.result.value;};
  const until=async expr=>{for(let i=0;i<1200;i++){if(await read(expr))return;await sleep(200);}throw Error('Timeout: '+expr);};
  const shot=async name=>{await read('mmm.renderer.render(mmm.scene,mmm.camera)');writeFileSync(`${out}/${name}.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));};
  const close=async()=>{await tab.close();ws.close();};
  const p={read,until,shot,close,errors,kind,ride:{kind,trailer},focus:()=>send('Page.bringToFront'),sample:(focus=true)=>read(`(${sampleGameRide})(mmm)`,focus)};pages.push(p);
  await send('Page.enable');await send('Runtime.enable');
  // The starter supplies normal background-throttle flags; convergence waits keep each receiver foregrounded.
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  const url=new URL(base);url.search=new URLSearchParams({mode:'explore',vehicle:kind,...(trailer?{trailer:'1'}:{}),road:'Highway 19',f:'.4',mp:'1',room:'rdds',mpserver:server,res:'1',hud:'1'}).toString();
  await send('Page.navigate',{url:url.href});await until('!!window.mmm && document.title.startsWith("settled")');
  await read(`if(!document.getElementById('title').hidden)document.getElementById('titleStart').click()`);
  await until('mmm.mp.current?.net.status === "on"');
  // Freeze local motion through the game's dev vehicle seam, but leave both normal network/ghost loops running.
  await read(`mmm.vehicle.update=()=>{};mmm.vehicle.vx=mmm.vehicle.vz=mmm.vehicle.speed=0`);
  return p;
}
async function witness(p,predicate,stage){
  const deadline=Date.now()+60000;let sample;await p.focus();
  while(Date.now()<deadline){sample=await p.sample(false);if(predicate(sample))return sample;await sleep(100);}
  receipts.push({name:'settle-timeout',stage,sample});throw Error(`${stage}: ${JSON.stringify(sample)}`);
}
async function settleBoth(a,b,distance){
  // Finish each source report, then leave each receiver foregrounded until its real
  // network position AND normal frame-driven opacity converge. Alternating tabs every
  // poll resets main.ts's visibility clock and under-advances the opacity easing.
  await witness(a,s=>rideWasReported(s,a.ride),'first page reports current pose/ride');
  await witness(b,s=>rideWasReported(s,b.ride),'second page reports current pose/ride');
  const fade=distance<=3?.35:1; // This row uses 0, 3, 10 and 12 m; Node also covers the 4–6 m band.
  await witness(a,s=>rideHasSettled(s,{distance,ride:b.ride,fade}),`first receiver settles at ${distance} m`);
  await witness(b,s=>rideHasSettled(s,{distance,ride:a.ride,fade}),`second receiver settles at ${distance} m`);
}
async function pose(p,x,z,heading){await p.read(`mmm.vehicle.place(${x},${z},${heading});mmm.vehicle.vx=mmm.vehicle.vz=mmm.vehicle.speed=0`);}
async function inspect(p,expected,name){
  await p.until('mmm.mp.current.net.count===1 && mmm.mp.current.ghosts.drawn===1');
  const state=await p.sample();assert.ok(state,`${name}: complete game witness`);
  assert.deepEqual(state.ride,expected,`${name}: announced ride reaches real peer`);
  const model=expected.kind==='car'?0:expected.kind==='truck'?(expected.trailer?2:1):expected.kind==='sxs'?3:4;
  assert.equal(state.influences[model+1],1,`${name}: selected morph is the actual ride`);
  assert.ok(state.label.length>0&&state.labelFade>.9,`${name}: readable name`);
  // A fixed overview keeps the complete truck/trailer and both vehicles in the PNG.
  await p.read(`(()=>{const m=mmm,v=m.vehicle,s=Math.sin(v.heading),c=Math.cos(v.heading);m.camera.position.set(v.x+c*15-s*16,v.y+9,v.z+s*15+c*16);m.camera.lookAt(v.x,v.y+1,v.z);m.camera.updateMatrixWorld(true);m.mp.current.ghosts.update(1/60,m.mp.current.net.views(performance.now()),m.camera,v,m.mp.current.host.ride());m.renderer.render(m.scene,m.camera);})()`);
  // Pin the camera between the synchronous draw and PNG capture.
  await p.read('mmm.camera.position.copy=()=>mmm.camera.position;mmm.camera.lookAt=()=>{}');
  await p.shot(name);receipts.push({name,...state});return state;
}
async function budget(p){
  // One isolated real render pass. Change only the ghost list during this synchronous probe; restore it before the frame loop resumes.
  return p.read(`(()=>{const mp=mmm.mp.current,g=mp.ghosts,r=mmm.renderer,s=mmm.scene,cam=mmm.camera,views=mp.net.views(performance.now()),hidden=[];for(const child of s.children)if(child!==g.group&&child.visible&&child.type!=='AmbientLight'&&child.type!=='DirectionalLight'&&child.type!=='HemisphereLight'){hidden.push(child);child.visible=false;}const rows=[];try{for(const n of [1,4,16]){const peers=Array.from({length:n},(_,i)=>({...views[0],id:500+i,name:'Driver '+i,hue:i%8,x:mmm.vehicle.x+(i%4)*3,z:mmm.vehicle.z-12-Math.floor(i/4)*4,alpha:1,ride:[{kind:'car',trailer:false},{kind:'bike',trailer:false},{kind:'truck',trailer:true},{kind:'sxs',trailer:false}][i%4]}));g.update(1/60,peers,cam);r.render(s,cam);rows.push({n,drawn:g.drawn,calls:r.info.render.calls,triangles:r.info.render.triangles,programs:r.info.programs.map(p=>p.diagnostics?.runnable??true)});}}finally{for(const c of hidden)c.visible=true;g.update(1/60,views,cam);}return rows;})()`);
}
let failure;
try{
  for(const [ak,bk,trailer] of [['car','bike',false],['truck','sxs',true]]){
    const a=await open(ak,trailer);let b=await open(bk);
    const start=await a.read('({x:mmm.vehicle.x,z:mmm.vehicle.z,heading:mmm.vehicle.heading})'),s=Math.sin(start.heading),c=Math.cos(start.heading);
    await pose(a,start.x,start.z,start.heading);await pose(b,start.x+s*12,start.z-c*12,start.heading);await settleBoth(a,b,12);
    await inspect(a,{kind:bk,trailer:false},`${ak}-sees-${bk}`);await inspect(b,{kind:ak,trailer},`${bk}-sees-${ak}${trailer?'-trailer':''}`);
    if(ak==='car'){
      await b.close();pages.splice(pages.indexOf(b),1);b=await open('car');
      for(const distance of [10,3,0,10]){
        // Drive one page's car into and through the other page's car on the real report path.
        await pose(b,start.x+s*distance,start.z-c*distance,start.heading);await settleBoth(a,b,distance);
        const state=await inspect(a,{kind:'car',trailer:false},`passing-${distance}m-${receipts.length}`);
        assert.ok(Math.abs(state.fade-(distance<=3?.35:1))<.03,`ghost fade at ${distance} m`);
      }
      const rows=await budget(a);for(const row of rows){assert.equal(row.drawn,row.n);assert.equal(row.calls,2);assert.ok(row.triangles<=row.n*702);assert.ok(row.programs.every(Boolean),'compiled morph shaders');}receipts.push({budget:rows});
    }
    if(trailer){
      await a.read('mmm.towing.detach()');a.ride.trailer=false;await settleBoth(a,b,12);await inspect(b,{kind:'truck',trailer:false},'sxs-sees-trailer-detached');
      await a.read('mmm.towing.attach()');a.ride.trailer=true;await settleBoth(a,b,12);await inspect(b,{kind:'truck',trailer:true},'sxs-sees-trailer-reattached');
    }
    assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);await b.close();pages.splice(pages.indexOf(b),1);await a.close();pages.splice(pages.indexOf(a),1);
  }
  console.log('PASS two game pages, actual rides both ways, trailer changes, 10/3/0/10 m fade, compiled shaders and mixed render counts');
}catch(e){failure=e;console.error(e.stack);}finally{writeFileSync(`${out}/rides-browser.json`,JSON.stringify(receipts,null,2)+'\n');for(const p of pages)await p.close();}
exitCheck(failure?1:0);
