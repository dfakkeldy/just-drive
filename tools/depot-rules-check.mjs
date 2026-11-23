// Pure Node check for the Port Hood Mail Depot, Boss character looks, loading scene and interrogation room.
// node tools/run-node-check.mjs tools/depot-rules-check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {
  BOSS_LOOKS,
  DEFAULT_BOSS_LOOK,
  InterrogationSession,
  LoadingRun,
  SWEET_SPOT,
  autoLoadingOnStart,
  dayBundles,
  depotEnabled,
  loadingEnabled,
  mergeSeenOffences,
  needsInterrogation,
  readBossLook,
  sampleComplaints,
  selectComplaints,
} from '../web/src/depot-rules.ts';
import { buildBossCharacter } from '../web/src/boss-character.ts';
import { DEPOT_DOOR_LOCAL, DEPOT_DOOR_RADIUS, DEPOT_FRAME, DepotSite } from '../web/src/depot-site.ts';
import { complaintLine } from '../web/src/complaints.ts';
import { Interiors } from '../web/src/interiors.ts';

// 1. Character options & privacy/mark guards
assert.equal(BOSS_LOOKS.length, 3, 'three invented Boss character options');
assert.ok(BOSS_LOOKS.some(l => l.id === DEFAULT_BOSS_LOOK), 'default look is one of the three options');
assert.equal(readBossLook(new URLSearchParams('')), DEFAULT_BOSS_LOOK);
assert.equal(readBossLook(new URLSearchParams('bossLook=a')), 'windbreaker');
assert.equal(readBossLook(new URLSearchParams('bossLook=b')), 'overcoat');
assert.equal(readBossLook(new URLSearchParams('bossLook=c')), 'vest');
assert.equal(readBossLook(new URLSearchParams('bossLook=overcoat')), 'overcoat');

const root = process.env.MMM_ROOT ?? process.cwd();
const FORBIDDEN_MARKS = /\b(canada\s*post|postes\s*canada|royal\s*mail|usps|purolator|fedex|ups)\b/i;
for (const file of ['depot-rules.ts', 'boss-character.ts', 'depot-site.ts', 'depot.ts', 'interior-depot.ts']) {
  const src = readFileSync(`${root}/web/src/${file}`, 'utf8');
  assert.doesNotMatch(src, FORBIDDEN_MARKS, `${file} contains no real postal service names`);
}

// 2. Gates & triggers
assert.equal(depotEnabled(true, true, new URLSearchParams('')), true);
assert.equal(depotEnabled(true, true, new URLSearchParams('depot=0')), false);
assert.equal(depotEnabled(false, true, new URLSearchParams('')), false);
assert.equal(depotEnabled(true, false, new URLSearchParams('')), false);

assert.equal(loadingEnabled('mail', true, true, false, false, new URLSearchParams('')), true);
assert.equal(loadingEnabled('fired', true, true, false, false, new URLSearchParams('')), false);
assert.equal(loadingEnabled('explore', true, true, false, false, new URLSearchParams('')), false);
assert.equal(loadingEnabled('mail', true, true, true, false, new URLSearchParams('')), false, 'never in Just Drive');
assert.equal(loadingEnabled('mail', true, true, false, true, new URLSearchParams('')), false, 'never when bare');
assert.equal(loadingEnabled('mail', true, true, false, false, new URLSearchParams('boss=0')), false);
assert.equal(loadingEnabled('mail', true, true, false, false, new URLSearchParams('depot=0')), false);

assert.equal(autoLoadingOnStart(true, true, new URLSearchParams('')), true, 'plain visitor shift starts in loading bay');
assert.equal(autoLoadingOnStart(true, true, new URLSearchParams('title=1')), false, '?title=1 harness stays on road');
assert.equal(autoLoadingOnStart(true, false, new URLSearchParams('x=1')), false, 'test visit stays on road');
assert.equal(autoLoadingOnStart(true, false, new URLSearchParams('x=1&depot=1')), true, '?depot=1 forces loading bay');
assert.equal(autoLoadingOnStart(false, true, new URLSearchParams('depot=1')), false);

assert.equal(needsInterrogation('suspension', 0), true, 'any suspension opens interrogation');
assert.equal(needsInterrogation('warning', 1), true, 'Boss-seen warning opens interrogation');
assert.equal(needsInterrogation('suspension', 2), true, 'Boss-seen suspension opens interrogation');
assert.equal(needsInterrogation('clear', 0), false, 'clean day skips interrogation');
assert.equal(needsInterrogation('clear', 1), false, 'clear verdict skips interrogation');
assert.equal(needsInterrogation('warning', 0), false, 'mild unseen warning skips interrogation');

