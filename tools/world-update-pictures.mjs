// Fixed-ending A/B replay on one warmed scene: the exact main drawEnding body and the real branch frame.
// Sharing the scene gives both paths identical seed, camera, object/material/geometry IDs and loaded assets.
// Independence audit (f7428e7, including update callees): both ending-only positions are retained.
// Trees reads terrain.drawnFine, camera, contact heights/clear/coast rules and its tile data. It writes its
// eye, tile queues/counters, batches and own group. Coast reads camera, terrain meshes/heights/revision and
// shadow references; it writes own group/instances and terrain coastRecessAnchor shader values. Tree
// contact sampling does not read that shader anchor. Both reach Terrain.find/meshHeightAt -> use, which
// reads/writes shared lastUsed/countedFrame/wantedCount. This fails the requested strict no-shared-write
// proof even though use normally makes idempotent marks. Trees keeps its ending anchor (after the terrain updates) before coast.
// Quarry reads camera, vehicle x/z/roadName/surfaceName and terrain mesh visibility/heights. It writes
// vehicle.roadName, own water/fixtures/rocks/solids and terrain quarryReflectionLevel. Trees reads neither
// that uniform nor the vehicle/quarry state, but shares Terrain.use bookkeeping with quarry sampling.
// QuarryWater.prepareLand also changes contact geometry during construction/loading (not update).
// Trees' same anchor keeps it before quarry, too.
// Fishing reads camera.position, vehicle x/z, own art and terrain.surfaceAt for its first build. It writes
// own art/group/solids AND FishingSite.top/toe. Props reads camera world position, time, own motion/cells
// and terrain height/surface; it writes own groups/instances/wires/timers and shares Terrain.use records.
// Crucially Terrain.heightAt -> withDeck -> FishingSite.deckHeight reads top/toe written by fishing.build.
// Props can therefore observe fishing's new deck in the same frame. Props keeps its ending anchor (after roads and canal).
// Fishing dt=0 does not advance phase or move camera/vehicle. Props.getWorldPosition refreshes camera
// matrices (and parent matrices, when present); it does not change camera position or orientation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import ts from '../web/node_modules/typescript/lib/typescript.js';
import { transformSync } from '../web/node_modules/esbuild/lib/main.js';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
import { compareCaptures } from './world-update-fixture.mjs';
const [out, first] = process.argv.slice(2), port = process.env.CDP_PORT;
const audit = process.env.MMM_WORLD_AUDIT;
if (!audit) throw new Error('world-update-pictures is an audit: set MMM_WORLD_AUDIT=<revision>, for example f7428e7');
const source = execFileSync('git', ['show', `${audit}:web/src/main.ts`], { encoding: 'utf8' });
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const old = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'drawEnding').getText(ast);
const oldJS = transformSync(old, { loader: 'ts' }).code;
const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const c = await cdp(tab.webSocketDebuggerUrl, { deadline: 180000 });
const read = async expression => (await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result.value;
const rows = [];
try {
  await c.send('Page.enable');
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `let seed=314159;Math.random=()=>((seed=Math.imul(seed,1664525)+1013904223|0)>>>0)/4294967296;` });
  for (const low of [false, true]) for (const site of ['wharf', 'coast', 'quarry']) {
    const query = site === 'wharf' ? 'at=wharf-road&cam=618710,5104885,125,180,-40,55' : site === 'coast' ? 'cam=618976,5109274,25,235,-17,64&camground=1' : 'area=westbay&at=sugar-camp&quarry=1';
    const url = new URL(`/?${query}&q=${low ? 'low' : 'high'}&title=1&hud=0&radio=0&res=1&shadows=0`, first).href;
    await c.send('Page.navigate', { url });
    let ready = false;
    for (let n = 0; n < 480; n++) {
      await sleep(250);
      if (await read("!!window.mmm && document.documentElement.dataset.mmmReady==='true'")) { ready = true; break; }
    }
    assert.ok(ready, 'settled ' + site);
    const liveCost=await read('mmm.cost');
    assert.ok(liveCost && Object.values(liveCost).some(n=>Number.isFinite(n)&&n>0), 'dev server measures positive update milliseconds');
    await read(`window.requestAnimationFrame=fn=>{if(fn.name==='frame')window.g14Frame=fn;return 0}`);
    for (let n = 0; n < 40 && !await read('!!window.g14Frame'); n++) await sleep(100);
    assert.ok(await read('!!window.g14Frame'), 'captured real branch frame');
    await read(`(async()=>{
      const {camera,terrain,renderer:r,endings,scene}=mmm;
      if (${JSON.stringify(site)}==='quarry') {
        const box=mmm.quarry.site.box,x=(box[0]+box[2])/2,z=(box[1]+box[3])/2;
        camera.position.set(x+100,terrain.heightAt(x,z)+160,z+220);camera.lookAt(x,terrain.heightAt(x,z)+20,z);
      }
      // Real shared ending controller; West Bay has no product ending, so its quiet controller is held busy.
      if(endings.begin) {
        if (${JSON.stringify(site)}==='wharf') { if(!mmm.fishing.art)throw Error('wharf art missing');mmm.fishing.takeJob();endings.update(12); }
        else {const pos=camera.position.clone(),q=camera.quaternion.clone();endings.begin({key:'g14-fixed',title:'Fixed world frame',lines:['G14 ordering proof'],camera:()=>{camera.position.copy(pos);camera.quaternion.copy(q)}});}
        const update=endings.update;endings.update=()=>update.call(endings,0);
      } else {endings.busy=true;}
      const sky=scene.children.find(o=>o.isSky);if(!sky)throw Error('real sky missing');
      const ctx={...mmm,sky,radio:mmm.radio??null,LOW:mmm.low,scenePaused:()=>true,pad:null,waterReflections:mmm.water};
      window.g14={old:new Function('context',${JSON.stringify(`with(context){${oldJS};return drawEnding;}`)})(ctx),now:performance.now()};
      // Settle the same ending camera with the real branch path before either measurement.
      for(let n=0;n<500;n++){
        g14.now+=50;g14Frame(g14.now);await new Promise(r=>setTimeout(r,30));
        if(n>30 && !terrain.pending && !(mmm.trees?.pending??0) && !(mmm.grass?.pending??0))break;
      }
      if(terrain.pending || (mmm.trees?.pending??0))throw Error('ending land/trees did not settle');
      terrain.uniforms.time.value=120;
      Object.defineProperty(performance,'now',{value:()=>120000,configurable:true});
      g14.calls=[];g14.pixels=null;
      scene.traverse(o=>{if(!o.isMesh)return;const prior=o.onBeforeRender;o.onBeforeRender=function(renderer,scene,cam,geometry,material,group){g14.calls.push([o.id,material.id,geometry.id,cam.id,group?.start??0]);return prior.apply(this,arguments)};});
      const render=r.render;
      r.render=function(scene,cam){render.apply(this,arguments);if(scene===mmm.scene && cam===camera && r.getRenderTarget()===null){const gl=r.getContext(),pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);if(gl.getError()!==gl.NO_ERROR)throw Error('readPixels failed');g14.pixels=pixels;g14.png=r.domElement.toDataURL('image/png');}};
      g14.capture=async path=>{
        g14.calls=[];g14.pixels=null;if(mmm.props)mmm.props.nextUpdate=0;
        if(path==='main')g14.old(0);else {g14.now+=50;g14Frame(g14.now);}
        if(!g14.pixels)throw Error('missing final render');
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',g14.pixels)),x=>x.toString(16).padStart(2,'0')).join('');
        const colors=new Set();for(let i=0;i<g14.pixels.length;i+=4)colors.add(g14.pixels[i]+','+g14.pixels[i+1]+','+g14.pixels[i+2]);
        return {hash,calls:g14.calls,colors:colors.size,png:g14.png,camera:[...camera.position.toArray(),...camera.quaternion.toArray()]};
      };
    })()`);
    const captures = [];
    for (const path of ['main', 'branch', 'main', 'branch']) captures.push(await read(`g14.capture(${JSON.stringify(path)})`));
    assert.ok(captures.every(x => x.colors > 50), site + ' nonblank pixels');
    assert.deepEqual(captures[0].camera, captures[1].camera, 'same ending camera');
    const proof = compareCaptures(captures, site + (low ? ' LOW' : ' high'));
    assert.ok(captures[0].calls.length > 0, 'real draws');
    const cost = await read('mmm.cost');
    assert.ok(cost && Number.isFinite(cost.terrain) && Number.isFinite(cost.mirror), 'dev server exposes measured mmm.cost');
    const active = await read(`({trees:mmm.trees?.count??0,coast:mmm.coast?.mesh.count??0,quarry:mmm.quarry?.fixtures.visible??false,fishing:mmm.fishing?.group.visible??false,clipping:mmm.renderer.localClippingEnabled,low:mmm.low})`);
    assert.equal(active.clipping, active.low && active.fishing, 'clipping follows fishing visibility');
    if(site==='wharf')assert.ok(active.fishing,'visible wharf');
    if(site==='coast')assert.ok(active.coast>0,'visible coast rocks');
    if(site==='quarry')assert.ok(active.quarry,'visible quarry fixtures');
    const row = { site, low, proof, hash: captures[0].hash, draws: captures[0].calls.length, active };
    rows.push(row);console.log('WORLD_ENDING_PROOF ' + JSON.stringify(row));
    for(const [i,path] of ['main','branch'].entries())writeFileSync(`${out}/g14-${site}-${low?'low':'high'}-${path}.png`,Buffer.from(captures[i].png.split(',')[1],'base64'));
  }
  writeFileSync(`${out}/g14-ending-proof.json`, JSON.stringify(rows, null, 2));
} finally { c.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); }
