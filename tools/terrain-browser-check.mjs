#!/usr/bin/env node
// RUN=terrain-browser-check.mjs VIEWS="desktop|q=high phone|q=low&touch=1" tools/yard-shots.sh 1280 720
// One owned browser job, one page load per supplied mode. Same-page pixels, real game RAF/render path.
// TERRAIN_BROWSER_MUTATION=dispose-wanted must exit nonzero. No software GPU or other browser is touched.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
const [out, ...urls] = process.argv.slice(2), endpoint = `http://127.0.0.1:${process.env.CDP_PORT}`;
assert.ok(out && urls.length); mkdirSync(out, { recursive: true });
const mutation = process.env.TERRAIN_BROWSER_MUTATION;
assert.ok(!mutation || mutation === 'dispose-wanted', 'unknown mutation');
// The 96 spare tiles and newly uploaded ancestor/mirror buffers are still owned, not leaked.
// Account for those live tile owners and pre-existing static landmark/tree/coast geometry caches.
// Their GPU upload can be lazy; their CPU identities are fixed before the trip. Desktop props and animals
// load after the reference, and owned prop geometry counts can change. Count those geometries out of that
// delta, but keep them in the trip-to-trip growth and unowned-resource checks. Remaining scene growth
// is at most 12 desktop / 22 phone geometries. No extra non-tile texture is allowed.
const SCENE_GEOMETRY_LIMIT = { desktop: 12, phone: 22 };
const sceneGeometries = (memory, mode) => memory.geometries-memory.tileGeometries-memory.staticGeometries
  -(mode==='desktop' ? (memory.owners.props??0)+(memory.owners.actors??0) : 0);
