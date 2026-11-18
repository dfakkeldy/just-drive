// Road animals in the real mail game on the real Mabou land: daily routes clear of the fixed animal sites and the
// roadside scene, a real autopilot drive through the real HUD hint into a near miss and its complaint, the H key,
// one draw per species with no new program, gating (no wildlife key, 1884) and desktop/phone pictures of each species.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { open, sleep } from './cdp.mjs';
const out = resolve(process.argv[2]); mkdirSync(out, { recursive: true });
const origin = new URL(process.argv[3]).origin, receipt = {};
// Day 3 is a plain day: no fish truck and no painter on Mabou Mines Road.
const page = await open(`${origin}/?wildlife=1&day=3&radio=0&shadows=0&q=low`);
try {
  assert.equal(await page.read('!!mmm.roadAnimals'), true, 'mail mode with wildlife=1 builds the animals');
  await page.read('mmm.animals?.ready');
  await page.read('new Promise(r=>setTimeout(r,500))');
  const routes = await page.read(`(()=>{const m=mmm,s=m.roadAnimals;s.update(0,m.vehicle,true);
    const bus=[];if(m.schoolBus?.road)for(let d=0;d<m.schoolBus.road.cumulative.at(-1);d+=10){const p={x:0,z:0,heading:0};m.schoolBus.road.at(d,0,p);bus.push(p);}
    const sites=[...(m.animals?.places??[]),...(m.roadScene?[m.roadScene.centre]:[]),...bus];
    return s.residents.map(a=>({road:a.route.road.name,kind:a.route.road.kind,species:a.route.species,stop:a.route.stop,
      nearestSite:Math.min(...sites.map(p=>Math.hypot(p.x-a.route.stop.x,p.z-a.route.stop.z)))}));})()`);
  console.log('ROUTES ' + JSON.stringify(routes));
  assert.ok(routes.length >= 2, 'the day has animals on real roads');
  const order = await page.read(`(()=>{const r=mmm.shift.roadside;return {animals:r.indexOf(mmm.roadAnimals),scene:r.indexOf(mmm.roadScene),bus:r.indexOf(mmm.schoolBus)}})()`);
  assert.ok(order.animals > order.scene && order.animals > order.bus && order.scene >= 0 && order.bus >= 0, 'the fish truck, painter and school bus hints come first on the HUD line ' + JSON.stringify(order));
  for (const r of routes) {
    assert.ok(r.kind === 2 || r.kind === 3, 'paved or gravel road');
    assert.ok(r.nearestSite >= 350, `${r.species} on ${r.road} keeps 350 m from the dogs, the bull, the cows and the roadside scene`);
  }
  receipt.routes = routes;
  // Start the shift so the camera follows the car and the land streams in around it.
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' });
  // Find a route whose whole crossing (both fields and the road between) proves safe on the real streamed land and rails.
  let chosen = -1;
  for (let n = 0; n < routes.length && chosen < 0; n++) {
    await page.read(`(()=>{const m=mmm,r=m.roadAnimals.residents[${n}].route,h=m.roads.nearest(r.stop.x,r.stop.z,20).heading;
      m.vehicle.restart(r.stop.x-Math.sin(h)*30,r.stop.z+Math.cos(h)*30,h);m.camera.position.set(m.vehicle.x,m.vehicle.y+4,m.vehicle.z);return true})()`);
    for (let wait = 0; wait < 150; wait++) {
      await sleep(200);
      if (await page.read(`mmm.roadAnimals.residents[${n}].safe`)) { chosen = n; break; }
    }
  }
  assert.ok(chosen >= 0, 'at least one daily animal proves safe on the real land');
  // A real drive: the production vehicle on autopilot at 14 m/s from 200 m out, frames from requestAnimationFrame,
  // the HUD line read from the page every frame.
  const drive = await page.read(`(async()=>{const m=mmm,s=m.roadAnimals,a=s.residents[${chosen}],v=m.vehicle;
    const {autopilot}=await import('/src/vehicle.ts'),{SceneRoad}=await import('/src/road-scene-rules.ts');
    // 200 m back along the real road (not a straight line: the back roads bend), facing the animal.
    const p=a.route.stop,line=new SceneRoad(a.route.road.pts,0,1),at=line.alongAt(p.x,p.z),length=line.cumulative.at(-1);
    const back=at>=200?-200:200,pose={x:0,z:0,heading:0};line.at(at+back,0,pose);if(back>0)pose.heading+=Math.PI;
    if(Math.min(at,length-at)<200&&Math.max(at,length-at)<200)throw Error('road too short for the drive');
    v.restart(pose.x,pose.z,pose.heading);
    for(let i=0;i<30;i++)await new Promise(requestAnimationFrame);
    a.state='stopped';a.progress=1;a.timer=-1e9;a.cooldown=0;
    const original=v.update.bind(v);v.update=(dt,input,after)=>original(dt,autopilot(v,m.roads,14),after);
    // No new damage on this scripted drive: a damage line on the HUD (a washboard knock, say) rightly breaks the warning,
    // and road-animals-check proves that; here the path under test is hint, then near miss, then complaint.
    const damage=v.damage;v.damage=null;m.shift.damage.hintTime=0;
    const hud=document.getElementById('stopHint'),before=m.shift.complaints.all.length;
    const log={frames:0,firstHint:-1,complaintFrame:-1,bolted:-1,hintAt:0,complaintAt:0,minGap:Infinity,speeds:[],lines:new Set()};
    const env=v.spec.envelope,gap=q=>{let g=Infinity;const fx=Math.sin(v.heading),fz=-Math.cos(v.heading);
      env.circles.forEach((o,c)=>{const sd=env.circleSides?.[c]??0;g=Math.min(g,Math.hypot(q.x-(v.x+fx*o-fz*sd),q.z-(v.z+fz*o+fx*sd))-env.radius-.95);});return g;};
    try{for(let f=0;f<1200;f++){
      await new Promise(requestAnimationFrame);log.frames++;
      const line=hud.textContent;log.lines.add(line);
      if(log.firstHint<0&&/^SLOW DOWN: a /.test(line)){log.firstHint=f;log.hintAt=performance.now();}
      if(log.bolted<0&&a.state==='bolting')log.bolted=f;
      const e0=a.progress<=1?a.route.home:a.route.stop,e1=a.progress<=1?a.route.stop:a.route.far,t=a.progress<=1?a.progress:a.progress-1;
      if(a.progress>0)log.minGap=Math.min(log.minGap,gap({x:e0.x+(e1.x-e0.x)*t,z:e0.z+(e1.z-e0.z)*t}));
      if(f%30===0)log.speeds.push(+v.speed.toFixed(1));
      if(log.complaintFrame<0&&m.shift.complaints.all.length>before){log.complaintFrame=f;log.complaintAt=performance.now();}
      if(log.complaintFrame>=0&&f>log.complaintFrame+30)break;
    }}finally{v.update=original;v.damage=damage;}
    const c=m.shift.complaints.all.slice(before);
    return {...log,lines:[...log.lines],complaints:c.map(x=>({kind:x.kind,customer:x.customer,line:x.line})),report:s.reportLine(),species:a.route.species,state:a.state,damageActive:v.damageActive};
  })()`);
  console.log('DRIVE ' + JSON.stringify(drive));
  assert.ok(drive.firstHint >= 0, 'the real HUD shows the slow-down hint');
  assert.ok(drive.bolted > drive.firstHint, 'the animal bolts after the hint');
  assert.ok(drive.complaintAt - drive.hintAt >= 1000, 'the real HUD showed the hint for at least a second before the complaint');
  assert.equal(drive.complaints.length, 1); assert.equal(drive.complaints[0].kind, 'sceneAnimal');
  assert.match(drive.complaints[0].customer, /^a neighbour on /);
  assert.ok(drive.lines.some(l => /^Too close\. The (deer|fox|moose) made the ditch/.test(l)), 'the near-miss line follows');
  assert.match(drive.report, /^Wildlife: 1 near miss\. Nobody was hurt\.$/);
  assert.ok(drive.minGap > 0, 'a near miss: the car body never reached the animal');
  receipt.drive = drive;
  // H sends a standing animal home; one draw per species and no new shader program on a repeat render.
  await page.read(`(()=>{const m=mmm,s=m.roadAnimals,a=s.residents[${chosen}],v=m.vehicle,p=a.route.stop,h=m.roads.nearest(p.x,p.z,20).heading;
    v.restart(p.x-Math.sin(h)*25,p.z+Math.cos(h)*25,h);a.state='stopped';a.progress=1;a.timer=-1e9;return true})()`);
  await sleep(1500);
  await page.read(`(()=>{const a=mmm.roadAnimals.residents[${chosen}];a.state='stopped';a.progress=1;a.timer=-1e9;return true})()`);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyH', key: 'h' });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyH', key: 'h' });
  await sleep(200);
  assert.equal(await page.read(`mmm.roadAnimals.residents[${chosen}].state`), 'leaving', 'the H key sends it home at a walk');
  receipt.draws = {};
  // Pictures from the driver's seat (V, the game's own key): from the chase camera the roof sign hides a fox.
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyV', key: 'v' });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyV', key: 'v' });
  for (const species of ['deer', 'fox', 'moose']) {
    const draw = await page.read(`(async()=>{const m=mmm,s=m.roadAnimals,a=s.residents[${chosen}],r=m.renderer;
      a.route.species='${species}';a.state='stopped';a.progress=1;a.timer=-1e9;
      for(let i=0;i<4;i++)await new Promise(requestAnimationFrame);
      const measure=()=>{r.info.reset();r.render(m.scene,m.camera);return {calls:r.info.render.calls,triangles:r.info.render.triangles,programs:r.info.programs.length};};
      const on=measure();s.group.visible=false;const off=measure();s.group.visible=true;const again=measure();
      return {on,off,again,count:s.meshes['${species}'].count,shadow:s.meshes['${species}'].castShadow};})()`);
    assert.ok(draw.count >= 1, species + ' drawn');
    assert.equal(draw.on.calls - draw.off.calls, 1, species + ': one draw for the species');
    assert.equal(draw.again.programs, draw.on.programs, species + ': no program on a repeat render');
    assert.equal(draw.shadow, false);
    receipt.draws[species] = draw;
    for (const [size, width, height] of [['desktop', 1280, 800], ['phone', 390, 844]]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: size === 'phone' });
      await page.read(`(()=>{const m=mmm,a=m.roadAnimals.residents[${chosen}],v=m.vehicle,p=a.route.stop,h=m.roads.nearest(p.x,p.z,20).heading;
        v.restart(p.x-Math.sin(h)*${size === 'phone' ? 16 : 20},p.z+Math.cos(h)*${size === 'phone' ? 16 : 20},h);a.state='stopped';a.progress=1;a.timer=-1e9;return true})()`);
      await sleep(1200);
      const file = resolve(out, `road-${species}-${size}.png`); await page.shot(file); console.log('PICTURE ' + file);
    }
  }
  console.log('PASS road animals: routes, drive, hint, near miss, horn, draws ' + JSON.stringify(receipt.draws));
} finally { await page.close(); }
// Gates: a test visit without wildlife=1 keeps the existing scenes, and 1884 has none. (The production player gate is the
// ambient traffic's expression; the dev server cannot serve a production build.)
for (const url of ['/?test=1&radio=0&q=low', '/?wildlife=1&era=1884&radio=0&q=low']) {
  const gate = await open(origin + url);
  try { assert.equal(await gate.read('mmm.roadAnimals ?? null'), null, url + ' has no road animals'); } finally { await gate.close(); }
}
console.log('PASS road animal gates: plain test visit and 1884');
writeFileSync(resolve(out, 'road-animals-browser.json'), JSON.stringify(receipt, null, 2));