// 3. LoadingRun rules
{
  const ordinary = dayBundles(1, false, 30);
  const dbl = dayBundles(2, true, 30);
  assert.ok(ordinary.length >= 5 && ordinary.length <= 7, `ordinary bundle count ${ordinary.length}`);
  assert.equal(dbl.length, 8, 'double mail day loads 8 bundles');
  assert.deepEqual(dayBundles(5, false, 35), dayBundles(5, false, 35), 'seeded deterministically');

  const run = new LoadingRun(1, false, 30);
  assert.equal(run.phase, 'loading');
  assert.equal(run.count, 0);
  // Needle at 0 is in sweet spot -> neat
  run.needle = 0;
  assert.equal(run.inSweetSpot, true);
  assert.equal(run.toss(), true);
  for (let i = 0; i < 5; i++) run.update(0.1);
  assert.equal(run.count, 1);
  assert.equal(run.loaded[0].grade, 'neat');
  assert.equal(run.neatCount, 1);
  // Needle outside sweet spot -> crammed (still loads!)
  run.needle = SWEET_SPOT + 0.4;
  assert.equal(run.inSweetSpot, false);
  assert.equal(run.toss(), true);
  for (let i = 0; i < 5; i++) run.update(0.1);
  assert.equal(run.count, 2);
  assert.equal(run.loaded[1].grade, 'crammed');
  // Rapid-fire toss finishes remaining bundles and closes hatch
  while (run.phase === 'loading') {
    run.needle = 0;
    run.toss();
  }
  assert.equal(run.phase, 'closing');
  assert.equal(run.count, run.total);
  for (let i = 0; i < 20; i++) run.update(0.1);
  assert.equal(run.phase, 'done');
  assert.equal(run.skipped, false);
  assert.equal(run.hatchClose, 1);

  // Skip works immediately with zero penalty
  const skipped = new LoadingRun(3, true, 40);
  skipped.skip();
  assert.equal(skipped.phase, 'done');
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.toss(), false);
}

// 4. InterrogationSession rules
{
  const realLawn = complaintLine('lawnDamage', 4, 12);
  const realBox = complaintLine('boxDown', 4, 19);
  const realMissing = complaintLine('missing', 4, 21);
  const realSeen = complaintLine('ditchMail', 4, 8);
  const picked = selectComplaints([
    { kind: 'missing', customer: 'c1', line: realMissing },
    { kind: 'boxDown', customer: 'c2', line: realBox },
    { kind: 'ditchMail', customer: 'c3', line: realSeen, seen: true },
    { kind: 'lawnDamage', customer: 'c4', line: realLawn },
  ], 4);
  assert.equal(picked.length, 3, 'caps interrogation at 3 complaints');
  assert.equal(picked[0].seen, true, 'Boss-seen complaint read first');
  assert.equal(picked[1].kind, 'lawnDamage', 'lawn damage prioritized next');

  const session = new InterrogationSession('suspension', 4, picked);
  assert.equal(session.phase, 'intro');
  assert.equal(session.choices.length, 0);
  session.advance();
  assert.equal(session.phase, 'complaint');
  assert.equal(session.quoteLine, realSeen, 'uses exact existing complaint line');
  assert.equal(session.choices.length, 3, 'three dry player replies');
  const verdictBefore = session.verdictLine;
  assert.equal(session.choose(2), true);
  assert.equal(session.phase, 'response');
  assert.equal(session.answers, 1);
  assert.equal(session.verdictLine, verdictBefore, 'player reply changes nothing serious');
  // Step through remaining complaints
  for (let i = 0; i < 10 && session.phase !== 'closing'; i++) {
    if (session.phase === 'complaint') session.choose(i % 3);
    else session.advance();
  }
  assert.equal(session.phase, 'closing');
  assert.equal(session.answers, 3);
  assert.equal(session.verdictLine, verdictBefore);
  session.advance();
  assert.equal(session.phase, 'done');

  // Direct visit uses real complaintLine() samples and can be skipped
  const visit = new InterrogationSession('visit', 2, []);
  assert.equal(visit.items.length, 3);
  assert.equal(visit.items[0].line, sampleComplaints(2)[0].line);
  visit.skip();
  assert.equal(visit.phase, 'done');
  assert.equal(visit.skipped, true);
}

