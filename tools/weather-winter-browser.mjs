// Matched pictures, whole-frame costs and attribution for the bounded precipitation field.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cdp, cdpFetch, sleep } from './cdp.mjs';

const [out, first] = process.argv.slice(2);
const port = process.env.CDP_PORT;
const pictures = join(out, 'evidence', 'weather-winter-browser');
mkdirSync(pictures, { recursive: true });

const views = [
  ['village', '624200.22,5103160.92,2.6,42,-3,52'],
  ['back-road', '618332.37,5102983.28,2.6,98,-3,52'],
  ['mines-road', '620072.75,5106820.43,2.6,311,-5,52'],
];
const clocks = [['noon', '12:00'], ['sunset', '16:06']];
const modes = [
  { name: 'desktop', width: 1440, height: 900, low: false },
  { name: 'phone-low', width: 844, height: 390, low: true },
];
const weather = [
  { name: 'clear', season: 'off' },
  { name: 'rain', season: 'off', rain: 'downpour' },
  { name: 'snow', season: 'date' },
];

async function capture(mode, [view, camera], [clock, time], mood, save = true) {
  const name = [mode.name, view, clock, mood.rain === 'drizzle' ? 'drizzle' : mood.name].join('-');
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const client = await cdp(tab.webSocketDebuggerUrl);
  const read = async expression => {
    const r = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.error || r.result?.exceptionDetails) throw Error(JSON.stringify(r.error ?? r.result.exceptionDetails));
    return r.result.result.value;
  };
  try {
    await client.send('Page.enable');
    await client.send('Emulation.setDeviceMetricsOverride', { width: mode.width, height: mode.height, deviceScaleFactor: 1, mobile: mode.low });
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: mode.low });
    const params = new URLSearchParams({
      site: 'just', mode: 'explore', cam: camera, camground: '1', hud: '0', radio: '0', mp: '0',
      scene: '0', res: '1', exag: '1.5', playerDate: '2026-12-21', playerTime: time, weather: mood.name,
      season: mood.season, q: mode.low ? 'low' : 'high', ...(mode.low ? { touch: '1' } : {}), ...(mood.rain ? { rain: mood.rain } : {}),
    });
    await client.send('Page.navigate', { url: new URL('/?' + params, first).href });
    const deadline = Date.now() + 130000;
    let ready = false;
    while (Date.now() < deadline) {
      if (await read("document.title.startsWith('settled') && !!window.mmm?.terrain && !mmm.terrain.pending && !mmm.trees?.pending").catch(() => false)) {
        ready = true;
        break;
      }
      await sleep(400);
    }
    assert.ok(ready, name + ' settled ground and trees');
    const state = await read(`(()=>{
      const m=mmm.precipitationMesh,t=mmm.terrain, [e,n]=${JSON.stringify(camera.split(',').slice(0, 2).map(Number))};
      const [ve,vn]=t.manifest.village, s=t.surfaceAt(e-ve,vn-n);
      return {low:mmm.low, view:mmm.camera.position.toArray(), wet:t.uniforms.rainWet?.value??0,
        winter:t.uniforms.winterCover?.value??0, washboard:s?.washboard??false,
        particles:m?.geometry.instanceCount??0, depth:m?[m.material.depthTest,m.material.depthWrite,m.castShadow]:null};
    })()`);
    const falling = mood.name !== 'clear';
    assert.equal(state.low, mode.low);
    assert.equal(state.winter, Number(mood.name === 'snow'));
    assert.equal(state.wet, mood.name === 'rain' ? (mood.rain === 'drizzle' ? 0.35 : 1) : 0);
    if (view === 'mines-road') assert.equal(state.washboard, true, name + ' road keeps its washboard');
    assert.equal(state.depth !== null, falling);
    if (falling) assert.deepEqual(state.depth, [true, false, false]);
    const limit = mode.low ? (mood.name === 'snow' ? 620 : 480) : (mood.name === 'snow' ? 1400 : 1100);
    if (falling) assert.equal(state.particles, mood.rain === 'drizzle' ? Math.round(limit * 0.35) : limit);
    else assert.equal(state.particles, 0);

    const frames = await read(`new Promise(resolve=>{
      const renderer=mmm.renderer,info=renderer.info,mesh=mmm.precipitationMesh,rows=[];
      let ownCalls=0,ownTris=0,beforeCalls=0,beforeTris=0;
      if(mesh){
        mesh.onBeforeRender=()=>{beforeCalls=info.render.calls;beforeTris=info.render.triangles;};
        mesh.onAfterRender=()=>{ownCalls+=info.render.calls-beforeCalls;ownTris+=info.render.triangles-beforeTris;};
      }
      info.autoReset=false;
      const tick=()=>{
        if(info.render.calls) rows.push({calls:info.render.calls,triangles:info.render.triangles,
          textures:info.memory.textures,programs:info.programs.length,ownCalls,ownTris});
        ownCalls=ownTris=0;info.reset();
        if(rows.length<25) requestAnimationFrame(tick);
        else { info.autoReset=true; resolve(rows.slice(1)); }
      };
      requestAnimationFrame(tick);
    })`);
    assert.ok(frames.every(({ ownCalls, ownTris }) => ownCalls === Number(falling) && ownTris === 2 * state.particles),
      name + ' submits one weather draw in the camera pass, with exactly two triangles per particle');
    const peak = Object.fromEntries(Object.keys(frames[0]).map(key => [key, Math.max(...frames.map(frame => frame[key]))]));
    const failures = client.logs.filter(line => /Shader Error|VALIDATE_STATUS|GL_INVALID_OPERATION|could not be merged/.test(line));
    assert.deepEqual(failures, [], name + ' GPU and mesh errors');
    if (save) {
      const result = await client.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(pictures, name + '.png'), Buffer.from(result.result.data, 'base64'));
    }
    const brake = view === 'village' && clock === 'noon' && mood.name !== 'rain' ? await read(`(()=>{
      const v=mmm.vehicle,t=mmm.terrain, [e,n,,az]=${JSON.stringify(camera.split(',').map(Number))};
      const [ve,vn]=t.manifest.village, heading=az*Math.PI/180;
      if(!v.place(e-ve,vn-n,heading)) throw Error('village road brake position refused');
      v.assist=0;
      v.vx=13*Math.sin(heading);v.vz=-13*Math.cos(heading);v.speed=13;
      for(let i=0;i<24;i++) v.update(1/120,{throttle:-1,steer:0,handbrake:false,touch:${mode.low}});
      return { surface:v.surfaceName, speed:v.speed };
    })()`) : undefined;
    return { name, ...state, ...peak, brake };
  } finally {
    client.close();
    await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {});
  }
}

