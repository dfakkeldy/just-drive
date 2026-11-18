// Checks the one measurement that picks the Picture setting at a first visit (FirstChoice in web/src/picture.ts)
// against simulated computers. No browser. Run with tools/check-picture.sh (it bundles this with esbuild).
// A simulated computer: a frame costs `fixed + pixels x ratio^2` milliseconds, and the screen shows at most `hz`
// frames a second. `events(t, n, sinceChange, ratio)` may mark a frame busy, add a hitch, or set the frame time outright (ms).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { FirstChoice, PICTURE, pictureChoices, pictureLadder, pictureRatio } from '../web/src/picture.ts';
import { SunShadows } from '../web/src/shadows.ts';

// The shadow guard gets the same busy value even after Picture has finished measuring.
const main = readFileSync(existsSync('web/src/main.ts') ? 'web/src/main.ts' : 'src/main.ts', 'utf8');
assert.ok(/const pictureBusy = picturePaused \|\| !loaded;/.test(main), 'Picture busy expression');
assert.ok(/picture\.frame\(clockDt, pictureBusy\)/.test(main), 'Picture gets pictureBusy');
assert.ok(/sunShadows\.update\(realDt, shadowFocus, reach, pictureBusy\)/.test(main), 'shadow guard gets pictureBusy');

// Exercise the real shadow update without WebGL. Binary-exact frame times pin both strict thresholds:
// 96 frames reach the six-second warmup, 64 more reach four slow seconds; frame 161 turns shadows off.
{
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: () => null } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  try {
    const focus = new THREE.Vector3(3, 4, 5);
    function guard(forced = false) {
      const renderer = { shadowMap: {} }, light = new THREE.DirectionalLight();
      const shadows = new SunShadows(renderer, new THREE.Scene(), light, new THREE.Vector3(1, 1, 0).normalize(), forced);
      return { shadows, renderer, light };
    }
    function frames(g, count, dt, busy, enabled = true) {
      for (let i = 0; i < count; i++) {
        g.shadows.update(dt, focus, 0, busy);
        assert.equal(g.shadows.enabled, enabled, `shadows after frame ${i + 1}/${count}, dt=${dt}, busy=${busy}`);
        assert.equal(g.renderer.shadowMap.enabled, enabled, 'renderer follows the guard');
        assert.equal(g.light.castShadow, enabled, 'sun follows the guard');
      }
    }
    const busy = guard();
    frames(busy, 320, .0625, true);
    assert.equal(busy.light.target.position.length() > 0, true, 'busy frames still position the shadow map');
    const play = guard();
    frames(play, 160, .0625, false);
    frames(play, 1, .0625, false, false);
    frames(play, 20, .03125, false, false); // Automatic shutoff remains permanent.
    // Loading neither ages the guard nor adds slow time: the same 161 play frames are required afterward.
    frames(busy, 160, .0625, false);
    frames(busy, 1, .0625, false, false);
    const mixed = guard();
    frames(mixed, 120, .0625, false);
    frames(mixed, 320, .0625, true);
    frames(mixed, 320, .03125, true); // Fast busy frames must not decay the slow time either.
    frames(mixed, 40, .0625, false);
    frames(mixed, 1, .0625, false, false);
    const fast = guard();
    frames(fast, 2000, .03125, false);
    frames(fast, 1000, .04, false); // Exactly 25 fps is still fast enough.
    const recovery = guard();
    frames(recovery, 136, .0625, false); // 2.5 slow seconds after warmup.
    frames(recovery, 64, .03125, false); // Two fast seconds remove one slow second.
    frames(recovery, 40, .0625, false); // Back to exactly four slow seconds.
    frames(recovery, 1, .0625, false, false);
    frames(guard(true), 320, .0625, false); // The URL override still wins.
    console.log('PASS shadow guard: busy frames excluded; shutoff at play frame 161; mixed loading/play, fast frames, recovery and forced shadows.');
  } finally {
    if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument); else delete globalThis.document;
    if (savedStorage) Object.defineProperty(globalThis, 'localStorage', savedStorage); else delete globalThis.localStorage;
  }
}

