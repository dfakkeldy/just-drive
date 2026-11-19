#!/usr/bin/env node
// Run through check-budget.sh / yard-shots.sh. Uses the real game loop, not a substitute render.
import assert from 'node:assert/strict';
import { loadavg } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertMailCar } from './mail-car-body.mjs';
const [, first] = process.argv.slice(2);
const origin = first ? new URL(first).origin : null, port = process.env.CDP_PORT ?? '9538';
const baselinePath = process.env.FRAME_BUDGET_BASELINE ?? fileURLToPath(new URL('./baseline/frame-budget.json', import.meta.url));
import { metrics, scenes, modes, allKeys, selectedRows, parseArgs, coverage, assetClass, compare, updateRow, serialize, PHONE_CAP } from './frame-budget-policy.mjs';
import { farLand, effective, stored } from './frame-budget-far.mjs';
const FAR_STATE = farLand(); // throws on a half-installed far pack
// Phone detail's "Far views on phone" choice (web/src/far-choice.ts). Unset: the game's default, Off, which the pins
// mean; coarse or full sample the far scene on phone rows (they are measured, not pinned: Settings > Advanced).
const FAR_PHONE = process.env.FRAME_BUDGET_FAR ?? '';
if(!['','off','coarse','full'].includes(FAR_PHONE)) throw Error('FRAME_BUDGET_FAR must be off, coarse or full');
const FAR_SAMPLE = FAR_PHONE==='coarse'||FAR_PHONE==='full';
const farOn = mode => !mode.phone||FAR_SAMPLE;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Installed before game modules. Pin animation dt to 1/60s, so GPU contention cannot change simulation work.
// finish() lets real occlusion-query results complete between frames; no visibility result is faked.
// autoReset=false preserves shadow + mirror + main + water-mask submissions. Reset ONCE before game frame.
const instrumentation = `(fixture => {
  localStorage.clear();
  // Pin the already-exposed radio before main calls start(): keep the default station and one real song
  // download, but remove wall-clock playlist changes. Looping prevents an ended event from fetching another.
  let exposed;
  Object.defineProperty(window,'mmm',{configurable:true,enumerable:true,get:()=>exposed,set(value){
    exposed=value;let radio=value.radio;
    const pin=r=>{if(r){r.live=()=>({track:0,at:0});r.audio.loop=true;}};pin(radio);
    Object.defineProperty(value,'radio',{configurable:true,enumerable:true,get:()=>radio,set(r){radio=r;pin(r)}});
  }});
  const raf = requestAnimationFrame.bind(window);
  let time = performance.now();
  window.__budget = { rows: [], serial: 0, active: false };
  window.requestAnimationFrame = callback => raf(() => {
    time += 1000 / 60;
    const b = window.__budget, m = window.mmm;
    const game = callback.name === 'frame' && m?.renderer;
    if (game) {
      const r=m.renderer;
      if(fixture.chase&&!b.vehicleUpdate) {
        const original=m.vehicle.update;
        b.vehicleUpdate=(...args)=>original(...args);
        b.parkUpdate=(dt,input,...args)=>b.vehicleUpdate(0,{throttle:0,steer:0,handbrake:true},...args);
        m.vehicle.update=b.parkUpdate;
      }
      if(fixture.animal&&m.animals&&!b.animalUpdate) {
        b.animalUpdate=m.animals.update.bind(m.animals);
        m.animals.update=(dt,...args)=>{
          // Build retries must continue while data arrives, but animation and AI clocks stay at zero.
          for(const resident of m.animals.residents) if(!resident.rig) resident.buildAfter=0;
          return b.animalUpdate(0,...args);
        };
      }
      if (!b.uploaded) {
        // Count the cut pump AND deferred array-texture GL calls in the same frame.
        // This game uses TEXTURE_2D_ARRAY only for bridge cut atlases.
        b.cutMainFrame=0;b.cutMainMax=0;
        const cuts=m.terrain.roadCuts,gl=r.getContext();
        for(const name of ['step','update']){const call=cuts[name].bind(cuts);cuts[name]=(...args)=>{const start=performance.now();try{return call(...args);}finally{b.cutMainFrame+=performance.now()-start;}};}
        for(const name of ['texStorage3D','texImage3D','texSubImage3D']){const call=gl[name].bind(gl);gl[name]=(...args)=>{if(args[0]!==gl.TEXTURE_2D_ARRAY)return call(...args);const start=performance.now();try{return call(...args);}finally{b.cutMainFrame+=performance.now()-start;}};}
        b.uploaded=new Set(); b.materials=new Set();
        b.textures=new Set();b.initialTextures=r.info.memory.textures;b.targets=new Set();
        const setTarget=r.setRenderTarget.bind(r);r.setRenderTarget=(target,...args)=>{if(target)b.targets.add(target);return setTarget(target,...args)};
        const init=r.initTexture.bind(r);r.initTexture=texture=>{b.textures.add(texture);return init(texture)};
        const keep=value=>{if(Array.isArray(value)){for(const v of value)keep(v);}else if(value?.isTexture&&!value.isRenderTargetTexture&&!value.isDepthTexture)b.textures.add(value);};
        const textures=material=>{
          for(const value of Object.values(material))keep(value);
          for(const uniforms of [material.uniforms,r.properties.get(material).uniforms])if(uniforms)for(const u of Object.values(uniforms))keep(u?.value);
        };

        const render=r.render.bind(r);
        r.render=(scene,...args)=>{scene.traverse(o=>{if(o.geometry)b.uploaded.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])b.materials.add(m);});return render(scene,...args);};
        const direct=r.renderBufferDirect.bind(r);
        r.renderBufferDirect=(...args)=>{b.uploaded.add(args[2]);b.materials.add(args[3]);if(!b.normalized){textures(args[3]);keep(args[4]?.skeleton?.boneTexture);}const result=direct(...args);if(!b.normalized){textures(args[3]);keep(args[4]?.skeleton?.boneTexture);}return result;};
      }
      r.info.autoReset = false; r.info.reset(); b.passes = []; b.groups = {}; b.groupTriangles = {};
    }
    callback(time);
    if (game) {
      const r = m.renderer;
      b.cutMainMax=Math.max(b.cutMainMax,b.cutMainFrame);
      b.cutMainFrame=0;
      r.getContext().finish();
      if (r.getContext().isContextLost()) throw Error('frame-budget: WebGL context lost');
      b.serial++;
      if (b.active) {
        const row = { calls: r.info.render.calls, triangles: r.info.render.triangles,
          geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs.length,
          readyTiles: [...m.terrain.tiles.values()].filter(t => t.ready).length };
        b.rows.push({ ...row, passes: b.passes, groups: b.groups, groupTriangles:b.groupTriangles, title: document.title,
          pending: m.terrain.pending + (m.grass?.pending ?? 0) + (m.trees?.pending ?? 0) + (m.roads.guardrails?.audit.pending ?? 0),
          topology: m.terrain.drawnRevision });
      }
    }
  });
  document.addEventListener('DOMContentLoaded', () => {
    document.head.append(Object.assign(document.createElement('link'), {rel:'icon', href:'data:,'}));
  }, {once:true});
})`;
async function openPage(scene, mode, options = {}) {
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {method:'PUT'})).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let serial = 0, requests = 0, ignoredDev = 0, ignoredOther = 0, cacheHits = 0, bytes = 0;
  const assets={terrain:0,areas:0,audio:0,models:0}, assetBytes={terrain:0,areas:0,audio:0,models:0}, assetIds=new Map(), farPaths=[];
  const pending = new Map(), inflight = new Set(), inflightUrls=new Map(), errors = [];
  ws.onmessage = ({data}) => {
    const m = JSON.parse(data);
    if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Network.requestWillBeSent' && /^https?:/.test(m.params.request.url)) {
      const url=m.params.request.url, cls=assetClass(url), path=new URL(url).pathname;
      // Game data only (terrain/areas), never the dev server's /src/far-land.ts module.
      if((cls==='terrain'||cls==='areas')&&/\/(far-land[^/]*\.(json|bin)|tall\.json)$/.test(path)) farPaths.push(path);
      if(cls) { requests++; assets[cls]++; assetIds.set(m.params.requestId,cls); }
      else if(/^\/(src\/|@|node_modules\/|\.vite\/)/.test(path)) ignoredDev++;
      else ignoredOther++;
      // Dedicated module-worker entry requests have no loadingFinished event on
      // this page's CDP session. Their readiness is terrain.pending / worker audit.
      if(!(path==='/src/road-cut-worker.ts'&&new URL(url).searchParams.has('worker_file'))){inflight.add(m.params.requestId);inflightUrls.set(m.params.requestId,url);}
    }
    if(m.method==='Network.requestServedFromCache') cacheHits++;
    if(m.method==='Network.loadingFinished'&&assetIds.has(m.params.requestId)) {bytes+=m.params.encodedDataLength;assetBytes[assetIds.get(m.params.requestId)]+=m.params.encodedDataLength;}
    if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') {inflight.delete(m.params.requestId);inflightUrls.delete(m.params.requestId);}
    if (m.method === 'Network.loadingFailed' && !m.params.canceled) errors.push(m.params.errorText);
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) errors.push(`${m.params.response.status} ${m.params.response.url}`);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, m => { clearTimeout(timer); m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result); });
    ws.send(JSON.stringify({id, method, params}));
  });
  const read = async expression => {
    const r = await send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const close = async () => {
    await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`, {signal:AbortSignal.timeout(5000)}).catch(() => {});
    ws.close();
  };
  const params = new URLSearchParams({hour:'16.75', exag:'1.5', hud:'1', shadows:'1', res:'1', q:mode.phone ? 'low' : 'high'});
  if(process.env.FRAME_BUDGET_TRAFFIC === '1') params.set('trafficCheck','1');
  if(scene.area)params.set('area',scene.area);
  if(scene.trailer)params.set('trailer','1');
  if (scene.cam) { params.set('cam', scene.cam); params.set('camground', '1'); }
  if(scene.at) params.set('at',scene.at);
  if(scene.animal) params.set('animal','cow');
  if (mode.phone) params.set('touch', '1');
  if (mode.explore) { params.set('mode','explore'); params.set('vehicle','truck'); }
  if(options.radioOff)params.set('radio','0');
  if(FAR_PHONE)params.set('far',FAR_PHONE);
  for(const [key,value] of Object.entries(options.query??{}))params.set(key,value);
  const url = `${options.origin??origin}/?${params}`;
  try {
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setCacheDisabled', {cacheDisabled:process.env.FRAME_BUDGET_COLD==='1'});
    await send('Emulation.setDeviceMetricsOverride', {width:mode.phone ? 390 : 1400, height:mode.phone ? 844 : 950, deviceScaleFactor:1, mobile:mode.phone});
    await send('Emulation.setTouchEmulationEnabled', {enabled:mode.phone});
    await send('Page.addScriptToEvaluateOnNewDocument', {source:instrumentation+`(${JSON.stringify({chase:!!scene.chase,animal:!!scene.animal})})`});
    await send('Page.navigate', {url});
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      assert.deepEqual(errors, [], `${scene.id}/${mode.id}: page errors`);
      if (!inflight.size && await read(`document.title==='settled' && document.readyState==='complete' && !!window.mmm && ${scene.animal?"mmm.animals.residents.some(a=>a.kind==='bull'&&a.rig?.shoulder===1.12&&a.rig.hoofSoles?.length===4)&&mmm.animals.residents.some(a=>a.kind==='cow'&&a.rig&&a.herd.length===4)":'true'}`)) break;
      await sleep(200);
    }
    assert.equal(await read('document.title'), 'settled', `${scene.id}/${mode.id}: load deadline inflight=`+JSON.stringify([...inflightUrls.values()])+JSON.stringify(await read(`(()=>{const m=window.mmm,c=m?.terrain?.roadCuts;return {title:document.title,ready:!!m,pending:m?.terrain?.pending,cuts:c?.audit,job:c?.job?{id:c.job.id,workerSent:c.job.workerSent,result:c.job.result===undefined?'waiting':!!c.job.result}:null,queue:c?.queue?.size,rails:m?.roads?.guardrails?.audit}})()`)));
    if(scene.animal) assert.ok(await read("mmm.animals.residents.some(a=>a.kind==='bull'&&a.rig?.shoulder===1.12&&a.rig.hoofSoles?.length===4)&&mmm.animals.residents.some(a=>a.kind==='cow'&&a.rig&&a.herd.length===4)"),'animal home must finish building');
    if(scene.chase) await read(`(() => {
      const m=mmm,b=__budget,v=m.vehicle; b.start={x:v.x,z:v.z};
      v.update=b.vehicleUpdate;
      for(let i=0;i<180;i++) m.driveVehicle(1/60,{throttle:1,steer:0,handbrake:false});
      for(let i=0;i<120;i++) m.driveVehicle(1/60,{throttle:0,steer:0,handbrake:true});
      v.update=b.parkUpdate; m.chase(1);
      b.drive={steps:300,dt:1/60,throttleSteps:180,brakeSteps:120,metres:Math.hypot(v.x-b.start.x,v.z-b.start.z),x:v.x,z:v.z};
      if(b.drive.metres<1) throw Error('Scripted chase drive did not move');
    })()`);
    if(scene.animal) await read(`(() => {
      const a=mmm.animals.residents.find(a=>a.kind==='cow'),h=a.spot.heading;
      // Put the waiting vehicle ten metres up the road, inside the cow/herd frame.
      mmm.vehicle.place(a.spot.x+Math.sin(h)*10,a.spot.z-Math.cos(h)*10,h);
    })()`);
    if(scene.chase||scene.animal) {
      // The script moves the real chase camera AFTER initial settlement. Finish its new tile/grass/query
      // work before normalizing GPU uploads, otherwise a briefly reflected old view leaves cache history.
      const firstFrame=await read('__budget.serial');let signature='',since=firstFrame,settled=false;
      const until=Date.now()+180000;
      while(Date.now()<until) {
        const state=await read(`({frame:__budget.serial,title:document.title,pending:mmm.terrain.pending+(mmm.grass?.pending??0)+(mmm.trees?.pending??0)+(mmm.roads.guardrails?.audit.pending??0),topology:mmm.terrain.drawnRevision,camera:mmm.camera.matrixWorld.toArray()})`);
        const key=JSON.stringify([state.topology,state.camera]);
        if(state.pending||state.title!=='settled'||inflight.size||key!==signature) {signature=key;since=state.frame;}
        else if(state.frame-firstFrame>=60&&state.frame-since>=30) {settled=true;break;}
        await sleep(200);
      }
      assert.ok(settled,'fixture pose and all assets must settle before GPU normalization');
    }

    // FAR_STATE describes the shared land. A caller measuring another tree that has no far views (sidewalks-counts
    // BASE_URL at a pre-far commit) passes farWait:false; waiting for far objects there would never finish.
    if(FAR_STATE==='after'&&options.farWait!==false&&farOn(mode)) {
      // Far views (PR #122) load after Start. Wait for them before GPU normalization, then hold each far query mesh
      // visible: the game redraws a hidden one five times a second, so its cost is the worst case, not a probe phase.
      const until=Date.now()+60000;
      // All four parts: a failed tall or turbine half must not pass (or be folded into the pins by --update).
      while(!await read('!!(window.mmm&&mmm.farVisibility&&mmm.farLand&&mmm.tall&&mmm.farTurbines)')) { assert.ok(Date.now()<until,`${scene.id}/${mode.id}: far views never loaded on after land`); await sleep(200); }
      await read(`(() => {const v=mmm.farVisibility;v.update=()=>{};if(!v.records.length)throw Error('far views have no query meshes');for(const r of v.records)r.mesh.visible=true;})()`);
    }
    if(process.env.FRAME_BUDGET_TRAFFIC === '1') await read(`(() => {
      const m=mmm,t=m.ambientTraffic;if(!t||!t.cars.length)throw Error('traffic pool missing');
      const f=m.camera.getWorldDirection(new (m.camera.position.constructor)());
      const x=m.camera.position.x+f.x*35,z=m.camera.position.z+f.z*35;
      let best=null,distance=Infinity;
      for(const path of t.paths){const along=path.alongAt(x,z),pose={x:0,z:0,heading:0};path.at(along,1.65,pose);const d=Math.hypot(pose.x-x,pose.z-z);if(d<distance){distance=d;best={path,along};}}
      if(!best)throw Error('traffic highway missing');
      t.update=()=>{};t.step=()=>{};
      t.cars.forEach((c,i)=>{c.path=best.path;c.along=Math.max(10,Math.min(best.path.cumulative.at(-1)-10,best.along+i*12));c.path.at(c.along,1.65,c.solid);c.active=true;t.place(c);});
    })()`);
    await read(`(() => {
      const m = mmm, r = m.renderer, b = __budget;
      b.scene = m.vehicle.car.root.parent;
      // Reserve the game's lazy reflection texture even when this view never sees water. Otherwise a
      // brief startup/chase view can allocate one extra retained texture on only some fresh loads.
      if(m.water?.target) {const target=r.getRenderTarget();r.setRenderTarget(m.water.target);r.clear();r.setRenderTarget(target);}

      // A ground-relative camera begins at y=80 while tiles load. Its transient uploads depend on arrival
      // order, even with identical final draws. Retire the REAL GPU geometry buffers and shader programs once at the settled
      // camera, retaining every CPU geometry. Normal game frames upload the fixed view again below.
      // Texture uploads have the same history problem: an old terrain normal map can remain cached after
      // a chase-camera move. Retire ordinary texture GPU storage too; CPU image/data sources remain intact.
      for(const texture of b.textures) texture.dispose();b.textures.clear();
      const targets=new Set();
      const keepTarget=target=>{if(target)for(const texture of [target.texture,target.depthTexture])if(texture&&r.properties.get(texture).__webglTexture)targets.add(r.properties.get(texture).__webglTexture);};
      for(const target of b.targets)keepTarget(target);keepTarget(m.water?.target);b.scene.traverse(o=>{keepTarget(o.shadow?.map);keepTarget(o.shadow?.mapPass)});
      if(r.info.memory.textures!==targets.size)throw Error('Untracked GPU texture '+JSON.stringify({remaining:r.info.memory.textures,targets:targets.size,initial:b.initialTextures,tracked:b.textures.size})+'; cannot normalize fixed-view upload inventory');
      for (const geometry of b.uploaded) geometry.dispose();
      if (r.info.memory.geometries!==0) throw Error('Untracked GPU geometry; cannot reset residency deterministically');
      b.uploaded.clear();
      for (const material of b.materials) material.dispose();
      if (r.info.programs.length!==0) throw Error('Untracked GPU shader material; cannot reset residency deterministically');
      b.materials.clear();b.normalized=true;
      const original = r.render.bind(r), wrapped = new WeakSet();
      const roots = new Map(Object.entries(m).filter(([,v]) => v?.group).map(([k,v]) => [v.group,k]));
      roots.set(m.vehicle.car.root, 'vehicle');
      const groupName = object => {
        for (let n=object; n && n!==b.scene; n=n.parent) if (roots.has(n)) return roots.get(n);
        let top=object; while(top.parent && top.parent!==b.scene && !top.parent.isScene) top=top.parent;
        return top.name || object.material?.name || object.material?.type || object.type;
      };
      const wrap = object => {
        if (wrapped.has(object) || !(object.isMesh || object.isLine || object.isPoints || object.isSprite)) return;
        wrapped.add(object);
        for (const [before, after, suffix] of [['onBeforeRender','onAfterRender',''],['onBeforeShadow','onAfterShadow',' (shadow)']]) {
          const oldBefore=object[before], oldAfter=object[after]; let calls=0,triangles=0;
          object[before]=function(...args) { oldBefore?.apply(this,args); calls=r.info.render.calls;triangles=r.info.render.triangles; };
          object[after]=function(...args) {
            const name=groupName(this)+suffix;
            b.groups[name]=(b.groups[name]??0)+r.info.render.calls-calls;
            b.groupTriangles[name]=(b.groupTriangles[name]??0)+r.info.render.triangles-triangles;
            oldAfter?.apply(this,args);
          };
        }
      };
      r.render = (scene, camera) => {
        const c = r.info.render.calls, t = r.info.render.triangles;
        const label = camera !== m.camera ? 'mirror' : scene === b.scene ? 'main+shadow' : 'water-mask';
        scene.traverse(wrap);
        original(scene, camera);
        b.passes.push({label, calls:r.info.render.calls-c, triangles:r.info.render.triangles-t});
      };
      b.active = true;
    })()`);
    const page = {send, read, close, url, errors, inflight,inflightUrls, farPaths, requestCount:() => requests, assetStats:()=>({...assets,ignoredDev,ignoredOther,cacheHits,assetBytes,bytes})};

    return page;
  } catch (error) { await close(); throw error; }
}
async function sample(page) {
  await page.read('__budget.rows = []');
  const until = Date.now() + 180000;
  while (Date.now() < until) {
    assert.deepEqual(page.errors, [], 'page errors');
    const rows = await page.read('__budget.rows.slice(-60)');
    const stable = rows.length === 60 && rows.every(r => r.title === 'settled' && r.pending === 0 && r.calls > 0)
      && rows.every(r => r.topology === rows[0].topology && ['geometries','textures','programs','readyTiles'].every(k => r[k] === rows[0][k]));
    if (stable && !page.inflight.size) {
      // Visibility queries can schedule a water-mask pass on alternate frames. Budget the full-frame maximum,
      // never the final render pass or a sum of counters from unrelated frames. Both fixed windows must agree.
      const envelope = window => Object.fromEntries(metrics.filter(k => k !== 'requests').map(k => [k,Math.max(...window.map(r => r[k]))]));
      const first = envelope(rows.slice(0,30)), second = envelope(rows.slice(30));
      if (JSON.stringify(first) === JSON.stringify(second)) {
        const peak = rows.slice(30).reduce((a,b) => b.calls > a.calls || b.calls === a.calls && b.triangles > a.triangles ? b : a);
        assert.equal(peak.triangles,second.triangles,'calls and triangles maxima must describe one actual frame');
        assert.equal(Object.values(peak.groups).reduce((a,b)=>a+b,0),peak.calls,'scene graph attribution must account for every draw');
        assert.equal(Object.values(peak.groupTriangles).reduce((a,b)=>a+b,0),peak.triangles,'attribution must account for every submitted triangle');
        const ranges=Object.fromEntries(metrics.filter(k => k !== 'requests').map(k => [k,[Math.min(...rows.map(r => r[k])),Math.max(...rows.map(r => r[k]))]]));
        return {counts:{...second,requests:page.requestCount()}, passes:peak.passes,groupTriangles:peak.groupTriangles,
          groups:Object.fromEntries(Object.entries(peak.groups).sort((a,b)=>b[1]-a[1])), frameRanges:ranges};
      }
    }
    await sleep(250);
  }
  throw Error('No stable pair of 30-frame post-settle windows: '+JSON.stringify({inflight:[...page.inflightUrls.values()],rows:await page.read('__budget.rows.slice(-2)')}));
}
export async function measure(scene, mode, mutation, options = {}) {
  const started=Date.now();
  const page = await openPage(scene, mode, options);
  try {
    if (mutation) await mutation(page);
    const result = await sample(page);
    if(process.env.FRAME_BUDGET_TRAFFIC === '1') {
      const active=await page.read('mmm.ambientTraffic.cars.filter(c=>c.active&&c.mesh.visible).length');
      assert.ok(active>0,'traffic fixture requires active cars');
      assert.ok(result.groups.ambientTraffic>0,'traffic fixture must submit visible traffic draws');
      console.log('TRAFFIC '+JSON.stringify({active,calls:result.groups.ambientTraffic,triangles:result.groupTriangles.ambientTraffic,wholeFrame:result.counts}));
    }
    const variant = typeof mode === 'string' ? modes.find(m => m.id === mode) : mode;
    if(scene.id==='quarry-gate'&&variant?.explore) {
      assert.ok(result.groups.vehicle>0,'quarry-gate budget must draw the loaded pickup');
      const assembly=await page.read('mmm.fleet?({spawned:mmm.fleet.spawned,driver:mmm.fleet.driven.id,attached:mmm.towing.attached,loaded:mmm.fleet.members.filter(m=>m.id!=="truck").every(m=>m.state==="STRAPPED")}):null');
      if(assembly)assert.ok(assembly.spawned&&assembly.driver==='truck'&&assembly.attached&&assembly.loaded,'quarry-gate budget requires the complete loaded and hitched fleet');
    }
    // The mail rows are pinned on the Blender car. A page that fell back to the code car must fail, not be measured.
    if (variant && !variant.explore) await assertMailCar(page.read, 'blender', `${scene.id}/${variant.id}`);
    if(process.env.FRAME_BUDGET_INVENTORY==='1') {
      result.textureInventory=await page.read(`(() => {
        const m=mmm,r=m.renderer,b=__budget,found=new Map(),blankRoads=[];
        const add=(texture,owner)=>{
          if(!texture?.isTexture)return;const gpu=r.properties.get(texture).__webglTexture;if(!gpu)return;
          let item=found.get(gpu);if(!item){const im=Array.isArray(texture.image)?texture.image[0]:texture.image;
            item={kind:texture.constructor.name,width:im?.width,height:im?.height,depth:im?.depth,type:texture.type,format:texture.format,owners:[],ownerCount:0};found.set(gpu,item);}
          item.ownerCount++;if(item.owners.length<8&&!item.owners.includes(owner))item.owners.push(owner);
        };
        const value=(v,owner)=>{if(Array.isArray(v))for(const t of v)add(t,owner);else add(v,owner);};
        const material=(mat,owner)=>{if(!mat)return;for(const[k,v]of Object.entries(mat))value(v,owner+'.'+k);
          for(const uniforms of[mat.uniforms,r.properties.get(mat).uniforms])if(uniforms)for(const[k,u]of Object.entries(uniforms))value(u?.value,owner+'.'+k);};
        b.scene.traverse(o=>{for(const mat of(Array.isArray(o.material)?o.material:[o.material]))material(mat,o.name||o.type);});
        for(const t of m.terrain.tiles.values())if(t.mesh){const key=t.level+'/'+t.i+'_'+t.j;material(t.mesh.material,'tile '+key);material(t.mirror?.material,'mirror '+key);
          if(t.road&&!m.terrain.hasRoad.has(key)&&r.properties.get(t.mesh.material.uniforms.tRoad.value).__webglTexture){let painted=0;
            for(let k=0;k<t.road.length;k+=4)if((t.road[k+2]&15)||t.road[k+3])painted++;
            blankRoads.push({tile:key,painted,sites:m.terrain.sites.filter(s=>!(s.box[2]<t.x0||s.box[0]>t.x0+t.size||s.box[3]<t.z0||s.box[1]>t.z0+t.size)).map(s=>({kind:s.constructor.name,field:s.roadField??'default'}))});}}
        let i=0;for(const target of b.targets){add(target.texture,'target '+i+' colour');add(target.depthTexture,'target '+i+' depth');i++;}
        add(m.terrain.noRoad,'shared no-road');add(m.terrain.roadCuts.empty,'empty cut');
        return {count:r.info.memory.textures,identified:found.size,textures:[...found.values()],roadFieldsWithoutBake:blankRoads};
      })()`);
      console.log('TEXTURE INVENTORY '+scene.id+'/'+mode.id+' '+JSON.stringify(result.textureInventory));
    }
    if(scene.chase) {
      assert.ok(result.groups.vehicle>0,'chase view must render selected vehicle');
      assert.ok(await page.read("document.getElementById('hud').textContent.includes('km/h')"),'normal chase HUD');
      result.drive=await page.read('__budget.drive');
    }
    if(scene.animal) {
      const bull=await page.read(`(()=>{const rig=mmm.animals.residents.find(a=>a.kind==='bull')?.rig;let draws=0,triangles=0;rig?.root.traverse(n=>{if(n.isMesh){draws++;triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3}});return {shoulder:rig?.shoulder,hooves:rig?.hoofSoles?.length,draws,triangles}})()`);
      assert.equal(bull.shoulder,1.12,'animal budget requires the loaded Blender bull');
      assert.equal(bull.hooves,4,'loaded bull has four support points');
      assert.equal(bull.draws,mode.phone?2:7,'loaded bull draw count');
      assert.equal(bull.triangles,mode.phone?1478:7600,'loaded bull triangle count');
      console.log('HIGHLAND '+JSON.stringify({mode:mode.id,...bull}));
      const animals=await page.read("({camera:mmm.camera.position.toArray(),rotation:mmm.camera.rotation.toArray(),residents:mmm.animals.residents.filter(a=>a.kind==='cow'||a.kind==='bull').map(a=>({kind:a.kind,home:a.home,position:a.rig?.root.position.toArray(),visible:a.rig?.root.visible,herd:a.herd.length}))})");
      console.log('ANIMAL '+JSON.stringify({key:scene.id,groups:result.groups,...animals}));
      assert.ok(result.groups.animals>0,'animal home must render real animal meshes');
      const framed=await page.read(`(()=>{const m=mmm,c=m.animals.residents.find(a=>a.kind==='cow'),points=[],inside=r=>{const p=r.root.position.clone();p.y+=.7;p.project(m.camera);points.push(p.toArray());return Math.abs(p.x)<1&&Math.abs(p.y)<1&&p.z>-1&&p.z<1;};return {cow:inside(c.rig),herd:c.herd.filter(a=>inside(a.rig)).length,points};})()`);
      console.log('FRAMING '+JSON.stringify(framed));
      assert.ok(framed.cow&&framed.herd===4,'animal-home must frame the road cow and all four pasture cattle, not only the bull');
      assert.ok(result.groups.vehicle>0,'animal-home road must render the selected vehicle too');
    }
    result.cutWork=await page.read('({...mmm.terrain.roadCuts.audit,mainWithUploadsMs:__budget.cutMainMax})');
    result.guardrails=await page.read(`(()=>{const r=mmm.roads.guardrails;let spans=0,overlaps=0;for(const c of r?.chunks??[])for(const s of c.spans){spans++;for(const p of [s.a,s.b,{x:(s.a.x+s.b.x)/2,z:(s.a.z+s.b.z)/2}])if(mmm.roads.bridgeArea(p.x,p.z,2))overlaps++;}return {spans,overlaps}})()`);
    assert.equal(result.guardrails.overlaps,0,'guardrails must skip bridge decks and approaches');
    assert.equal(result.cutWork.error,'','cut worker has no errors');
    assert.ok(result.cutWork.maxFrameMs<=8,'cut-field main-thread frame budget: '+JSON.stringify(result.cutWork));
    assert.ok(result.cutWork.mainWithUploadsMs<=8,'cut-field main-thread frame budget including GL uploads: '+JSON.stringify(result.cutWork));
    assert.equal(result.cutWork.steps,0,'browser cut raster runs off the main thread');
    if(result.cutWork.atlases)assert.ok(result.cutWork.workerJobs>0,'browser cut raster uses its worker');
    if(options.programInventory) result.programKeys=await page.read('mmm.renderer.info.programs.map(p=>p.cacheKey).sort()');
    result.assets=page.assetStats();
    // Exactly one request is neither a counted asset nor a dev-server module: the page itself. A new kind of
    // player download (a new public folder, an imported image) must be classed on purpose in frame-budget-policy.mjs.
    if(result.assets.ignoredOther!==1) throw Error(`${scene.id}/${typeof mode==='string'?mode:mode.id}: ${result.assets.ignoredOther} requests are neither counted assets nor dev modules (1 expected: the page). Class the new download in tools/frame-budget-policy.mjs so that it is counted or named as ignored.`);
    result.radio=await page.read('mmm.radio?({station:mmm.radio.station,defaultStation:mmm.radio.first,track:mmm.radio.track,clock:mmm.radio.live(),loop:mmm.radio.audio.loop}):null');
    if(options.radioOff){assert.equal(result.radio,null,'radio disabled on both count-comparison sides');assert.equal(result.assets.audio,0,'no songs or radio manifest transferred');}
    else assert.ok(result.radio&&result.radio.station===result.radio.defaultStation&&result.radio.track===0&&result.radio.clock.at===0&&result.radio.loop,'default radio fixture must stay on track 0 at fixed station clock');

    if(scene.id==='village-start'&&mode.phone) { result.trees=await treeFrustum(page); assert.equal(result.trees.calls,result.groups.trees??0,'tree graph and submitted draws must agree');assert.equal(result.trees.triangles,result.groupTriangles.trees??0,'tree graph and submitted triangles must agree'); }
    if(mutation) result.mutation=await page.read('__budget.mutation ?? null');
    assert.deepEqual(await page.read('[innerWidth,innerHeight,mmm.renderer.domElement.width,mmm.renderer.domElement.height]'),
      mode.phone ? [390,844,390,844] : [1400,950,1400,950], 'fixed CSS viewport and drawing buffer');
    assert.equal(await page.read('mmm.low'), mode.phone);
    assert.equal(await page.read('mmm.gameMode'), mode.explore ? 'explore' : 'mail');
    if (mode.explore) assert.equal(await page.read('mmm.vehicleId'), 'truck');
    assert.ok(await page.read('!mmm.renderer.getContext().isContextLost()'));
    assert.equal(await page.read('mmm.renderer.shadowMap.enabled'), !mode.phone, 'forced desktop shadows / LOW has no shadow pass');
    const device=await page.read(`(() => {const gl=mmm.renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)})()`);
    assert.ok(!/swiftshader|llvmpipe|software/i.test(device),'hardware GPU required: '+device);
    if (!mode.phone && scene.id==='harbour-water') assert.ok(result.passes.some(p=>p.label==='mirror' && p.calls>0),'harbour must include a real water mirror pass');
    // Phone Off (after land): the far views pack stays out of the frame entirely, so the phone pins keep their
    // meaning. Checked at the end of the measurement, against every request the page made.
    if(FAR_STATE==='after'&&options.farWait!==false&&!farOn(mode)) {
      assert.deepEqual(page.farPaths,[],`${scene.id}/${mode.id}: far views requested on a phone with Far views on phone Off`);
      assert.ok(!await page.read('!!(mmm.farLand||mmm.tall||mmm.farTurbines)'),`${scene.id}/${mode.id}: far views drawn on a phone with Far views on phone Off`);
    }
    return {...result, seconds:(Date.now()-started)/1000, url:page.url.replace(options.origin??origin,''), viewport:mode.phone ? [390,844] : [1400,950]};
  } finally { await page.close(); }
}
// Graph-only diagnostic: test the same object sphere the renderer uses, against all six planes.
// A different valid aggregate sphere can select different conservative batches at a screen edge.
async function treeFrustum(page) {
  return page.read(`(() => {
    const m=mmm,c=m.camera,e=c.projectionMatrix.clone().multiply(c.matrixWorldInverse).elements;
    const planes=[[e[3]-e[0],e[7]-e[4],e[11]-e[8],e[15]-e[12]],[e[3]+e[0],e[7]+e[4],e[11]+e[8],e[15]+e[12]],
      [e[3]+e[1],e[7]+e[5],e[11]+e[9],e[15]+e[13]],[e[3]-e[1],e[7]-e[5],e[11]-e[9],e[15]-e[13]],
      [e[3]-e[2],e[7]-e[6],e[11]-e[10],e[15]-e[14]],[e[3]+e[2],e[7]+e[6],e[11]+e[10],e[15]+e[14]]]
      .map(p=>{const l=Math.hypot(...p.slice(0,3));return p.map(x=>x/l)});
    let calls=0,triangles=0,outsideCalls=0,outsideTriangles=0,culledCalls=0,culledTriangles=0,withoutNearCalls=0,withoutNearTriangles=0;
    if(!m.trees.group.parent||!m.trees.group.visible) return {calls,triangles,outsideCalls,outsideTriangles};
    for(const o of m.trees.group.children) {
      if(!o.visible||!o.count||o.material.visible===false||!(o.layers.mask&c.layers.mask)) continue;
      const t=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*o.count;
      const saved=o.boundingSphere?.clone()??null; if(o.boundingSphere===null)o.computeBoundingSphere();
      const centre=o.boundingSphere.center.clone().applyMatrix4(o.matrixWorld),r=o.boundingSphere.radius*o.matrixWorld.getMaxScaleOnAxis();
      const outside=planes.some(p=>p[0]*centre.x+p[1]*centre.y+p[2]*centre.z+p[3]<-r);
      if(planes.slice(0,5).some(p=>p[0]*centre.x+p[1]*centre.y+p[2]*centre.z+p[3]<-r)){withoutNearCalls++;withoutNearTriangles+=t;}
      if(outside&&o.frustumCulled){culledCalls++;culledTriangles+=t;}else{calls++;triangles+=t;if(outside){outsideCalls++;outsideTriangles+=t;}}
      o.boundingSphere=saved;
    }
    return {calls,triangles,outsideCalls,outsideTriangles,culledCalls,culledTriangles,withoutNearCalls,withoutNearTriangles,bounds:'world-space instance bounding spheres; six camera frustum planes'};
  })()`);
}
export async function run(astra, studyCounts) {
  const options=parseArgs(JSON.parse(process.env.FRAME_BUDGET_ARGS??'[]'));
  if(options.action==='mutations') {
    const {mutations}=await import('./frame-budget-mutations.mjs');
    return mutations({origin,port,baselinePath,measure});
  }
  const updating=options.action==='update'||options.action==='raise';
  // Coarse and Full are sampled, never pinned: the pins mean phone Off (tools/baseline/frame-budget-far.json phone rows are 0).
  assert.ok(!(FAR_SAMPLE&&updating),'FRAME_BUDGET_FAR='+FAR_PHONE+' samples the phone far scene; it never updates or raises the pins');
  if(FAR_SAMPLE)console.log(`FAR SAMPLE ${FAR_PHONE}: phone rows are measured against the phone cap (PHONE_CAP), not the pins`);
  let baseline={};
  try {baseline=JSON.parse(readFileSync(baselinePath,'utf8'));} catch(e) {if(!updating||e.code!=='ENOENT')throw e;}
  // Far views (PR #122): pins mean the land without the far pack; after install each ceiling adds its measured far delta.
  const land=FAR_STATE;baseline=effective(baseline,land);
  if(land==='after')console.log('FAR LAND after: ceilings = pins + tools/baseline/frame-budget-far.json; --update/--raise store measured - far delta');
  const selected=selectedRows(options),visited=[];
  const subset=options.phone||options.scenes.length>0||options.modes.length>0;
  if(!subset) assert.deepEqual(selected.map(r=>r.key).sort(),allKeys().sort(),'implicit subset is not allowed');
  if(subset) console.log(`SUBSET ${JSON.stringify(JSON.parse(process.env.FRAME_BUDGET_ARGS??'[]'))}: ${selected.length}/${allKeys().length} known rows; validating full baseline manifest`);
  else console.log(`FULL RUN ${selected.length} rows`);
  if(coverage(baseline,allKeys(),updating)) return 1;
  console.log('EXACT counts: '+metrics.join(', ')+'; zero margins. geometries/programs/textures = fixed-view GPU re-upload inventory, not startup-residency/leak totals; texture inventory includes the retained water/shadow/environment render-target pool. requests = terrain + areas + audio + models logical asset requests (cache hits included); Vite modules excluded. Radio pinned to default station, track 0 / playhead 0 / loop; manifest and real song download are counted.');
  const next={...baseline},phone=[],started=Date.now();let failed=false;
  for(const {scene,mode,key} of selected) {
    const measurements=[];
    for(let i=0;i<(updating?5:1);i++) {
      const result=await measure(scene,mode,undefined,astra?{query:{astra}}:{});measurements.push(result);
      console.log(`${key} run=${i+1} ${JSON.stringify(result.counts)}`);
      console.log(`DIAGNOSTIC ${key} `+JSON.stringify({url:result.url,seconds:result.seconds,passes:result.passes,groups:result.groups,groupTriangles:result.groupTriangles,frames:result.frameRanges,assets:result.assets,drive:result.drive,trees:result.trees,radio:result.radio,cutWork:result.cutWork,guardrails:result.guardrails}));
    }
    const result=measurements[0]; visited.push(key);
    if (studyCounts) studyCounts[key] = result.counts;
    if(updating) {
      const spreads=Object.fromEntries(metrics.map(k=>[k,[Math.min(...measurements.map(r=>r.counts[k])),Math.max(...measurements.map(r=>r.counts[k]))]]));
      console.log(`SPREAD ${key} ${JSON.stringify(spreads)}`);
      for(const k of metrics) assert.equal(spreads[k][0],spreads[k][1],`${key}: ${k} is not exact over five fresh loads; fix settlement`);
      next[key]=updateRow(key,result.counts,baseline[key],options.action==='raise');
    }
    if(FAR_SAMPLE&&mode.phone){
      const fits=result.counts.calls<=PHONE_CAP.calls&&result.counts.triangles<=PHONE_CAP.triangles;
      console.log(`CAP ${key} far=${FAR_PHONE}: calls=${result.counts.calls}/${PHONE_CAP.calls} triangles=${result.counts.triangles}/${PHONE_CAP.triangles} ${fits?'FITS':'OVER'}; pin calls=${baseline[key].calls} triangles=${baseline[key].triangles}`);
    } else failed=compare(key,result.counts,updating?next[key]:baseline[key])||failed;
    if(mode.phone) phone.push({key,...result.counts,groups:result.groups});
  }
  // Neither deleting a scene/mode nor silently skipping one can leave a full baseline passing.
  failed=coverage(updating?next:baseline,allKeys())||failed;
  assert.deepEqual([...visited].sort(),selected.map(r=>r.key).sort(),'selected script rows were not all measured');
  if(updating) writeFileSync(baselinePath,serialize(stored(next,land)));
  for(const row of phone.sort((a,b)=>b.calls-a.calls)) console.log(`PHONE TOTAL ${row.key}: calls=${row.calls} triangles=${row.triangles} geometries=${row.geometries} textures=${row.textures} programs=${row.programs}`);
  if(!failed) for(const row of phone.slice(0,3)) console.log(`PHONE TOP ${row.key}: calls=${row.calls} triangles=${row.triangles}; groups=${JSON.stringify(row.groups)}`);
  console.log(`${failed?'FAIL':'PASS'} frame-budget ${subset?'SUBSET':'full'} (${((Date.now()-started)/1000).toFixed(1)}s)`);
  return failed?1:0;
}
// Reuse the owned hardware browser for paired study runs. Each scene still gets a fresh tab.
async function runStudy(flags) {
  const names = flags.split(',').map(name => name === 'off' ? '' : name);
  assert.ok(names.every(name => ['', 'bend-camera', 'coastal-air', 'window-light', 'wall-shadows'].includes(name)), 'unknown study flag');
  const args = JSON.parse(process.env.FRAME_BUDGET_ARGS ?? '[]');
  const options = parseArgs(args);
  assert.equal(options.action, 'check', 'a proposal measures the committed pins');
  let status = 0;
  for (const name of names) {
    let load;
    while ((load = loadavg()[0]) >= 40) await sleep(5000);
    const started = new Date().toISOString(), flag = name || 'off', counts = {};
    console.log(`ASTRA budget start ${started} load1=${load.toFixed(2)} flag=${flag}`);
    const code = await run(name, counts);
    status = code || status;
    if (process.env.MMM_CHECK_OUT) {
      const folder = join(process.env.MMM_CHECK_OUT, 'evidence/astra-budget');
      mkdirSync(folder, { recursive: true });
      const fixture = [basename(baselinePath, '.json'), ...(options.phone ? ['phone'] : []), ...options.scenes, ...options.modes].join('-');
      writeFileSync(join(folder, fixture + '-' + flag + '.json'), JSON.stringify({ flag, args, started, load, code, counts }, null, 2) + '\n');
    }
  }
  return status;
}
let entry=false;
try {entry=realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url));} catch { /* imported module or stdin */ }
if(entry) {
  try {
    const flags = process.env.ASTRA_BUDGET_VARIANT;
    process.exitCode = flags === undefined ? await run() : await runStudy(flags);
  } catch(error) {console.error('FAIL frame-budget: '+error.stack);process.exitCode=1;}
}
