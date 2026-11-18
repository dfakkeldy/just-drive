#!/usr/bin/env node
import { cdp, cdpFetch, exitCheck } from './cdp.mjs';
// Run through yard-shots.sh so this check owns its browser and uses the worker's ports.
// Window 1280 x 720: the look-down case needs land that the mirror sees and the main view does not;
// in a taller window (the starter's default 1600 x 1200) the main view already holds it and the case fails.
import { writeFileSync } from 'node:fs';
const [outDir, first] = process.argv.slice(2);
const base = new URL(first).origin, port = process.env.CDP_PORT ?? '9403';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failed = false;
const check = (ok, name) => { console.log(`${ok ? 'ok' : 'FAIL'} ${name}`); if (!ok) failed = true; };
async function open(query, dpr = 1) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  let cast = null; const errors = [];
  const { ws, send } = await cdp(tab.webSocketDebuggerUrl, { onEvent: d => {
    if (d.method === 'Page.screencastFrame' && cast) cast(d.params);
    if (d.method === 'Log.entryAdded' && /WebGL|GL_INVALID/.test(d.params.entry.text)) console.log('WEBGL_LOG', d.params.entry.text);
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map((a) => a.value ?? a.description).join(' '));
  } });
  const read = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  if (dpr !== 1) {
    const [width, height] = JSON.parse(await read('JSON.stringify([innerWidth, innerHeight])'));
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false });
  }
  // finish=0: this check counts every draw into a picture as a mirror draw, and the finish pass (finish.ts) draws the
  // world into a picture of its own. The mirror itself is the same with the pass.
  await send('Page.navigate', { url: `${base}/?hud=0&finish=0&${query}` });
  let settled = false;
  // Startup deadline only: allow other threads to use this Mac's GPU. No timing threshold is relaxed.
  for (let i = 0; i < 400; i++) { await sleep(300); if ((await read('document.title')).startsWith('settled')) { settled = true; break; } }
  check(settled, `settled: ${query}`);
  await sleep(800);
  check(!errors.length, `no script or shader console errors: ${errors.join(' ').slice(0, 300)}`);
  check(await read('mmm.renderer.info.programs.every(p => !p.diagnostics || p.diagnostics.runnable)'), 'all WebGL programs compile');
  const turnShots = async () => {
    let first = null, ready = false, moved = false, timer;
    const pair = new Promise((resolve) => {
      cast = async (frame) => {
        void send('Page.screencastFrameAck', { sessionId: frame.sessionId });
        if (first === null) {
          first = frame.data;
          writeFileSync(`${outDir}/mirror-turn-a.png`, Buffer.from(frame.data, 'base64'));
          const before = await read('mmm.camera.quaternion.toArray()');
          await read(`new Promise(resolve => {
            document.getElementById('c').dispatchEvent(new PointerEvent('pointermove', {pointerId:1,clientX:460,clientY:450,bubbles:true}));
            requestAnimationFrame(()=>requestAnimationFrame(resolve));
          })`);
          const after = await read('mmm.camera.quaternion.toArray()');
          moved = after.some((v,i)=>Math.abs(v-before[i])>0.00001);
          ready = true;
        } else if (ready) {
          writeFileSync(`${outDir}/mirror-turn-b.png`, Buffer.from(frame.data, 'base64'));
          cast = null; clearTimeout(timer);
          void send('Page.stopScreencast').then(()=>resolve({moved,changed:frame.data!==first,frames:2}));
        }
      };
      // A capture deadline, not a render-speed requirement, on the shared Mac.
      timer=setTimeout(()=>{cast=null;void send('Page.stopScreencast').then(()=>resolve(null));},30000);
    });
    await send('Page.startScreencast',{format:'png',everyNthFrame:1});
    return pair;
  };
  return { read, send, turnShots, shot: async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); const path = `${outDir}/${name}.png`; writeFileSync(path, Buffer.from(r.result.data, 'base64')); console.log(path); }, close: async () => { check(!errors.length, `no errors after case: ${errors.join(' ').slice(0, 500)}`); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); ws.close(); } };
}
const sample = async (p) => {
  const result = await p.read(`new Promise(resolve => {
  const r = mmm.renderer, render = r.render, terrain = mmm.terrain, prepare = terrain.withReflection;
  let mirrors = 0, frames = 0, shore = 0, reflection = 0, source = null, geometryError = 0, projectionError = 0;
  let clipped = true, restored = true, treeMeshes = 0, dimensions = [], filters = [], extraTiles = 0, invalidSamples = 0, maskDraws = 0;
  const calls = [], triangles = [];
  terrain.withReflection = function(camera, focus, draw) {
    const before = [...this.tiles.values()].filter(t => t.mesh).map(t => ({ mesh: t.mesh, visible: t.mesh.visible,
      geometry: t.mesh.geometry, material: t.mesh.material, hide: t.mesh.material.uniforms.hideQuad.value.clone() }));
    const out = prepare.call(this, camera, focus, () => {
      extraTiles = Math.max(extraTiles, before.filter(s => !s.visible && s.mesh.visible).length);
      draw();
    });
    restored &&= before.every(s => s.mesh.visible === s.visible && s.mesh.geometry === s.geometry && s.mesh.material === s.material && s.mesh.material.uniforms.hideQuad.value.equals(s.hide));
    return out;
  };
  r.render = function(scene, camera) {
    if (scene.name === 'Water visibility') { maskDraws++; return render.call(this, scene, camera); }
    const target = this.getRenderTarget(), firstFrame = this.info.render.frame;
    if (target) {
      dimensions = [target.width, target.height]; filters = [target.texture.minFilter, target.texture.magFilter];
      clipped &&= this.clippingPlanes.length === 1 && this.clippingPlanes[0].normal.y === 1;
      if (source) {
        const level = -this.clippingPlanes[0].constant;
        geometryError = Math.max(geometryError, Math.abs(camera.position.y + source.position.y - 2 * level));
        for (const i of [0,1,3,4,5,7,8,9,11,12,13,15]) projectionError = Math.max(projectionError, Math.abs(camera.projectionMatrix.elements[i] - source.projectionMatrix.elements[i]));
        const forward = source.getWorldDirection(source.position.clone());
        for (const [dx, height, distance] of [[0, 80, 600], [140, 30, 1200], [-200, 140, 2000]]) {
          const point = source.position.clone().addScaledVector(forward, distance); point.x += dx; point.y = level + height;
          const image = point.clone().project(camera); point.y = 2 * level - point.y;
          const expected = point.project(source);
          geometryError = Math.max(geometryError, Math.abs(image.x - expected.x), Math.abs(image.y + expected.y));
        }
      }
      treeMeshes = 0; scene.traverseVisible(o => { if (o.isInstancedMesh && o.geometry.getAttribute('leafTint')) treeMeshes++; });
    } else {
      source = camera; restored &&= this.clippingPlanes.length === 0;
      const water = mmm.water, uniforms = water?.uniforms;
      if (uniforms) {
        reflection = uniforms.reflectionOn.value; shore = uniforms.tShore.value.image.width;
        const width = Math.min(1024, Math.ceil(r.domElement.width / 2)), height = Math.round(width * r.domElement.height / r.domElement.width);
        if (reflection && (!water.valid || water.target.width !== width || water.target.height !== height || !water.projection.equals(camera.projectionMatrix) || camera.position.y <= water.level)) invalidSamples++;
      }
    }
    const out = render.call(this, scene, camera);
    if (this.info.render.frame > firstFrame && !this.getContext().isContextLost()) {
      if (target) { mirrors++; calls.push(this.info.render.calls); triangles.push(this.info.render.triangles); } else frames++;
    }
    return out;
  };
  setTimeout(() => {
    r.render = render; terrain.withReflection = prepare;
    resolve({mirrors, frames, reflection, shore, error: r.getContext().getError(), lost: r.getContext().isContextLost(), dimensions, filters, clipped, restored,
      geometryError, projectionError, treeMeshes, extraTiles, invalidSamples, maskDraws,
      calls: calls.length ? [Math.min(...calls), Math.max(...calls)] : [], triangles: triangles.length ? [Math.min(...triangles), Math.max(...triangles)] : [],
      canvas: [r.domElement.width, r.domElement.height]});
  }, 1500);
})`);
  check(!!result && result.frames > 1 && !result.lost && result.error === 0, `sample contains completed main renders in a live context: ${JSON.stringify(result)}`);
  if (result) check(result.invalidSamples === 0, 'sampling uses only a valid image of the present size and projection, above sea level');
  return result;
};
{
  const p = await open('cam=623800,5103200,3,25,-2,60&reflections=1');
  const s = await sample(p);
  check(s.mirrors > 0 && Math.abs(s.mirrors - s.frames) <= 1, `visible water updates every frame: ${JSON.stringify(s)}`);
  check(s.geometryError < 0.000001 && s.projectionError < 0.000001, 'mirror matches reflected world points with the same perspective and a shorter far plane');
  check(s.clipped && s.restored, 'mirror sets its clip plane at sea level and restores the main scene clipping state (this reads the plane, not clipped pixels)');
  check(s.filters.every(f => f === 1006), 'mirror uses linear minification and magnification');
  check(s.dimensions[0] === Math.min(1024, Math.ceil(s.canvas[0] / 2)) && s.dimensions[1] === Math.round(s.dimensions[0] * s.canvas[1] / s.canvas[0]), 'mirror preserves canvas aspect at half width, capped at 1024');
  check(s.treeMeshes > 0, 'real single-tree shapes participate in the mirror');
  check(s.shore > 1, 'shore map is derived from the existing land-cover image');
  check(s.error === 0, 'mirror restores state without a framebuffer feedback error');
  await p.shot('church-motion-a'); await sleep(2200); await p.shot('church-motion-b');
  await p.read(`(() => { const b = [...document.querySelectorAll('#settings label')].find(l => l.textContent.includes('Water reflections')).querySelector('input'); b.click(); })()`);
  const off = await sample(p);
  check(off.mirrors === 0 && off.reflection === 0, 'settings switch stops the reflection render and sampling');
  check(await p.read(`localStorage.getItem('mmm.reflections') === '0'`), 'settings switch remembers the choice');
  await p.close();
}
{
  const p = await open('cam=623800,5103200,3,25,-2,60&reflections=1');
  const s = await sample(p);
  check(s.mirrors > 0 && s.reflection === 1, 'address reflections=1 overrides the saved off choice');
  await p.read(`localStorage.setItem('mmm.reflections', '1')`);
  await p.close();
}
{
  const p = await open('cam=623800,5103200,1.8,25,-2,60&reflections=1');
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 400, y: 450, button: 'left', buttons: 1, clickCount: 1 });
  const pair = await p.turnShots();
  check(pair!==null && pair.moved && pair.changed,'turning camera captures two distinct completed views');
  await p.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:460,y:450,button:'left',buttons:0,clickCount:1});
  console.log('mirror-turn functional capture:',JSON.stringify(pair));
  await p.close();
}
{
  const p = await open('road=Mabou%20Harbour%20Road&f=0.35&demo=5&reflections=1');
  const s = await sample(p);
  check(s.mirrors > 0 && s.calls[0] > 0 && s.triangles[0] > 0, 'harbour road mirror draw counts are available');
  console.log('MIRROR_COST harbour-road:', JSON.stringify(s));
  await p.close();
}
{
  const p = await open('road=Mabou%20Harbour%20Road&f=0.35&demo=5&reflections=1', 2);
  const s = await sample(p);
  check(s.dimensions[0] === 1024 && s.dimensions[1] === Math.round(1024 * s.canvas[1] / s.canvas[0]), 'high-density canvas caps the mirror at 1024 with matching aspect');
  console.log('MIRROR_COST harbour-road-dpr2:', JSON.stringify(s));
  await p.close();
}
{
  const p = await open('cam=623100,5104620,29.8,180,-60,60&reflections=1');
  const s = await sample(p);
  check(s.mirrors > 0 && s.extraTiles > 0 && s.restored, 'look-down mirror includes off-screen terrain and restores main visibility, materials, geometry and masks');
  await p.shot('look-down'); await p.close();
}
{
  const p = await open('cam=623800,5103200,29.8,25,-60,60&reflections=1');
  const made = await p.read(`async function addPaintedWater() {
    // The game's own three.js module (same URL, so the same instance), wherever Vite's cacheDir puts it.
    const threeUrl = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/deps/three.js'));
    if (!threeUrl) throw Error('the page loaded no Vite three.js module');
    const THREE = await import(threeUrl);
    const t = [...mmm.terrain.tiles.values()].find(t => t.mask);
    if (!t) return false;
    const geometry = new THREE.PlaneGeometry(10000, 10000).rotateX(-Math.PI/2);
    geometry.setAttribute('ground', new THREE.BufferAttribute(new Float32Array(4).fill(-0.19), 1));
    const material = t.mesh.material.clone(); material.uniforms = {...t.mesh.material.uniforms, hideQuad: {value:new THREE.Vector4()}};
    const surface = new THREE.Mesh(geometry, material); surface.position.y = -0.19; mmm.water.scene.add(surface);
    const maskMaterial = t.mask.material.clone(); maskMaterial.uniforms = material.uniforms;
    const mask = new THREE.Mesh(geometry, maskMaterial); mask.position.y = -0.19; mmm.terrain.maskScene.add(mask);
    return true;
  }; addPaintedWater()`);
  check(made, 'painted sea-level + 0.01 test surface constructed with the real terrain shader');
  await sleep(800);
  const s = await sample(p);
  const visible = await p.read('({sea:mmm.water.seaVisibility.visible,land:mmm.water.landVisibility.visible})');
  check(!visible.sea && visible.land && s.mirrors > 0 && s.reflection === 1, 'painted tidal water keeps reflections when it hides the sea mesh');
  await p.close();
}
{
  const p = await open('cam=623800,5103200,3,25,-2,60&reflections=1');
  const restored = await p.read(`new Promise(resolve => {
    const r = mmm.renderer;
    r.domElement.addEventListener('webglcontextrestored', () => resolve(true), {once:true});
    r.forceContextLoss(); setTimeout(() => r.forceContextRestore(), 500); setTimeout(() => resolve(false), 8000);
  })`);
  check(restored, 'graphics context restores'); await sleep(1200);
  const s = await sample(p);
  check(s.mirrors > 0 && s.reflection === 1, 'new visibility queries and a fresh mirror recover after context loss');
  // Exercise forced projection and size changes.
  await p.read(`mmm.camera.fov = 57; mmm.camera.updateProjectionMatrix();`);
  await p.send('Emulation.setDeviceMetricsOverride', {width:1510,height:900,deviceScaleFactor:2,mobile:false});
  const resized = await sample(p);
  check(resized.mirrors > 0 && resized.invalidSamples === 0, 'resize and projection changes force fresh images before sampling');
  // The Picture setting (web/src/picture.ts) changes the pixel ratio while the game runs, with this same call.
  await p.read(`mmm.renderer.setPixelRatio(2)`);
  const sharp = await sample(p);
  check(sharp.mirrors > 0 && sharp.invalidSamples === 0 && sharp.canvas[0] === 2 * resized.canvas[0] && sharp.dimensions[0] === Math.min(1024, Math.ceil(sharp.canvas[0] / 2)),
    `a change of pixel ratio gives a mirror of the new size before sampling: canvas ${resized.canvas} to ${sharp.canvas}, mirror ${resized.dimensions} to ${sharp.dimensions}`);
  const gates = await p.read(`(() => {
    const w = mmm.water, camera = mmm.camera.clone(); camera.position.y = w.level - 1; camera.updateMatrixWorld();
    w.update(camera); const below = w.uniforms.reflectionOn.value === 0 && !w.valid;
    w.seaVisibility.visible = w.landVisibility.visible = false; w.update(mmm.camera);
    const away = w.uniforms.reflectionOn.value === 0 && !w.valid;
    w.seaVisibility.visible = true;
    const before = mmm.renderer.info.render.frame; w.update(mmm.camera);
    return {below,away,fresh:w.valid && w.uniforms.reflectionOn.value===1 && mmm.renderer.info.render.frame>before};
  })()`);
  check(gates.below && gates.away && gates.fresh, 'below-sea, looking-away and re-entry gates reject the previous image');
  await p.close();
}
{
  const p = await open('demo=4&road=Mabou%20Mines%20Road&f=0.3&reflections=0');
  const dry = await p.read(`(() => {
    const tiles = [...mmm.terrain.tiles.values()].filter(t => t.mesh?.visible && !t.mesh.material.defines.SEA_WATER);
    return {count:tiles.length,cheap:tiles.every(t => { const p = mmm.renderer.properties.get(t.mesh.material).currentProgram; return p && !p.getUniforms().map.tReflection; })};
  })()`);
  check(dry.count > 0 && dry.cheap, 'dry tile programs have no compiled desktop reflection sampler');
  await sample(p); await p.close();
}
{
  const p = await open('cam=624350,5103370,3,45,-50,60&camground=1&reflections=1');
  const s = await sample(p);
  check(s.mirrors === 0 && s.reflection === 0, `hidden sea has no reflection renders: ${JSON.stringify(s)}`);
  await p.close();
}
{
  const p = await open('shot=3&reflections=0');
  const s = await sample(p);
  check(s.mirrors === 0 && s.reflection === 0, 'address switch disables reflections');
  check(s.shore > 1, 'shore detail remains when reflections are disabled');
  await p.close();
}
{
  const p = await open('shot=3&q=low&touch=1&reflections=1');
  check(await p.read(`![...document.querySelectorAll('#settings label')].some(l => l.textContent.includes('Water reflections'))`), 'phone constructs no reflection pass or settings switch');
  const s = await sample(p);
  check(s.mirrors === 0 && s.shore === 0, 'phone allocates no reflection target or shore map');
  await p.close();
}
exitCheck(failed ? 1 : 0);
