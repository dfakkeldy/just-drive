#!/usr/bin/env node
// Ambient traffic behaviour on small made-up road networks, with no browser: web/src/ambient-traffic.ts is bundled with
// esbuild (three.js included) and run in Node on flat ground. Each case fails with its own message.
// --mutations: each mutant changes one rule in the module source; the cases must fail on every mutant.
// Usage: node tools/ambient-traffic-check.mjs [--mutations]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from '../web/node_modules/esbuild/lib/main.js';

const SOURCE = fileURLToPath(new URL('../web/src/ambient-traffic.ts', import.meta.url));
const original = readFileSync(SOURCE, 'utf8');

async function load(source) {
  const out = await build({ stdin: { contents: source, resolveDir: fileURLToPath(new URL('../web/src/', import.meta.url)), sourcefile: 'ambient-traffic.ts', loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
}

function cases({ AmbientTraffic }, THREE) {
  const flat = { heightAt: () => 0 };
  const make = (list, low = false) => new AmbientTraffic({ roads: list.map(([pts, kind = 1, half = 3.6, bridge = false]) => ({ kind, halfWidth: half, bridge, pts })), deckHeight: () => null }, flat, low);
  const start = (t, path, along, speed = 12, i = 0) => { const c = t.cars[i]; c.path = path; c.along = along; c.speed = speed; c.active = true; path.at(along, 1.65, c.solid); t.place(c); return c; };   // as a spawn: stood on the ground
  const run = (t, player, ticks, watch) => { for (let i = 0; i < ticks; i++) { t.step(1 / 120, player); watch?.(); } };
  const straight = (length) => [[[[0, 0], [0, -length]]]];
  const camera = (x, z, look) => { const c = new THREE.PerspectiveCamera(60, 16 / 9, .1, 3000); c.position.set(x, 2, z); c.lookAt(x, 2, z + look); c.updateMatrixWorld(); c.updateProjectionMatrix(); return c; };
  const sees = (cam, x, z) => { const f = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)); return f.intersectsSphere(new THREE.Sphere(new THREE.Vector3(x, 1, z), 5)); };
  const out = {};
  const check = (name, fn) => { out[name] = fn(); };

  check('pool', () => {
    for (const low of [false, true]) { const t = make(straight(1000), low); if (t.cars.length !== (low ? 2 : 4)) throw Error(`pool: ${t.cars.length} cars on ${low ? 'LOW' : 'desktop'}`); }
    return 'desktop 4, LOW 2';
  });
  check('bridge', () => {   // the map splits a highway at each bridge: one road, crossed at speed
    const t = make([[[[0, 0], [0, -300]]], [[[0, -300], [0, -330]], 1, 3.6, true], [[[0, -330], [0, -800]]]]);
    if (t.paths.length !== 2 || Math.abs(t.paths[0].cumulative.at(-1) - 800) > 1) throw Error('bridge pieces not joined: ' + t.paths.map(p => p.cumulative.at(-1)));
    const c = start(t, t.paths[0], 250); let slowest = 99; run(t, { x: 1000, z: 1000 }, 1200, () => slowest = Math.min(slowest, c.speed));
    if (slowest < 11.5 || c.along < 360) throw Error(`car slowed at a bridge join: ${slowest.toFixed(2)} m/s, at ${c.along.toFixed(0)}`);
    return { slowest };
  });
  check('decks', () => {   // own bridge: on the deck (also a two-point piece, 10 m past its mapped end, and a recovered span with no bridge piece); an overpass: on the land below
    const roads = [[[0, 0], [0, -300]], [[0, -300], [0, -400]], [[0, -400], [0, -800]]].map((pts, i) => ({ id: 10 + i, kind: 1, halfWidth: 3.6, bridge: i === 1, pts }));
    const deckHeight = (x, z) => z >= -415 && z <= -300 ? 4 : Math.abs(z + 600) < 6 ? 6 : z <= -650 && z >= -700 ? 5 : null;
    const bridgeRuns = () => [{ pts: [[0, -650], [0, -700]], roads: new Set([12]) }, { pts: [[-6, -600], [6, -600]], roads: new Set([99]) }];
    const t = new AmbientTraffic({ roads, deckHeight, bridgeRuns }, flat, false), length = t.paths[0].cumulative.at(-1);
    for (const [along, want] of [[330, 4], [410, 4], [600, 0], [200, 0], [675, 5]]) for (const [path, at] of [[t.paths[0], along], [t.paths[1], length - along]]) {
      const c = start(t, path, at);
      if (c.y !== want) throw Error(`decks: a car ${along} m along stands at ${c.y}, not ${want}`);
    }
    return 'own deck, overpass';
  });
  check('opposing', () => {   // two cars meeting in opposite lanes keep going (the old slot priority deadlocked)
    const t = make(straight(1000)); const a = start(t, t.paths[0], 400, 12, 0), b = start(t, t.paths[1], 560, 12, 1);
    run(t, { x: 1000, z: 1000 }, 1200);
    if (a.speed < 10 || b.speed < 10) throw Error('opposing lanes deadlocked');
    return 'pass';
  });
  check('oncoming', () => {   // an oncoming player in the other lane does not stop the car
    const t = make(straight(1000)), c = start(t, t.paths[0], 300); let slowest = 99;
    run(t, { x: -1.65, z: c.solid.z - 25, speed: 10 }, 240, () => slowest = Math.min(slowest, c.speed));
    if (slowest < 11.5) throw Error('car braked for an oncoming player in the other lane: ' + slowest.toFixed(2));
    return { slowest };
  });
  check('gap', () => {   // a moving player ahead in the lane: the car stops 12 m behind and does not pass
    const t = make(straight(1000)), c = start(t, t.paths[0], 100), player = { x: 1.65, z: c.solid.z - 25, speed: 1 };
    run(t, player, 1200);
    const gap = Math.hypot(c.solid.x - player.x, c.solid.z - player.z);
    if (c.speed > 1 || gap < 10 || c.side < 1.6) throw Error(`player gap failed: ${c.speed.toFixed(2)} m/s, gap ${gap.toFixed(1)}, side ${c.side.toFixed(2)}`);
    return { gap };
  });
  const AI = { halfLength: 2.3 };
  check('others', () => {   // the Point Tupper AI ahead in the car's line, going its way: the car keeps its distance
    const t = make(straight(1000)), c = start(t, t.paths[0], 100), ai = { x: 1.65, z: c.solid.z - 40, heading: 0, speed: 0, spec: AI };
    t.others = [ai]; run(t, { x: 1000, z: 1000 }, 1200);
    const gap = Math.hypot(c.solid.x - ai.x, c.solid.z - ai.z);
    if (c.speed > .5 || gap < 11 || gap > 14) throw Error(`no gap behind another driver: ${c.speed.toFixed(2)} m/s, gap ${gap.toFixed(1)}`);
    // Coming the other way a hair either side of 180 degrees (the wrap), moving or stopped at a red; and going its way in the other lane.
    for (const [label, other] of [['oncoming at 180-0.001', { heading: Math.PI - 1e-3, speed: 8 }], ['oncoming at 180+0.001', { heading: Math.PI + 1e-3, speed: 8 }],
      ['oncoming, stopped', { heading: Math.PI - 1e-3, speed: 0 }], ['going its way in the other lane', { heading: 0, speed: 8 }]]) {
      const u = make(straight(1000)), d = start(u, u.paths[0], 100); let slowest = 99;
      u.others = [{ ...other, x: -1.65, z: d.solid.z - 25, spec: AI }]; run(u, { x: 1000, z: 1000 }, 480, () => slowest = Math.min(slowest, d.speed));
      if (slowest < 11.9) throw Error(`car braked for another driver ${label} in the other lane: ${slowest.toFixed(2)}`);
    }
    return { gap };
  });
  // A right-hand bend for a car going north: from (-60, 400) north to (-60, 0), then round toward (0, -60).
  const rightArc = () => { const arc = []; for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI / 2; arc.push([-60 * Math.cos(a), -60 * Math.sin(a)]); } return [[[[-60, 400], ...arc]]]; };
  check('othersBend', () => {   // right-hand bend: the AI coming the other way does not stop the car; the AI ahead round the bend in its lane does
    const lane = (path, along, side) => { const p = { x: 0, z: 0, heading: 0 }; path.at(along, side, p); return p; };
    for (const jitter of [-1e-3, 0, 1e-3]) {
      const t = make(rightArc()), path = t.paths.find(p => p.points[0][1] > 0), back = t.paths.find(p => p !== path);
      const c = start(t, path, 380), length = path.cumulative.at(-1); let slowest = 99;
      const oncoming = lane(back, length - 430, 1.65); t.others = [{ ...oncoming, heading: oncoming.heading + jitter, speed: 0, spec: AI }];
      run(t, { x: 1000, z: 1000 }, 480, () => slowest = Math.min(slowest, c.speed));
      if (slowest < 11.9) throw Error(`car braked on a right-hand bend for the AI in the other lane (jitter ${jitter}): ${slowest.toFixed(2)}`);
    }
    const u = make(rightArc()), upath = u.paths.find(p => p.points[0][1] > 0), d = start(u, upath, 395);
    const ahead = lane(upath, 425, 1.65); u.others = [{ ...ahead, speed: 0, spec: AI }];
    run(u, { x: 1000, z: 1000 }, 1200);
    const gap = Math.hypot(d.solid.x - ahead.x, d.solid.z - ahead.z);
    if (d.speed > .5 || gap < 10) throw Error(`car did not keep its distance behind the AI round the bend: ${d.speed.toFixed(2)} m/s, gap ${gap.toFixed(1)}`);
    return 'pass';
  });
  check('othersCross', () => {   // the AI crossing the highway at a junction ahead: the car stops short; one crossing well to the side does not stop it
    for (const heading of [Math.PI / 2, -Math.PI / 2 + .3]) {
      const t = make(straight(1000)), c = start(t, t.paths[0], 100), ai = { x: 1.65, z: c.solid.z - 30, heading, speed: 0, spec: AI };
      t.others = [ai]; run(t, { x: 1000, z: 1000 }, 600);
      const gap = Math.hypot(c.solid.x - ai.x, c.solid.z - ai.z);
      if (c.speed > .5 || gap < 4) throw Error(`car did not stop for the AI crossing ahead (heading ${heading.toFixed(2)}): ${c.speed.toFixed(2)} m/s, gap ${gap.toFixed(1)}`);
    }
    const u = make(straight(1000)), d = start(u, u.paths[0], 100); let slowest = 99;
    u.others = [{ x: 12, z: d.solid.z - 15, heading: Math.PI / 2, speed: 0, spec: AI }]; run(u, { x: 1000, z: 1000 }, 240, () => slowest = Math.min(slowest, d.speed));
    if (slowest < 11.9) throw Error(`car braked for the AI crossing 10 m to the side: ${slowest.toFixed(2)}`);
    return 'pass';
  });
  check('othersMerge', () => {   // the AI turning onto the highway 15 m ahead in the car's lane, 40 degrees off its heading: the car brakes
    const t = make(straight(1000)), c = start(t, t.paths[0], 100); let slowest = 99;
    t.others = [{ x: 1.65, z: c.solid.z - 15, heading: .7, speed: 0, spec: AI }];
    run(t, { x: 1000, z: 1000 }, 120, () => slowest = Math.min(slowest, c.speed));
    if (slowest > 7) throw Error(`car did not brake for the AI turning on ahead: ${slowest.toFixed(2)}`);
    return 'pass';
  });
  check('othersSpawn', () => {   // no spawn within 35 m of the AI
    const t = make(straight(1000));
    t.others = [{ x: 1.65, z: -500, heading: 0, speed: 0, spec: AI }];
    if (!t.crowded(1.65, -480) || t.crowded(1.65, -440)) throw Error('spawn spacing ignores the AI');
    return 'pass';
  });
  check('queue', () => {   // a stopped queue (the canal barrier) within 40 m ahead in the lane: no pass round the player waiting in it
    const player = { x: 1.5, z: -340, speed: 0 }, Q = { heading: 0, speed: 0, spec: AI, queue: true };
    const waits = (other) => { const t = make(straight(2000)), c = start(t, t.paths[0], 300, 12, 0); t.others = [other];
      for (let i = 0; i < 6000 && !c.passing; i++) t.step(1 / 120, player); return !c.passing; };
    if (!waits({ ...Q, x: 1.65, z: -364 })) throw Error('car pulled out round a player waiting at a barrier');
    if (waits({ ...Q, x: 1.65, z: -420 })) throw Error('a queue more than 40 m ahead still forbade the pass');
    if (waits({ ...Q, x: -1.65, z: -364 })) throw Error('a queue in the other lane forbade the pass');
    if (waits({ ...Q, x: 1.65, z: -364, queue: false })) throw Error('an ordinary driver ahead forbade the pass');
    return 'pass';
  });
  check('keepOut', () => {   // no spawn where the canal keeps cars out; spawns elsewhere go on
    const t = make(straight(3000)), player = { x: 1.65, z: -1500, speed: 0 }, cam = camera(1.65, -1500, -1);
    t.keepOut = (_x, z) => z > -1300;
    let inside = 0, outside = 0;
    for (let frame = 0; frame < 600; frame++) {
      t.update(cam, player);
      for (const c of t.cars) if (c.active) { if (c.solid.z > -1300) inside++; else outside++; c.active = false; }
    }
    if (inside || outside < 30) throw Error(`keep-out spawns: ${inside} inside, ${outside} outside`);
    return { outside };
  });
  check('othersPass', () => {   // the AI coming the other way forbids a pass round a stopped player, as an oncoming traffic car does
    const t = make(straight(2000)), c = start(t, t.paths[0], 300, 12, 0), player = { x: 1.5, z: -340, speed: 0 };
    t.others = [{ x: -1.65, z: -460, heading: Math.PI, speed: 8, spec: AI }];
    for (let i = 0; i < 1200; i++) t.step(1 / 120, player);
    if (c.passing) throw Error('car pulled out to pass toward the AI coming the other way');
    { const u = make(straight(2000)), d = start(u, u.paths[0], 300, 12, 0);   // the same wait, then the AI goes: the pass starts
      u.others = [{ x: -1.65, z: -460, heading: Math.PI, speed: 8, spec: AI }];
      for (let i = 0; i < 1200; i++) u.step(1 / 120, player);
      u.others = []; for (let i = 0; i < 6000 && !d.passing; i++) u.step(1 / 120, player);
      if (!d.passing) throw Error('car never passed once the AI had gone'); }
    t.others = [{ x: -30, z: -460, heading: Math.PI, speed: 8, spec: AI }];   // a driver on another road 30 m off to the side
    for (let i = 0; i < 6000 && !c.passing; i++) t.step(1 / 120, player);
    if (!c.passing) throw Error('car never passed with the AI on another road off to the side');
    t.others = [{ x: -1.65, z: c.solid.z - 60, heading: Math.PI, speed: 8, spec: AI }]; let ended = false;
    run(t, player, 600, () => { ended ||= !c.passing; });
    if (!ended) throw Error('the pass did not end for the AI coming the other way');
    return 'pass';
  });
  check('curve', () => {   // a player in the car's lane round a curve still stops it (a straight-ahead cone misses it)
    const arc = []; for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI / 2; arc.push([60 * Math.cos(a), -60 * Math.sin(a)]); }
    const t = make([[[[60, 400], ...arc]]]), path = t.paths.find(p => p.points[0][1] > 0);
    const c = start(t, path, 420), pose = { x: 0, z: 0, heading: 0 }; path.at(450, 1.65, pose);
    run(t, { ...pose, speed: 1 }, 600); const gap = Math.hypot(c.solid.x - pose.x, c.solid.z - pose.z);
    if (c.speed > 1 || gap < 8) throw Error(`car did not stop for the player in its lane on a curve: ${c.speed.toFixed(2)} m/s, gap ${gap.toFixed(1)}`);
    return { gap };
  });
  check('mailbox', () => {   // a player stopped at the paved edge of a 3.6 m half-width road (a mail stop): the car eases past
    const t = make(straight(1000)), c = start(t, t.paths[0], 300), player = { x: 3.5, z: -340, speed: 0 };
    let closest = 99, widest = 0;
    run(t, player, 3600, () => {
      if (Math.abs(c.solid.z - player.z) < 4.5) closest = Math.min(closest, Math.abs(c.solid.x - player.x));
      widest = Math.max(widest, 1.65 - c.side);
    });
    if (c.along < 380) throw Error(`car held for ever behind a player stopped at the road edge: at ${c.along.toFixed(0)}`);
    if (closest < 2.2) throw Error(`car passed too close to the stopped player: ${closest.toFixed(2)} m`);
    if (Math.abs(c.side - 1.65) > .01) throw Error('car did not return to its lane: side ' + c.side.toFixed(2));
    return { passedTo: c.along, closest, eased: widest };
  });
  check('mailboxOncoming', () => {   // no pass while a car comes the other way; it passes after that car goes by
    const t = make(straight(2000)), c = start(t, t.paths[0], 300, 12, 0), player = { x: 3.5, z: -340, speed: 0 };
    const o = start(t, t.paths[1], 2000 - 340 - 100, 12, 1);   // oncoming, 100 m beyond the player
    let crossedNear = false;
    run(t, player, 4800, () => { if (o.active && Math.hypot(o.solid.x - c.solid.x, o.solid.z - c.solid.z) < 30 && c.side < 1.2) crossedNear = true; });
    if (crossedNear) throw Error('car eased into the other lane with an oncoming car near');
    if (c.along < 380) throw Error('car never passed after the oncoming car went by: at ' + c.along.toFixed(0));
    return 'pass';
  });
  check('centre', () => {   // a player stopped on the centre line cannot be passed: the car waits
    const t = make(straight(1000)), c = start(t, t.paths[0], 300); run(t, { x: 0, z: -340, speed: 0 }, 2400);
    if (c.along > 330 || c.side < 1.6) throw Error(`car drove round a player on the centre line: at ${c.along.toFixed(0)}, side ${c.side.toFixed(2)}`);
    return 'pass';
  });
  const side = [[[[0, 0], [0, -1000]]], [[[0, -500], [200, -500]], 2]];
  check('giveWay', () => {   // the player waits in a side road's mouth: stop 10 m short, then go on after 6 s
    const t = make(side), c = start(t, t.paths[0], 420); run(t, { x: 10, z: -500 }, 1000);
    if (c.speed > 1 || c.along > 495) throw Error(`car did not give way at the side road: ${c.speed.toFixed(2)} m/s, at ${c.along.toFixed(0)}`);
    const waited = c.along; run(t, { x: 10, z: -500 }, 1800);
    if (c.along < 520) throw Error('car waited for ever at a side road: at ' + c.along.toFixed(0));
    return { waited, then: c.along };
  });
  check('giveWayHighway', () => {   // the player on the highway itself at the junction: no give-way
    const t = make(side), c = start(t, t.paths[0], 420); run(t, { x: -1.65, z: -500, speed: 8 }, 1200);
    if (c.along < 520) throw Error('car waited at a side road for a player on the highway: at ' + c.along.toFixed(0));
    return 'pass';
  });
  check('shoulder', () => {   // a player stopped off the road 10 m past a side road (a mailbox): both lanes pass
    for (const k of [0, 1]) { const t = make(side), c = start(t, t.paths[k], 420); run(t, { x: 5, z: -510, speed: 0 }, 2400);
      if (c.along < 520) throw Error(`car (${k ? 'oncoming' : 'near'} lane) waited for a player stopped beside the road near a side road: at ${c.along.toFixed(0)}`); }
    return 'pass';
  });
  check('tooClose', () => {   // the player appears in the mouth when the car cannot stop 10 m short: it carries on
    const t = make(side), c = start(t, t.paths[0], 488); let slowest = 99; run(t, { x: 10, z: -500 }, 360, () => slowest = Math.min(slowest, c.speed));
    if (slowest < 6 || c.along < 520) throw Error(`car braked into the side road's mouth: slowest ${slowest.toFixed(2)}, at ${c.along.toFixed(0)}`);
    return { slowest };
  });
  check('crossroads', () => {   // a four-way crossing: both side roads are junctions, each gives way on its own side
    const t = make([[[[0, 0], [0, -1000]]], [[[0, -500], [200, -500]], 2], [[[0, -501], [-200, -501]], 2]]);
    const n = t.junctions.get(t.paths[0]).length;
    if (n !== 2) throw Error('crossroads kept ' + n + ' junction(s), not 2');
    const c = start(t, t.paths[0], 420); run(t, { x: -10, z: -501 }, 1000);
    if (c.speed > 1 || c.along > 495) throw Error('car did not give way to the player in the west side road');
    return 'pass';
  });
  check('spawn', () => {   // spawns are 100–600 m from the player and out of the camera, never in view (no pop-in)
    const t = make(straight(3000)), player = { x: 1.65, z: -1500, speed: 0 }, cam = camera(1.65, -1500, -1);
    let spawns = 0, bad = '';
    for (let frame = 0; frame < 600; frame++) {
      t.update(cam, player);
      for (const c of t.cars) if (c.active) {
        spawns++;
        const d = Math.hypot(c.solid.x - player.x, c.solid.z - player.z);
        if (d <= 100 || d > 600 || sees(cam, c.solid.x, c.solid.z)) bad ||= `spawn at ${d.toFixed(0)} m, in view ${sees(cam, c.solid.x, c.solid.z)}`;
        c.active = false;   // force a new spawn next frame
      }
    }
    if (spawns < 50) throw Error('too few spawns to judge: ' + spawns);
    if (bad) throw Error(bad);
    return { spawns };
  });
  check('despawn', () => {   // out of the camera: far cars and cars at a road's end go; in view, nothing goes
    const t = make(straight(3000)), player = { x: 1.65, z: -1500 }, cam = camera(1.65, -1500, -1);
    const behindFar = start(t, t.paths[0], 800, 12, 0);   // 700 m behind (south of) the player, out of view
    const behindNear = start(t, t.paths[0], 1300, 12, 1);   // 200 m behind, out of view, mid-road: stays
    const aheadFar = start(t, t.paths[0], 2280, 12, 2);   // 780 m ahead, in view: stays
    t.update(cam, player);
    if (behindFar.active) throw Error('a car 700 m away out of view did not go back to the pool');
    if (!behindNear.active) throw Error('a car 200 m away mid-road went back to the pool');
    if (!aheadFar.active) throw Error('a car in view went back to the pool (pop-out)');
    const t2 = make(straight(1000)), p2 = { x: 1.65, z: -940 }, cam2 = camera(1.65, -940, 1);   // camera looks back south
    const atEnd = start(t2, t2.paths[0], 980, 0, 0);   // 40 m from the player, at the road's end, out of view
    t2.update(cam2, p2);
    if (atEnd.active) throw Error('a car waiting at the road end out of view near the player stayed');
    return 'pass';
  });
  check('room', () => {   // update(..., false): a multiplayer room clears the road, and nothing moves or spawns
    const t = make(straight(3000)), player = { x: 1.65, z: -1500 }, cam = camera(1.65, -1500, -1);
    for (let i = 0; i < 60; i++) t.update(cam, player);
    if (!t.cars.some(c => c.active)) throw Error('no car spawned before the room test');
    for (let i = 0; i < 60; i++) { t.update(cam, player, false); t.step(1 / 60, player); }
    if (t.cars.some(c => c.active || c.mesh.visible)) throw Error('cars stayed on the road in a multiplayer room');
    return 'pass';
  });
  check('farCar', () => {   // a far car out of view is hidden, never left standing; a camera turned to it sees it where it is, after a climb
    const hill = { heightAt: (x, z) => -.12 * z };   // a 12% grade up to the north
    const t = new AmbientTraffic({ roads: [{ kind: 1, halfWidth: 3.6, bridge: false, pts: [[0, 0], [0, -3000]] }], deckHeight: () => null }, hill, false);
    const view = (to, fov) => { const k = new THREE.PerspectiveCamera(fov, 16 / 9, .1, 3000); k.position.set(1.65, 182, -1500); k.lookAt(...to); k.updateMatrixWorld(); k.updateProjectionMatrix(); return k; };
    const player = { x: 1.65, z: -1500, speed: 0 }, away = view([1.65, 182, -1600], 60), c = start(t, t.paths[0], 1000);   // 500 m south, ground 120 m
    const stale = () => c.mesh.visible && Math.hypot(c.mesh.position.x - c.solid.x, c.mesh.position.z - c.solid.z) > .5;
    t.update(away, player);
    c.along += 300; t.paths[0].at(c.along, c.side, c.solid);   // it drives 300 m north out of view and climbs 36 m
    t.update(away, player);
    if (stale()) throw Error(`a car out of view was left standing ${Math.hypot(c.mesh.position.x - c.solid.x, c.mesh.position.z - c.solid.z).toFixed(0)} m from where it is`);
    t.update(view([c.solid.x, 157, c.solid.z], 10), player);   // the camera turns to the car, 200 m away
    if (!c.mesh.visible || stale() || Math.abs(c.mesh.position.y - 156) > .1) throw Error(`a car in view was not shown where it is: visible ${c.mesh.visible}, y ${c.mesh.position.y.toFixed(1)}`);
    return 'pass';
  });
  check('passAbort', () => {   // player stopped at x 1.5 (the pass crosses the centre line); an oncoming car appears 60 m ahead mid-pass
    const t = make(straight(2000)), c = start(t, t.paths[0], 300, 12, 0), player = { x: 1.5, z: -340, speed: 0 };
    for (let i = 0; i < 6000 && !(c.passing && c.side < 0); i++) t.step(1 / 120, player);
    if (!(c.passing && c.side < 0)) throw Error('car never eased out to pass a player at x 1.5');
    const o = start(t, t.paths[1], 2000 - (c.along + 60), 12, 1); let hit = '', closest = 99, ended = false;
    run(t, player, 6000, () => {
      ended ||= !c.passing;
      if (o.active && Math.abs(o.solid.z - c.solid.z) < 4.5 && Math.abs(o.solid.x - c.solid.x) < 1.8) hit ||= `the passing car met the oncoming car at ${c.along.toFixed(0)}, side ${c.side.toFixed(2)}`;
      if (Math.abs(c.solid.z - player.z) < 4.6) closest = Math.min(closest, Math.abs(c.solid.x - player.x));
    });
    if (hit) throw Error(hit);
    if (!ended) throw Error('the pass did not end for the oncoming car');
    if (closest < 2.2) throw Error(`car came too close to the stopped player: ${closest.toFixed(2)} m`);
    if (c.along < 380 || Math.abs(c.side - 1.65) > .01) throw Error(`car did not pass after the oncoming car went by: at ${c.along.toFixed(0)}, side ${c.side.toFixed(2)}`);
    return { closest };
  });
  check('passClose', () => {   // a car at rest 6 m behind a player at x 1.5 starts to ease out; an oncoming car comes: it ends the pass, never creeping on in line
    const t = make(straight(2000)), c = start(t, t.paths[0], 334, 0, 0), player = { x: 1.5, z: -340, speed: 0 };
    for (let i = 0; i < 6000 && !(c.passing && c.side < 1); i++) t.step(1 / 120, player);
    if (!(c.passing && c.side < 1)) throw Error('car at rest close behind never started to ease out');
    const from = c.along, o = start(t, t.paths[1], 2000 - (c.along + 60), 12, 1); let crept = 0, ended = false, hit = '';
    run(t, player, 6000, () => {
      ended ||= !c.passing;
      if (Math.abs(c.solid.x - player.x) < 1.9 && Math.abs(c.solid.z - player.z) < 8) crept = Math.max(crept, c.along - from);
      if (o.active && Math.abs(o.solid.z - c.solid.z) < 4.5 && Math.abs(o.solid.x - c.solid.x) < 1.8) hit ||= 'the car met the oncoming car at ' + c.along.toFixed(0);
    });
    if (!ended) throw Error('a pass begun close behind did not end for the oncoming car');
    if (crept > .1) throw Error(`car crept ${crept.toFixed(2)} m on toward the player while in line with them`);
    if (hit) throw Error(hit);
    if (c.along < 380 || Math.abs(c.side - 1.65) > .01) throw Error('car did not pass after the oncoming car went by: at ' + c.along.toFixed(0));
    return 'pass';
  });
  check('passRolling', () => {   // the player rolls on (2 m/s² to V) as a pass starts, or while the car is beside them, with a car coming
    const out = {};
    for (const phase of ['start', 'beside']) for (const V of [4, 4.5, 5, 5.5]) {
      const t = make(straight(4000)), c = start(t, t.paths[0], 300, 12, 0), player = { x: 1.5, z: -340, speed: 0 };
      const ready = () => c.passing && (phase === 'start' || player.z - c.solid.z > -4.75);
      for (let i = 0; i < 7200 && !ready(); i++) t.step(1 / 120, player);
      if (!ready()) throw Error(`rolling player (${phase}): the pass never reached that point`);
      const o = phase === 'beside' ? start(t, t.paths[1], 4000 - c.along - 152, 12, 1) : null;
      let left = 0, hit = '', closest = 99;
      for (let k = 0; k < 120 * 90; k++) {
        player.speed = Math.min(V, player.speed + 2 / 120); player.z -= player.speed / 120; t.step(1 / 120, player);
        if (c.side < .9) left += 1 / 120;
        if (o && Math.abs(o.solid.z - c.solid.z) < 4.5 && Math.abs(o.solid.x - c.solid.x) < 1.8) hit ||= `met the oncoming car, side ${c.side.toFixed(2)}`;
        if (Math.abs(c.solid.z - player.z) < 4.6) closest = Math.min(closest, Math.abs(c.solid.x - player.x));
      }
      const where = `player rolling at ${V} m/s (${phase})`;
      if (hit) throw Error(`${where}: ${hit}`);
      if (left > 7) throw Error(`${where}: car stayed out of its lane ${left.toFixed(1)} s`);
      if (closest < 2.2) throw Error(`${where}: car came ${closest.toFixed(2)} m from the player`);
      out[phase + V] = +left.toFixed(1);
    }
    return out;
  });
  check('passSpawn', () => {   // while a car passes, no car spawns on the other carriageway within 150 m ahead of it
    const t = make(straight(3000)), player = { x: 1.5, z: -1500, speed: 0 }, back = camera(1.5, -1500, 1), c = start(t, t.paths[0], 1460, 12, 0);
    let frames = 0, near = 0, bad = '';
    for (let frame = 0; frame < 3600 && c.along < 1530; frame++) {
      t.update(back, player);
      for (const o of t.cars) if (o !== c && o.active) {
        const gap = 3000 - o.along - c.along;
        if (c.passing && o.path === t.paths[1] && gap > 100 - 40 && gap < 200) near++;
        if (c.passing && o.path === t.paths[1] && gap > -5 && gap < 150) bad ||= `a car spawned ${gap.toFixed(0)} m ahead of a passing car, coming toward it`;
        o.active = o.mesh.visible = false;   // keep the slots free: new spawn tries every frame
      }
      if (c.passing) frames++;
      t.step(1 / 60, player);
    }
    if (c.along < 1530) throw Error('car never passed in the spawn test');
    if (bad) throw Error(bad);
    if (near < 3) throw Error('too few spawns near the passing car to judge: ' + near);
    return { passingFrames: frames, spawnsNear: near };
  });
  check('centreMid', () => {   // the player moves to the centre line while a car eases out: the car ends the pass behind the player
    const t = make(straight(1000)), c = start(t, t.paths[0], 300), player = { x: 3.5, z: -340, speed: 0 };
    for (let i = 0; i < 6000 && !(c.passing && c.side < 1.2); i++) t.step(1 / 120, player);
    if (!c.passing) throw Error('car never started to pass the player at the edge');
    player.x = 0; let closest = 99;
    run(t, player, 2400, () => { if (Math.abs(c.solid.z - player.z) < 4.6) closest = Math.min(closest, Math.abs(c.solid.x - player.x)); });
    if (c.along > 340 - 5.75 || closest < 2.2) throw Error(`car went on past a player who moved to the centre line: at ${c.along.toFixed(1)}, closest ${closest.toFixed(2)}`);
    if (Math.abs(c.side - 1.65) > .01) throw Error('car did not return to its lane behind the player: side ' + c.side.toFixed(2));
    return { stoppedShort: +(340 - c.along).toFixed(1) };
  });
  check('stoppedOncoming', () => {   // a stopped car on the other carriageway 100 m beyond the player is not in the way: the car passes
    const t = make(straight(2000)), c = start(t, t.paths[0], 300, 12, 0), player = { x: 3.5, z: -340, speed: 0 }, hold = 2000 - 440;
    const o = start(t, t.paths[1], hold, 0, 1);
    run(t, player, 3600, () => { o.speed = 0; o.along = hold; t.paths[1].at(hold, 1.65, o.solid); });
    if (c.along < 380) throw Error('a stopped oncoming car beyond the pass held the car for ever: at ' + c.along.toFixed(0));
    return 'pass';
  });
  return out;
}

