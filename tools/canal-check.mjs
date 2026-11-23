import assert from 'node:assert/strict';
import { height } from './canal-ground.mjs';
import { readFileSync } from 'node:fs';
import { transformSync } from '../web/node_modules/esbuild/lib/main.js';
const source = readFileSync('web/src/canal-timer.ts', 'utf8');
function check(source) {
  const code = transformSync(source.replaceAll('export ', ''), { loader: 'ts' }).code;
  const { canalState: state, stopAtGate: stop } = new Function(code + ';return {canalState,stopAtGate}')();
  assert.equal(state(0).closed, false);
  assert.equal(state(12).closed, true);
  assert.equal(state(8.99).stopping, false);
  assert.equal(state(9).stopping, true);
  assert.equal(state(64).stopping, false);
  assert.equal(state(19.99).passing, false);
  assert.equal(state(20).passing, true);
  assert.equal(state(56).passing, false);
  assert.equal(state(64).closed, false);
  assert.equal(state(72).queue, 0);
  assert.equal(state(30).queue, 3);
  assert.deepEqual([0, 1, 2, 3].map(i => state(i * 100 + 30).vessel), [0, 1, 2, 3]);
  for (let t = 0; t < 400; t += .125) {
    const s = state(t);
    if (s.passing) assert.ok(s.closed && s.queue === 3, 'boats have a closed barrier and waiting cars');
    assert.ok(s.progress >= 0 && s.progress <= 1);
  }
  for (const side of [-1, 1]) {
    assert.equal(stop(side * (60 - 1e-10), side * 59.9, side, 60), side * 60, 'reprojection roundoff cannot leak');
    assert.equal(stop(side * 90, side * -90, side, 60), side * 60, 'fast swept crossing stops');
    assert.equal(stop(side * 50, side * 80, side, 60), side * 80, 'car on span can leave');
    assert.equal(stop(side * 90, side * 85, side, 60), side * 85, 'distant car moves');
  }
}
check(source);
for (const [name, from, to] of [['barrier removed', 'out.closed = t >= CANAL_WARNING && t < 64', 'out.closed = false'], ['swept stop removed', '? line : after', '? after : after'], ['roundoff guard removed', 'gate - 1e-6', 'gate']]) {
  assert.ok(source.includes(from));
  assert.throws(() => check(source.replace(from, to)), undefined, name + ' must fail');
  console.log('KILLED', name);
}
console.log('PASS canal timer and swept barrier');
const { buildSync } = await import('../web/node_modules/esbuild/lib/main.js');
const canalSource = readFileSync('web/src/canal.ts', 'utf8');
async function productionCheck(source) {
  const built = buildSync({ stdin: { contents: source + "\nexport { AmbientTraffic } from './ambient-traffic';", resolveDir: new URL('../web/src/', import.meta.url).pathname, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
  const { Canal, AmbientTraffic } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
  // Real traffic coupled to the canal: a car meeting the stop line at any distance never freezes the cycle, and none is
  // over the deck while it is hidden.
  // Real traffic coupled to the canal on a straight 90 m span (deck ends at x = ±45). Each run: cars on the reverse
  // path (driving -x) and a still player. The cycle must never freeze and no car may be over the hidden deck.
  // A start is metres from mid-span on the car's approach; [start, 0] drives the forward path (+x) instead.
  const coupled = (starts, player, label, waits = false, from = 8.99) => {
    const span = { id: 1, pts: [[-45, 0], [45, 0]] };
    const c = new Canal({ nearest: () => ({ road: span }), deckHeight: () => 0, showCanalDeck() {} }, { heightAt: () => 0 }, [0, 0], -.2);
    const t = new AmbientTraffic({ roads: [{ kind: 1, halfWidth: 3.6, bridge: false, pts: [[-1000, 0], [1000, 0]] }], deckHeight: () => null }, { heightAt: () => 0 }, false);
    t.others = c.drivers; t.keepOut = c.keepOut; c.traffic = t.cars;
    const cars = starts.map((start, n) => { const [at, path] = Array.isArray(start) ? start : [start, 1], car = t.cars[n];
      car.path = t.paths[path]; car.along = 1000 - at; car.speed = 12; car.active = true; car.path.at(car.along, 1.65, car.solid); t.place(car); return car; });
    c.seconds = from;
    let transits = 0, was = false, lowered = 0, upWhileClosed = 0, lateDriveOn = 0; const starts_ = [], stopped = cars.map(() => 0); let longest = 0;
    const outside = cars.map(car => Math.abs(car.solid.x) >= 57);
    for (let i = 0; i < 60 * 150; i++) {
      t.step(1 / 120, player); t.step(1 / 120, player); c.update(1 / 60, player);
      const s = c.seconds % 100, passing = s >= 20 && s < 56;
      if (passing) for (const car of cars) assert.ok(Math.abs(car.solid.x) >= 45 + 2.25 || Math.abs(car.solid.z) > 6, `${label}: traffic over the hidden deck at ${car.solid.x.toFixed(1)}`);
      if (passing && !was) { transits++; starts_.push(Math.round(c.seconds)); } was = passing;
      // A closed arm (54 m out) never comes down through a waiting car.
      if (s >= 12 && s < 64) for (const car of cars) if (car.speed < .5 && Math.abs(car.solid.z) < 6)
        assert.ok(Math.abs(car.solid.x) - 2.25 >= 54 || Math.abs(car.solid.x) + 2.25 <= 54, `${label}: arm through a car at ${car.solid.x.toFixed(1)}`);
      cars.forEach((car, n) => { stopped[n] = car.speed < .5 && car.along < 1985 - 30 ? stopped[n] + 1 / 60 : 0; longest = Math.max(longest, stopped[n]); });
      // A lowered arm never comes down on a moving car either: none under it, and none between the arms heading for it.
      for (const arm of c.arms) {
        if (arm.rotation.x !== 0) { if (s >= 12.05 && s < 64) upWhileClosed++; continue; }
        lowered++;
        const side = Math.sign(arm.userData.along);
        for (const car of cars) if (car.active && Math.abs(car.solid.z) < 6) {
          assert.ok(Math.abs(side * car.solid.x - 54) >= 2.25, `${label}: arm down on a car at ${car.solid.x.toFixed(1)}, ${c.seconds.toFixed(2)} s`);
          assert.ok(!(Math.abs(car.solid.x) < 54 && side * Math.sin(car.solid.heading) > 0), `${label}: arm down across the exit of a car at ${car.solid.x.toFixed(1)}, ${c.seconds.toFixed(2)} s`);
        }
      }
      // A car that drives on past the stand-in (12 m beyond the deck end) does so within 1.5 s of it appearing at 9 s.
      cars.forEach((car, n) => { const out = Math.abs(car.solid.x) >= 57;
        if (outside[n] && !out && Math.abs(car.solid.z) < 6 && s >= 9 && s < 64) lateDriveOn = Math.max(lateDriveOn, s - 9); outside[n] = out; });
    }
    if (!waits) assert.ok(c.seconds > 150, `${label}: the canal froze at ${c.seconds.toFixed(2)} s (cars at ${cars.map(car => car.solid.x.toFixed(1))})`);
    return { transits, starts: starts_, at: cars.map(car => car.solid.x), longest, seconds: c.seconds, drivers: c.drivers.length, lowered, upWhileClosed, lateDriveOn };
  };
  // The coupled runs are the slow part: they run after the quick checks below, so most mutants fail fast.
  const coupledRuns = () => {
  const far = { x: 0, z: 300, vx: 0, vz: 0, speed: 0 };
  // A car meeting the stop line at any distance.
  // Cars from 46 m to about 75 m drive on (already past the stand-in, or too close to stop for it): those on both paths,
  // so each arm is the near arm for some and the far arm for others.
  let lateDriveOn = 0;
  for (let start = 46; start <= 110; start += 2) for (const path of start <= 80 ? [1, 0] : [1]) {
    const one = coupled([[start, path]], far, 'stop line, car at ' + start + ' on path ' + path);
    assert.deepEqual(one.starts, [20, 120], 'every vessel passes, car at ' + start);
    // A car that stops for the stand-in never holds an arm up: both stay down for the whole closure.
    if (start >= 82) assert.equal(one.upWhileClosed, 0, 'arms down all closure, car at ' + start + ' waiting');
    lateDriveOn = Math.max(lateDriveOn, one.lateDriveOn);
  }
  // A guard on the STOP_LINE comment (the old one said 0.75 s), and that some car does drive on.
  assert.ok(lateDriveOn > 0 && lateDriveOn <= 1.5, 'the STOP_LINE comment: drive-on up to 1.5 s, ' + lateDriveOn);
  // A player waiting at the far gate in the traffic's lane, facing it: the car stops 12 m short of them, off the deck.
  const lane = (() => { const t = new AmbientTraffic({ roads: [{ kind: 1, halfWidth: 3.6, bridge: false, pts: [[-1000, 0], [1000, 0]] }], deckHeight: () => null }, { heightAt: () => 0 }, false); const p = { x: 0, z: 0, heading: 0 }; t.paths[1].at(1000, 1.65, p); return p.z; })();
  // The player drives at the closed far gate in that lane (no queue there) and the canal itself stops them.
  const waiting = { x: -30, z: lane, vx: 0, vz: 0, speed: 0 };
  { const span = { id: 1, pts: [[-45, 0], [45, 0]] }, g = new Canal({ nearest: () => ({ road: span }), deckHeight: () => 0, showCanalDeck() {} }, { heightAt: () => 0 }, [0, 0], -.2);
    g.seconds = 30; g.update(0, far); g.resolve(waiting, -200, lane); assert.ok(waiting.x < -50, 'gate stops the player: ' + waiting.x); }
  for (const start of [20, 0, -20]) {
    const one = coupled([start], waiting, 'player at the gate, car at ' + start);
    assert.deepEqual(one.starts, [20, 120], 'the car waits off the deck and every vessel passes: ' + JSON.stringify(one));
  }
  // A player parked on the span (off the lanes, watching for a boat): the cycle waits with the road open, so no car
  // waits at an empty stop line.
  for (const time of [8.99, 10.5]) {   // parked before the stopping, or driven on during it
    const parked = coupled([120, [140, 0]], { x: 0, z: 5, vx: 0, vz: 0, speed: 0 }, 'player parked on the span', true, time);
    assert.ok(parked.longest < 8 && parked.seconds % 100 < 9 && parked.drivers === 0, 'the road stays open around a parked player: ' + JSON.stringify(parked));
  }
  // A player stopped in the approach lane outside the arm but inside the gate band (13 or 15.5 m past the deck end; the
  // arm is at 9 m), on either approach, with traffic coming: the cycle closes, the arms come down and a vessel passes.
  // (`lane` is the reverse path's lane: the exit lane at -x, the approach lane at +x.)
  for (const [out, side, z] of [[13, -1, -lane], [13, 1, lane], [15.5, -1, -lane], [15.5, 1, lane]]) {
    const label = `player waiting ${out} m out, side ${side}, lane ${z.toFixed(2)}`;
    const one = coupled([120, [140, 0]], { x: side * (45 + out), z, vx: 0, vz: 0, speed: 0 }, label);
    assert.deepEqual(one.starts, [20, 120], label + ': every vessel passes: ' + JSON.stringify(one));
    assert.ok(one.lowered > 0 && one.upWhileClosed === 0, label + ': the arms come down and stay down: ' + JSON.stringify(one));
  }
  // Waiting anywhere else across the road 13 m out (the centre line, just right of it, the exit lane), with traffic that
  // leaves by the other end: the same, the cycle closes and every vessel passes. (A car crossing toward a player it cannot
  // get round waits behind them on the deck; that holds the closure, as below.)
  for (const side of [-1, 1]) for (const z of [0, side * .9, side * 1.9]) {
    const label = `player waiting 13 m out at ${z} across, side ${side}`;
    const one = coupled([[140, side < 0 ? 0 : 1]], { x: side * 58, z, vx: 0, vz: 0, speed: 0 }, label);
    assert.ok(one.starts[0] === 20 && one.upWhileClosed === 0, label + ': every vessel passes, arms down: ' + JSON.stringify(one));
  }
  // In the exit lane, 13 m out, with a car that drove on crossing toward them: it would stop 12 m short, on the deck, and
  // cost the vessel. So the closure waits with the road open (the car waits, then goes round them), then runs.
  for (const side of [-1, 1]) {
    const label = `player waiting 13 m out in the exit lane, car crossing toward them, side ${side}`;
    const one = coupled([[55, side < 0 ? 1 : 0]], { x: side * 58, z: side * 1.9, vx: 0, vz: 0, speed: 0 }, label, true);
    // Held a few seconds (not for ever) while the car went round them; then both vessels pass (no turn-back).
    assert.ok(one.seconds > 130 && one.seconds < 149 && one.longest < 8, label + ': the closure waits for the car: ' + JSON.stringify(one));
    assert.deepEqual(one.starts, [20, 120], label + ': every vessel passes: ' + JSON.stringify(one));
  }
  // Two cars behind that player: the second is still on the deck, so the vessel turns back after HOLD seconds.
  const two = coupled([20, 40], waiting, 'player at the gate, two cars');
  assert.deepEqual(two.starts, [120], 'first vessel turned back, the next one passes: ' + JSON.stringify(two));
  };
  const road = { id: 1, pts: [[-45, 0], [45, 0]] };
  let visible, ground = 8;
  const canal = new Canal({ nearest: () => ({ road }), deckHeight: () => 4, showCanalDeck: (_id, v) => { visible = v; } }, { heightAt: () => ground }, [0, 0], -.2);
  let draws = 0, triangles = 0;
  canal.group.traverse(node => {
    if (!node.isMesh) return;
    draws++; triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3 * (node.isInstancedMesh ? 6 : 1);
    assert.equal(node.material.map, null, 'no image textures');
  });
  assert.ok(draws <= 9 && triangles < 2000, 'bounded traffic geometry');
  const car = { x: 0, z: 0, vx: 0, vz: 0, speed: 0 };
  canal.seconds = 11.99; canal.update(.05, car); assert.equal(canal.seconds, 11.99, 'occupied span postpones closure');
  car.x = 120; canal.update(.05, car); assert.ok(canal.seconds > 12);
  for(let t=20;t<56;t+=.25) {
    canal.seconds=t;canal.update(0,car);const boat=canal.boats[0];
    assert.ok(height(boat.position.x,-boat.position.z)<-.2,'production boat position stays in canal');
  }
  // Ambient highway traffic: a car on the span holds the transit (the deck hides at 20 s), not the warning.
  const traffic = { active: true, solid: { x: 10, z: 1, heading: Math.PI / 2 } }; canal.traffic = [traffic];
  canal.seconds = 19.99; canal.update(.05, car); assert.equal(canal.seconds, 19.99, 'traffic on the span postpones the transit');
  traffic.solid.x = 120; canal.update(.05, car); assert.ok(canal.seconds > 20, 'clear span starts the transit');
  traffic.solid.x = 10; traffic.active = false; canal.seconds = 19.99; canal.update(.05, car); assert.ok(canal.seconds > 20, 'pooled car ignored');
  car.x = 0; canal.seconds = 19.99; canal.update(.05, car); assert.equal(canal.seconds, 19.99, 'player on the span postpones the transit'); car.x = 120;
  traffic.solid.x = 50; traffic.active = true; canal.seconds = 19.99; canal.update(.05, car); assert.ok(canal.seconds > 20, 'a car stopped off the deck does not hold the transit');
  car.x = 50; canal.seconds = 19.99; canal.update(.05, car); assert.ok(canal.seconds > 20, 'nor does the player off the deck'); car.x = 120;
  traffic.active = true; traffic.solid.x = 10; canal.seconds = 11.99; canal.update(.05, car); assert.ok(canal.seconds > 12, 'traffic leaving the span does not hold the barrier');
  // The give-way test: a player under the arm, or rolling at it too fast to stop clear, holds the closure; one stopped
  // or slow outside it does not (fault 2 of #123: waiting 9-16 m out held the barrier up for as long as they waited).
  traffic.solid.x = 300;
  for (const side of [-1, 1]) {
    for (const [out, inward, holds, what] of [[11, 0, true, 'under the arm'], [13, 0, false, 'stopped outside the arm'],
      [15.5, 3, false, 'slow outside the arm'], [15.5, 14, true, 'too fast to stop clear of the arm'], [15.5, -14, false, 'rolling away fast'],
      [17, 30, false, 'beyond the gate line']]) {
      Object.assign(car, { x: side * (45 + out), z: -side * 1.9, vx: -side * inward });
      canal.seconds = 11.99; canal.update(.05, car);
      assert.equal(canal.seconds === 11.99, holds, `player ${what} (side ${side}) ${holds ? 'holds' : 'does not hold'} the closure`);
    }
    // The player's own body: the car (half-diagonal 2.49 m) waiting nose up to the arm, 12 m out, does not hold it; the
    // truck (3.61 m) there does, as its corner could be under the arm.
    for (const [spec, out, holds] of [[{ halfLength: 2.3, halfWidth: .95 }, 12, false], [{ halfLength: 2.3, halfWidth: .95 }, 11.3, true], [{ halfLength: 3.4, halfWidth: 1.22 }, 12, true]]) {
      const body = { x: side * (45 + out), z: -side * 1.9, vx: 0, vz: 0, speed: 0, spec };
      canal.seconds = 11.99; canal.update(.05, body);
      assert.equal(canal.seconds === 11.99, holds, `a ${spec.halfLength} m body ${out} m out ${holds ? 'holds' : 'does not hold'} the closure`);
    }
  }
  // In the exit lane 13 m out: a car between the arms heading for the player's end holds the closure (it would stop on the
  // deck behind them); one under that end's arm on its way in, away from them, does not.
  for (const [x, heading, holds, what] of [[0, Math.PI / 2, true, 'crossing toward them'], [53, -Math.PI / 2, false, 'under their arm, heading away']]) {
    canal.traffic = [{ active: true, solid: { x, z: x ? -1.9 : 1.9, heading } }];
    Object.assign(car, { x: 45 + 13, z: 1.9, vx: 0 });
    canal.seconds = 11.99; canal.update(.05, car);
    assert.equal(canal.seconds === 11.99, holds, `an exit-lane waiter with a car ${what} ${holds ? 'holds' : 'does not hold'} the closure`);
  }
  canal.traffic = [traffic];
  Object.assign(car, { x: 120, z: 0, vx: 0 });
  assert.equal(canal.keepOut(0, 0), true, 'no spawn on the closed span'); assert.equal(canal.keepOut(0, 30), false, 'spawn off the span');
  canal.seconds = 5; canal.update(0, car); assert.equal(canal.keepOut(0, 0), false, 'spawn on the open span (state of the last update)');
  // Stand-ins: one stop line per closed gate (traffic stops 12 m short, on the player's gate line) and each queue's tail.
  traffic.solid.x = 300; canal.seconds = 30; canal.update(0, car);
  assert.equal(canal.drivers.length, 4, 'two gates and two queue tails');
  for (const side of [-1, 1]) {
    const mine = canal.drivers.filter(d => d.x * side > 0).map(d => Math.abs(d.x)).sort((a, b) => a - b);
    assert.deepEqual(mine.map(x => Math.round(x * 100) / 100), [57, 80], 'stop line and third waiting car');
    for (const d of canal.drivers.filter(d => d.x * side > 0)) {
      assert.ok(Math.abs(d.z + side * 1.9) < 1e-9, 'stand-in in the waiting lane');
      assert.ok(Math.abs(Math.sin(d.heading) + side) < 1e-9 && Math.abs(Math.cos(d.heading)) < 1e-9, 'stand-in faces the span');
      assert.ok(d.queue && d.speed === 0, 'stopped queue');
    }
  }
  canal.seconds = 9.5; canal.update(0, car); assert.equal(canal.drivers.length, 2, 'traffic stops 3 s before the arms drop');
  canal.seconds = 8.5; canal.update(0, car); assert.equal(canal.drivers.length, 0, 'open road before the warning');
  canal.seconds = 66; canal.update(0, car); assert.equal(canal.drivers.length, 2, 'open gates keep only the waiting cars');
  canal.seconds = 80; canal.update(0, car); assert.equal(canal.drivers.length, 0, 'open road');
  traffic.solid.x = -66; traffic.solid.z = 1.9; canal.seconds = 30; canal.update(0, car);
  assert.ok(canal.queueSlots.slice(0, canal.queueCount).every(s => Math.abs(s.along + 66) >= 4.5), 'no queue car on a waiting traffic car');
  assert.equal(canal.queueCount, 5);
  traffic.active = false; canal.update(0, car); assert.equal(canal.queueCount, 6); canal.traffic = [];
  canal.seconds = 30; canal.update(.05, car, false);
  assert.ok(canal.seconds === 0 && visible && canal.drivers.length === 0 && canal.queues.count === 0, 'a multiplayer room keeps the road open');
  canal.seconds = 30; canal.update(0, car); assert.equal(visible, false);
  assert.equal(canal.queues.count, 6);
  assert.equal(canal.arms[0].position.y, 9.2, 'barrier follows approach ground rather than centre deck');
  for (const side of [-1, 1]) {
    assert.equal(canal.queueSlots.find(s => s.along * side > 0).across, -side * 1.9, 'right lane queue');
    car.x = side * 80; car.z = -side * 1.9;
    canal.resolve(car, side * 110, car.z); assert.equal(car.x, side * 85, 'queue tail stops player');
    car.x = side * 80; car.z = side * 1.9;
    canal.resolve(car, side * 110, car.z); assert.equal(car.x, side * 80, 'opposite lane has no queue on this approach');
  }
  canal.seconds=30;car.x=0;car.z=5;canal.resolve(car,0,8);
  assert.equal(car.z,8,'closed span rejects side entry');
  // A player who waited inside the gate line while the arms came down is stopped at the arm (nose clear of it).
  for (const side of [-1, 1]) {
    car.x = side * (45 + 10); car.z = side * 1.9; canal.resolve(car, side * (45 + 14), car.z);
    assert.ok(Math.abs(car.x - side * (45 + 9 + 3.7)) < 1e-9, 'the lowered arm stops a player who waited inside the gate line: ' + car.x);
    const body = { x: side * (45 + 10), z: side * 1.9, vx: 0, vz: 0, speed: 0, spec: { halfLength: 2.3, halfWidth: .95 } };
    canal.resolve(body, side * (45 + 12), body.z);
    assert.ok(Math.abs(body.x - side * (45 + 9 + Math.hypot(2.3, .95))) < 1e-9, 'and a car at its own half-diagonal from the arm: ' + body.x);
  }
  // An arm left up for a traffic car that drove on is no way in for the player: the barrier keeps to the timer.
  const leaving = { active: true, solid: { x: 53, z: 1.9, heading: Math.PI / 2 } };   // under arm +1, on its way out
  canal.traffic = [leaving];
  canal.update(0, car); assert.ok(canal.arms[1].rotation.x !== 0 && canal.arms[0].rotation.x === 0, 'only the arm over a leaving car waits up');
  leaving.solid.heading = -Math.PI / 2; canal.update(0, car);
  assert.ok(canal.arms.every(a => a.rotation.x !== 0), 'a car under the near arm on its way in holds both: it leaves by the far one');
  leaving.solid.z = 20; canal.update(0, car); assert.ok(canal.arms.every(a => a.rotation.x === 0), 'a car off the road holds no arm');
  leaving.solid.z = 1.9; leaving.solid.heading = Math.PI / 2; canal.update(0, car);
  for (const side of [1, -1]) for (const z of [1.9, -1.9]) {
    car.x = side * (45 + 14); car.z = z; canal.resolve(car, side * (45 + 20), car.z);
    assert.equal(car.x, side * (45 + 16), 'the gate holds beside an arm left up for a car, and beside a lowered one');
    car.x = 45 + 2; car.z = z; canal.resolve(car, 45 + 2, 8); assert.equal(car.z, 8, 'no side entry beside an arm left up');
  }
  canal.traffic = []; canal.update(0, car); assert.ok(canal.arms.every(a => a.rotation.x === 0), 'both arms down once it is through');
  // Reprojection of a rotated world stop may fall a few ulps inside the line.
  const rotated = new Canal({ nearest: () => ({ road: { ...road, pts: [[9957,10015],[10043,9985]] } }), deckHeight: () => 4, showCanalDeck: () => {} }, { heightAt: () => 4 }, [0,0], -.2);
  rotated.seconds=30;car.x=300;car.z=300;rotated.update(0,car);
  const gate=rotated.halfLength+40;
  let pos=rotated.point(-gate-1,1.9);car.x=pos.x;car.z=pos.y;
  for(let i=0;i<500;i++) {
    const x=car.x,z=car.z;
    car.x+=rotated.along.x*.1;car.z+=rotated.along.y*.1;rotated.resolve(car,x,z);
    assert.ok(rotated.project(car.x,car.z).along<=-gate+1e-7,'rotated queue stop stays solid over repeated physics steps');
  }
  // A stopped player must have a free slot while the queue grows around them.
  car.x = -71; car.z = 1.9;
  for (const time of [12, 15, 18, 30]) {
    canal.seconds = time; canal.update(0, car);
    assert.ok(canal.queueSlots.slice(0, canal.queueCount).every(s => Math.abs(s.along - car.x) >= 4.5 || Math.abs(s.across - car.z) >= 2.5), 'no queue overlaps player');
    car.x = -64;canal.resolve(car, -71, 1.9);assert.equal(car.x, -71, 'first car still stops player inside growing queue');
    car.x = -71;
  }
  ground = null; canal.update(0, car); assert.equal(canal.queueCount, 0);
  car.x = -70; canal.resolve(car, -110, 1.9); assert.equal(car.x, -70, 'no invisible queue blocker');
  canal.seconds = 75; canal.update(0, car); assert.equal(visible, true);
  car.x = 0; canal.resolve(car, 100, 0); assert.equal(car.x, 0, 'open road releases player');
  const time = canal.seconds; canal.update(0, car); assert.equal(canal.seconds, time, 'paused dt freezes timer');
  const arm = canal.arms[0], { Vector3 } = await import('../web/node_modules/three/build/three.module.js');
  // Use a sloped road axis to expose Euler ordering; local arm Z must rise vertically.
  arm.rotation.y = .3; arm.updateMatrix();
  const axis = new Vector3(0,0,1).transformDirection(arm.matrix); assert.ok(Math.abs(axis.y) > .9999, 'raised arm vertical');
  coupledRuns();
}
try {
  await productionCheck(canalSource);
  for (const [name, from, to] of [
    ['side entry removed', 's.closed && Math.abs(before.across) > 6', 'false && Math.abs(before.across) > 6'],
    ['occupancy removed', 'from < CANAL_WARNING && to >= CANAL_WARNING && this.blocks(p, car)', 'false'],
    ['give-way at the gate band in the approach lane (#123 fault 2)', ': this.armLine(car);', ': this.halfLength + GATE;'],
    ['give-way ignores a player under the arm', 'return this.halfLength + ARM + (car.spec', 'return this.halfLength + (car.spec'],
    ['a truck-sized clearance for every body', '(car.spec ? Math.hypot(car.spec.halfLength, car.spec.halfWidth) : NOSE)', 'NOSE'],
    ['the exit-lane hold counts a car heading away', 'this.armHeld(side, false) ?', 'this.armHeld(side) ?'],
    ['a player rolling at the arm ignored', 'return inward > 0 && out - inward * inward / (2 * BRAKE) < clear;', 'return false;'],
    ['no arm line for a player inside the gate line', 'along = stopAtGate(before.along, along, side, this.armLine(car));', ''],
    ['arms ignore cars that drove on (#123 fault 1)', 'if (under && side * q.along > reach - TRAFFIC_NOSE || side * toward > 0) return true;', ''],
    ['exit arm closes ahead of a car', 'under && side * q.along > reach - TRAFFIC_NOSE || side * toward > 0', 'under && side * q.along > reach - TRAFFIC_NOSE'],
    ['near arm closes on a car', 'under && side * q.along > reach - TRAFFIC_NOSE || side * toward > 0', 'side * toward > 0'],
    ['the player passes an arm left up for a car', 'if (s.closed) for (const side of SIDES) {', 'if (s.closed) for (const side of SIDES) if (!this.armHeld(side)) {'],
    ['the exit lane waits only from the arm', 'side * p.across > EXIT_REACH && this.armHeld(side, false) ? this.halfLength + GATE :', 'false ? this.halfLength + GATE :'],
    ['the exit lane waits for the whole band with no car crossing', 'side * p.across > EXIT_REACH && this.armHeld(side, false) ?', 'side * p.across > EXIT_REACH ?'],
    ['a player rolling away holds the closure', 'return inward > 0 && out', 'return out'],
    ['waiting cars hold the arms up', 'Math.abs(q.along) >= reach + TRAFFIC_NOSE', 'Math.abs(q.along) >= reach + 30'],
    ['a car off the road holds an arm', 'if (Math.abs(q.across) >= 6 || Math.abs(q.along) >= reach', 'if (Math.abs(q.along) >= reach'],
    ['transit hold removed', 'from < CANAL_TRANSIT && to >= CANAL_TRANSIT && (this.onDeck(p) || this.trafficOnDeck())', 'false'],
    ['transit held for the whole gate band', 'this.halfLength + DECK', 'this.halfLength + GATE'],
    ['player gate at the old 13 m', 'GATE = 16,', 'GATE = 13,'],
    ['the transit waits for ever', '(this.held += dt) > HOLD', 'false'],
    ['stop line at the deck end (old)', 'STOP_LINE = 12', 'STOP_LINE = 1'],
    ['stop line inside the arm (round 2)', 'STOP_LINE = 12', 'STOP_LINE = 6'],
    ['the closure waits for ever', '(this.held += dt) > GIVE_WAY', 'false'],
    ['traffic stops for a parked player', 'if (from < CANAL_STOPPING && to >= CANAL_STOPPING && this.blocks(p, car)) return;', ''],
    ['room keeps the canal', 'if (!live) { this.seconds = 0; this.held = 0; return; }', ''],
    ['traffic slot protection removed', 'if (Math.abs(q.along - along) < 4.5', 'if (false'],
    ['gate stand-in removed', 's.stopping ? this.halfLength + STOP_LINE : 0', '0'],
    ['gate stand-in only once closed', 's.stopping ? this.halfLength + STOP_LINE : 0', 's.closed ? this.halfLength + STOP_LINE : 0'],
    ['stand-in faces away', 'Math.atan2(-side * this.along.x, side * this.along.y)', 'Math.atan2(side * this.along.x, -side * this.along.y)'],
    ['keep-out removed', 'this.state.stopping && this.onSpan(', 'false && this.onSpan('],
    ['lane flipped', 'across = -side * 1.9', 'across = side * 1.9'],
    ['queue stop removed', 'i < this.queueCount', 'i < 0'],
    ['player slot protection removed', 'Math.abs(p.along - along) < 4.5', 'false'],
  ]) {
    assert.ok(canalSource.includes(from));
    await assert.rejects(() => productionCheck(canalSource.replace(from, to)), undefined, name + ' must fail');
    console.log('KILLED', name);
  }
  console.log('PASS production canal occupancy, lane, growth, barrier, visibility and release');
} catch (e) { console.error(e.message); process.exitCode = 1; }

const routeSource = readFileSync('web/src/canal-route.ts', 'utf8');
function routeCheck(source) {
  const code = transformSync(source.replaceAll('export ', ''), { loader: 'ts' }).code;
  const r = new Function(code + ';return CANAL_ROUTE')();
  let high = -Infinity;
  // Entire largest vessel envelope: 22 m long, 6 m wide, plus 1 m side clearance.
  for (let t = -r.halfLength-12; t <= r.halfLength+12; t += .5) for (const w of [-4, 0, 4]) {
    const e = r.east + r.eastward * t - r.northward * w;
    const n = r.north + r.northward * t + r.eastward * w;
    const h = height(e,n);assert.ok(h !== null && h < -.2, 'whole boat route must remain in water: '+JSON.stringify({e,n,h}));
    high = Math.max(high,h);
  }
  return high;
}
console.log('PASS baked water corridor maximum ground',routeCheck(routeSource));
const perpendicular = routeSource.replace('0.7193398003386512', '0.325').replace('-0.6946583704589973', '-0.946');
assert.throws(() => routeCheck(perpendicular));console.log('KILLED bridge-perpendicular route');
// #156: modern decks are one merged mesh. showCanalDeck leaves the canal span's deck out of it at once (drawing only);
// its approaches stay drawn over their road cuts. An unchanged state does not re-merge, since the canal sets it every frame.
{
  const built = buildSync({ stdin: { contents: "export { ModernBridges } from './modern-bridges'; export * as THREE from 'three';", resolveDir: new URL('../web/src/', import.meta.url).pathname, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
  const { ModernBridges, THREE } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
  // Vertex i carries x = span id * 1000 + i, so the merged mesh shows which vertices were kept.
  const geometry = (id, n) => { const g = new THREE.BufferGeometry(); for (const a of ['position', 'normal', 'color']) g.setAttribute(a, new THREE.BufferAttribute(Float32Array.from({ length: n * 3 }, (_, k) => k % 3 ? 0 : Math.abs(id) * 1000 + k / 3), 3)); return g; };
  const span = (id, n, approach, members = [id]) => ({ road: { id }, members: new Set(members), x0: 1e9, z0: 1e9, x1: 1e9, z1: 1e9, geometry: geometry(id, n), approachRanges: Int32Array.from(approach) });
  const decks = Object.assign(Object.create(ModernBridges.prototype), { spans: [span(35, 12, [0, 3, 6, 9]), span(-7, 9, [0, 3], [36, 37])], hidden: new Set(), dirty: true, mesh: null,
    material: new THREE.MeshBasicMaterial(), group: new THREE.Group(), audit: { merges: 0 }, terrain: {}, ensure() { throw Error('no span builds in this fixture'); } });
  const xs = () => [...decks.mesh.geometry.getAttribute('position').array].filter((_, k) => k % 3 === 0);
  const range = (id, a, b) => Array.from({ length: b - a }, (_, i) => id * 1000 + a + i);
  decks.update(new THREE.Vector3());
  assert.deepEqual(xs(), [...range(35, 0, 12), ...range(7, 0, 9)], 'both spans drawn');
  decks.setHidden(35, true);
  assert.deepEqual(xs(), [...range(35, 0, 3), ...range(35, 6, 9), ...range(7, 0, 9)], 'at once, the canal deck leaves the mesh and its approaches stay');
  const merges = decks.audit.merges; decks.setHidden(35, true); decks.update(new THREE.Vector3());
  assert.equal(decks.audit.merges, merges, 'an unchanged state does not re-merge');
  decks.setHidden(37, true); assert.deepEqual(xs(), [...range(35, 0, 3), ...range(35, 6, 9), ...range(7, 0, 3)], 'a member id hides its span deck');
  decks.setHidden(35, false); decks.setHidden(37, false); assert.deepEqual(xs(), [...range(35, 0, 12), ...range(7, 0, 9)], 'shown again');
  console.log('PASS modern decks: the canal deck hides at once and its approaches stay drawn, without a re-merge per frame');
}
