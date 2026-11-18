// Checks the reckoning of web/src/sharpness.ts against simulated computers. No browser.
// Bundle with web/node_modules/.bin/esbuild, then run with Node (tools/check-sharpness.sh does both).
// A simulated computer: a frame costs `fixed + pixels x ratio^2` milliseconds, and the screen shows at most `hz`
// frames a second (a frame that is ready early waits for the screen, as in a browser).
// `events(t, ratio, sinceChange, n)` may change the cost, add a hitch, mark frames busy, or set the frame time
// outright (`dt`, in milliseconds). `n` counts the frames.
import assert from 'node:assert/strict';
import { STEPS, Sharpness } from '../web/src/sharpness.ts';

function run(most, fixed, pixels, hz, seconds, events = () => ({})) {
  const s = new Sharpness(most);
  const log = [];   // [time, ratio] at each change
  const spent = new Map();   // ratio -> seconds, after `from`
  let t = 0, n = 0, slowTime = 0, softTime = 0, changedAt = 0;
  while (t < seconds) {
    const e = events(t, s.ratio, t - changedAt, n++);
    const cost = (e.fixed ?? fixed) + (e.pixels ?? pixels) * s.ratio * s.ratio + (e.hitch ?? 0);
    const dt = (e.dt ?? Math.max(cost, 1000 / (e.hz ?? hz))) / 1000;
    t += dt;
    if (1 / dt < 50) slowTime += dt;
    if (s.ratio < most) softTime += dt;
    spent.set(s.ratio, (spent.get(s.ratio) ?? 0) + dt);
    if (s.frame(dt, e.busy ?? false)) { log.push([t, s.ratio]); changedAt = t; }
    assert.ok(Number.isFinite(s.ratio) && s.ratio <= most + 1e-9 && s.ratio >= Math.min(1, most) - 1e-9, `the ratio stays between 1 and the screen's: ${s.ratio}`);
  }
  return { ratio: s.ratio, log, slowTime, softTime, spent };
}
const fpsAt = (fixed, pixels, ratio, hz) => Math.min(hz, 1000 / (fixed + pixels * ratio * ratio));
const gaps = (times) => times.slice(1).map((at, k) => at - times[k]);
const stepsFor = (most) => [...STEPS.filter((s) => s < most - 0.01), most];
/** The most changes in any stretch of `seconds`. */
function busiest(log, seconds) {
  let most = 0;
  for (let a = 0, b = 0; b < log.length; b++) { while (log[b][0] - log[a][0] > seconds) a++; most = Math.max(most, b - a + 1); }
  return most;
}

// 1. A fast computer keeps every pixel, on a 60, a 120 and a 144 Hz screen.
for (const hz of [60, 120, 144]) {
  const r = run(2, 3, 2.2, hz, 120);
  assert.equal(r.ratio, 2, `fast computer at ${hz} Hz keeps full sharpness`);
  assert.equal(r.log.length, 0, 'and never changes it');
}

// 2. The Mac this was measured on: 47 frames a second at ratio 2 with everything on, about 125 at ratio 1.
//    It must come to rest on the sharpest step that holds 52 a second, soon, and then stay but for rare tries.
{
  const fixed = 3.6, pixels = 4.4;   // 21.2 ms at ratio 2, 8 ms at ratio 1
  const best = [...STEPS].reverse().find((step) => fpsAt(fixed, pixels, step, 60) >= 52);
  const r = run(2, fixed, pixels, 60, 600);
  assert.equal(best, 1.75, 'the case is the one meant: 1.75 holds, 2 does not');
  const settled = r.log.find(([, ratio]) => ratio === best)?.[0];
  assert.ok(settled !== undefined && settled < 3, `it reaches ${best} within three seconds (at ${settled?.toFixed(1)} s)`);
  const tries = r.log.filter(([, ratio]) => ratio === 2).map(([at]) => at);
  assert.ok(tries.length >= 5 && tries.length <= 24, `it tries full sharpness again, but seldom: ${tries.length} times in ten minutes`);
  const g = gaps(tries);
  assert.ok(g[g.length - 1] >= 30, `the tries end up half a minute or more apart: the last gap is ${g[g.length - 1]?.toFixed(0)} s`);
  assert.ok(g.every((gap, k) => k === 0 || gap >= g[k - 1] - 1.5), `each wait is at least as long as the one before: ${g.map((x) => x.toFixed(0))}`);
  assert.ok(r.slowTime < 600 * 0.05, `slow frames are under 5 percent of the time: ${r.slowTime.toFixed(1)} s`);
  assert.ok(r.log.every(([, ratio]) => ratio >= best), 'it never goes softer than it must');
}