const rows = [];
for (const mode of modes) {
  for (const view of views) for (const clock of clocks) {
    const group = [];
    for (const mood of weather) {
      const row = await capture(mode, view, clock, mood);
      const control = group[0] ?? row;
      assert.deepEqual(row.view, control.view, row.name + ' matches the clear camera');
      if (row.brake) {
        assert.equal(row.brake.surface, 'pavement', row.name + ' brakes on paved Highway 19');
        if (mood.name === 'snow') {
          assert.ok(row.brake.speed > control.brake.speed, row.name + ' grips less on snow');
          assert.ok(row.brake.speed < 13, row.name + ' still brakes on snow');
          console.log(row.name, 'brake speed, clear/snow', control.brake.speed.toFixed(3), row.brake.speed.toFixed(3), 'm/s');
        }
      }
      console.log(row.name, `${row.calls} draws (${row.ownCalls} weather), ${row.triangles} tris (${row.ownTris} weather), ${row.textures} textures, ${row.programs} programs`);
      row.delta = Object.fromEntries(['calls', 'triangles', 'textures', 'programs'].map(key => [key, row[key] - control[key]]));
      group.push(row);
      rows.push(row);
      writeFileSync(join(pictures, 'frames.json'), JSON.stringify(rows, null, 2) + '\n');
    }
  }
  const drizzle = await capture(mode, views[0], clocks[0], { name: 'rain', season: 'off', rain: 'drizzle' }, false);
  const downpour = rows.find(r => r.name === mode.name + '-village-noon-rain');
  assert.ok(drizzle.ownTris < downpour.ownTris && drizzle.wet < downpour.wet, mode.name + ' drizzle is lighter than downpour');
  console.log(drizzle.name, `${drizzle.ownCalls} weather draw, ${drizzle.ownTris} weather triangles`);
  rows.push(drizzle);
  writeFileSync(join(pictures, 'frames.json'), JSON.stringify(rows, null, 2) + '\n');
}
