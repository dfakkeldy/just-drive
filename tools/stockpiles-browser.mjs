#!/usr/bin/env node
// The two Point Tupper stockpiles in the real game, HIGH and LOW: drawn, seated on the drawn land, culled far
// away, within their budgets, shaders built before first sight, and their cost in frame time (piles shown against
// piles hidden, same page and view). Dev server only. Run with FREE_RUN=1, or the frame times only show the limit.
//   FREE_RUN=1 RUN=stockpiles-browser.mjs VIEWS="stockpiles|area=pointtupper" tools/yard-shots.sh 1280 720
// Before the pack is installed in the land, the committed pack is served to the page (tools/stockpiles-pack.mjs).
// Numbers go to $MMM_CHECK_OUT/evidence/stockpiles-browser/results.json, which check-all keeps after a pass.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cdp, cdpFetch, sleep, exitCheck } from './cdp.mjs';
import { stockpilePack } from './stockpiles-pack.mjs';
const [, first] = process.argv.slice(2), port = process.env.CDP_PORT ?? '9333', origin = new URL(first).origin;
const evidence = process.env.MMM_CHECK_OUT ? join(process.env.MMM_CHECK_OUT, 'evidence', 'stockpiles-browser') : null;
// A stand on a mapped track beside each pile, facing it (east, north, compass heading).
const STANDS = { 'DAPI40/3718': [629076.0, 5049258.0, 209], 'DASA42/1039': [628516.4, 5050829.6, 123] };
const pack = await stockpilePack(origin);
console.log('DATA', pack.data);
const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const c = await cdp(tab.webSocketDebuggerUrl, { onEvent: pack.onEvent });
const read = async expression => (await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result.value;
const until = async (expression, label, polls = 480) => {
  for (let i = 0; i < polls; i++) { if (await read(`(()=>{try{return !!(${expression});}catch{return false;}})()`)) return; await sleep(250); }
  throw Error(`timeout: ${label}`);
};
const rows = [];
try {
  await c.send('Page.enable'); await pack.enable(c);
  for (const quality of ['high', 'low']) {
    const base = `${origin}/?mode=explore&area=pointtupper&mp=0&radio=0&hud=0&q=${quality}`;
    // 1. The area's own start is far from both piles: they are hidden, and their shaders are built all the same.
    await c.send('Page.navigate', { url: `${base}&name=far-${quality}` });
    await until(`document.documentElement.dataset.mmmReady==='true' && mmm.stockpiles?.sites.length===2`, `${quality}: game ready with both piles`);
    await sleep(800);
    const far = await read(`(()=>{const s=mmm.stockpiles,r=mmm.renderer,v=mmm.terrain.manifest.village;
      return s.sites.map(site=>({id:site.id,visible:site.group.visible,refits:site.refits,
        metres:Math.round(Math.hypot(mmm.vehicle.x-(site.center[0]-v[0]),mmm.vehicle.z-(v[1]-site.center[1]))),
        built:site.group.children.map(m=>!!r.properties.get(m.material).currentProgram),culled:site.group.children.map(m=>m.frustumCulled)}));})()`);
    for (const site of far) {
      assert.ok(site.metres > 1300 && !site.visible && site.refits === 0, `${quality} ${site.id}: hidden and not seated ${site.metres} m away`);
      assert.ok(site.built.every(Boolean), `${quality} ${site.id}: shaders built with the scene, before first sight`);
      assert.ok(site.culled.every(Boolean), `${quality} ${site.id}: culled as usual after the first pass`);
    }
    // 2. Beside each pile.
    for (const [id, stand] of Object.entries(STANDS)) {
      await c.send('Page.navigate', { url: `${base}&name=${quality}-${id.replace('/', '-')}&at=${stand.join(',')}` });
      await until(`document.documentElement.dataset.mmmReady==='true' && mmm.stockpiles?.sites.length===2`, `${quality} ${id}: game ready`);
      await read(`(()=>{window.__pile=mmm.stockpiles.sites.find(site=>site.id===${JSON.stringify(id)});window.__draws=__pile.group.children.map(()=>0);__pile.group.children.forEach((m,i)=>{m.onBeforeRender=()=>{__draws[i]++;};});})()`);
      await until(`__pile.group.visible && __draws.every(n=>n>3)`, `${quality} ${id}: every pile mesh drawn in the view from the track`);
      await sleep(1200);
      const state = await read(`(()=>{const s=mmm.stockpiles,t=mmm.terrain,site=__pile,kind=s.data.piles.find(p=>p.id===site.id).kind,meshes=site.group.children;
        const lift=(x,y,z)=>{const g=t.meshHeightAt(x,z,true);return g===null?null:y-g;};
        const out={quality:'${quality}',id:${JSON.stringify(id)},kind,meshes:meshes.length,instances:0,triangles:0,textures:0,refits:site.refits,foot:0,body:0,odd:0,unread:0,stubLow:0,stubs:0,
          placed:Math.hypot(mmm.vehicle.x-(${stand[0]}-t.manifest.village[0]),mmm.vehicle.z-(t.manifest.village[1]-${stand[1]}))};
        for(const m of meshes){
          out.triangles+=m.geometry.index.count/3*(m.isInstancedMesh?m.count:1);if(m.material.map)out.textures++;
          if(m.isInstancedMesh){out.instances+=m.count;const a=m.instanceMatrix.array;for(let i=0;i<m.count;i++){const y=lift(a[i*16+12],a[i*16+13],a[i*16+14]);if(y===null)out.unread++;else{out.stubs++;if(y<0.15||y>12.5)out.stubLow++;}}continue;}
          const p=m.geometry.getAttribute('position'),foot=kind==='coal'?-0.35:-0.3,lo=kind==='coal'?0.13:1.19,hi=kind==='coal'?0.51:12.01;
          for(let i=0;i<p.count;i++){const y=lift(p.getX(i),p.getY(i),p.getZ(i));if(y===null)out.unread++;else if(Math.abs(y-foot)<0.02)out.foot++;else if(y>=lo&&y<=hi)out.body++;else out.odd++;}
        }
        const t0=performance.now();for(let i=0;i<200;i++)site.fit();out.probeMs=(performance.now()-t0)/200;out.refitsAfterProbes=site.refits;
        const t1=performance.now();for(let i=0;i<5;i++)site.fit(true);out.seatMs=(performance.now()-t1)/5;out.tiles=t.tiles?.size??null;
        // The land draws only the tiles in view. With every tile out of the picture (as after a turn of the camera)
        // the pile must stay as it is: not read again, not moved. The land sets the tiles again on its next frame.
        const heights=()=>meshes.flatMap(m=>m.isInstancedMesh?[]:Array.from(m.geometry.getAttribute('position').array)),before=heights(),refits=site.refits;
        const shown=[...t.tiles.values()].filter(q=>q.mesh?.visible);out.tilesInView=shown.length;
        for(const q of shown)q.mesh.visible=false;
        site.fit();out.unseenRefits=site.refits-refits;
        site.fit(true);const after=heights();out.unseenMoved=before.reduce((worst,y,i)=>Math.max(worst,Math.abs(y-after[i])),0);
        for(const q of shown)q.mesh.visible=true;
        site.fit();out.backRefits=site.refits-refits-1;
        return out;})()`);
      assert.ok(state.tilesInView > 0 && state.unseenRefits === 0 && state.backRefits === 0, `${quality} ${id}: land that leaves the picture and comes back does not seat the pile again (${state.unseenRefits}, ${state.backRefits})`);
      assert.equal(state.unseenMoved, 0, `${quality} ${id}: a pile seated on the drawn land keeps its place while that land is out of the picture`);
      assert.ok(state.placed < 8, `${quality} ${id}: the car stands on the asked track point`);
      assert.ok(state.textures === 0 && state.meshes <= 2, `${quality} ${id}: at most a skin and a stub batch, no textures`);
      assert.ok(state.instances <= (quality === 'low' ? 384 : 1536) && state.triangles < (quality === 'low' ? 10000 : 50000), `${quality} ${id}: within the instance and triangle budget`);
      assert.ok(state.foot > 20 && state.body > state.foot, `${quality} ${id}: skin read on the drawn land (${JSON.stringify(state)})`);
      assert.equal(state.odd, 0, `${quality} ${id}: no skin vertex floats above or sinks into the drawn land (${JSON.stringify(state)})`);
      assert.equal(state.stubLow, 0, `${quality} ${id}: no stub log under the drawn land`);
      assert.ok(state.refits >= 1 && state.refits <= 12 && state.refitsAfterProbes === state.refits, `${quality} ${id}: seated a few times while the land loaded (${state.refits}), then never again on unchanged land`);
      assert.ok(state.seatMs < 30, `${quality} ${id}: a full seat costs ${state.seatMs.toFixed(2)} ms (limit 30; it runs only when the land under the pile changes detail)`);
      assert.ok(state.probeMs < 1, `${quality} ${id}: the pass on unchanged land costs ${state.probeMs.toFixed(3)} ms (limit 1)`);
      // 3. Frame time with the piles shown and hidden, as 48 pairs of 8-frame blocks (four frames run before each
      // block, so frames queued in the GPU from the other arm drain first; the order in a pair alternates). Other
      // work on a shared GPU moves the frame time in steps that last for seconds, so two long turns can sit on
      // different steps. The two blocks of a pair are at most a few tenths of a second apart and see the same step;
      // the cost is the median of the differences in the pairs. Every shown block must draw every pile mesh, so a
      // pile that stops drawing cannot pass as free.
      const timing = await read(`(async()=>{const block=frames=>new Promise(done=>{let n=-4,t0=0,d0=[];const tick=()=>{if(n===0){t0=performance.now();d0=__draws.slice();}if(n===frames){const each=__draws.map((d,i)=>(d-d0[i])/frames);done([(performance.now()-t0)/frames,each.reduce((a,b)=>a+b,0),Math.min(...each)]);return;}n++;requestAnimationFrame(tick);};requestAnimationFrame(tick);});
        const pairs=[],draws=[],least=[],turn=async show=>{mmm.stockpiles.group.visible=show;const [ms,drawn,fewest]=await block(8);if(show){draws.push(drawn);least.push(fewest);}return ms;};
        for(let pair=0;pair<48;pair++){let shown,hidden;if(pair%2){hidden=await turn(false);shown=await turn(true);}else{shown=await turn(true);hidden=await turn(false);}pairs.push([shown,hidden]);}
        mmm.stockpiles.group.visible=true;
        return {pairs,drawsPerFrame:Math.max(...draws),meshDrawsMin:Math.min(...least)};})()`);
      const median = list => list.slice().sort((x, y) => x - y)[Math.floor(list.length / 2)];
      timing.shownMs = median(timing.pairs.map(pair => pair[0])); timing.hiddenMs = median(timing.pairs.map(pair => pair[1]));
      timing.costMs = median(timing.pairs.map(pair => pair[0] - pair[1]));
      timing.pairs = timing.pairs.map(pair => pair.map(ms => Math.round(ms * 100) / 100));
      assert.ok(timing.drawsPerFrame <= 2 * state.meshes + 0.2, `${quality} ${id}: ${timing.drawsPerFrame.toFixed(2)} pile draw calls a frame`);
      assert.ok(timing.meshDrawsMin >= 0.75, `${quality} ${id}: every pile mesh drawn in every shown block (the fewest for one mesh in one block: ${timing.meshDrawsMin.toFixed(2)} draw calls a frame)`);
      assert.ok(timing.costMs <= timing.hiddenMs * 0.25 + 0.5, `${quality} ${id}: the pile costs under a quarter of a frame (${timing.costMs.toFixed(2)} ms more in the median pair; medians ${timing.shownMs.toFixed(2)} ms shown, ${timing.hiddenMs.toFixed(2)} ms hidden)`);
      // 4. Far away the pile leaves the picture.
      assert.ok(await read(`(()=>{const s=mmm.stockpiles;s.next=0;s.update({x:1e6,z:1e6});const gone=s.sites.every(site=>!site.group.visible);s.next=0;return gone;})()`), `${quality} ${id}: distant piles culled`);
      const row = { ...state, ...timing }; rows.push(row);
      console.log('PASS', JSON.stringify(row));
    }
  }
  if (evidence) { mkdirSync(evidence, { recursive: true }); writeFileSync(join(evidence, 'results.json'), JSON.stringify({ data: pack.data, gpu: await read(`(()=>{const gl=mmm.renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown';})()`), rows }, null, 2) + '\n'); }
  c.assertHealthy();
  console.log('PASS stockpiles HIGH and LOW: drawn, seated, budgets, shaders prebuilt, frame cost and culling');
} finally { await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {}); c.close(); }
exitCheck(0);