// 3. A weak computer (30 a second at ratio 2) is fast within four seconds: one look two steps down, then straight
//    to the step that the two rates point to.
{
  const fixed = 6, pixels = 6.8;   // 33 ms at ratio 2; 12.8 ms at ratio 1
  const r = run(2, fixed, pixels, 60, 300);
  const first = r.log[0], rest = r.log.find(([, ratio]) => fpsAt(fixed, pixels, ratio, 60) >= 52);
  assert.ok(first && first[0] < 2 && first[1] <= 1.5, `the first step is a big one and comes within two seconds: ${first}`);
  assert.ok(rest && rest[0] < 4 && rest[1] === 1.3, `it is fast within four seconds, on the sharpest step that is: ${rest}`);
  assert.equal(r.log.findIndex((entry) => entry === rest), 1, 'in two changes');
  assert.ok(r.slowTime < 300 * 0.08, `slow frames are under 8 percent of the time: ${r.slowTime.toFixed(1)} s`);
}

// 4. A step down must buy speed. A computer whose processor is the limit (40 a second at every sharpness) keeps its
//    pixels: a softer picture would not be a faster one.
{
  const r = run(2, 25, 0.001, 60, 600);
  assert.ok(r.softTime < 600 * 0.03, `it is soft for under 3 percent of the time: ${r.softTime.toFixed(1)} s`);
  assert.ok(r.log.every(([, ratio], k) => (k % 2 ? ratio === 2 : ratio < 2)), 'every look is undone');
  const downs = r.log.filter(([, ratio]) => ratio < 2).map(([at]) => at), g = gaps(downs);
  assert.ok(downs.length >= 3 && downs.length <= 9, `it asks again whether pixels would help, but seldom: ${downs.length} times in ten minutes`);
  assert.ok(g[0] < 8, `the second look comes soon, in case the first met a busy moment: ${g[0].toFixed(1)} s`);
  assert.ok(g.every((gap, k) => k === 0 || gap >= g[k - 1] * 0.95) && g[g.length - 1] >= 100, `then the waits grow to two minutes: ${g.map((x) => x.toFixed(0))}`);
}
//    The same for a browser that holds the page at 30 frames a second (a power-saving mode), whatever the picture costs.
{
  const r = run(2, 3, 2.2, 30, 300);
  assert.ok(r.softTime < 300 * 0.05, `a page held at 30 a second is soft for under 5 percent of the time: ${r.softTime.toFixed(1)} s`);
  const back = r.log.find(([, ratio]) => ratio === 2);
  assert.ok(back && back[0] < 4, `the first step down is undone within four seconds: ${back}`);
}
//    On such a page the rate never reaches 52, so no step upward is ever "fast". A heavy scene makes the picture
//    softer; when the scene is light again, the next look must find that sharper steps cost nothing, and climb.
{
  const r = run(2, 3, 2.2, 30, 480, (t) => (t > 60 && t < 180 ? { pixels: 12 } : {}));   // heavy: 51 ms at ratio 2, 30 ms at 1.5
  const heavy = r.log.filter(([at]) => at > 60 && at < 180);
  assert.ok(heavy.some(([, ratio]) => ratio === 1.5) && r.log.some(([at, ratio]) => at > 70 && at < 180 && ratio === 1.5), `the heavy scene is drawn softer: ${heavy.map(([at, ratio]) => `${at.toFixed(0)}:${ratio}`)}`);
  const full = r.log.find(([at, ratio]) => at >= 180 && ratio === 2);
  assert.ok(full && full[0] - 180 < 130, `full sharpness is back ${full ? (full[0] - 180).toFixed(0) : '?'} s after the scene got light`);
  assert.equal(r.ratio, 2);
}
//    A screen that shows 50 pictures a second, and a computer that is slow at full sharpness (41 a second). The rate
//    can never reach 52. It must rest on the sharpest step that gives the 50, not walk on down.
{
  const r = run(2, 3, 5.4, 50, 300);   // 24.6 ms at ratio 2; 19.5 ms (so the screen's 50) at 1.75
  assert.ok((r.spent.get(1.75) ?? 0) > 300 * 0.9, `it rests on 1.75: ${(r.spent.get(1.75) ?? 0).toFixed(0)} s of 300; changes ${r.log.map(([at, ratio]) => `${at.toFixed(1)}:${ratio}`)}`);
}
//    The same where the first look skips a step (far too slow: two steps down at once). The skipped step is looked
//    at on the way back up.
{
  const r = run(2, 10, 7.5, 30, 300);   // 40 ms at ratio 2; 33 ms (the page's 30) at 1.75
  assert.ok((r.spent.get(1.75) ?? 0) > 300 * 0.85, `it rests on 1.75: ${(r.spent.get(1.75) ?? 0).toFixed(0)} s of 300; changes ${r.log.map(([at, ratio]) => `${at.toFixed(1)}:${ratio}`)}`);
}
//    A computer that is slow at every step, where pixels help a little: it walks down while that buys speed, and stops.
{
  const r = run(2, 30, 3, 60, 240);
  assert.ok(r.ratio <= 1.3, `it ends on a soft step: ${r.ratio}`);
  assert.ok(r.log.length <= 18, `without hunting: ${r.log.length} changes in four minutes`);
  assert.ok(fpsAt(30, 3, r.ratio, 60) >= 0.87 * fpsAt(30, 3, 1, 60), 'and is within an eighth of the best rate there is');
}

