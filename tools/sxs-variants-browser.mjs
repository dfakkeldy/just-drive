#!/usr/bin/env node
// RUN=sxs-variants-browser.mjs VIEWS='sxs|mode=explore&vehicle=sxs' tools/yard-shots.sh 1280 800
// Real browser check for all four generic side-by-side models: renderer budget, title/settings picker,
// saved storage, ?car= links, live driving, and ordinary mail isolation.
import assert from 'node:assert/strict';
import { open, sleep } from './truck-cdp.mjs';

const [, first] = process.argv.slice(2);
const origin = new URL(first).origin;
const p = await open(`${origin}/sxs.html?model=sxs&view=front`);
const failures = [];
const check = (ok, label, detail) => {
  if (!ok) failures.push({ label, detail });
  console.log(ok ? 'PASS' : 'FAIL', label, ...(ok ? [] : [JSON.stringify(detail)]));
};

async function waitReady(predicate, label) {
  for (let i = 0; i < 160; i++) {
    await sleep(250);
    try {
      if (await p.read(`document.documentElement.dataset.mmmReady==='true' && (${predicate})`)) return;
    } catch { /* reload in flight */ }
  }
  throw new Error(`timeout waiting for ${label}`);
}

try {
  // 1. Actual WebGL renderer budgets for all four models on sxs.html.
  for (const id of ['sxs', 'sxs-utility', 'sxs-crew', 'sxs-cabin']) {
    await p.navigate(`${origin}/sxs.html?model=${id}&view=front`);
    const stats = await p.read(`(() => {
      const { car, renderer, scene, camera } = sxsPreview;
      for (const n of scene.children) if (n !== car.root && !n.isLight) n.visible = false;
      car.root.traverse(n => { n.frustumCulled = false; });
      renderer.render(scene, camera);
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    })()`);
    check(stats.calls <= 30 && stats.triangles <= 40000, `${id}: studio renderer budget`, stats);
  }

  // 2. Just Drive title card: clicking Side by side reveals the 4 model buttons without overlap.
  await p.navigate(`${origin}/?mode=explore&title=1&q=low&radio=0&mp=0`);
  await waitReady(`!!document.getElementById('vehicleChoice')`, 'explore title');
  await p.read(`localStorage.removeItem('mmm.vehicle')`);
  const beforeRow = await p.read(`({
    kinds: [...document.querySelectorAll('#vehicleChoice button')].map(b => b.dataset.vehicle),
    sub: !!document.querySelector('#vehicleChoice [data-sxs-models]')
  })`);
  check(JSON.stringify(beforeRow.kinds) === JSON.stringify(['car', 'sxs', 'bike', 'drone']) && !beforeRow.sub,
    'title card shows Side by side in the top row and hides model sub-row when car is active', beforeRow);

  // Settings panel ride picker must wrap without overflowing when Car is active (desktop and narrow phone).
  await p.read(`document.getElementById('titleStart')?.click(); document.getElementById('gear')?.click();`);
  await sleep(200);
  const measureSettings = `(() => {
    const panel = document.getElementById('settings'), pr = panel.getBoundingClientRect();
    const btns = [...document.querySelectorAll('#settingsVehicleChoice button')].map(b => b.getBoundingClientRect());
    return {
      open: panel.classList.contains('open'),
      vehicleId: mmm.vehicleId,
      carPressed: document.querySelector('#settingsVehicleChoice [data-vehicle="car"]')?.getAttribute('aria-pressed'),
      panelWidth: pr.width,
      minWidth: Math.min(...btns.map(r => r.width)),
      minHeight: Math.min(...btns.map(r => r.height)),
      overflow: panel.scrollWidth - panel.clientWidth,
      maxRight: Math.max(...btns.map(r => r.right)) - pr.right,
      count: btns.length,
    };
  })()`;
  const settingsDesktop = await p.read(measureSettings);
  check(
    settingsDesktop.open && settingsDesktop.vehicleId === 'car' && settingsDesktop.carPressed === 'true'
    && settingsDesktop.count === 4 && settingsDesktop.panelWidth > 200 && settingsDesktop.minWidth >= 60 && settingsDesktop.minHeight >= 40
    && settingsDesktop.overflow <= 1 && settingsDesktop.maxRight <= 1,
    'desktop Settings ride picker wraps inside open panel when Car is active', settingsDesktop,
  );
  await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(150);
  const settingsPhone = await p.read(measureSettings);
  check(
    settingsPhone.open && settingsPhone.vehicleId === 'car' && settingsPhone.carPressed === 'true'
    && settingsPhone.count === 4 && settingsPhone.panelWidth > 200 && settingsPhone.minWidth >= 60 && settingsPhone.minHeight >= 40
    && settingsPhone.overflow <= 1 && settingsPhone.maxRight <= 1,
    'phone Settings ride picker wraps inside open panel when Car is active', settingsPhone,
  );
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await p.navigate(`${origin}/?mode=explore&title=1&q=low&radio=0&mp=0`);
  await waitReady(`!!document.getElementById('vehicleChoice')`, 'explore title after settings width check');

  await p.read(`setTimeout(() => document.querySelector('#vehicleChoice [data-vehicle="sxs"]').click(), 0)`);
  await waitReady(`mmm.vehicleId === 'sxs' && !!document.querySelector('#vehicleChoice [data-sxs-models]')`, 'sxs selected');
  const sxsUi = await p.read(`(() => {
    const card = document.getElementById('titleCard');
    const rect = s => card.querySelector(s)?.getBoundingClientRect();
    const choice = rect('#vehicleChoice'), dl = rect('dl'), start = rect('#titleStart');
    const clear = (a, b) => a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1;
    return {
      stored: localStorage.getItem('mmm.vehicle'),
      groupPressed: document.querySelector('#vehicleChoice [data-vehicle-group="sxs"]')?.getAttribute('aria-pressed'),
      models: [...document.querySelectorAll('#vehicleChoice [data-sxs-models] button')].map(b => [b.dataset.vehicle, b.textContent, b.getAttribute('aria-pressed')]),
      noOverlap: !!choice && !!dl && !!start && clear(choice, dl) && clear(dl, start) && clear(choice, start),
    };
  })()`);
  check(
    sxsUi.stored === 'sxs' && sxsUi.groupPressed === 'true' && sxsUi.noOverlap &&
    JSON.stringify(sxsUi.models) === JSON.stringify([
      ['sxs', 'Sport', 'true'],
      ['sxs-utility', 'Utility cab', 'false'],
      ['sxs-crew', 'Crew cab', 'false'],
      ['sxs-cabin', 'Full cabin', 'false'],
    ]),
    'selecting Side by side exposes the four models cleanly with no title overlap', sxsUi,
  );

  // 3. Switch to Utility cab from title card, then to Crew cab from Settings, and drive forward.
  await p.read(`setTimeout(() => document.querySelector('#vehicleChoice [data-vehicle="sxs-utility"]').click(), 0)`);
  await waitReady(`mmm.vehicleId === 'sxs-utility'`, 'sxs-utility selected');
  const utilState = await p.read(`({
    id: mmm.vehicleId,
    mass: mmm.vehicle.spec.mass,
    stored: localStorage.getItem('mmm.vehicle'),
    hud: document.getElementById('hud')?.textContent ?? '',
    pressed: document.querySelector('#settingsVehicleChoice [data-vehicle="sxs-utility"]')?.getAttribute('aria-pressed'),
  })`);
  check(utilState.id === 'sxs-utility' && utilState.mass === 1080 && utilState.stored === 'sxs-utility' && utilState.pressed === 'true',
    'title switch loads Side by side: utility cab', utilState);

  await p.read(`document.getElementById('titleStart')?.click(); document.getElementById('gear')?.click();`);
  await sleep(250);
  await p.read(`setTimeout(() => document.querySelector('#settingsVehicleChoice [data-vehicle="sxs-crew"]').click(), 0)`);
  await waitReady(`mmm.vehicleId === 'sxs-crew'`, 'sxs-crew selected from settings');
  await p.read(`document.getElementById('titleStart')?.click();`);
  await sleep(400);
  const startPose = await p.read(`({ x: mmm.vehicle.x, z: mmm.vehicle.z, id: mmm.vehicleId, wb: mmm.vehicle.spec.wheelbase })`);
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
  for (let i = 0; i < 30; i++) {
    await sleep(250);
    if (await p.read(`Math.hypot(mmm.vehicle.x - (${startPose.x}), mmm.vehicle.z - (${startPose.z})) > 4`)) break;
  }
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
  const moved = await p.read(`({ dist: Math.hypot(mmm.vehicle.x - (${startPose.x}), mmm.vehicle.z - (${startPose.z})), speed: mmm.vehicle.speed, pressed: document.querySelector('#settingsVehicleChoice [data-vehicle="sxs-crew"]')?.getAttribute('aria-pressed') })`);
  check(startPose.id === 'sxs-crew' && startPose.wb === 3.05 && moved.dist > 3 && moved.pressed === 'true',
    'settings switch loads crew cab and W drives it forward', { startPose, moved });

  // 4. ?car= links work for both legacy ?car=sxs and the new ?car=sxs-cabin.
  await p.navigate(`${origin}/?mode=explore&car=sxs-cabin&q=low&radio=0&mp=0`);
  await waitReady(`mmm.vehicleId === 'sxs-cabin'`, '?car=sxs-cabin');
  const cabinState = await p.read(`({ id: mmm.vehicleId, mass: mmm.vehicle.spec.mass, pressed: document.querySelector('#settingsVehicleChoice [data-vehicle="sxs-cabin"]')?.getAttribute('aria-pressed') })`);
  check(cabinState.id === 'sxs-cabin' && cabinState.mass === 1320 && cabinState.pressed === 'true',
    '?car=sxs-cabin loads Side by side: full cabin', cabinState);

  await p.navigate(`${origin}/?mode=explore&car=sxs&q=low&radio=0&mp=0`);
  await waitReady(`mmm.vehicleId === 'sxs'`, '?car=sxs');
  const legacyState = await p.read(`({ id: mmm.vehicleId, mass: mmm.vehicle.spec.mass })`);
  check(legacyState.id === 'sxs' && legacyState.mass === 790, '?car=sxs keeps loading sport side by side', legacyState);

  // 5. Saved side-by-side choice leaves ordinary mail play on the mail car.
  await p.read(`localStorage.setItem('mmm.vehicle', 'sxs-crew')`);
  await p.navigate(`${origin}/?mode=mail&title=1&q=low&radio=0&mp=0`);
  await waitReady(`mmm.vehicleId === 'car'`, 'mail mode ignores saved sxs-crew');
  const mailState = await p.read(`({ id: mmm.vehicleId, picker: !!document.getElementById('vehicleChoice') })`);
  check(mailState.id === 'car' && !mailState.picker, 'mail play ignores saved sxs-crew and hides ride picker', mailState);

  assert.deepEqual(failures, [], 'side-by-side variants browser checks');
  console.log('PASS all four side-by-side variants in the browser');
} finally {
  await p.close();
}