// 5. Boss 3D character options (all 3 × standing/seated)
for (const spec of BOSS_LOOKS) {
  for (const pose of ['standing', 'seated']) {
    const fig = buildBossCharacter(spec.id, pose);
    let meshes = 0, tris = 0;
    fig.root.traverse(o => {
      if (o.isMesh) {
        meshes++;
        assert.equal(o.castShadow, false);
        assert.equal(o.receiveShadow, false);
        const pos = o.geometry.getAttribute('position');
        tris += o.geometry.index ? o.geometry.index.count / 3 : pos.count / 3;
      }
    });
    assert.equal(meshes, 3, `${spec.id} (${pose}) uses 3 merged draws (body, head, arm)`);
    assert.ok(tris > 150 && tris < 1200, `${spec.id} (${pose}) lean triangle count: ${tris}`);
    fig.dispose();
  }
}

// 6. DepotSite geometry & door reachability
{
  const village = [614206.015, 5096202.736];
  const site = new DepotSite(village);
  assert.ok(site.solids.length >= 4, 'building and bollards have collision solids');
  assert.ok(site.clear.length >= 4, 'building and apron clear surveyed trees');
  // Door point is on the gravel apron, outside every solid, and within DEPOT_DOOR_RADIUS
  const d = site.doorPosition;
  assert.ok(site.surface(d.x, d.z)?.kind === 8, 'door apron is gravel');
  assert.ok(Math.hypot(d.x - site.centre.x, d.z - site.centre.z) < DEPOT_DOOR_RADIUS, 'door is in front of building');
  assert.ok(DEPOT_DOOR_LOCAL[0] > 6.5, 'door sits in front of loading dock');
  assert.ok(Math.hypot(DEPOT_FRAME.e - village[0], DEPOT_FRAME.n - village[1]) >= 200, 'clear of Port Hood village researched place');
}