// 5. A step up is on trial. A probe that holds for 1.2 seconds and then falls to 45 a second (a shader that warms
//    up, a pass that runs every second) must not count as held: the waits must still grow.
{
  const r = run(2, 3, 2.2, 60, 240, (t, ratio, since) => (ratio === 2 && since > 1.2 ? { dt: 1000 / 45 } : {}));
  assert.ok(r.log.length <= 26, `no flapping: ${r.log.length} changes in four minutes`);
  const tries = r.log.filter(([, ratio]) => ratio === 2).map(([at]) => at), g = gaps(tries);
  assert.ok(g[g.length - 1] >= 28, `the tries end up half a minute apart: ${g.map((x) => x.toFixed(0))}`);
  assert.ok(g.every((gap, k) => k === 0 || gap >= g[k - 1] - 1.5), 'each wait is at least as long as the one before');
}
//    The same for a load that comes later: some seconds after each step up, well after the trial. A step that holds
//    for less than a minute keeps its penalty, so the tries still end up half a minute apart.
for (const after of [3, 6, 12, 21, 45]) {
  const r = run(2, 3, 2.2, 60, 600, (t, ratio, since) => (ratio === 2 && since > after ? { dt: 1000 / 45 } : {}));
  const tries = r.log.filter(([, ratio]) => ratio === 2).map(([at]) => at), g = gaps(tries);
  assert.ok(r.log.length <= 40, `a load ${after} s after each step up: ${r.log.length} changes in ten minutes`);
  assert.ok(g[g.length - 1] >= 30 + after, `and the tries end up over half a minute apart: ${g.map((x) => x.toFixed(0))}`);
  assert.ok(r.slowTime < 600 * 0.06, `slow frames are under 6 percent of the time: ${r.slowTime.toFixed(1)} s`);
}
//    A step that holds for over a minute is forgiven (it may be a computer that gets hot): the picture is slow for
//    a second and a half in each round, and no more.
{
  const r = run(2, 3, 2.2, 60, 600, (t, ratio, since) => (ratio === 2 && since > 70 ? { dt: 1000 / 45 } : {}));
  assert.ok(r.log.length <= 16, `a load 70 s after each step up: ${r.log.length} changes in ten minutes`);
  assert.ok(r.slowTime < 600 * 0.03, `slow frames are under 3 percent of the time: ${r.slowTime.toFixed(1)} s`);
}