const THREE = await import('../web/node_modules/three/build/three.module.js');
const base = cases(await load(original), THREE);
console.log('PASS ' + JSON.stringify(base));

if (process.argv.includes('--mutations')) {
  const mutants = [
    ['spawn in view (pop-in)', 'if (y === null || this.inView(pose.x, y, pose.z)) continue;', 'if (y === null) continue;'],
    ['no 100 m spawn rule', 'if (far > 600 || far <= 100 ||', 'if (far > 600 ||'],
    ['no 600 m spawn rule', 'if (far > 600 || far <= 100 ||', 'if (far <= 100 ||'],
    ['no 650 m despawn', '|| far > 650)) {', ')) {'],
    ['despawn in view', 'if (!seen && (c.along', 'if ((c.along'],
    ['room keeps cars', 'if (!live) { for (const c of this.cars) c.active = c.mesh.visible = false; return; }', 'if (!live) return;'],
    ['no bridge joins', 'if (!best || count > 1 && best.cos < .7) return;', 'return;'],
    ['heading-ray cone instead of the lane', 'if (ahead > -4 && (Math.abs(across - c.side) < CLEAR || !c.passing && Math.abs(across - LANE) < CLEAR)) {', 'if (ahead > -4 && Math.abs((player.x - c.solid.x) * fz - (player.z - c.solid.z) * fx) < 5) {'],
    ['never pass a stopped player', 'if ((c.held += dt) > HOLD) c.passing = true;', 'c.held += dt;'],
    ['oncoming cars ignored', 'clear = this.oncomingClear(c, ahead + ZONE);', 'clear = true;'],
    ['pass not ended by an oncoming car', 'if (c.passing && !finish && (!canPass || !clear || rolling))', 'if (c.passing && !finish && (!canPass || rolling))'],
    ['pass not ended when the player moves to the centre line', 'if (c.passing && !finish && (!canPass || !clear || rolling))', 'if (c.passing && !finish && (!clear || rolling))'],
    ['spawn toward a passing car', ' || this.facesPass(path, along) ||', ' ||'],
    ['a stopped oncoming car beyond the pass blocks it', '(o.speed > .5 || gap < zone)', '(true)'],
    ['a car at rest close behind counts as past the point of no return', 'const unstoppable = ahead < TAIL || closing > .5 && Math.abs(across - c.side) >= APART && ahead - TAIL - 2 < closing * closing / 16;', 'const unstoppable = ahead - TAIL - 2 < closing * closing / 16;'],
    ['point of no return on the own speed of the car (old rule)', 'const unstoppable = ahead < TAIL || closing > .5 && Math.abs(across - c.side) >= APART && ahead - TAIL - 2 < closing * closing / 16;\n        const finish = unstoppable && (!rolling || closing > 0 && ahead + 8 < closing * FINISH);\n        if (c.passing && !finish && (!canPass || !clear || rolling))', 'const finish = ahead < TAIL || c.speed > .5 && Math.abs(across - c.side) >= APART && ahead - TAIL - 2 < c.speed * c.speed / 16;\n        if (c.passing && !finish && (!canPass || !clear))'],
    ['a rolling player does not end the pass', 'if (c.passing && !finish && (!canPass || !clear || rolling))', 'if (c.passing && !finish && (!canPass || !clear))'],
    ['finish the pass however long it takes', 'const finish = unstoppable && (!rolling || closing > 0 && ahead + 8 < closing * FINISH);', 'const finish = unstoppable;'],
    ['steer back toward a player while beside them', 'else if (ahead < TAIL + 1 && c.side < LANE - .05) side = Math.min(LANE, c.side);', ''],
    ['far car left standing (not hidden)', 'else { if (seen || far < NEAR) this.place(c); else c.mesh.visible = false; continue; }', 'else { if (seen || far < NEAR) this.place(c); continue; }'],
    ['view test at the stale height (no drift slack)', 'DRIFT * Math.abs(c.along - c.placedAt)', '0'],
    ['pass round a player on the centre line', 'const passSide = Math.min(LANE, across - EASE), canPass = passSide >= -LANE,', 'const passSide = Math.max(-3, Math.min(LANE, across - EASE)), canPass = true,'],
    ['no give-way', 'target = Math.min(target, Math.sqrt(6 * Math.max(0, a - 10))); giving = j;', 'giving = j;'],
    ['give-way not recorded (no patience)', 'giving = j; }', '}'],
    ['give way for ever', '(c.waited += dt) > PATIENCE', '(c.waited += dt) > 1e9'],
    ['give way to any player near a junction (old rule)', 'if (out > 3 && out < 20 && Math.abs(px * j.sz - pz * j.sx) < 5)', 'if (Math.hypot(px, pz) < 20)'],
    ['brake into the mouth', 'if (a - 10 < c.speed * c.speed / 16 && c.speed > 1 || a < 8) continue;', ''],
    ['crossroads deduped as one', '&& j.sx * sx + j.sz * sz > 0)) continue;', ')) continue;'],
    ['topmost deck everywhere (stands on an overpass)', 'if (y === null || !deck) return y;', 'if (y === null) return y;'],
    ['land only (falls through its own deck)', 'const top = this.roads.deckHeight(x, z);', 'const top = null;'],
    ['joined piece loses its first segment', 'if (near(pts[lo - 1], end)) lo--; else if (near(pts[hi + 1], end)) hi++;', ''],
    ['no pad past the mapped piece', 'const DECK_PAD = 20;', 'const DECK_PAD = 0;'],
    ['recovered spans ignored', 'let carried = false; for (const id of run.roads) if (ids.has(id)) { carried = true; break; }', 'const carried = false;'],
    ['six cars', 'i < (low ? 2 : 4)', 'i < (low ? 2 : 6)'],
    ['other drivers ignored', 'for (const o of this.others) {\n        const dx = o.x - c.solid.x, dz = o.z - c.solid.z, gap = dx * fx + dz * fz, along', 'for (const o of []) {\n        const dx = o.x - c.solid.x, dz = o.z - c.solid.z, gap = dx * fx + dz * fz, along'],
    ['other drivers in either lane', 'along > .5 ? Math.abs(bendOffset(dx, dz, c.solid.heading, o.heading) - (LANE - c.side)) < CLEAR', 'along > .5 ? true'],
    ['other drivers on a straight line (no bend offset)', 'along > .5 ? Math.abs(bendOffset(dx, dz, c.solid.heading, o.heading) - (LANE - c.side)) < CLEAR', 'along > .5 ? Math.abs(dx * fz - dz * fx) < CLEAR'],
    ['an oncoming AI judged by the bend offset (the 180 degree wrap)', 'if (gap <= 0 || gap >= 32 || along < -.5) continue;', 'if (gap <= 0 || gap >= 32) continue;'],
    ['a crossing AI ignored', ' || along < .95 && across : across)', ' || along < .95 && across : false)'],
    ['a crossing AI anywhere across', 'const across = gap < 20 && Math.abs(dx * Math.cos(c.solid.heading) + dz * Math.sin(c.solid.heading)) < .9 + o.spec.halfLength + .3;', 'const across = gap < 20;'],
    ['an oncoming AI does not stop a pass', 'if (Math.cos(o.heading - c.solid.heading) < -.5 && gap > -5', 'if (false && gap > -5'],
    ['an oncoming AI on any road stops a pass', ' && Math.abs(bendOffset(dx, dz, c.solid.heading, o.heading + Math.PI)) < 8\n', '\n'],
    ['the first straight-line rule (oncoming on a right-hand bend counts)', 'if (gap <= 0 || gap >= 32 || along < -.5) continue;', 'if (gap <= 0 || gap >= 32) continue; if (Math.abs(dx * fz - dz * fx) < CLEAR) { target = Math.min(target, Math.max(0, (gap - 12) * .5)); continue; } continue;'],
    ['the AI turning on ahead ignored (bend offset only within 60 degrees)', ' || along < .95 && across : across)', ' : across)'],
    ['queue ignored', ' && !this.queued(c)) {', ') {'],
    ['queue at any distance', 'gap > 0 && gap < QUEUE && Math.abs', 'gap > 0 && Math.abs'],
    ['queue in either lane', ' && Math.abs(bendOffset(dx, dz, c.solid.heading, o.heading) - (LANE - c.side)) < CLEAR) return true;', ') return true;'],
    ['every driver a queue', 'if (!o.queue) continue;', ''],
    ['keep-out ignored', ' || this.keepOut?.(pose.x, pose.z)) continue;', ') continue;'],
    ['spawn beside the AI', 'for (const o of this.others) if (Math.hypot(o.x - x, o.z - z) < 35) return true;', ''],
  ];
  let survived = 0;
  for (const [name, from, to] of mutants) {
    if (original.split(from).length !== 2) { console.log(`FAIL mutant "${name}": its anchor is not found once in the source`); survived++; continue; }
    try { cases(await load(original.replace(from, to)), THREE); console.log(`FAIL mutant "${name}" survived`); survived++; }
    catch (e) { console.log(`killed "${name}": ${e.message}`); }
  }
  if (survived) { console.log(`FAIL ${survived} of ${mutants.length} mutants survived`); process.exit(1); }
  console.log(`PASS all ${mutants.length} mutants killed`);
}