// 7. Interior scene budgets & shared door system (headless DOM stand-in)
{
  const pen = new Proxy({}, { get: (_, key) => key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
  class FakeEl {
    hidden = false; textContent = ''; className = ''; id = ''; disabled = false; type = '';
    children = []; listeners = new Map(); style = { values: new Map(), setProperty(k, v) { this.values.set(k, v); }, removeProperty(k) { this.values.delete(k); } };
    classList = { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } };
    addEventListener(n, fn) { this.listeners.set(n, fn); }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(n) { this.children.push(n); return n; }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    remove() {}
    getContext() { return pen; }
  }
  const prevDoc = globalThis.document, prevAdd = globalThis.addEventListener, prevRem = globalThis.removeEventListener;
  globalThis.document = { head: new FakeEl(), body: new FakeEl(), hidden: false, createElement() { return new FakeEl(); } };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  try {
    const { DepotLoadingInterior, DepotInterrogationInterior, BossLooksInterior, depotDoor } = await import('../web/src/interior-depot.ts');
    const idle = { throttle: 0, steer: 0, handbrake: false };
    const loading = new DepotLoadingInterior({ day: 3, double: true, stops: 42 });
    loading.update(0.1, idle);
    let meshes = 0;
    loading.scene.traverse(o => { if (o.isMesh) { meshes++; assert.equal(o.castShadow, false); } if (o.isLight) assert.ok(!o.castShadow); });
    assert.ok(meshes < 45, `loading bay mesh count ${meshes}`);
    loading.leave();
    assert.ok(loading.result !== null);
    loading.dispose();
    assert.equal(loading.scene.children.length, 0);

    const office = new DepotInterrogationInterior({ reason: 'suspension', day: 3 });
    office.update(0.1, idle);
    let oMeshes = 0;
    office.scene.traverse(o => { if (o.isMesh) { oMeshes++; assert.equal(o.castShadow, false); } if (o.isLight) assert.ok(!o.castShadow); });
    assert.ok(oMeshes < 40, `interrogation room mesh count ${oMeshes}`);
    office.leave();
    assert.ok(office.result !== null);
    office.dispose();
    assert.equal(office.scene.children.length, 0);

    const looks = new BossLooksInterior();
    looks.update(0.1, idle);
    looks.leave();
    looks.dispose();
    assert.equal(looks.scene.children.length, 0);

  // Needle moves continuously across bundle landings (no phase teleport when pace steps up)
  const smooth = new LoadingRun(4, false, 30);
  for (let i = 0; i < 120; i++) smooth.update(0.1);
  const beforeLanding = smooth.needle;
  smooth.toss();
  for (let i = 0; i < 4; i++) smooth.update(0.1); // lands bundle
  const afterLanding = smooth.needle;
  smooth.update(0.016);
  assert.ok(Math.abs(smooth.needle - afterLanding) < 0.08, `needle stays continuous after landing (${beforeLanding} -> ${afterLanding} -> ${smooth.needle})`);

  // Boss-seen speeding / schoolBus offences merge cleanly when there are zero customer complaints
  const merged = mergeSeenOffences([], [{ kind: 'speeding', label: '104 in an 80' }, { kind: 'schoolBus', label: 'passed a stopped school bus' }]);
  assert.equal(merged.length, 2);
  assert.ok(merged.every(m => m.seen === true));
  const speedHearing = new InterrogationSession('bossVerdict', 3, merged);
  speedHearing.advance();
  assert.match(speedHearing.quoteLine, /104 in an 80/);

  // Virtual doors (radius 0) never trigger proximity prompt; physical Port Hood door does.
  // Also verify: (a) finish() clears busy BEFORE calling receive() so depot -> office jump succeeds,
  // and (b) afterShift: true doors advance through entering -> inside -> leaving -> drive when dt === 0.
  const site = new DepotSite([614206.015, 5096202.736]);
  let jumpRequested = false;
  const doors = new Interiors(() => 0, () => '', receipt => {
    if (receipt.door.id === 'depot' && jumpRequested) {
      jumpRequested = false;
      assert.equal(doors.busy, false, 'Interiors.busy must be false before receive() runs');
      doors.enter('depot-interrogation');
    }
  });
  doors.register({ id: 'virtual', name: 'Virtual', position: { x: 0, z: 0 }, radius: 0, prompt: '', create: () => new DepotLoadingInterior({ day: 1 }) });
  doors.register({ id: 'depot-interrogation', name: 'Office', position: { x: 0, z: 0 }, radius: 0, prompt: '', repeat: true, afterShift: true, create: () => new DepotInterrogationInterior({ reason: 'visit', day: 1 }) });
  doors.register(depotDoor(site, DEFAULT_BOSS_LOOK, () => { jumpRequested = true; doors.leave(); }));
  doors.update(0.1, idle, { x: 0, z: 0, speed: 0 }, true);
  assert.equal(doors.busy, false);
  doors.enter(); // should NOT enter virtual door at (0,0)
  assert.equal(doors.busy, false, 'radius 0 door never activates by proximity');
  doors.update(0.1, idle, { x: site.doorPosition.x, z: site.doorPosition.z, speed: 0 }, true);
  doors.enter();
  assert.equal(doors.busy, true, 'Port Hood depot door activates on apron');
  assert.equal(doors.doorId, 'depot');
  // Simulate clicking "Boss's office" from inside Port Hood loading bay
  jumpRequested = true;
  doors.leave();
  doors.update(0.45, idle, { x: site.doorPosition.x, z: site.doorPosition.z, speed: 0 }, true);
  assert.equal(doors.busy, true, 'depot -> office jump enters interrogation room immediately');
  assert.equal(doors.doorId, 'depot-interrogation');
  // Advance afterShift interrogation room using dt = 0 (post-shift wall-clock fallback)
  const realNow = performance.now;
  let fakeMs = 1000;
  performance.now = () => fakeMs;
  try {
    for (let i = 0; i < 12; i++) { fakeMs += 50; doors.update(0, idle, { x: 0, z: 0, speed: 0 }, false); }
    assert.equal(doors.busy, true, 'afterShift room stays open after entering fade with dt=0');
    doors.leave();
    for (let i = 0; i < 12; i++) { fakeMs += 50; doors.update(0, idle, { x: 0, z: 0, speed: 0 }, false); }
    assert.equal(doors.busy, false, 'afterShift room finishes leaving fade with dt=0');
  } finally {
    performance.now = realNow;
  }
  } finally {
    globalThis.document = prevDoc;
    globalThis.addEventListener = prevAdd;
    globalThis.removeEventListener = prevRem;
  }
}

console.log('PASS depot rules, 3 Boss character looks, loading bay, interrogation room, Port Hood site and door checks.');