// 6. Long frames that come again and again are a slow picture, though most frames are quick. Each of these three
//    happens at full sharpness only; the next softer step runs at 60. The picture must get softer and stay so.
//    (The second is 50 a second, just under the line, and half of its windows read 53: a try at full sharpness
//    lasts up to five seconds there. So it is softer for seven tenths of the time, not eight.)
for (const [name, pattern, fps, soft] of [
  ['two frames on time and one late', [16.67, 16.67, 33.33], 45, 0.8],
  ['one 100 ms frame in every 25', [...Array(24).fill(16.67), 100], 50, 0.7],
  ['four quick frames, then two of 350 ms', [16.67, 16.67, 16.67, 16.67, 350, 350], 7.8, 0.8],
]) {
  const made = 1000 * pattern.length / pattern.reduce((a, b) => a + b);
  assert.ok(Math.abs(made - fps) < 0.1, `${name} is ${fps} frames a second (the pattern gives ${made.toFixed(2)})`);
  const r = run(2, 3, 2.2, 60, 120, (t, ratio, since, n) => (ratio === 2 ? { dt: pattern[n % pattern.length] } : {}));
  const first = r.log[0];
  assert.ok(first && first[0] < 8 && first[1] < 2, `${name}: it gives pixels away within eight seconds: ${first}`);
  assert.ok(r.softTime > 120 * soft, `${name}: and stays softer for most of the time: ${r.softTime.toFixed(0)} s of 120; changes ${r.log.map(([at, ratio]) => `${at.toFixed(1)}:${ratio}`)}`);
}
//    One long frame now and then (a land tile arriving) is not a slow picture. Loading frames, marked busy, are left out.
{
  const hitch = run(2, 3, 2.2, 60, 120, (t) => ({ hitch: t % 2.5 < 0.017 ? 120 : 0 }));
  assert.equal(hitch.log.length, 0, 'a hitch every two and a half seconds changes nothing');
  const loading = run(2, 3, 2.2, 60, 60, (t) => (t < 20 ? { fixed: 60, busy: true } : {}));
  assert.equal(loading.log.length, 0, 'twenty seconds of slow loading frames change nothing');
  const notBusy = run(2, 3, 2.2, 60, 60, (t) => (t < 20 ? { fixed: 60 } : {}));
  assert.equal(notBusy.ratio, 2, 'the same frames not marked busy end at full sharpness too (the steps bought nothing)');
  const away = run(2, 3, 2.2, 60, 60, (t, ratio, since, n) => (n === 600 ? { dt: 300000 } : {}));
  assert.equal(away.log.length, 0, 'one frame of five minutes (the tab was away) changes nothing');
  const stalls = run(2, 3, 2.2, 60, 60, (t, ratio, since, n) => ([100, 148, 196].includes(n % 600) ? { dt: 300 } : {}));
  assert.equal(stalls.log.length, 0, 'three stalls of 0.3 s within two seconds, every ten seconds (one more than the allowance covers), change nothing: one slow window is not a slow picture');
}
//    A computer that crawls (a frame takes two and a half seconds at full sharpness) is not "away": it is helped.
{
  const r = run(2, 100, 600, 60, 120);
  assert.equal(r.ratio, 1, 'a crawling computer ends on the softest step');
}

