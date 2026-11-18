// Ambient traffic in a real browser with hardware WebGL (behaviour is tools/ambient-traffic-check.mjs, in Node):
// 1. the pool's draw cost, desktop and LOW, pinned exactly;
// 2. the real game at Mabou with trafficCheck=1: the baked highways join into long roads, cars spawn while the page
//    loads, and four cars stand on Highway 19 in view, with a picture;
// 3. the main.ts gates: no traffic in 1884, with traffic=0, or on a plain dev visit.
// Numbers and the picture go to $MMM_CHECK_OUT/evidence/ambient-traffic-browser/, which check-all keeps after a pass.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { cdp, cdpFetch } from './cdp.mjs';
const port = process.env.CDP_PORT ?? '9333';
const evidence = process.env.MMM_CHECK_OUT ? join(process.env.MMM_CHECK_OUT, 'evidence', 'ambient-traffic-browser') : null;
if (evidence) mkdirSync(evidence, { recursive: true });
let tab, client;
try {
  tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, {method:'PUT'})).json();
  client = await cdp(tab.webSocketDebuggerUrl, {deadline:30000});
  const {send} = client;
  const read = async expression => { const r = await send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true}); assert.ok(!r.result.exceptionDetails, JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  const origin = new URL(process.argv[3] || process.argv[2] || 'http://127.0.0.1:5183').origin;
  const open = async query => {
    await send('Page.navigate', {url:origin+'/?'+query});
    for (let i = 0; i < 240; i++) { await new Promise(r=>setTimeout(r,500)); if (await read('document.title') === 'settled') return; }
    assert.fail('game page did not settle: ?'+query);
  };
  const report = {};

  // 1. Pool draw cost: every slot drawn at a known visible pose.
  await send('Page.navigate', {url:origin});
  await new Promise(r=>setTimeout(r,5000));
  report.pool = await read(`(async()=>{
    const T=await import('/node_modules/three/build/three.module.js');
    const {AmbientTraffic}=await import('/src/ambient-traffic.ts');
    const renderer=new T.WebGLRenderer(); renderer.setSize(400,300);
    const gl=renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info');
    const gpu=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    const results=[];
    for(const low of [false,true]) {
      const traffic=new AmbientTraffic({roads:[{kind:1,halfWidth:3.6,bridge:false,pts:[[0,0],[0,-1000]]}],deckHeight:()=>null},{heightAt:()=>0},low);
      const scene=new T.Scene();scene.add(traffic.group,new T.AmbientLight(0xffffff));
      const camera=new T.PerspectiveCamera(60,4/3,.1,2000);camera.position.set(0,40,40);camera.lookAt(0,0,-100);camera.updateMatrixWorld();
      traffic.group.children.forEach((m,i)=>{m.visible=true;m.position.set(i*5,0,-20);});
      renderer.render(scene,camera);
      results.push({low,cars:traffic.group.children.length,triangles:renderer.info.render.triangles,calls:renderer.info.render.calls});
    }
    renderer.dispose();return {gpu,results};
  })()`);
  assert.ok(!/swiftshader|llvmpipe|software/i.test(report.pool.gpu), report.pool.gpu);
  for (const r of report.pool.results) {
    assert.equal(r.cars, r.low ? 2 : 4, 'pool size');
    assert.equal(r.calls, r.cars, 'one draw call per car');
    assert.equal(r.triangles, r.low ? 456 : 912, 'pinned traffic triangles (228 per car)');
  }

  // 2. The real game at Mabou. The camera stands beside Highway 19 north of the village, looking along it.
  await open('trafficCheck=1&hour=14&exag=1.5&hud=0&cam=627029.8,5107096.1,5,332,-7,55&camground=1');
  report.game = await read(`(() => {
    const m=mmm,t=m.ambientTraffic;if(!t)return {error:'no traffic in the game with trafficCheck=1'};
    const spawned=t.cars.filter(c=>c.active).length;
    const chains=t.paths.filter((_,i)=>i%2===0).map(p=>Math.round(p.cumulative.at(-1)));
    const f=m.camera.getWorldDirection(new (m.camera.position.constructor)());
    const x=m.camera.position.x+f.x*40,z=m.camera.position.z+f.z*40;
    let best=null,distance=Infinity;
    t.paths.forEach((path,index)=>{const along=path.alongAt(x,z),pose={x:0,z:0,heading:0};path.at(along,0,pose);const d=Math.hypot(pose.x-x,pose.z-z);if(d<distance){distance=d;best={index,along};}});
    t.update=()=>{};t.step=()=>{};
    const ahead=t.paths[best.index],back=t.paths[best.index^1],length=ahead.cumulative.at(-1);
    [[ahead,best.along-5],[ahead,best.along+25],[back,length-best.along-15],[back,length-best.along+20]].forEach(([path,along],i)=>{const c=t.cars[i];c.path=path;c.along=along;c.speed=12;c.active=true;path.at(along,1.65,c.solid);t.place(c);});
    return {spawned,chains,roadGap:distance,cars:t.cars.map(c=>({visible:c.mesh.visible,y:+c.mesh.position.y.toFixed(2),pitch:+c.mesh.rotation.z.toFixed(3)}))};
  })()`);
  const game = report.game;
  assert.ok(game && !game.error, JSON.stringify(game));
  assert.ok(game.spawned > 0, 'no car spawned while the page loaded');
  assert.ok(game.chains.length >= 2 && game.chains[0] > 15000, 'Mabou highways must join into long roads: ' + JSON.stringify(game.chains));
  assert.ok(game.roadGap < 15, 'camera target not on a highway: ' + game.roadGap);
  assert.ok(game.cars.every(c => c.visible), 'every placed car stands on loaded ground');
  await new Promise(r=>setTimeout(r,1500));
  if (evidence) { const shot = await send('Page.captureScreenshot', {format:'png'}); writeFileSync(join(evidence, 'traffic-highway19.png'), Buffer.from(shot.result.data, 'base64')); }

  // 3. The gates in main.ts: each of these pages has no traffic object at all.
  report.gates = {};
  for (const [name, query] of [['1884', 'era=1884&trafficCheck=1&hour=14'], ['traffic=0', 'trafficCheck=1&traffic=0&hour=14'], ['plain dev visit', 'hour=14']]) {
    await open(query);
    report.gates[name] = await read(`Object.hasOwn(mmm,'ambientTraffic') ? (mmm.ambientTraffic === null ? 'none' : 'TRAFFIC') : 'key missing'`);
    assert.equal(report.gates[name], 'none', `${name}: traffic must be off (?${query})`);
  }
  console.log('TRAFFIC ' + JSON.stringify(report));
  if (evidence) writeFileSync(join(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n');
} finally {
  if(tab) await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});
  client?.close?.();
}
