// The night look's picture sheet and its browser check, through the light study (?date=&time=).
// Five scenes (dusk, night in Mabou village, night on Highway 19, the Highland bull in the head lamps, a yard lamp), in the chase
// and the driver's view, at desktop size (full detail) and phone size (phone detail, touch). Each page must compile
// every shader, carry its head lamp beams, and (where it should) its lamp pools and the bull.
// First, day pages (no study, the study at noon and 12 minutes before sunset, a phone mail page) must build none of it.
//   OUT="$PWD/data/work/night" RUN=night-shots.mjs tools/yard-shots.sh 1400 900
//   NIGHT_ONLY=bull,village limits the scenes; NIGHT_SIZES=desktop limits the sizes; NIGHT_PHONE_DPR=3 takes the phone
//   frames at a real phone's pixel ratio (the default 1 keeps the check fast). With NIGHT_ONLY the day pages are skipped.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { open, sleep } from './cdp.mjs';
const root = resolve(import.meta.dirname, '..');
const [out, first] = process.argv.slice(2), origin = new URL(first).origin;
mkdirSync(out, { recursive: true });
const data = JSON.parse(readFileSync(resolve(root, 'data/baked/terrain/roads.json')));
const [VE, VN] = JSON.parse(readFileSync(resolve(root, 'data/baked/terrain/manifest.json'))).village;
/** A pose `along` metres down a road's line, facing forward (dir 1) or back toward its start (dir -1). */
function station(id, along, dir = 1) {
  const road = data.roads.find(r => r.id === id), pts = dir > 0 ? road.pts : [...road.pts].reverse();
  let left = along;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dn = b[1] - a[1], len = Math.hypot(dx, dn);
    if (left <= len || i === pts.length - 1) { const t = Math.min(1, left / len); return [a[0] + dx * t, a[1] + dn * t, Math.atan2(dx, dn) * 180 / Math.PI]; }
    left -= len;
  }
}
// Mabou, 10 October 2026. Sunset is 18:32; at 18:50 the sun is 4.5° down (civil twilight); at 21:30 it is full night.
const SCENES = [
  // Highway 19 out of the village toward the south-west: the last light is ahead, over the hills.
  { id: 'dusk', time: '18:50', at: station(25, 1500, -1).join(','), pools: false },
  // Highway 19 into the village from the south-west, two street lamps ahead.
  { id: 'village', time: '21:30', at: station(25, 6600).join(','), pools: true },
  // Highway 19 in the country, 4 km out: only the head lamps and the stars.
  { id: 'highway', time: '21:30', at: station(25, 2600).join(','), pools: false },
  // Mabou Mines Road heading north on the washboard: the bull is ahead on the left, 14 m on (guardrail-night-shots.mjs).
  { id: 'bull', time: '21:30', at: station(55, 5493.73 - 14).join(','), pools: false, bull: true },
  // An invented yard lamp on a country road, a few hundred metres ahead (found on the page: yardPose below).
  { id: 'yard', time: '21:30', at: null, pools: false, yard: true },
];
/** Page code: 'seen' when the lamp at world [x, z] shows its glow here. The view is drawn with and without the glow and
 * the pixels around the lamp's place on the screen compared (a hill, a bank or a tree in front leaves them the same). */
const glowSeen = ([x, z]) => `(()=>{const l=mmm.night.lamps.find(l=>Math.abs(l.x-(${x}))<.01&&Math.abs(l.z-(${z}))<.01);
  if(!l||l.glowY===null)return 'no glow placed';const r=mmm.renderer,gl=r.getContext(),g=mmm.scene.getObjectByName('night lamp glow');
  const v=new mmm.camera.position.constructor(l.x,l.glowY,l.z).project(mmm.camera);if(v.z>1||Math.abs(v.x)>.85||Math.abs(v.y)>.85)return 'off screen';
  const px=Math.round((v.x+1)/2*gl.drawingBufferWidth)-4,py=Math.round((v.y+1)/2*gl.drawingBufferHeight)-4;
  const read=()=>{r.render(mmm.scene,mmm.camera);const buf=new Uint8Array(324);gl.readPixels(px,py,9,9,gl.RGBA,gl.UNSIGNED_BYTE,buf);return buf;};
  const on=read();g.visible=false;const off=read();g.visible=true;let d=0;for(let i=0;i<324;i+=4)d+=Math.max(0,on[i]-off[i]);return d>150?'seen':'hidden ('+d+')';})()`;