// 7. A scene that gets heavier (a forest road after open fields) and light again. While it is heavy the game rests
//    on ratio 1.5 at full speed; every try at 1.75 fails, and the waits grow to their longest. When the scene gets
//    light, full sharpness must be back within a minute, on every kind of screen.
for (const hz of [60, 120, 144]) {
  const heavy = 5.6;   // at 1.5: 15.6 ms (full speed on a 60 Hz screen); at 1.75: 20.2 ms (49 a second)
  const r = run(2, 3, 2.2, hz, 600, (t) => (t > 30 && t < 330 ? { pixels: heavy } : {}));
  const during = r.log.filter(([at]) => at > 31 && at < 330);
  assert.ok(during[1] && during[1][1] === 1.5 && during[1][0] < 36, `it rests on 1.5 within six seconds of the heavy scene (${hz} Hz): ${during[1]}`);
  const failed = during.filter(([, ratio]) => ratio === 1.75).slice(1).map(([at]) => at), g = gaps(failed);
  assert.ok(failed.length >= 5, `while the scene is heavy, tries at 1.75 are made and fail (${hz} Hz): ${failed.length}`);
  assert.ok(g[g.length - 1] >= 28, `and the wait has grown to its longest: ${g.map((x) => x.toFixed(0))}`);
  assert.ok(during.every(([, ratio]) => ratio <= 1.75), 'full sharpness is never reached in the heavy scene');
  const full = r.log.find(([at, ratio]) => at >= 330 && ratio === 2);
  assert.ok(full && full[0] - 330 < 60, `full sharpness is back ${full ? (full[0] - 330).toFixed(0) : '?'} s after the scene got light (${hz} Hz)`);
  assert.equal(r.ratio, 2);
}

// 8. One measurement must not mislead it for long.
//    A step down that reaches the rate is kept, though the gain is small (50 a second becomes 53).
{
  const fixed = 15.008, pixels = 1.248;   // 20 ms at ratio 2, 18.83 ms at 1.75
  const r = run(2, fixed, pixels, 60, 600);
  assert.ok((r.spent.get(1.75) ?? 0) > 600 * 0.9, `it rests on 1.75: ${(r.spent.get(1.75) ?? 0).toFixed(0)} s of 600`);
}
//    A screen ratio of 1.8 on a computer whose cost is all pixels: the next step on the list, 1.75, is too near to
//    measure a gain. The look must go far enough (1.5) to see one.
{
  const r = run(1.8, 0, 8, 60, 120);
  assert.ok((r.spent.get(1.5) ?? 0) > 120 * 0.85, `it rests on 1.5: ${(r.spent.get(1.5) ?? 0).toFixed(0)} s of 120`);
}
//    A busy moment during the first look (the softer step measures no better) must not shut the door for half a
//    minute: a second look follows within ten seconds.
{
  const fixed = 3.6, pixels = 4.4;
  let looked = false;
  const r = run(2, fixed, pixels, 60, 60, (t, ratio, since) => {
    if (ratio < 2 && !looked && since > 1.9) looked = true;
    return ratio < 2 && !looked ? { fixed: fixed + 4.5 } : {};   // 1.75 measures 46 a second, as slow as 2
  });
  const undone = r.log.find(([, ratio], k) => k > 0 && ratio === 2), settled = r.log.find(([at, ratio]) => undone && at > undone[0] && ratio === 1.75);
  assert.ok(undone, 'the first look is undone (it bought nothing)');
  assert.ok(settled && settled[0] < 12, `and the second look, which finds the gain, comes within twelve seconds: ${settled}`);
}
//    A processor load that ends while the look is on (45 a second becomes 55, at any sharpness): the softer step is
//    not the cause. Full sharpness must come back, not stay away for good.
{
  const r = run(2, 22.2, 0.001, 60, 120, (t) => (t > 1.8 ? { fixed: 18.2 } : {}));
  assert.equal(r.ratio, 2, 'it ends at full sharpness');
  assert.ok(r.softTime < 20, `and is soft for under twenty seconds: ${r.softTime.toFixed(1)} s`);
}

