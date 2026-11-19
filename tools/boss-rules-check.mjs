// The Boss in Get Fired: sight, pursuit states, the time cost, speeds and words (web/src/boss-rules.ts), and its two
// hooks on the score rules. Bundled and run by tools/boss-rules-mutations.mjs (cwd web/), never on its own.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../web/src/boss-rules.ts';
import { ScoreBook, POINTS, offenceLabel, WITNESSED } from '../web/src/score-rules.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';

let passed = 0;
const ok = (name, fn) => { try { fn(); passed++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };
// Heading 0 is north (-z), clockwise: a Boss at the origin facing north sees (0, -50) straight ahead.
const boss = (x = 0, z = 0, heading = 0, speed = 10) => ({ x, z, heading, speed });
const player = (x, z, speed = 10, heading = 0) => ({ x, z, heading, speed });
const run = (p, seconds, step, input, dt = .1) => { const out = []; for (let t = 0; t < seconds - 1e-9; t += dt) { const e = p.tick(dt, step, input()); if (e) out.push(e); } return out; };

ok('gates: Get Fired only, today only, ?boss=0 off; live only single player from the first step', () => {
  const q = s => new URLSearchParams(s);
  assert.equal(R.bossEnabled(true, true, q('')), true);
  assert.equal(R.bossEnabled(false, true, q('')), false, 'mail play and Just Drive build none');
  assert.equal(R.bossEnabled(true, false, q('')), false, 'no Boss in another era');
  assert.equal(R.bossEnabled(true, true, q('boss=0')), false);
  assert.equal(R.bossEnabled(true, true, q(''), true), false, "not in Today's run");
  assert.equal(R.bossEnabled(true, true, q(''), false), true);
  assert.equal(R.bossLive(false, 0), false, 'not at the start');
  assert.equal(R.bossLive(false, 1), true, 'after the first discipline step');
  assert.equal(R.bossLive(true, 3), false, 'never in multiplayer');
});

ok('sight: near, in front, and not behind a building or a hill', () => {
  const b = boss();
  assert.equal(R.sees(b, { x: 0, z: -60 }, 1), true, 'straight ahead within range');
  assert.equal(R.sees(b, { x: 0, z: -(R.sightRange(1) + 1) }, 1), false, 'too far at step 1');
  assert.equal(R.sees(b, { x: 0, z: -(R.sightRange(1) + 1) }, 4), true, 'a higher step sees further');
  assert.equal(R.sees(b, { x: 0, z: 40 }, 1), false, 'behind it, beyond the near ring');
  assert.equal(R.sees(b, { x: 0, z: R.SIGHT_NEAR - 1 }, 1), true, 'very near, all round');
  const off = 75 * Math.PI / 180;
  assert.equal(R.sees(b, { x: Math.sin(off) * 50, z: -Math.cos(off) * 50 }, 1), false, 'outside the windscreen');
  const in_ = 55 * Math.PI / 180;
  assert.equal(R.sees(b, { x: Math.sin(in_) * 50, z: -Math.cos(in_) * 50 }, 1), true, 'inside the windscreen');
  let asked = 0;
  assert.equal(R.sees(b, { x: 0, z: -50 }, 1, () => { asked++; return true; }), false, 'a cut line of sight hides it');
  assert.equal(R.sees(b, { x: 0, z: 500 }, 1, () => { asked++; return false; }), false);
  assert.equal(asked, 1, 'the line test runs only when distance and angle say yes');
  for (let s = 1; s <= 7; s++) assert.ok(R.sightRange(s) >= R.sightRange(s - 1) && R.sightRange(s) <= R.SIGHT_MAX);
});

ok('buildings and hills block the line; a box round either end does not', () => {
  const walls = new R.Occluders([[-5, -30, 5, -20], [100, 100, 110, 110]]);
  assert.equal(walls.blocks({ x: 0, z: 0 }, { x: 0, z: -50 }), true, 'a house between');
  assert.equal(walls.blocks({ x: 20, z: 0 }, { x: 20, z: -50 }), false, 'beside it');
  assert.equal(walls.blocks({ x: 0, z: -25 }, { x: 0, z: -60 }), false, 'standing inside a box (beside a wall) is not hidden by it');
  assert.equal(walls.blocks({ x: 0, z: 0 }, { x: 200, z: 200 }), true, 'a long diagonal finds the far box');
  assert.equal(R.segmentHitsBox({ x: 0, z: 0 }, { x: 10, z: 0 }, [4, -1, 6, 1]), true);
  assert.equal(R.segmentHitsBox({ x: 0, z: 0 }, { x: 3, z: 0 }, [4, -1, 6, 1]), false, 'stops short');
  const hill = (x, z) => z < -20 && z > -40 ? 8 : 0, flat = () => 0;
  assert.equal(R.hillBetween({ x: 0, z: 0 }, { x: 0, z: -60 }, hill), true, 'a crest between');
  assert.equal(R.hillBetween({ x: 0, z: 0 }, { x: 0, z: -60 }, flat), false);
  assert.equal(R.hillBetween({ x: 0, z: 0 }, { x: 0, z: -60 }, (x, z) => z < -20 && z > -40 ? 1.5 : 0), false, 'a bump below eye height');
});

ok('close behind: the player ahead of the nose, about 10 m bumper to bumper', () => {
  const b = boss();
  assert.equal(R.closeBehind(b, { x: 0, z: -(R.CLOSE_GAP + R.CAR_LENGTH - .5) }), true);
  assert.equal(R.closeBehind(b, { x: 0, z: -(R.CLOSE_GAP + R.CAR_LENGTH + 1) }), false, 'too far');
  assert.equal(R.closeBehind(b, { x: 0, z: 8 }), false, 'the player behind the Boss');
  assert.equal(R.closeBehind(b, { x: 10, z: -2 }), false, 'beside, not ahead');
});

ok('a complaint is a lead; it drives there, and on reaching it patrols', () => {
  const p = new R.Pursuit();
  assert.equal(p.state, 'patrol'); assert.equal(p.goal(), null, 'no lead: patrol, no goal');
  p.complaint({ x: 300, z: 0 });
  assert.equal(p.state, 'onItsWay'); assert.deepEqual(p.goal(), { x: 300, z: 0 }, 'heads for the complaint, not the player');
  p.complaint({ x: 500, z: 0 }); assert.deepEqual(p.goal(), { x: 500, z: 0 }, 'the newest complaint');
  assert.deepEqual(run(p, 1, 1, () => ({ boss: boss(480, 0), player: player(0, 900), seen: false, onRoad: true })), []);
  assert.equal(p.state, 'patrol', 'reached the lead without seeing anyone'); assert.equal(p.lead, null);
  // A lead it cannot reach is dropped after ON_WAY_MAX; a fresh complaint starts the time again.
  const far = () => ({ boss: boss(0, 0), player: player(0, 900), seen: false, onRoad: true });
  const w = new R.Pursuit(); w.complaint({ x: 5000, z: 0 });
  run(w, R.ON_WAY_MAX - 10, 1, far, 1); w.complaint({ x: 5000, z: 10 });
  run(w, R.ON_WAY_MAX - 10, 1, far, 1); assert.equal(w.state, 'onItsWay', 'a new complaint restarts its time');
  run(w, 11, 1, far, 1); assert.equal(w.state, 'patrol', 'an unreachable lead is given up'); assert.equal(w.lead, null);
  const off = new R.Pursuit(); off.complaint({ x: 5000, z: 0 });
  run(off, R.ON_WAY_MAX + 1, 1, () => ({ ...far(), onRoad: false }), 1);
  assert.equal(off.state, 'patrol', 'also when it never found a road to start on');
});

ok('seen: it follows; close behind for a few seconds it flashes and honks', () => {
  const f = new R.Pursuit();
  f.tick(.1, 1, { boss: boss(0, 0), player: player(0, -40, 10), seen: true, onRoad: true });
  f.tick(.1, 1, { boss: boss(0, 0), player: player(5, -60, 10), seen: true, onRoad: true });
  assert.deepEqual({ ...f.goal() }, { x: 5, z: -60 }, 'it follows where it saw the player last, not first');
  const p = new R.Pursuit(); p.complaint({ x: 0, z: -100 });
  const near = () => ({ boss: boss(0, 0), player: player(0, -12, 12), seen: true, onRoad: true });
  assert.equal(p.tick(.1, 1, near()), 'seen'); assert.equal(p.state, 'following'); assert.deepEqual(p.goal(), { x: 0, z: -12 }, 'now it heads for the player');
  assert.deepEqual(run(p, R.HOLD - .3, 1, near), [], 'not before HOLD');
  assert.deepEqual(run(p, .5, 1, near), ['signal']); assert.equal(p.signal, true);
  // Farther than close, the hold starts over.
  const q = new R.Pursuit(); q.tick(.1, 1, near());
  run(q, R.HOLD - .5, 1, near); run(q, .3, 1, () => ({ ...near(), player: player(0, -40, 12) }));
  assert.deepEqual(run(q, R.HOLD - .5, 1, near), [], 'the hold restarted when the player pulled away');
});

const signalled = () => {
  const p = new R.Pursuit();
  run(p, R.HOLD + .5, 2, () => ({ boss: boss(0, 0), player: player(0, -12, 12), seen: true, onRoad: true }));
  assert.equal(p.signal, true); return p;
};
ok('pulled over: by stopping, by crawling with the Boss beside, or by being stuck', () => {
  let p = signalled();
  assert.deepEqual(run(p, 1.2, 2, () => ({ boss: boss(0, 0, 0, 0), player: player(0, -11, 0), seen: true, onRoad: true })), [],
    'standing still, the player first sees the flash and hears the horn');
  p = signalled();
  assert.deepEqual(run(p, R.STOP_HOLD + .2, 2, () => ({ boss: boss(0, 0, 0, 0), player: player(0, -11, 0), seen: true, onRoad: true })), ['pulledOver']);
  assert.equal(p.state, 'pulledOver'); assert.equal(p.pulledOver, 1); assert.equal(p.signal, false);
  p = signalled();
  assert.deepEqual(run(p, .1, 2, () => ({ boss: boss(0, 0), player: player(4, -3, 2), seen: true, onRoad: true })), ['pulledOver'], 'slow with the Boss beside');
  p = signalled();
  assert.deepEqual(run(p, R.STUCK - .3, 2, () => ({ boss: boss(0, 0), player: player(0, -15, 2), seen: true, onRoad: true })), [], 'slow, but not yet stuck');
  assert.deepEqual(run(p, .5, 2, () => ({ boss: boss(0, 0), player: player(0, -15, 2), seen: true, onRoad: true })), ['pulledOver'], 'stuck');
  p = signalled();
  assert.deepEqual(run(p, 10, 2, () => ({ boss: boss(0, 0), player: player(0, -14, 15), seen: true, onRoad: true })), [], 'driving on at speed is not a pull-over');
  assert.equal(p.signal, true);
  // Away from it for SIGNAL_DROP, it stops flashing and follows on.
  run(p, R.SIGNAL_DROP + .2, 2, () => ({ boss: boss(0, 0), player: player(0, -60, 25), seen: true, onRoad: true }));
  assert.equal(p.signal, false); assert.equal(p.state, 'following');
  // Got away while it still flashes, then stopped far ahead: not a pull-over.
  p = signalled();
  assert.deepEqual(run(p, R.STOP_HOLD + .5, 2, () => ({ boss: boss(0, 0, 0, 0), player: player(0, -80, 0), seen: true, onRoad: true })), [],
    'stopped 80 m ahead with the flash still on');
  assert.equal(p.signal, true);
});

ok('after the card it drives off: patrol, no lead, and a cooldown before it heeds anything', () => {
  const p = signalled();
  run(p, R.STOP_HOLD + .2, 2, () => ({ boss: boss(0, 0, 0, 0), player: player(0, -11, 0), seen: true, onRoad: true }));
  assert.equal(p.state, 'pulledOver');
  assert.deepEqual(run(p, 2, 2, () => ({ boss: boss(0, 0, 0, 0), player: player(0, -11, 0), seen: true, onRoad: true })), [], 'pulled over holds until released');
  p.release(); assert.equal(p.state, 'patrol'); assert.equal(p.cooldown, R.COOLDOWN); assert.equal(p.goal(), null);
  p.complaint({ x: 9, z: 9 }); assert.equal(p.state, 'patrol', 'a complaint during the cooldown is no lead');
  assert.deepEqual(run(p, R.COOLDOWN - 1, 2, () => ({ boss: boss(0, 0), player: player(0, -11, 12), seen: true, onRoad: true })), [], 'nor is the player in sight');
  assert.deepEqual(run(p, 1.5, 2, () => ({ boss: boss(0, 0), player: player(0, -11, 12), seen: true, onRoad: true })), ['seen'], 'then it is back');
});

ok('lost: out of sight about 20 s, it gives up, counts an escape and patrols', () => {
  const p = new R.Pursuit(); p.tick(.1, 1, { boss: boss(), player: player(0, -30), seen: true, onRoad: true });
  const away = () => ({ boss: boss(), player: player(0, -400, 25), seen: false, onRoad: true });
  assert.deepEqual(run(p, R.loseTime(1) - .5, 1, away), []); assert.equal(p.state, 'following');
  assert.deepEqual(run(p, 1, 1, away), ['lost']); assert.equal(p.state, 'lost'); assert.equal(p.escaped, 1); assert.equal(p.goal(), null);
  assert.equal(R.bossLine(p), 'Lost the Boss.');
  run(p, R.LOST_SHOW + .2, 1, away); assert.equal(p.state, 'patrol');
  // Seen again inside the time: the clock starts over.
  const q = new R.Pursuit(); q.tick(.1, 1, { boss: boss(), player: player(0, -30), seen: true, onRoad: true });
  run(q, R.loseTime(1) - 2, 1, away); q.tick(.1, 1, { boss: boss(), player: player(0, -30), seen: true, onRoad: true });
  assert.deepEqual(run(q, R.loseTime(1) - 2, 1, away), [], 'a glimpse resets it');
  // Off the road (gone round a corner and taken off), the time still runs.
  assert.deepEqual(run(q, 3, 1, () => ({ ...away(), onRoad: false })), ['lost']);
  // Harder to shake at higher steps, within reason.
  assert.equal(R.loseTime(1), 20); for (let s = 2; s <= 7; s++) assert.ok(R.loseTime(s) >= R.loseTime(s - 1) && R.loseTime(s) <= R.LOSE_MAX);
  assert.ok(R.loseTime(6) > R.loseTime(1));
});

ok('the cost: the clock jumps more at higher steps; speed rises with the step and never passes the player', () => {
  assert.equal(R.clockCost(1), 20 * 60);
  for (let s = 2; s <= 7; s++) assert.ok(R.clockCost(s) > R.clockCost(s - 1), `cost at ${s}`);
  const top = R.openRoadTop(CAR_SPEC);
  assert.ok(top > 40 && top < 50, `the mail car's open-road top ${top}`);
  for (let s = 1; s <= 7; s++) for (const state of ['patrol', 'onItsWay', 'following']) {
    for (const t of [top, R.roadTop(3), R.roadTop(1), 8]) assert.ok(R.cruise(state, s, t) <= t * R.TOP_SHARE + 1e-9, `${state} ${s} ${t}`);
  }
  assert.ok(R.cruise('following', 6, top) > R.cruise('following', 1, top), 'faster to arrive at higher steps');
  assert.ok(R.cruise('patrol', 3, top) < R.cruise('onItsWay', 3, top), 'a patrol is slower than a pursuit');
  assert.ok(R.spawnRange(6)[1] < R.spawnRange(1)[1] && R.spawnRange(6)[0] <= R.spawnRange(1)[0], 'it appears nearer at higher steps');
  assert.ok(R.spawnRange(7)[0] >= 120, 'never close enough to be seen arriving');
  // Following: closes on the player, holds back near the keep gap, stops for a stopped car.
  assert.equal(R.followSpeed(R.FOLLOW_KEEP, 0, 30), 0); assert.equal(R.followSpeed(2, 10, 30), 7.6);
  assert.ok(R.followSpeed(40, 20, 25) <= 25, 'never over its limit');
  // The phone's touch help limits the player's car by road kind: the Boss's table is vehicle.ts's.
  const vehicle = readFileSync('src/vehicle.ts', 'utf8').match(/s\.kind === 1 \? 100 \/ 3\.6 : s\.kind === 2 \? 90 \/ 3\.6 : s\.kind === 13 \? 90 \/ 3\.6 : s\.kind === 3 \? 75 \/ 3\.6 : s\.kind === 5 \? 55 \/ 3\.6 : 50 \/ 3\.6/);
  assert.ok(vehicle, 'vehicle.ts touch limit table unchanged');
  assert.deepEqual([1, 2, 13, 3, 5, 4].map(k => Math.round(R.roadTop(k) * 3.6)), [100, 90, 90, 75, 55, 50]);
});

ok('steering: a branch nearer the goal wins; it never turns back the way it came; it turns round only far off', () => {
  // Heading north, goal due east: an east-west road ahead gains; turning back south never.
  assert.ok(R.branchGain(0, Math.PI / 2, Math.PI / 2) > .9);
  assert.ok(R.branchGain(0, 0, Math.PI / 2) < 0, 'goal straight on: stay');
  assert.equal(R.branchGain(0, Math.PI, 0), 0, 'the way back is not offered, even with the goal behind');
  assert.equal(R.turnRound(boss(0, 0, 0), { x: 0, z: 200 }), true);
  assert.equal(R.turnRound(boss(0, 0, 0), { x: 0, z: 30 }), false, 'not when the goal is close');
  assert.equal(R.turnRound(boss(0, 0, 0), { x: 100, z: -10 }), false, 'not for a goal to the side');
});

ok('words: invented, generic, dry; no police, no siren, no names', () => {
  const card = R.pullOverCard(1, 3);
  assert.equal(card.title, 'Pulled over'); assert.equal(card.lines.length, 3);
  assert.match(card.lines[0], /the Boss|The Boss/); assert.match(card.lines[1], /Suspended.*30 minutes.*combo/);
  assert.match(card.lines[2], /^The steward grieves it/);
  assert.notEqual(R.pullOverCard(2, 3).lines[0], card.lines[0], 'the next pull-over has another line');
  assert.match(R.pullOverCard(1, 3, 12 * 60).lines[1], /the clock jumps 12 minutes/, 'the minutes really taken when 18:00 came first');
  const all = [...R.WINDOW, ...R.STEWARD, card.lines[1], R.bossSummary(1, 2, true), R.bossSummary(0, 0, false),
    ...['patrol', 'onItsWay', 'following', 'lost', 'pulledOver'].map(state => R.bossLine(Object.assign(new R.Pursuit(), { state })))];
  for (const line of all) assert.doesNotMatch(line, /police|cop\b|siren|officer|sheriff|arrest|ticket|RCMP|Canada Post|CUPW|Mountie/i, line);
  assert.equal(R.bossSummary(1, 2, true), 'Pulled over once · lost the Boss twice.');
  assert.equal(R.bossSummary(0, 3, true), 'Pulled over never · lost the Boss 3 times.');
  assert.equal(R.bossSummary(0, 0, false), 'The Boss never came out.');
  assert.equal(R.bossLine(Object.assign(new R.Pursuit(), { state: 'patrol' })), '', 'a patrol is not news');
  const car = readFileSync('src/boss-car.ts', 'utf8');
  assert.match(car, /BOSS_WORDS = 'THE BOSS'/);
  const code = car.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /police|siren|0x0000ff|#00f\b|#0000ff/i, 'no police colours or words on the car');
});

ok('score rules: witnessed is double; losing the Boss is a bonus; a pull-over ends the combo only', () => {
  assert.equal(WITNESSED, 2);
  const a = new ScoreBook(), b = new ScoreBook(), e = { kind: 'lawnDamage', place: 'route', speed: 5, time: 1 };
  assert.equal(b.add({ ...e, witnessed: true }).points, a.add(e).points * 2);
  assert.ok(POINTS.lostBoss > 0); assert.equal(offenceLabel('lostBoss'), 'Lost the Boss');
  assert.equal(new ScoreBook().add({ kind: 'lostBoss', place: 'cemetery', speed: 5, time: 1 }).points, 0, 'nothing scores at a cemetery, not even this');
  const c = new ScoreBook(); c.add({ ...e, time: 1 }); c.add({ ...e, kind: 'sceneHorn', time: 2 });
  const total = c.total, step = c.step; assert.ok(c.comboAt(2) > 1);
  c.breakCombo();
  assert.equal(c.comboAt(2), 1, 'combo gone'); assert.equal(c.total, total, 'points stay'); assert.equal(c.step, step, 'the step stays');
  // A witnessed penalty is not doubled: the school bus stays the same penalty.
  assert.equal(new ScoreBook().add({ kind: 'schoolBus', place: 'route', speed: 9, time: 1, witnessed: true }).points, -300);
});

console.log(`boss rules: ${passed} groups passed`);