/** Yard lamps that stand beside a road, each with poses 200–600 m before it on that road, facing near it. */
const BACKS = [400, 300, 500, 250, 600, 200];
function yardPoses(heads) {
  const byLamp = heads.map(([x, z]) => {
    const e = x + VE, n = VN - z, found = [];
    // The lamp's nearest point on each road within 25 m (a pole stands beside its road).
    for (const road of data.roads) {
      let along = 0, best = null;
      for (let i = 1; i < road.pts.length; i++) {
        const a = road.pts[i - 1], b = road.pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const t = Math.max(0, Math.min(1, ((e - a[0]) * (b[0] - a[0]) + (n - a[1]) * (b[1] - a[1])) / (len * len || 1)));
        const off = Math.hypot(a[0] + (b[0] - a[0]) * t - e, a[1] + (b[1] - a[1]) * t - n);
        if (off < 25 && (!best || off < best.off)) best = { off, at: along + t * len };
        along += len;
      }
      if (best) for (const back of BACKS) {
        if (best.at <= back) continue;
        // The lamp must be ahead, near the middle of the view: the road may bend between the car and the lamp.
        const pose = station(road.id, best.at - back), bearing = Math.atan2(e - pose[0], n - pose[1]) * 180 / Math.PI;
        if (Math.abs(((bearing - pose[2]) % 360 + 540) % 360 - 180) < 12) found.push({ pose, lamp: [x, z] });
      }
    }
    return found;
  });
  // Every lamp's first pose, then every lamp's second, so one hilly lamp does not use up the tries.
  const poses = [];
  for (let k = 0; byLamp.some(list => k < list.length); k++) for (const list of byLamp) if (k < list.length) poses.push(list[k]);
  return poses;
}
const SIZES = [
  { id: 'desktop', width: 1400, height: 900, query: { q: 'high' }, beams: 2 },
  { id: 'phone', width: 844, height: 390, query: { q: 'low', touch: '1', res: '1.35' }, beams: 1, dpr: Number(process.env.NIGHT_PHONE_DPR ?? 1) },
];
const only = process.env.NIGHT_ONLY?.split(','), sizes = process.env.NIGHT_SIZES?.split(',');
// Day pages: the night is not built at all, so they draw as they did before it existed.
const DAYS = [
  { id: 'explore', query: 'mode=explore&q=high', width: 1400, height: 900 },
  { id: 'study-noon', query: 'mode=explore&q=high&date=2026-10-10&time=13:00', width: 1400, height: 900 },
  // 18:20: the sun is still above the horizon, low and orange: the study's sunset, not its night.
  { id: 'study-sunset', query: 'mode=explore&q=high&date=2026-10-10&time=18:20', width: 1400, height: 900 },
  { id: 'mail-phone', query: 'q=low&touch=1&res=1.35', width: 844, height: 390 },
];
const receipts = [];
let page = null;
try {
  if (!only) for (const day of DAYS) {
    if (!page) page = await open(`${origin}/?hud=0&radio=0&mode=explore`);
    await page.send('Emulation.setDeviceMetricsOverride', { width: day.width, height: day.height, deviceScaleFactor: 1, mobile: false });
    await page.navigate(`${origin}/?hud=0&radio=0&${day.query}`);
    for (let i = 0; i < 100 && !(await page.read(`mmm.terrain?.pending===0`)); i++) await sleep(200);
    const state = await page.read(`(()=>({night:'night' in mmm, terrainNight:mmm.terrain.night, lampUniform:'nightLamp' in mmm.terrain.uniforms,
      hook:Object.prototype.hasOwnProperty.call(mmm.scene,'onBeforeRender'), skyMaterial:mmm.scene.getObjectByName('night lamp glow')?'night':'day',
      shaders:mmm.renderer.info.programs.filter(p=>/night/i.test(p.name)).map(p=>p.name)}))()`);
    assert.deepEqual(state, { night: false, terrainNight: null, lampUniform: false, hook: false, skyMaterial: 'day', shaders: [] }, `${day.id}: a day page builds no night`);
    console.log('DAY', day.id, 'no night built');
  }
  for (const size of SIZES.filter(s => !sizes || sizes.includes(s.id))) for (const scene of SCENES.filter(s => !only || only.includes(s.id))) for (const view of ['chase', 'seat']) {
    if (!page) page = await open(`${origin}/?hud=0&radio=0&mode=explore`);
    if (scene.yard && !scene.at) {
      // The yard lamps are chosen on the page (night-rules.ts chooseYardLights); read them from a night page.
      await page.navigate(`${origin}/?hud=0&radio=0&mode=explore&area=mabou&date=2026-10-10&time=21:30`);
      const poses = yardPoses(await page.read(`mmm.night.lamps.filter(l=>l.colour[1]<.8).map(l=>[l.x,l.z])`));
      console.log('YARD POSES', poses.length);
      // The first pose from which the lamp's glow is really seen: render the view with and without the glow and compare
      // the pixels around the lamp's place on the screen (a hill, a bank or a tree in front leaves them the same).
      for (const { pose, lamp } of poses.slice(0, 12)) {
        await page.navigate(`${origin}/?hud=0&radio=0&mode=explore&area=mabou&exag=1.5&q=${size.query.q}&date=2026-10-10&time=21:30&at=${pose.join(',')}`);
        for (let i = 0; i < 100 && !(await page.read(`mmm.terrain.pending===0`)); i++) await sleep(200);
        await sleep(1500);
        const seen = await page.read(glowSeen(lamp));
        console.log('YARD POSE', pose.map(v => +v.toFixed(1)).join(','), seen);
        if (seen === 'seen') { scene.at = pose.join(','); scene.lamp = lamp; break; }
      }
      assert.ok(scene.at, 'a yard lamp stands beside a road');
    }
    const query = new URLSearchParams({ hud: '0', mode: 'explore', radio: '0', area: 'mabou', exag: '1.5', date: '2026-10-10', time: scene.time, at: scene.at, view, ...size.query });
    const url = `${origin}/?${query}`;
    await page.send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: size.dpr ?? 1, mobile: false });
    await page.navigate(url);
    // Hold the car still: the pictures are of the light, not of a car rolling down the hill.
    await page.read(`(()=>{const v=mmm.vehicle,update=v.update.bind(v);v.update=(dt,input,...args)=>update(0,{throttle:0,steer:0,handbrake:true},...args);return true})()`);
    for (let i = 0; i < 150; i++) {
      if (await page.read(`(()=>{mmm.roads.guardrails?.update(mmm.camera.position);return mmm.terrain.pending===0&&!(mmm.roads.guardrails?.audit.pending)&&(${!!scene.bull}?mmm.animals?.residents.some(r=>r.kind==='bull'&&r.rig):true)})()`)) break;
      await sleep(200);
    }
    await sleep(2500);
    // Draw counts: the largest of a few whole frames (a single read can land after a partial pass).
    const frame = await page.read(`(async()=>{let calls=0,triangles=0;for(let i=0;i<4;i++){await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
      const r=mmm.renderer.info.render;if(r.calls>calls){calls=r.calls;triangles=r.triangles;}}return {calls,triangles}})()`);
    const state = await page.read(`(()=>{const n=mmm.night;if(!n)return null;const u=mmm.terrain.uniforms;
      return {beams:n.beams.length,lamps:n.lamps.length,ready:n.lamps.filter(l=>l.y!==null).length,
        pools:u.nightPool.value.filter(p=>p.w>0).length,lampsOn:u.nightLamp.value.w,
        bull:mmm.animals?.residents.some(r=>r.kind==='bull'&&r.rig)??false,
        broken:mmm.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).map(p=>p.name),
        glows:n.lamps.filter(l=>l.glowY!==null).length,programs:mmm.renderer.info.programs.length}})()`);
    if (state) Object.assign(state, frame);
    assert.ok(state, `${scene.id}: the night look is built`);
    assert.deepEqual(state.broken, [], `${scene.id}: every shader program compiles`);
    assert.equal(state.beams, size.beams, `${scene.id} ${size.id}: head lamp beams`);
    assert.equal(state.lampsOn, size.beams, `${scene.id} ${size.id}: the land knows the beams`);
    if (scene.pools) assert.ok(state.pools >= 2, `${scene.id}: street lamps light their pools`);
    if (scene.bull) assert.ok(state.bull, `${scene.id}: the bull is there`);
    // The lamp the search found shows its glow in this very picture (from the seat the cab may hide it, so the chase view).
    if (scene.yard && view === 'chase') assert.equal(await page.read(glowSeen(scene.lamp)), 'seen', `${scene.id} ${size.id}: the yard lamp's glow is seen`);
    const file = resolve(out, `night-${scene.id}-${view}-${size.id}.png`);
    await page.shot(file);
    receipts.push({ scene: scene.id, view, size: size.id, url: query.toString(), ...state });
    console.log('PICTURE', file, JSON.stringify(state));
  }
} finally { await page?.close(); }
writeFileSync(resolve(out, 'night-receipts.json'), JSON.stringify(receipts, null, 2) + '\n');
console.log(`DONE ${receipts.length} night picture(s)`);