// 9. Screens: an ordinary screen (ratio 1) has nothing to give; an odd ratio is the top step; a ratio under 1 stays.
assert.equal(run(1, 30, 30, 60, 30).log.length, 0, 'ratio 1: no change, however slow');
assert.equal(run(0.8, 30, 30, 60, 30).log.length, 0, 'ratio 0.8 (a zoomed-out browser): no change, and never above the screen');
{
  assert.equal(new Sharpness(1.6).ratio, 1.6);
  const r = run(1.6, 3.6, 8, 60, 60);
  assert.ok(r.ratio < 1.6 && STEPS.includes(r.ratio), `an odd screen ratio steps down onto the list: ${r.ratio}`);
  for (const bad of [NaN, 0, -2, Infinity]) assert.equal(new Sharpness(bad).ratio, 1, `a senseless screen ratio (${bad}) is taken as 1`);
}
//    Bad frame times are ignored.
{
  const s = new Sharpness(2);
  for (const dt of [0, -1, NaN, Infinity, 1e9]) assert.equal(s.frame(dt), false);
  assert.equal(s.ratio, 2);
}

// 10. Many computers, drawn at random (always the same ones: the generator is seeded).
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
const pick = (random, list) => list[Math.floor(random() * list.length)];
let steadyCases = 0, restCases = 0;
//    (a) Steady computers, nothing else going on. Where a step reaches 52 a second, the game must rest on the
//        sharpest such step. Where none does, it must stop within an eighth of the best rate, and not hunt.
{
  const random = seeded(20261111);
  for (let i = 0; i < 400; i++) {
    const most = pick(random, [1.25, 1.5, 1.6, 1.8, 2, 2]), hz = pick(random, [60, 60, 75, 120, 144]);
    const fixed = 1 + random() * 24, pixels = 0.3 + random() * 8;
    const steps = stepsFor(most), rates = steps.map((step) => 1000 / (fixed + pixels * step * step));
    if (rates.some((rate) => rate > 50.5 && rate < 53.5)) continue;   // a step on the line may go either way
    const best = [...steps].reverse().find((step, k) => rates[steps.length - 1 - k] >= 52);
    const r = run(most, fixed, pixels, hz, 300), tag = `steady ${i}: most ${most}, ${fixed.toFixed(1)} + ${pixels.toFixed(2)} x r^2 ms, ${hz} Hz`;
    steadyCases++;
    if (best !== undefined) {
      restCases++;
      const there = r.spent.get(best) ?? 0;
      assert.ok(there > 300 * 0.9, `${tag}: it rests on ${best}: ${there.toFixed(0)} s of 300; changes ${r.log.slice(0, 8).map(([at, ratio]) => `${at.toFixed(1)}:${ratio}`)}`);
      assert.ok(r.slowTime < 300 * 0.06, `${tag}: slow frames under 6 percent: ${r.slowTime.toFixed(1)} s`);
      assert.ok(r.log.length <= 30, `${tag}: ${r.log.length} changes in five minutes`);
    } else {
      const softest = Math.max(...rates), end = 1000 / (fixed + pixels * r.ratio * r.ratio);
      const last = r.log.length ? r.log[r.log.length - 1][0] : 0;
      // judged on the resting step: a look may be on at the very end
      const rest = [...r.spent.entries()].sort((a, b) => b[1] - a[1])[0][0], restRate = 1000 / (fixed + pixels * rest * rest);
      assert.ok(restRate >= 0.87 * softest, `${tag}: it rests on ${rest} (${restRate.toFixed(1)} a second; the best is ${softest.toFixed(1)}); ended on ${r.ratio} (${end.toFixed(1)}), last change at ${last.toFixed(0)} s`);
      assert.ok(r.log.length <= 20, `${tag}: ${r.log.length} changes in five minutes`);
    }
  }
}
//    (b) Computers with something going on. Whatever happens, the picture must not change often.
//        `calm`: frames jitter a little, a hitch comes now and then, and the scene's cost moves by up to a third.
//        The governor follows the scene (two changes for each swing) and tries a sharper step every half minute.
//        `chased`: the same, and every change buys speed for some seconds, after which a load comes: the case in
//        which a governor could run after its own changes. The penalties hold it to one round every half minute.
//        `wild`: the cost more than doubles and halves within a minute, frames jitter by a quarter, hitches come
//        every second. There the governor has real changes to follow.
//        The limits are guards against a new fault, set a fifth above the worst case found, not laws.
const LIMITS = { calm: [17, 70], chased: [18, 92], wild: [20, 100] };   // most changes in any minute, and in any ten minutes
const worst = { calm: [0, 0], chased: [0, 0], wild: [0, 0] }, cases = { calm: 0, chased: 0, wild: 0 };
for (const kind of ['calm', 'chased', 'wild']) {
  const random = seeded({ calm: 4711, chased: 77, wild: 1961 }[kind]), mild = kind !== 'wild';
  for (let i = 0; i < 300; i++) {
    const most = pick(random, [1.5, 1.8, 2, 2, 2]), hz = pick(random, [30, 50, 60, 60, 120, 144]);
    const fixed = 1 + random() * 20, pixels = 0.3 + random() * 7;
    const jitter = pick(random, mild ? [0, 0.02, 0.05] : [0, 0.03, 0.1, 0.25]);
    const hitchOdds = pick(random, mild ? [0, 0.0005, 0.002] : [0, 0.001, 0.01, 0.05]), hitchSize = 30 + random() * 300;
    const period = (mild ? 10 : 4) + random() * 90, swing = random() * (mild ? 0.3 : 1.5);
    const lag = kind === 'calm' ? 0 : pick(random, [0.5, 2, 6, 15, 25, 61]), lagCost = random() * 12;
    const wave = pick(random, ['none', 'square', 'sine', 'saw']);
    const noise = seeded(1000 + i);
    const r = run(most, fixed, pixels, hz, 900, (t, ratio, since) => {
      const phase = (t % period) / period;
      const scene = wave === 'square' ? (phase < 0.5 ? 1 : 1 + swing) : wave === 'sine' ? 1 + swing * (0.5 + 0.5 * Math.sin(phase * 2 * Math.PI)) : wave === 'saw' ? 1 + swing * phase : 1;
      const late = lag > 0 && ratio > 1.2 && since > lag ? lagCost : 0;
      return {
        pixels: pixels * scene * (1 + jitter * (noise() * 2 - 1)),
        fixed: fixed + late,
        hitch: noise() < hitchOdds ? hitchSize : 0,
      };
    });
    cases[kind]++;
    const minute = busiest(r.log, 60), ten = busiest(r.log, 600);
    worst[kind] = [Math.max(worst[kind][0], minute), Math.max(worst[kind][1], ten)];
    const tag = `${kind} ${i}: most ${most}, ${fixed.toFixed(1)} + ${pixels.toFixed(2)} x r^2 ms, ${hz} Hz, jitter ${jitter}, hitches ${hitchOdds} of ${hitchSize.toFixed(0)} ms, ${wave} x${(1 + swing).toFixed(2)} every ${period.toFixed(0)} s, +${lagCost.toFixed(1)} ms ${lag} s after a change`;
    assert.ok(minute <= LIMITS[kind][0], `${tag}: ${minute} changes in one minute`);
    assert.ok(ten <= LIMITS[kind][1], `${tag}: ${ten} changes in ten minutes`);
  }
}
console.log(`PASS: fast machine untouched; the measured Mac rests at 1.75 with rare tries upward; a weak machine is fast within four seconds; a step down that buys nothing is undone (slow processor, 30 a second cap, 50 Hz screen) and sharpness comes back under such a cap; a step up is on trial, and a step that fails later keeps its penalty; long frames that keep coming count, hitches, loading and an absent tab do not; full sharpness is back within a minute of a lighter scene; one measurement does not mislead it for long; odd screens.`);
console.log(`Random computers: ${steadyCases} steady (${restCases} with a step that reaches 52: each rests on the sharpest one). Most changes in any minute and in any ten minutes: ${Object.keys(LIMITS).map((kind) => `${cases[kind]} ${kind} ${worst[kind]} (limits ${LIMITS[kind]})`).join('; ')}.`);