const failures = [], rows = []; const startedAt = Date.now();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function bootstrap() {
  localStorage.clear();
  const raf = requestAnimationFrame.bind(window);
  window.__g9RAF = { frame: null, id: 0 };
  window.requestAnimationFrame = callback => {
    if (callback.name === 'frame') { __g9RAF.frame = callback; return ++__g9RAF.id; }
    return raf(callback);
  };
}
async function install() {
  const T = await import('/node_modules/three/build/three.module.js');
  if (T.REVISION !== '170') throw Error('three.js revision changed');
  const m = window.mmm, { renderer: r, terrain: t, camera: c, trees } = m;
  let scene = t.group; while (scene.parent) scene = scene.parent;
  if (!scene.isScene || !__g9RAF.frame) throw Error('No production scene/RAF');
  const staticGeometries = new Set([...(trees?.shapes ?? []), ...(trees?.nearShapes ?? [])]);
  for (const group of [m.landmarks?.group,m.coast?.group]) group?.traverse(o=>{if(o.geometry)staticGeometries.add(o.geometry);});
  const gl = r.getContext(), wall = performance.now.bind(performance);
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const device = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  if (/swiftshader|llvmpipe|softpipe|software|basic render|warp/i.test(device)) throw Error('Software graphics: ' + device);
  const s = window.g9 = { m, r, t, c, trees, scene, gl, device, wall, now: wall(), capture: null,
    pictures: new Map(), resident: new Set(), watched: new WeakSet(), disposed: new WeakSet(), cycles: [], current: null, qualityReady: null,
    pose: { x: 0, z: 0, eye: 2.2 }, lastUpdate: null, lastBuilds: 0, builds: 0, maxDrivingBuilds: 0, drivingBuilds: 0, driveProbe: null, uploads: 0 };
  const check = (ok, message) => { if (!ok) throw Error(message); };
  // Freeze actor animation, not terrain, plants, cache work or the production renderer. All shaders see one time.
  for (const actor of [m.animals, m.fishing]) if (actor?.update) {
    const update = actor.update.bind(actor); actor.update = (_dt, ...args) => update(0, ...args);
  }
  m.vehicle.car.root.visible = false;
  const qframe = m.quality.frame.bind(m.quality);
  m.quality.frame = (dt, settled, ...args) => { s.qualityReady = settled; return qframe(dt, settled, ...args); };
  const mark = geometry => {
    if (!geometry?.isBufferGeometry || s.resident.has(geometry)) return;
    s.resident.add(geometry);
    geometry.addEventListener('dispose', () => { s.resident.delete(geometry); s.disposed.add(geometry); });
  };
  const auditObject = object => {
    if (!(object.isMesh || object.isLine || object.isPoints) || s.watched.has(object)) return;
    s.watched.add(object);
    const render = object.onBeforeRender, shadow = object.onBeforeShadow;
    object.onBeforeRender = function (...args) { mark(args[3]); render?.apply(this, args); };
    object.onBeforeShadow = function (...args) { mark(args.find(a => a?.isBufferGeometry)); shadow?.apply(this, args); };
  };
  const watchTexture = texture => {
    if (!texture?.isTexture || s.watched.has(texture)) return;
    s.watched.add(texture); texture.addEventListener('dispose', () => s.disposed.add(texture));
  };
  const build = t.build.bind(t);
  t.build = decoded => {
    build(decoded); s.builds++;
    for (const field of ['tNormal', 'tRoad', 'tBrook']) watchTexture(decoded.tile.mesh.material.uniforms[field].value);
  };
  const render = r.render.bind(r);
  r.render = (world, camera) => {
    world.traverse(auditObject); t.uniforms.time.value = 120;
    render(world, camera);
    if (s.capture && world === scene && camera === c && r.getRenderTarget() === null) {
      const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
      check(gl.getError() === gl.NO_ERROR, 'readPixels WebGL error');
      s.pictures.set(s.capture, { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, data });
    }
  };
  const update = t.update.bind(t);
  t.update = (camera, startMode = false) => {
    const at = wall(), gap = s.lastUpdate === null ? 0 : at - s.lastUpdate, before = t.readyCount;
    const beforeBuilds = s.builds, previousBuilds = s.lastBuilds;
    s.lastUpdate = at; update(camera, startMode);
    s.lastBuilds = s.builds - beforeBuilds;
    if (t.buildMode === 'driving') {
      s.maxDrivingBuilds = Math.max(s.maxDrivingBuilds, s.lastBuilds); s.drivingBuilds += s.lastBuilds;
      check(s.lastBuilds <= 1, `Driving update built ${s.lastBuilds} terrain tiles`);
    }
    if (s.driveProbe) {
      s.driveProbe.updates++; s.driveProbe.maxBuilds = Math.max(s.driveProbe.maxBuilds,s.lastBuilds);
      if(t.buildMode === 'burst')s.driveProbe.burstUpdates++;
      check(t.buildMode === 'driving','Short normal drive unexpectedly entered '+t.buildMode);
      check(s.lastBuilds <= 1,'Short normal drive built more than one tile');
    }
    if (s.current) {
      const cycle=s.current;
      if (t.readyCount < before) { cycle.disposed += before - t.readyCount; cycle.disposeMaxMs = Math.max(cycle.disposeMaxMs, gap); }
      if (cycle.returning) {
        if(gap >= cycle.returnMaxMs){cycle.returnMaxMs=gap;cycle.returnWorstBuilds=previousBuilds;}
        if(!t.burst && cycle.burstUpdates>0)cycle.burstComplete=true;
        if(t.buildMode==='burst') {
          cycle.burstUpdates++;cycle.burstBuilds+=s.lastBuilds;
          const ms=wall()-at;
          if(ms>=cycle.burstWorstUpdateMs){cycle.burstWorstUpdateMs=ms;cycle.burstWorstUpdateBuilds=s.lastBuilds;}
          if(!t.burst)cycle.burstComplete=true;
        }else if(cycle.burstComplete)cycle.returning=false;
      }
    }
  };

  s.step = delta => {
    const frameAt=wall();
    if (s.pose) {
      c.position.x = s.pose.x; c.position.z = s.pose.z;
      c.position.y = Math.max(t.seaLevel, t.heightAt(c.position.x, c.position.z) ?? 40) + s.pose.eye;
    }
    s.now += delta; __g9RAF.frame(s.now);
    check(!gl.isContextLost(), 'WebGL context lost');
    check(document.getElementById('gameError')?.hidden !== false, 'Production frame stopped');
    if(s.current?.returning && t.buildMode==='burst') {
      const ms=wall()-frameAt;
      if(ms>=s.current.burstLongestFrameMs){s.current.burstLongestFrameMs=ms;s.current.burstLongestFrameBuilds=s.lastBuilds;}
    }
    const probe=s.blockProbe,tile=probe&&t.tiles.get(probe.key);
    if(probe&&tile){
      if(tile.failed&&!probe.firstFailure)probe.firstFailure=Date.now();
      if(probe.firstFailure&&Date.now()-probe.firstFailure<20000&&!tile.ready&&tile.wanted===t.frame){
        probe.samples++;if(document.documentElement.dataset.mmmReady==='true')probe.blips.push({frame:t.frame,pending:t.pending,failed:t.failed});
      }
    }
  };
  s.batch = async (n, delta = 1000 / 60) => {
    for (let i = 0; i < n; i++) { s.step(delta); await new Promise(resolve => setTimeout(resolve, 0)); }
    return s.status();
  };
  // Guardrails are planned from the land at most one chunk per update, and every tile load or eviction replans the
  // near chunks. A picture taken while that queue is non-empty can differ from a later, settled picture.
  // A new mesh (a rebuilt rail chunk, a tree tile) casts no shadow until the shadow pass's twice-a-second scan
  // marks it (shadows.ts), and picture() advances no game time. Count the meshes that scan has not reached yet.
  const unflagged = () => { let n = 0; if (r.shadowMap.enabled) scene.traverse(o => { if (o.isMesh && !o.userData.shadowSet) n++; }); return n; };
  s.status = () => ({ frame: t.frame, pending: t.pending, failed: t.failed, treePending: trees?.pending ?? 0,
    grassPending: m.grass?.pending ?? 0, railPending: m.roads?.guardrails?.audit.pending ?? 0, shadowPending: unflagged(), ready: document.documentElement.dataset.mmmReady === 'true', qualityReady: s.qualityReady });
  s.move = (x, z, eye, moveCar) => {
    s.pose = { x, z, eye }; c.position.set(x, (t.heightAt(x, z) ?? 40) + eye, z);
    if (moveCar) { m.vehicle.place(x, z, Math.PI / 2); m.driveVehicle(0, { throttle: 0, steer: 0, handbrake: true }); }
  };
  s.audit = () => {
    let ready = 0, visible = 0;
    for (const tile of t.tiles.values()) if (tile.ready) {
      ready++; check(tile.mesh?.parent === t.group, 'READY tile has no terrain.group mesh');
      if (tile.mesh.visible) visible++;
      check(!s.disposed.has(tile.mesh.geometry), 'READY tile has a disposed geometry');
      for (const field of ['tNormal', 'tRoad', 'tBrook']) check(!s.disposed.has(tile.mesh.material.uniforms[field].value), 'READY tile has a disposed texture');
    }
    check(t.readyCount === ready, `READY count drift ${t.readyCount}/${ready}`);
    check(t.group.children.length === ready, `terrain.group leak ${t.group.children.length}/${ready}`);
    check(t.group.children.filter(q => q.visible).length === visible && t.drawn === visible, 'drawn terrain mesh count drift');
    check(gl.getError() === gl.NO_ERROR, 'WebGL error after lifecycle work');
    return { ready, wanted: t.wantedCount, spare: ready - t.wantedCount, meshes: t.group.children.length, drawn: visible };
  };
  s.evictFine = keys => {
    const targets = keys.map(key => t.tiles.get('8/' + key)).filter(tile => tile?.ready);
    for (const tile of targets) {
      check(!tile.mesh.visible && tile.wanted !== t.frame && !tile.loading, 'held tree ground is still in use');
    }
    // Apply synchronous cache pressure only to these old, hidden tiles. Use production disposal;
    // restore the real wanted count before any frame runs. The 96-tile cache limit stays unchanged.
    const wanted = t.wantedCount, ages = targets.map(tile => tile.lastUsed);
    try {
      for (const tile of targets) tile.lastUsed = -Infinity;
      t.wantedCount = t.readyCount - 96 - targets.length;
      t.evict();
    } finally {
      t.wantedCount = wanted;
      targets.forEach((tile, i) => { tile.lastUsed = ages[i]; });
    }
    let missing = 0;
    for (const key of keys) {
      const tile = t.tiles.get('8/' + key);
      check(!tile?.ready && !tile?.loading, 'held tree fine ground was not evicted: ' + key);
      const [i, j] = key.split('_').map(Number), m = t.manifest;
      const x = m.origin[0] + (i + .5) * 256 - m.village[0];
      const z = m.village[1] - (m.origin[1] - (j + .5) * 256);
      check((t.surfaceAt(x, z)?.level ?? -1) < 8, 'held tree still has fine ground: ' + key);
      missing++;   // counted only after all three checks above passed for this key
    }
    return { evicted: targets.length, missing };
  };
  s.memory = () => {
    const geometries = new Set(), textures = new Set(), tileGeometries = new Set(), tileTextures = new Set(), owners = new Map();
    const shapes = new Set([...(trees?.shapes ?? []), ...(trees?.nearShapes ?? [])]);
    const groups = [[t.group,'terrain'],[t.maskScene,'terrain'],[trees?.group,'trees'],[m.grass?.group,'grass'],[scene.getObjectByName('Roadside props'),'props'],[m.roads?.group,'roads'],[m.landmarks?.group,'landmarks'],[m.coast?.group,'coast'],[m.roadScene?.group,'road-scene'],[m.yard?.group,'yard'],[m.animals?.group,'actors']];
    const geoOwner = (geometry, object, forced) => {
      if (!geometry || !s.resident.has(geometry)) return;
      let name = forced ?? 'other';
      if (shapes.has(geometry)) name = 'tree-shape-cache';
      else if (!forced) for (let node=object;node;node=node.parent) {const group=groups.find(([g])=>g===node);if(group){name=group[1];break;}}
      if(['tree-shape-cache','landmarks','coast'].includes(name))check(staticGeometries.has(geometry),'static geometry cache gained a new identity');
      if (!owners.has(name)) owners.set(name,new Set()); owners.get(name).add(geometry); geometries.add(geometry);
    };
    const addTexture = texture => { if (texture?.isTexture && r.properties.get(texture).__webglTexture) textures.add(texture); };
    const material = mat => {
      if (!mat) return;
      for (const value of Object.values(mat)) if (value?.isTexture) addTexture(value);
      for (const uniform of Object.values(mat.uniforms ?? {})) addTexture(uniform.value);
    };
    const inventory = node => node.traverse(object => {
      geoOwner(object.geometry,object);
      if (Array.isArray(object.material)) object.material.forEach(material); else material(object.material);
      if (object.isDirectionalLight && object.shadow.map) {
        addTexture(object.shadow.map.texture); addTexture(object.shadow.map.depthTexture);
      }
    });
    inventory(scene); inventory(t.maskScene);
    for (const tile of t.tiles.values()) if (tile.ready) {
      for (const geometry of [tile.mesh.geometry, tile.mirror?.geometry]) if (geometry && s.resident.has(geometry)) { geoOwner(geometry,null,'terrain'); tileGeometries.add(geometry); }
      for (const field of ['tNormal', 'tRoad', 'tBrook']) {
        const tex = tile.mesh.material.uniforms[field].value;
        if (tex !== t.noRoad && tex !== t.noBrook && r.properties.get(tex).__webglTexture) tileTextures.add(tex);
      }
    }
    for (const geo of [...(trees?.shapes ?? []), ...(trees?.nearShapes ?? [])]) if (s.resident.has(geo)) geoOwner(geo,null,'tree-shape-cache');
    for (const tex of [t.noRoad, t.noBrook, t.uniforms.tCover.value]) addTexture(tex);
    if (m.water) { addTexture(m.water.target.texture); addTexture(m.water.target.depthTexture); }
    for (const uniform of Object.values(m.water?.uniforms ?? {})) addTexture(uniform.value);
    return { geometries: r.info.memory.geometries, textures: r.info.memory.textures, liveGeometries: geometries.size, liveTextures: textures.size,
      tileGeometries: tileGeometries.size, staticGeometries: ['tree-shape-cache','landmarks','coast'].reduce((n,key)=>n+(owners.get(key)?.size??0),0), tileTextures: tileTextures.size, owners:Object.fromEntries([...owners].map(([name,geos])=>[name,geos.size])),
      engineG: r.info.memory.geometries - geometries.size, engineT: r.info.memory.textures - textures.size };
  };
  s.picture = async label => {
    for (let i = 0; i < 6; i++) { s.step(0); await new Promise(resolve => setTimeout(resolve, 15)); }
    s.capture = label; s.step(0); s.capture = null;
    check(s.pictures.has(label), 'Production render did not supply pixels');
    return s.memory();
  };
  s.diff = (a, b) => {
    const before = s.pictures.get(a), after = s.pictures.get(b); check(before && after, 'Missing picture');
    check(before.width === after.width && before.height === after.height, 'Picture dimensions changed');
    let pixels = 0;
    for (let i = 0; i < before.data.length; i += 4) if (before.data[i] !== after.data[i] || before.data[i+1] !== after.data[i+1] || before.data[i+2] !== after.data[i+2] || before.data[i+3] !== after.data[i+3]) pixels++;
    return pixels;
  };
  s.png = async label => {
    const p = s.pictures.get(label); if (!p) return null;
    const canvas = document.createElement('canvas'); canvas.width = p.width; canvas.height = p.height;
    const ctx = canvas.getContext('2d'), image = ctx.createImageData(p.width, p.height);
    for (let y = 0; y < p.height; y++) image.data.set(p.data.subarray(y*p.width*4,(y+1)*p.width*4), (p.height-y-1)*p.width*4);
    ctx.putImageData(image, 0, 0); return canvas.toDataURL('image/png').split(',')[1];
  };
  return { device, exag: t.exag, low: m.low, hooks: Object.keys(m).sort() };
}
async function connect(url) {
  const tab = await (await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r,j) => { ws.onopen=r; ws.onerror=j; });
  let serial = 0, phase = 'boot', treeDelay = false, blocked = null, blockedStart = null, closed = false, delayedTrees = 0, paused = new Set();
  const pending = new Map(), errors = [], glWarnings = [];
  const send = (method, params = {}) => new Promise((resolve,reject) => {
    if(closed){reject(Error('owned tab is closed'));return;}
    const id=++serial, timer=setTimeout(() => {pending.delete(id);reject(Error('CDP timeout '+method));},180000);
    pending.set(id, m => {clearTimeout(timer);m.error?reject(Error(method+': '+JSON.stringify(m.error))):resolve(m.result);}); ws.send(JSON.stringify({id,method,params}));
  });
  ws.onmessage = ({data}) => {
    const m=JSON.parse(data); if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);return;}
    if(m.method==='Runtime.exceptionThrown') errors.push({phase,text:m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text});
    if(m.method==='Runtime.consoleAPICalled') {
      const text=m.params.args.map(a=>a.value??a.description).join(' ');
      if(m.params.type==='error') errors.push({phase,text});
      if(/WebGL|GL_INVALID|INVALID_OPERATION|context lost/i.test(text)&&['warning','warn','error'].includes(m.params.type)) glWarnings.push({phase,text});
    }
    if(m.method==='Log.entryAdded' && ['warning','error'].includes(m.params.entry.level) && /WebGL|GL_INVALID|INVALID_OPERATION|context lost/i.test(m.params.entry.text)) glWarnings.push({phase,text:m.params.entry.text});
    if(m.method==='Fetch.requestPaused') {
      const p=m.params, requestUrl=p.request.url; paused.add(p.requestId);
      const finish=async()=>{
        if(blocked && requestUrl.endsWith('/8/'+blocked+'.png')) {
          blockedStart ??= Date.now();
          if(Date.now()-blockedStart<20000){await send('Fetch.failRequest',{requestId:p.requestId,errorReason:'Failed'});paused.delete(p.requestId);return;}
        }
        if(treeDelay && requestUrl.endsWith('.t.bin')) { delayedTrees++; await sleep(8000); while(treeDelay&&!closed) await sleep(20); }
        if(closed)return;
        await send('Fetch.continueRequest',{requestId:p.requestId}); paused.delete(p.requestId);
      };
      finish().catch(error=>errors.push({phase,text:error.message}));
    }
  };
  ws.onclose=()=>{for(const complete of pending.values())complete({error:{message:'owned tab closed'}});pending.clear();};
  const read = async expression => {const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const until = async (expression, label, ms=120000) => {const end=Date.now()+ms;while(Date.now()<end){if(await read(expression))return;await sleep(50);}throw Error('timeout '+label);};
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${bootstrap.toString()})()`});
  const low=new URL(url).searchParams.get('q')==='low', width=low?844:1280,height=low?390:720;
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url});
  await until('!!window.mmm?.terrain && !!window.__g9RAF?.frame','game ready to drive');
  const info=await read(`(${install.toString()})()`);
  let heading=90,pitch=-3;
  const pose=async (x,z,eye=2.2,car=true,h=90,p=-3)=>{
    const dx=(h-heading)*Math.PI/180/.0032,dy=-(p-pitch)*Math.PI/180/.0032;
    if(dx||dy){const startX=dx>=0?100:width-100;
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:startX,y:200,button:'left',clickCount:1});
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:startX+dx,y:200+dy,button:'left',buttons:1});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:startX+dx,y:200+dy,button:'left',clickCount:1});
      heading=h;pitch=p;
    }
    await read(`g9.move(${x},${z},${eye},${car})`);
  };
  const pump=async(n=20,dt=1000/60)=>read(`g9.batch(${n},${dt})`);
  const settle=async(min=35)=>{
    await pump(min); const end=Date.now()+120000;
    while(Date.now()<end){const s=await pump(12);if(s.ready&&!s.pending&&!s.failed&&!s.treePending&&!s.grassPending&&!s.railPending&&!s.shadowPending)return s;}
    throw Error('timeout settled land '+JSON.stringify(await read('g9.status()')));
  };
  const clean=()=>{
    assert.deepEqual(errors,[],'console errors');assert.deepEqual(glWarnings,[],'WebGL warnings');
    const log=process.env.BROWSER_LOG;
    if(log&&existsSync(log))assert.deepEqual(readFileSync(log,'utf8').split('\n').filter(l=>/WebGL|GL_INVALID|GL_ERROR|GLDriver/i.test(l)&&/warning|error|invalid|context.?lost/i.test(l)),[],'WebGL warnings in browser log');
  };
  return {low,info,read,send,pump,pose,settle,until,clean,errors,glWarnings,
    phase(value){phase=value;}, get delayedTrees(){return delayedTrees;}, delayTrees(value){treeDelay=value;}, block(value){blocked=value;blockedStart=null;}, get blockedStart(){return blockedStart;},
    async interception(){await send('Fetch.enable',{patterns:[{urlPattern:'*.t.bin',requestStage:'Request'},{urlPattern:'*.png',requestStage:'Request'}]});},
    async close(){treeDelay=false;blocked=null;for(const id of paused)await send('Fetch.continueRequest',{requestId:id}).catch(()=>{});paused.clear();await fetch(`${endpoint}/json/close/${tab.id}`).catch(()=>{});closed=true;ws.close();}};
}
// Raw first/final counts are printed. The engine-owned offset must remain fixed; live resource deltas must be
// attributable to scene owners and the bounded 96-tile spare cache, never an unreachable terrain resource.
async function runMode(input) {
  const url=new URL(input), low=url.searchParams.get('q')==='low', mode=low?'phone':'desktop';
  // finish=0: the pictures are read from the canvas right after the world draw; the finish pass (finish.ts) draws the world elsewhere first.
  for(const [k,v]of Object.entries({finish:'0',hud:'0',radio:'0',res:'1',shadows:'1',cam:'624271,5103301,2.2,90,-3,51',camground:'1',at:'624271,5103301,90'}))url.searchParams.set(k,v);
  let p;
  const part=async(label,fn)=>{
    p.phase(label);
    try {const value=await fn();rows.push({mode,part:label,...value});console.log(`PASS ${mode} ${label} ${JSON.stringify(value)}`);return value;}
    catch(error){failures.push({mode,part:label,error:error.message});console.error(`FAIL ${mode} ${label}: ${error.message}`);
      try{await p.read("g9.picture('failure')");for(const key of ['village-reference','village-final','coast-reference','coast-final','failure']){
        const data=await p.read(`g9.png(${JSON.stringify(key)})`);if(data)writeFileSync(`${out}/${mode}-${label}-${key}.png`,Buffer.from(data,'base64'));
      }}catch{}return null;
    }
  };
  try {
    p=await connect(url.href); console.log(`DEVICE ${mode} ${JSON.stringify(p.info)}`);
    let reference;
    await part('a',async()=>{
      await p.pose(0,0);await p.settle(90);
      reference=await p.read("g9.picture('village-reference')");await p.read("g9.picture('method-repeat')");
      assert.equal(await p.read("g9.diff('village-reference','method-repeat')"),0,'two stationary captures must match before testing eviction');
      if(!low){await p.pose(618976-624271,5103301-5109274,3,true,180,-8);await p.settle(80);await p.read("g9.picture('coast-reference')");await p.pose(0,0);await p.settle();}
      const scenes=[];
      for(let n=0;n<5;n++){
        await p.read(`g9.current={cycle:${n+1},disposed:0,disposeMaxMs:0,returnMaxMs:0,returnWorstBuilds:0,returning:false,burstComplete:false,burstUpdates:0,burstBuilds:0,burstWorstUpdateMs:0,burstWorstUpdateBuilds:0,burstLongestFrameMs:0,burstLongestFrameBuilds:0};g9.cycles.push(g9.current)`);
        await p.pose(-3500,-3500);await p.pump(700);await p.settle();
        await p.read('g9.current.returning=true');await p.pose(0,0);await p.settle(80);
        const inventory=await p.read('g9.audit()'),held=await p.read('g9.memory()');p.clean();
        scenes.push(held.geometries-held.tileGeometries-held.staticGeometries);
        console.log(`CYCLE ${mode} ${n+1} ${JSON.stringify({...inventory,sceneGeometries:scenes.at(-1),props:held.owners.props,textures:held.textures-held.tileTextures})}`);
      }
      await p.pump(730);await p.settle();await p.read("g9.picture('village-final')");
      const final=await p.read('g9.memory()'),inventory=await p.read('g9.audit()');
      const pixels=await p.read("g9.diff('village-reference','village-final')");
      const memory={first:reference,final,deltaG:final.geometries-reference.geometries,deltaT:final.textures-reference.textures};
      console.log(`MEASURE ${mode} a ${JSON.stringify({pixels,inventory,memory})}`);
      assert.equal(pixels,0,'reloaded village pixels');
      // Exact owner inventory is the pinned rule: engine offset is fixed, and only 96 spare tile owners may remain.
      // Desktop props/animals have independent arrival/expiry times. Exclude their owned counts only
      // from this reference delta; the raw trip counts below still include every scene owner.
      const growth=sceneGeometries(final,mode)-sceneGeometries(reference,mode);
      assert.ok(growth>=0&&growth<=SCENE_GEOMETRY_LIMIT[mode],`non-tile geometry growth ${growth} is outside 0..${SCENE_GEOMETRY_LIMIT[mode]}`);
      // Props show and hide on a 350 ms wall-clock timer, so one reading can catch them absent (measured 93, 74, 93, 73, 93).
      // A leak rises from trip to trip: the last two trips may not exceed the first three.
      assert.ok(Math.max(scenes[3],scenes[4])<=Math.max(scenes[0],scenes[1],scenes[2]),`non-tile geometries grow with each trip: ${scenes.join(', ')}`);
      // A ready tile owns at most a mesh and a mirror geometry, and a normal, a road and a brook texture.
      assert.ok(final.tileGeometries<=2*inventory.ready&&final.tileTextures<=3*inventory.ready,`more tile resources (${final.tileGeometries} geometries, ${final.tileTextures} textures) than ${inventory.ready} ready tiles can own`);
      assert.equal(final.textures-final.tileTextures,reference.textures-reference.tileTextures,'non-tile texture count did not return to baseline');
      assert.equal(final.engineG,reference.engineG,'unowned GPU geometry leak');assert.equal(final.engineT,reference.engineT,'unowned GPU texture leak');
      assert.ok(Math.abs(reference.engineG)<=8&&Math.abs(reference.engineT)<=8,'unexpected engine resource offset');
      assert.ok(inventory.spare<=96,'mature spare cache limit');
      p.clean();return {pixels,inventory,memory,sceneGrowth:growth};
    });
    await part('b',async()=>{
      const cycles=await p.read('g9.current=null;g9.cycles');assert.equal(cycles.length,5,'five cycle hitch records');const maxDisposeMs=Math.max(...cycles.map(q=>q.disposeMaxMs)),maxReturnMs=Math.max(...cycles.map(q=>q.returnMaxMs));
      if(Math.max(maxDisposeMs,maxReturnMs)>250)console.log(`HITCH OVER 250 MS ${mode}: ${Math.max(maxDisposeMs,maxReturnMs).toFixed(2)} MS`);
      const builds=await p.read('({maxDrivingBuilds:g9.maxDrivingBuilds,drivingBuilds:g9.drivingBuilds})');
      assert.ok(builds.maxDrivingBuilds<=1,'more than one tile built per driving update');
      for(const cycle of cycles){assert.ok(cycle.burstUpdates>0,'return entered burst');assert.ok(cycle.burstComplete,'return burst ended');}
      assert.ok(cycles.some(c=>c.burstBuilds>0),'returns exercised burst tile builds');
      return {maxDisposeMs,maxReturnMs,...builds,cycles};
    });
    await p.interception();
    await part('d',async()=>{
      // New tree keys, same page/build. Keep the delayed requests paused until both eight seconds and the
      // >660-update away interval have elapsed, to reproduce the await/eviction race on either GPU speed.
      p.delayTrees(true);await p.pose(1500,0);await p.pump(70);assert.ok(p.delayedTrees>0,'real tree-file requests were intercepted');
      // The tree tiles whose files are held back. Only these are the subject of this part.
      const held=await p.read("[...g9.trees.tiles].filter(([,tile])=>tile==='loading').map(([key])=>key)");
      assert.ok(held.length>0,'tree tiles wait for their delayed files');
      // Keep the real away/aging interval. Lazy phone reads can still leave this ground in the spare
      // cache, so explicit pressure below guarantees that the held files arrive over missing fine ground.
      await p.pose(6000,0);await p.pump(150);
      await p.pose(-3500,-3500);await p.pump(700);
      const ground=await p.read(`g9.evictFine(${JSON.stringify(held)})`);
      assert.equal(ground.missing,held.length,'all held tree tiles lack fine ground before releasing files');
      console.log(`MISSING_GROUND ${mode} d ${JSON.stringify(ground)}`);
      p.delayTrees(false);await p.settle();
      const away=await p.read('g9.status()');assert.equal(away.ready,true,'tools ready became true while away');
      // Witness: files arrived while their fine ground was gone, and are kept decoded, not planted.
      const deferred=await p.read(`${JSON.stringify(held)}.filter(key=>g9.trees.decoded.has(key)&&g9.trees.tiles.get(key)==='loading').length`);
      assert.ok(deferred>0,`no delayed tree file arrived over missing fine ground (0 of ${held.length} deferred): the route did not test the rule`);
      await p.pose(1500,0);await p.settle(100);
      const roots=await p.read(`(()=>{let n=0,max=0,off=0,planted=0;for(const key of ${JSON.stringify(held)}){
        const tile=g9.trees.tiles.get(key);if(!tile||tile==='loading')continue;
        if(g9.trees.decoded.has(key))throw Error('planted tile retains decoded file');
        if(!g9.t.drawnFine.has(key))continue;planted++;
        for(const batch of tile.batches)for(let k=0;k<batch.matrices.length;k+=16){
          const x=batch.matrices[k+12],z=batch.matrices[k+14],surface=g9.t.surfaceAt(x,z);if(surface?.level!==8)throw Error('root oracle is coarse');
          const gap=Math.abs(batch.matrices[k+13]+.25-g9.t.heightAt(x,z));max=Math.max(max,gap);if(gap>.05*g9.t.exag)off++;n++;
        }
      }return {sampled:n,planted,maxError:max,off,tolerance:.05*g9.t.exag,decoded:g9.trees.decoded.size}})()`);
      assert.ok(roots.sampled>=2000,`only ${roots.sampled} roots of the delayed tiles were sampled`);assert.equal(roots.off,0);p.clean();
      return {awayReady:away.ready,delayedFiles:p.delayedTrees,heldTiles:held.length,ground,deferred,...roots};
    });
    await part('e',async()=>{
      await p.pose(0,0);await p.settle(80);
      const originals=await p.read("[...g9.t.tiles.entries()].filter(([,t])=>t.ready&&t.level===8&&t.countedFrame===g9.t.frame).map(([key,t])=>({key,x:t.x0+t.size/2,z:t.z0+t.size/2}))");
      await p.pose(-3500,-3500);await p.pump(700);await p.settle();
      let candidates=await p.read(`${JSON.stringify(originals)}.filter(q=>!g9.t.tiles.get(q.key)?.ready&&Math.hypot(q.x,q.z)>100)`);
      if(!candidates.length){await p.pose(6000,0);await p.pump(700);await p.settle();candidates=await p.read(`${JSON.stringify(originals)}.filter(q=>!g9.t.tiles.get(q.key)?.ready&&Math.hypot(q.x,q.z)>100)`);}
      // The lazy phone cache can retain every village tile even after both away poses. Part d now
      // deliberately reloads its fine land, so guarantee this later retry test also makes a real read.
      let fallback=false;
      if(!candidates.length){
        fallback=true;
        const retained=originals.find(q=>Math.hypot(q.x,q.z)>100);
        assert.ok(retained,'a village height file exists away from the car');
        await p.read(`g9.evictFine(${JSON.stringify([retained.key.slice(2)])})`);
        candidates=await p.read(`${JSON.stringify(originals)}.filter(q=>!g9.t.tiles.get(q.key)?.ready&&Math.hypot(q.x,q.z)>100)`);
      }
      assert.ok(candidates.length,'a wanted level-8 height file must need a real reload');
      const target=candidates[0].key.slice(2);p.block(target);await p.read(`g9.blockProbe={key:'8/${target}',samples:0,firstFailure:0,blips:[]}`);await p.pose(0,0);
      const deadline=Date.now()+70000;let firstFrame=null,lastFrame=null,qualityReady=false,blockedSamples=0,recovered=false;
      while(Date.now()<deadline){const s=await p.pump(10);if(s.failed){firstFrame??=s.frame;lastFrame=s.frame;assert.equal(s.ready,false,'blocked wanted file reported settled');qualityReady ||= s.qualityReady;blockedSamples++;}
        if(p.blockedStart&&Date.now()-p.blockedStart>=20000&&s.ready&&!s.failed&&!s.pending){recovered=true;break;}
      }
      assert.ok(blockedSamples&&lastFrame>firstFrame+20,'game kept updating during retry back-off');
      assert.ok(qualityReady,'qualityReady must become true during network back-off (quiet >20)');assert.ok(recovered,'readiness did not recover after 20s block');const perUpdate=await p.read('const probe=g9.blockProbe;g9.blockProbe=null;probe');assert.ok(perUpdate.samples>20);assert.deepEqual(perUpdate.blips,[],'tools ready blipped during a blocked wanted read');const blockedMs=Date.now()-p.blockedStart;p.block(null);
      return {file:target,fallback,blockedMs,perUpdateSamples:perUpdate.samples,readyBlips:perUpdate.blips.length,blockedSamples,updates:lastFrame-firstFrame,qualityReady,recovered};
    });
    if(!low)await part('f',async()=>{
      await p.pose(618976-624271,5103301-5109274,3,true,180,-8);await p.settle(100);await p.read("g9.picture('coast-final')");
      const pixels=await p.read("g9.diff('coast-reference','coast-final')");assert.equal(pixels,0,'coast mask/recess picture after eviction');p.clean();return {pixels};
    });
    await part('g',async()=>{
      await p.pose(0,0);await p.settle(80);
      const start=await p.read("(()=>{const road=mmm.roads.nearest(0,0,100,r=>r.kind<=3);if(!road)throw Error('no village road');mmm.vehicle.place(road.x,road.z,road.heading);mmm.driveVehicle(0,{throttle:0,steer:0,handbrake:true});return {x:mmm.vehicle.x,z:mmm.vehicle.z,y:mmm.vehicle.y}})()");
      await p.pose(-3500,-3500,2.2,false);await p.pump(700);await p.settle();await p.pose(start.x,start.z,2.2,false);await p.settle(50);
      await p.read("g9.pose=null;window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF',key:'f',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyF',key:'f',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',key:'w',bubbles:true}));g9.driveProbe={updates:0,maxBuilds:0,burstUpdates:0};g9.heightProbe={last:mmm.vehicle.y,max:0,distance:0,updates:0}");
      const result=await p.read(`(async()=>{const p=g9.heightProbe;for(let i=0;i<2400;i++){
        g9.step(1000/60);const v=mmm.vehicle;p.max=Math.max(p.max,Math.abs(v.y-p.last));p.last=v.y;p.distance=Math.hypot(v.x-(${start.x}),v.z-(${start.z}));p.updates++;
        if(p.distance>=50)break;await new Promise(r=>setTimeout(r,0));
      }window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW',key:'w',bubbles:true}));const drive=g9.driveProbe;g9.driveProbe=null;return {...p,tileUpdates:drive.updates,maxTileBuilds:drive.maxBuilds,burstUpdates:drive.burstUpdates}})()`);
      assert.ok(result.distance>=50,'car did not drive 50m');assert.ok(result.max<=.15,'car height jump >0.15m');assert.ok(result.tileUpdates>0);assert.equal(result.burstUpdates,0,'short drive remains normal');assert.ok(result.maxTileBuilds<=1,'short drive builds at most one');p.clean();return result;
    });
    if(mutation)await part('mutation',async()=>{await p.read("const q=[...g9.t.tiles.values()].find(t=>t.ready&&t.mesh.visible);q.mesh.material.uniforms.tNormal.value.dispose();g9.audit()");return {survived:true};});
  } catch(error){failures.push({mode,part:'setup',error:error.message});console.error(`FAIL ${mode} setup: ${error.stack}`);}
  finally{await p?.close();console.log(`NORMAL_MODE_EXIT ${mode} ${failures.some(f=>f.mode===mode&&f.part!=='mutation')?1:0}`);console.log(`MODE_EXIT ${mode} ${failures.some(f=>f.mode===mode)?1:0}`);}
}
for(const url of urls){await runMode(url);await sleep(500);}
console.log('TERRAIN_BROWSER_RESULT '+JSON.stringify({mutation:mutation??null,rows,failures,seconds:(Date.now()-startedAt)/1000}));
if(mutation){
  const expected=failures.filter(f=>f.part==='mutation'&&/READY tile has a disposed texture/.test(f.error));
  if(expected.length===urls.length&&failures.length===expected.length)process.exitCode=1;
  else{console.error('MUTATION_PROOF_INVALID: baseline failed or mutation survived');process.exitCode=2;}
}else if(failures.length)process.exitCode=1;