function run(screen, fixed, pixels, hz, events = () => ({}), limit = 600) {
  const first = new FirstChoice(pictureLadder(screen));
  const tried = [first.trying];
  let t = 0, n = 0, changedAt = 0;
  while (!first.result && t < limit) {
    const ratio = pictureRatio(first.trying, screen), e = events(t, n++, t - changedAt, ratio);
    const dt = (e.dt ?? Math.max(fixed + pixels * ratio * ratio + (e.hitch ?? 0), 1000 / hz)) / 1000;
    t += dt;
    if (first.frame(dt, e.busy ?? false)) { tried.push(first.trying); changedAt = t; }
  }
  return { result: first.result, rate: first.rate, tried, seconds: t };
}
const fps = (fixed, pixels, ratio, hz = 60) => Math.min(hz, 1000 / (fixed + pixels * ratio * ratio));

// 1. The ladder. A step must cut the pixels by a fifth or more; the buttons exist whenever two choices differ.
assert.deepEqual(pictureLadder(2), ['sharp', 'balanced', 'fast']);
assert.deepEqual(pictureLadder(3), ['sharp', 'balanced', 'fast']);
assert.deepEqual(pictureLadder(1.6), ['sharp', 'fast'], 'at 1.6 Balanced (1.5) is too near to Sharp to measure a gain');
assert.deepEqual(pictureLadder(1.25), ['sharp', 'fast']);
assert.deepEqual(pictureLadder(1.1), ['sharp'], 'at 1.1 even Fast cuts under a fifth: nothing to measure');
assert.deepEqual(pictureLadder(1), ['sharp']);
assert.deepEqual(pictureChoices(1.1), ['sharp', 'fast'], 'the buttons are still there at 1.1');
assert.deepEqual(pictureChoices(1), ['sharp'], 'an ordinary screen has one choice, so no buttons');
assert.deepEqual(pictureChoices(1.01), ['sharp', 'fast'], 'two choices that differ at all have buttons');
assert.deepEqual(pictureChoices(1.005), ['sharp', 'fast']);
assert.deepEqual(pictureChoices(1.5), ['sharp', 'fast'], 'at 1.5 Sharp and Balanced are the same picture');
assert.equal(new FirstChoice(pictureLadder(1)).result, 'sharp', 'one step: the answer is there at once');

