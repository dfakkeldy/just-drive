// RUN=yard-props-browser.mjs VIEWS="desktop|x=1&at=624400,5103300,0 low|x=1&q=low&at=624400,5103300,0 era|era=1884&x=1&at=624400,5103300,0" tools/yard-shots.sh 1280 720
// Yard props at houses (yard-props.ts): in Mabou today they appear, each kind is one instanced mesh, the real car is
// stopped by a parked vehicle, trailer, mower or motorhome when it drives into one, a dog is never solid and slips away
// from a car beside it, no prop stands on a road the land knows, and 1884 has none. Pictures, desktop and phone, of the
// nearest vehicle, trailer, motorhome, mower and dog: yard-props-desktop-<kind>.png and, on LOW, yard-props-phone-<kind>.png.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { open, sleep } from './cdp.mjs';

const [out, ...urls] = process.argv.slice(2);
const evidence = process.env.MMM_CHECK_OUT ? join(process.env.MMM_CHECK_OUT, 'evidence', 'yard-props-browser') : out;
mkdirSync(evidence, { recursive: true });
const KINDS = ['car', 'suv', 'pickup', 'trailer', 'motorhome', 'mower', 'dog-lying', 'dog-sitting'];

for (const url of urls) {
  const page = await open(url);
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    const params = new URL(url).searchParams, name = params.get('name');
    if (params.get('era') === '1884') {
      assert.equal(await page.read('window.mmm.yardProps'), null, 'no yard props in 1884');
      console.log('PASS no yard props in 1884');
      continue;
    }
    for (let i = 0; i < 120 && !await page.read('!!window.mmm?.yardProps'); i++) await sleep(500);
    const census = await page.read(`(()=>{const y=mmm.yardProps,c={};for(const i of y.items)c[i.prop.kind]=(c[i.prop.kind]??0)+1;
      return {total:y.items.length,kinds:c,solids:y.solids.length,droppedSolid:y.items.filter(i=>!i.solid&&!i.prop.kind.startsWith('dog')).length,
      unaccounted:y.items.filter(i=>!i.prop.kind.startsWith('dog')&&!i.solid&&!y.near.dropped.has(i)).length,dogSolids:y.items.filter(i=>i.prop.kind.startsWith('dog')&&i.solid).length,low:y.low,area:mmm.area.id};})()`);
    console.log(name, 'census', JSON.stringify(census));
    assert.equal(census.area, 'mabou');
    assert.equal(census.low, params.get('q') === 'low', 'LOW detail follows the page');
    assert.ok(census.total > 120, 'Mabou has yard props at a share of its houses');
    for (const k of KINDS) assert.ok(census.kinds[k] > 0, `Mabou has ${k}`);
    const dogs = (census.kinds['dog-lying'] ?? 0) + (census.kinds['dog-sitting'] ?? 0);
    assert.equal(census.unaccounted, 0, 'every prop but a dog is solid, unless the land showed it cannot stand there (dropped)');
    assert.equal(census.dogSolids, 0, 'no dog is solid');
    assert.equal(census.solids + census.droppedSolid, census.total - dogs);
    assert.ok(census.droppedSolid <= census.total * 0.1, 'few props dropped by the land check');

    // The car goes beside the nearest yard with a vehicle; the camera follows it, and every prop near it is posed.
    const target = await page.read(`(()=>{const y=mmm.yardProps,v=mmm.vehicle;
      const cars=y.items.filter(i=>i.solid&&['car','suv','pickup'].includes(i.prop.kind)).sort((a,b)=>Math.hypot(a.x-v.x,a.z-v.z)-Math.hypot(b.x-v.x,b.z-v.z));
      const t=cars[0],h=t.heading,back=t.prop.half+9;
      v.place(t.x-Math.sin(h)*back,t.z+Math.cos(h)*back,h);v.speed=0;v.vx=0;v.vz=0;
      return {x:t.x,z:t.z,heading:h,half:t.prop.half,halfWidth:t.prop.halfWidth,kind:t.prop.kind,house:t.prop.house};})()`);
    let drawn = null;
    for (let i = 0; i < 240; i++) {
      drawn = await page.read(`(()=>{const y=mmm.yardProps,meshes=[];y.group.traverse(o=>{if(o.isMesh)meshes.push({name:o.name,instanced:!!o.isInstancedMesh,count:o.count,visible:o.visible});});return meshes;})()`);
      if (drawn.some(m => m.name === target.kind && m.count > 0)) break;
      await sleep(500);
    }
    console.log(name, 'meshes', JSON.stringify(drawn));
    assert.ok(drawn.some(m => m.name === target.kind && m.count > 0), `the ${target.kind} beside the car is drawn`);
    assert.ok(drawn.every(m => m.instanced), 'every prop kind is one instanced mesh');
    assert.equal(new Set(drawn.map(m => m.name)).size, drawn.length, 'one mesh per kind');
    assert.ok(drawn.length <= KINDS.length);
    assert.ok(drawn.every(m => m.visible === m.count > 0), 'a kind with nothing in view costs no draw');

    // No drawn prop stands on a road the land knows (the baked road field) or in the sea.
    const ground = await page.read(`(()=>{const y=mmm.yardProps,t=mmm.terrain,bad=[];let checked=0;
      for(const i of y.items){const s=t.surfaceAt(i.x,i.z);if(!s||s.level<8)continue;checked++;
        if(!y.near.dropped.has(i)&&s.roadDist<s.halfWidth)bad.push({kind:i.prop.kind,x:i.x,z:i.z,roadDist:s.roadDist,half:s.halfWidth});}
      return {checked,bad,dropped:y.near.dropped.size};})()`);
    console.log(name, 'ground', JSON.stringify(ground));
    assert.ok(ground.checked >= 3, 'props were checked on fine land');
    assert.deepEqual(ground.bad, [], 'no prop on a road');

    // Every solid near the car: the car set just inside its end is pushed out (the same contact path the game runs).
    const contacts = await page.read(`(()=>{const y=mmm.yardProps,v=mmm.vehicle,saved={x:v.x,z:v.z,heading:v.heading,vx:v.vx,vz:v.vz,speed:v.speed};let tested=0;
      try{for(const s of y.solids.filter(s=>Math.hypot(s.x-v.x,s.z-v.z)<400)){const x=s.x+Math.sin(s.heading)*s.half*.85,z=s.z-Math.cos(s.heading)*s.half*.85;
        Object.assign(v,{x,z,vx:0,vz:0,speed:0});y.resolveSolids(v);if(Math.hypot(v.x-x,v.z-z)<.1)throw Error('a yard prop did not block the car');tested++;}}
      finally{Object.assign(v,saved);}return tested;})()`);
    assert.ok(contacts >= 3, `solids tested near the car: ${contacts}`);

    // The game's own frame loop keeps the real car out: set 0.3 m into the vehicle's tail, rolling into it at 3 m/s with the
    // throttle held, the car is pushed back to the bumper within a few frames and never gets deeper. (Driving up from
    // rest tests a yard's banks, which can stall a car short of the bumper, not the solid.)
    const touch = target.half + 0.95 + 1.35;
    const inside = `(()=>{const v=mmm.vehicle,t=${JSON.stringify(target)},ax=Math.sin(t.heading),az=-Math.cos(t.heading);let deepest=-Infinity;
      for(const o of [-1.35,0,1.35]){const cx=v.x+Math.sin(v.heading)*o-t.x,cz=v.z-Math.cos(v.heading)*o-t.z,a=cx*ax+cz*az,b=-cx*az+cz*ax;
        const out=Math.hypot(Math.max(Math.abs(a)-t.half,0),Math.max(Math.abs(b)-t.halfWidth,0));deepest=Math.max(deepest,0.95-out);}
      return {deepest,gap:Math.hypot(v.x-t.x,v.z-t.z)};})()`;
    await page.read(`(()=>{const v=mmm.vehicle,t=${JSON.stringify(target)},ax=Math.sin(t.heading),az=-Math.cos(t.heading),back=${touch}-0.3;
      v.place(t.x-ax*back,t.z-az*back,t.heading);v.vx=ax*3;v.vz=az*3;v.speed=3;return true;})()`);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'ArrowUp', key: 'ArrowUp', windowsVirtualKeyCode: 38 });
    const samples = [];
    try { for (let i = 0; i < 30; i++) { samples.push(await page.read(inside)); await sleep(50); } }
    finally { await page.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ArrowUp', key: 'ArrowUp', windowsVirtualKeyCode: 38 }); }
    const settled = samples.slice(10), drive = { start: +samples[0].deepest.toFixed(3), deepest: +Math.max(...settled.map(s => s.deepest)).toFixed(3), gap: +settled.at(-1).gap.toFixed(2), touch: +touch.toFixed(2) };
    console.log(name, 'drive', JSON.stringify(drive));
    assert.ok(drive.deepest < 0.05, `the ${target.kind} pushes the car out to its bumper and holds it there (deepest ${drive.deepest} m)`);
    assert.ok(drive.gap < touch + 1.5, 'the car stays at the bumper, not thrown off');

    // A dog is never solid: with the car on top of it, it slips away and nothing pushes the car.
    const dog = await page.read(`(()=>{const y=mmm.yardProps,v=mmm.vehicle,d=y.items.filter(i=>!i.solid).sort((a,b)=>Math.hypot(a.x-v.x,a.z-v.z)-Math.hypot(b.x-v.x,b.z-v.z))[0];
      const saved={x:v.x,z:v.z,heading:v.heading,vx:v.vx,vz:v.vz,speed:v.speed};
      try{Object.assign(v,{x:d.x,z:d.z,vx:0,vz:0,speed:0});y.resolveSolids(v);const pushed=Math.hypot(v.x-d.x,v.z-d.z);
        y.update(mmm.camera,v);const away=d.away;Object.assign(v,{x:d.x+40,z:d.z});y.update(mmm.camera,v);return {pushed,away,back:!d.away,solid:y.solids.some(s=>s.x===d.x&&s.z===d.z)};}
      finally{Object.assign(v,saved);}})()`);
    console.log(name, 'dog', JSON.stringify(dog));
    assert.ok(dog.pushed < 1e-6 && !dog.solid, 'a dog is never solid');
    assert.ok(dog.away && dog.back, 'a dog slips away from a car beside it and comes back when it has gone');

    // Pictures: the nearest of each sort in the game's own chase view, the car stopped 14 m off with the prop to one side.
    // Desktop size on the desktop view, phone size on LOW.
    const [width, height, mobile, size] = params.get('q') === 'low' ? [390, 844, true, 'phone'] : [1280, 720, false, 'desktop'];
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    const pictures = [];
    for (const sort of [['pickup', 'suv', 'car'], ['trailer'], ['motorhome'], ['mower'], ['dog-lying', 'dog-sitting']]) {
      const at = await page.read(`(()=>{const v=mmm.vehicle,sort=${JSON.stringify(sort)},t=mmm.yardProps.items.filter(i=>sort.includes(i.prop.kind)&&!mmm.yardProps.near.dropped.has(i)).sort((a,b)=>Math.hypot(a.x-v.x,a.z-v.z)-Math.hypot(b.x-v.x,b.z-v.z))[0];
        if(!t)return null;const h=t.heading+Math.PI*0.7,ax=Math.sin(h),az=-Math.cos(h),side=t.prop.kind.startsWith('dog')?2.2:3.2,far=t.prop.kind.startsWith('dog')?9:14;
        const x=t.x-ax*far-az*side,z=t.z-az*far+ax*side;v.place(x,z,h);v.speed=0;v.vx=0;v.vz=0;return {kind:t.prop.kind,house:t.prop.house,x:t.x,z:t.z};})()`);
      if (!at) continue;
      for (let i = 0; i < 120 && !await page.read(`mmm.yardProps.counts.drawn[${JSON.stringify(at.kind)}]>0`); i++) await sleep(500);
      await sleep(2000);
      const file = `yard-props-${size}-${at.kind}.png`;
      await page.shot(join(evidence, file)); pictures.push(file);
    }
    console.log(name, 'pictures', pictures.join(' '));
    assert.ok(pictures.length >= 4, 'pictures of at least four sorts of prop');
    const facts = { census, target, drawn, ground, contacts, drive, dog, pictures };
    writeFileSync(join(evidence, `yard-props-${name}.json`), JSON.stringify(facts, null, 1));
    assert.deepEqual(page.errors, []);
    console.log(`PASS yard props ${name}`);
  } finally { await page.close(); }
}
console.log('PASS yard-props-browser');