// 2. A fast computer keeps Sharp and never changes the picture. It takes about five and a half seconds of play.
for (const hz of [60, 120, 144]) {
  const r = run(2, 3, 2.2, hz);
  assert.equal(r.result, 'sharp'); assert.deepEqual(r.tried, ['sharp']);
  assert.ok(r.seconds > 5 && r.seconds < 6.5, `it is done in ${r.seconds.toFixed(1)} s`);
}
// 3. The Mac this game was measured on with everything on: about 40 a second at Sharp, over 55 at Balanced.
{
  const r = run(2, 3, 5.5, 60);   // 25 ms at ratio 2 (40 a second); 15.4 ms at 1.5 (60)
  assert.equal(r.result, 'balanced'); assert.deepEqual(r.tried, ['sharp', 'balanced']);
  assert.ok(r.seconds < 13, `two steps take ${r.seconds.toFixed(1)} s`);
}
// 4. A weak computer: slow at Sharp and at Balanced, fine at Fast.
{
  const r = run(2, 6, 9, 60);   // 42 ms, 26 ms, 15 ms
  assert.equal(r.result, 'fast'); assert.deepEqual(r.tried, ['sharp', 'balanced', 'fast']);
}
// 5. Pixels are not the cost: a page held at 30 a second, and a slow processor. Sharp stays, after one look.
for (const [name, fixed, pixels, hz] of [['a page held at 30 a second', 3, 2.2, 30], ['a slow processor', 25, 0.01, 60], ['a 50 Hz screen', 3, 2.2, 50]]) {
  const r = run(2, fixed, pixels, hz);
  assert.equal(r.result, 'sharp', name); assert.deepEqual(r.tried, ['sharp', 'balanced', 'sharp'], `${name}: one look at Balanced, then back`);
}
// 6. A softer step that is only a little faster (under a tenth) is not taken.
{
  const r = run(2, 18, 0.625, 60);   // 48.8 a second at Sharp, 51.5 at Balanced
  assert.equal(r.result, 'sharp');
}
// 7. Balanced is clearly faster but under 55, and Fast adds little: Balanced.
{
  const fixed = 15, pixels = 2.5;   // 40 a second at Sharp, 48.5 at Balanced, 57 at Fast: Fast is clearly faster still
  assert.equal(run(2, fixed, pixels, 60).result, 'fast');
  const r = run(2, 17.2, 1.95, 60);   // 40 a second, 46.3 (+16 percent), 52.2 (+13 percent): on down to Fast
  assert.equal(r.result, 'fast');
  const s = run(2, 18.5, 1.6, 60);    // 40.2, 45.2 (+12 percent), 49.75 (+9.95 percent, under a tenth): Balanced
  assert.equal(s.result, 'balanced');
  const u = run(2, 19, 1.5, 60);      // 40, 44.7 (+11.8 percent), 48.8 (+9.1 percent): Fast adds too little
  assert.equal(u.result, 'balanced'); assert.deepEqual(u.tried, ['sharp', 'balanced', 'fast', 'balanced']);
}
//    Right on the lines, by the numbers. A gain of exactly a tenth counts (40, 44, 60 a second: on to Fast), also
//    on a ladder of two steps; and exactly 55 a second is enough. Frame times add up with rounding errors
//    (39.99999999999 and 43.9999999999 a second): the lines must not be missed by those.
{
  const steady = (rates) => (t, n, since, ratio) => ({ dt: 1000 / rates[ratio] });
  const r = run(2, 0, 0, 60, steady({ 2: 40, 1.5: 44, 1: 60 }));
  assert.equal(r.result, 'fast'); assert.deepEqual(r.tried, ['sharp', 'balanced', 'fast']);
  assert.equal(run(1.6, 0, 0, 60, steady({ 1.6: 40, 1: 44 })).result, 'fast', 'two steps, a gain of exactly a tenth');
  assert.equal(run(2, 0, 0, 60, steady({ 2: 40, 1.5: 43.9, 1: 60 })).result, 'sharp', 'a gain just under a tenth is not taken');
  const at55 = run(2, 0, 0, 60, (t, n, since, ratio) => ({ dt: ratio === 2 ? (n % 2 ? 15 : 2000 / 55 - 15) : 1000 / 61 }));
  assert.equal(at55.result, 'sharp', 'frames of 15 ms and 21.36 ms in turn are exactly 55 a second: Sharp is kept');
  assert.deepEqual(at55.tried, ['sharp']);
  assert.equal(run(2, 0, 0, 60, steady({ 2: 54.9, 1.5: 61, 1: 61 })).result, 'balanced', 'just under 55 is not enough');
}
//    The rate at the answer is kept: a slow answer gets a nudge toward "Low detail" (web/src/detail.ts).
{
  const steady = (rates) => (t, n, since, ratio) => ({ dt: 1000 / rates[ratio] });
  const slow = run(2, 0, 0, 60, steady({ 2: 8, 1.5: 10, 1: 13 }));
  assert.equal(slow.result, 'fast'); assert.ok(Math.abs(slow.rate - 13) < 0.01, `a slow computer ends on Fast at 13 a second: ${slow.rate}`);
  const stuck = run(2, 0, 0, 60, steady({ 2: 12, 1.5: 12.5, 1: 13 }));
  assert.equal(stuck.result, 'sharp'); assert.ok(Math.abs(stuck.rate - 12) < 0.01, `no gain from fewer pixels: Sharp, and the rate is Sharp's: ${stuck.rate}`);
  const fine = run(2, 3, 2.2, 60);
  assert.ok(Math.abs(fine.rate - 60) < 0.01, `a fast computer: ${fine.rate}`);
}
// 8. Loading frames that come again and again (the land loads about once a second while the car drives) do not
//    stop the measurement and do not change its answer. They only make it take longer.
for (const [fixed, pixels, want] of [[3, 2.2, 'sharp'], [3, 5.5, 'balanced'], [6, 9, 'fast']]) {
  const r = run(2, fixed, pixels, 60, (t, n) => (n % 60 < 6 ? { busy: true, hitch: 80 } : {}));
  assert.equal(r.result, want, `with a tenth of the frames busy: ${fixed} + ${pixels} r^2`);
  assert.ok(r.seconds < 40, `and it still ends: ${r.seconds.toFixed(1)} s`);
}
// 9. Nothing is measured while the game is not played (the title card, a hidden tab): the answer waits.
{
  const r = run(2, 3, 5.5, 60, (t) => (t < 30 ? { busy: true } : {}));
  assert.equal(r.result, 'balanced'); assert.ok(r.seconds > 30 && r.seconds < 45);
  const never = run(2, 3, 5.5, 60, () => ({ busy: true }), 120);
  assert.equal(never.result, null, 'all frames busy: no answer, and no change');
  assert.deepEqual(never.tried, ['sharp']);
}
// 10. A stall (a frame of a second or more: a tab that was away) is left out. Hitches now and then do not turn a
//     fast computer into a slow one; frames that are late all the time do.
{
  const stall = run(2, 3, 2.2, 60, (t, n) => (n === 200 ? { dt: 300000 } : {}));
  assert.equal(stall.result, 'sharp');
  const hitches = run(2, 3, 2.2, 60, (t, n) => (n % 150 === 0 ? { hitch: 120 } : {}));   // one 120 ms frame every 2.5 s: 57.3 a second
  assert.equal(hitches.result, 'sharp');
  const late = run(2, 3, 2.2, 60, (t, n) => ({ dt: [16.67, 16.67, 33.33][n % 3] }));   // 45 a second at every choice
  assert.equal(late.result, 'sharp', 'late frames that fewer pixels do not cure: one look, then Sharp');
  assert.deepEqual(late.tried, ['sharp', 'balanced', 'sharp']);
}
//     The first second after the start and after each change is slow (a new drawing buffer, shaders being made):
//     those frames are left out, so a fast computer is not taken for a slow one, nor a middling one for a weak one.
{
  const warm = (t, n, since) => (since < 1.2 ? { hitch: 90 } : {});
  assert.equal(run(2, 3, 2.2, 60, warm).result, 'sharp');
  assert.equal(run(2, 3, 5.5, 60, warm).result, 'balanced');
}
// 11. Odd screens. At 1.6 the ladder is Sharp then Fast, so a computer that Fast helps is not stopped by Balanced.
{
  assert.equal(run(1.6, 10, 6, 60).result, 'fast');     // 39 a second at 1.6; 62 at 1
  assert.equal(run(1.6, 3, 2.2, 60).result, 'sharp');
  assert.equal(run(1.25, 10, 9, 60).result, 'fast');    // 41 a second at 1.25; 52.6 at 1 (+28 percent), the last step
  assert.equal(run(1, 40, 40, 60).result, 'sharp', 'an ordinary screen: nothing to measure');
}
// 12. Many computers at random (seeded). Jitter of 5 percent on each frame. The answer must be a sensible one:
//     never a softer choice than a choice that reaches 55 with room, never Sharp when Sharp is far too slow and
//     Balanced is far faster, and the measurement always ends within 20 seconds of play.
{
  let a = 20261111 >>> 0;
  const random = () => { a = (a + 0x6D2B79F5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const count = { sharp: 0, balanced: 0, fast: 0 };
  for (let i = 0; i < 500; i++) {
    const fixed = 1 + random() * 24, pixels = 0.3 + random() * 9, hz = [60, 60, 75, 120][Math.floor(random() * 4)];
    const r = run(2, fixed, pixels, hz);
    const noisy = (() => {
      const first = new FirstChoice(pictureLadder(2)); let t = 0;
      while (!first.result && t < 600) { const ratio = PICTURE[first.trying]; const dt = Math.max((fixed + pixels * ratio * ratio) * (0.95 + 0.1 * random()), 1000 / hz) / 1000; t += dt; first.frame(dt, false); }
      return { result: first.result, seconds: t };
    })();
    const tag = `random ${i}: ${fixed.toFixed(1)} + ${pixels.toFixed(2)} r^2 ms at ${hz} Hz -> ${noisy.result} (${[2, 1.5, 1].map((q) => fps(fixed, pixels, q, hz).toFixed(0))} a second)`;
    assert.ok(noisy.result && noisy.seconds < 20, `${tag}: ends in ${noisy.seconds.toFixed(1)} s`);
    const at = { sharp: fps(fixed, pixels, 2, hz), balanced: fps(fixed, pixels, 1.5, hz), fast: fps(fixed, pixels, 1, hz) };
    if (at.sharp >= 58) assert.equal(noisy.result, 'sharp', tag);
    if (at.sharp < 50 && at.balanced >= 58 && at.balanced > at.sharp * 1.2) assert.equal(noisy.result, 'balanced', tag);
    if (at.balanced < 45 && at.fast > at.balanced * 1.25 && at.balanced > at.sharp * 1.2) assert.equal(noisy.result, 'fast', tag);
    if (noisy.result !== 'sharp') assert.ok(at.sharp < 57.5, `${tag}: a softer choice only when Sharp was under 55`);
    assert.ok(r.result, tag);
    count[noisy.result]++;
  }
  console.log(`PASS: ladders for odd screens; fast, middling and weak computers get Sharp, Balanced and Fast; a capped page, a slow processor and a small gain keep Sharp; loading frames, the title card, stalls and hitches do not change the answer; 500 random computers (${count.sharp} Sharp, ${count.balanced} Balanced, ${count.fast} Fast), each done within 20 s of play.`);
}
