// The Places panel in Port Hood, Point Tupper, Canso Causeway and Judique, in the real page.
// Run only through tools/yard-shots.sh (it starts the browser with tools/browser.sh):
// OUT=<dir> HUD=1 RUN=places-areas-browser.mjs VIEWS="porthood|area=porthood&mode=explore pointtupper|area=pointtupper&mode=explore cansocauseway|area=cansocauseway&mode=explore judique|area=judique&mode=explore" tools/yard-shots.sh 1280 720
// Check the full panel order, road jumps, arrival notes and desktop and phone layout.
// The Point Tupper phone page opts into Far views to exercise the turbine place there too.
// The registry keeps pictures and the jump report under evidence/places-areas-browser.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cdp, cdpFetch, sleep, waitForSettled, exitCheck } from './cdp.mjs';

const [runnerOut, ...urls] = process.argv.slice(2), port = process.env.CDP_PORT;
const out = process.env.MMM_CHECK_OUT ? join(process.env.MMM_CHECK_OUT, 'evidence', 'places-areas-browser') : runnerOut;
mkdirSync(out, { recursive: true });
const PICTURED = { porthood: 'port-hood-station', pointtupper: 'granville-green', cansocauseway: 'troy-station', judique: 'baxters-cove' };
const results = [];

async function openPage(url, width, height, phone) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const c = await cdp(tab.webSocketDebuggerUrl, { deadline: 180000 });
  const read = async expression => {
    const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  };
  const close = async () => { try { await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); } finally { c.close(); } };
  try {
    await c.send('Page.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: phone });
    if (phone) await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.clear()}catch{}" });
    await c.send('Page.navigate', { url });
    assert.ok(await waitForSettled(read, url, { polls: 360 }), `page settled: ${url} ${c.errors.join(' | ')}`);
    c.assertHealthy();
  } catch (error) { await close(); throw error; }
  const shot = async name => { const r = await c.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
  return { read, send: c.send, close, shot, errors: c.errors, assertHealthy: c.assertHealthy };
}
/** Wait for the ground under the car to finish loading, then for a few frames. */
async function quiet(page) {
  for (let i = 0; i < 120 && await page.read('mmm.terrain.pending > 0'); i++) await sleep(250);
  await sleep(900);
}

async function checkList(page, area, farViews) {
  const { researched, cemeteries, turbines } = await page.read(`(async()=>{
    const {areaPlaces, tallPlaces} = await import('/src/places.ts');
    const {id} = mmm.area, pack = mmm.terrain.manifest.tall;
    return { researched:areaPlaces(id), cemeteries:(mmm.cemeteries?.places??[]).map(p=>p.id),
      turbines:${farViews} && Number.isInteger(pack?.far) && pack.turbines > 0 ? tallPlaces(id) : [] };
  })()`);
  if (turbines.length) {
    // The optional pack starts after boot. Use scenery readiness independently of the Places list.
    for (let i = 0; i < 120 && !await page.read('!!mmm.farVisibility'); i++) await sleep(250);
    assert.ok(await page.read('mmm.tall?.turbineCount > 0'), `${area}: the advertised turbine pack loads`);
  }
  const list = await page.read(`({ area:mmm.area.id, shown:mmm.places.places.map(p=>p.id),
    buttons:[...document.querySelectorAll('#placesList button')].map(b=>b.dataset.place), marks:mmm.places.marks.length })`);
  const expected = [...(area === 'judique' ? ['home', 'church'] : []), ...researched.map(p => p.id), ...cemeteries, ...turbines.map(p => p.id)];
  assert.ok(cemeteries.length > 0 && cemeteries.every(id => id.startsWith('cemetery-')), `${area}: its cemetery places come from the cemetery pack`);
  assert.equal(list.area, area);
  assert.deepEqual(list.shown, expected, `${area}: researched and cemetery places, then any places from the loaded scenery`);
  assert.deepEqual(list.buttons, expected, `${area}: one button per place`);
  assert.equal(list.marks, expected.length, `${area}: one minimap mark per place`);
  return { researched, turbines, first: expected[0] };
}

// The same filter nearestPlacement uses for an ordinary place, so a crossing road cannot answer instead.
const onRoad = `(()=>{const h=mmm.places.roads.nearest(mmm.vehicle.x,mmm.vehicle.z,1,r=>r.kind>=1&&r.kind<=3);
  return {dist:h?.dist??null,road:h?.road.name??null,rail:h?h.road.name==='Railroad'||!!h.road.railway:null,speed:mmm.vehicle.speed,
  vehicleHeading:mmm.vehicle.heading,roadHeading:h?.heading??null,
  card:document.getElementById('placeArrival').hidden?'':document.getElementById('placeArrival').innerText,
  panel:!document.getElementById('placesPanel').hidden};})()`;
async function jump(page, { id, name }) {
  await page.read(`document.getElementById('placesButton').click()`);
  assert.equal(await page.read(`!document.getElementById('placesPanel').hidden`), true, 'PLACES opens the panel');
  await page.read(`document.querySelector('[data-place="${id}"]').click()`);
  for (let i = 0; i < 40; i++) { await sleep(150); if ((await page.read(onRoad)).card.includes(name)) break; }
  return page.read(onRoad);
}

function judgeJump(s, place) {
  const delta = s.vehicleHeading - (place.spawn?.heading ?? s.roadHeading);
  const heading = Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)));
  const pass = !s.panel && s.speed === 0 && s.dist !== null && s.dist < 0.01 && !s.rail
    && (!place.spawn || s.road === place.spawn.road) && heading < 0.001
    && s.card.includes(place.name) && s.card.includes(place.note);
  return { ...s, heading, pass };
}

async function takePictures(page, list, area, size) {
  const subjects = [
    [list.researched.find(p => p.id === PICTURED[area]), `${area}-place`],
    ...list.researched.filter(p => p.spawn).concat(list.turbines).map(p => [p, `${area}-${p.id}`]),
  ];
  for (const [place, file] of subjects) {
    const jumpResult = judgeJump(await jump(page, place), place);
    assert.ok(jumpResult.pass, `${size} ${place.id}: jump: ${JSON.stringify(jumpResult)}`);
    await quiet(page);
    const settled = judgeJump(await page.read(onRoad), place);
    assert.ok(settled.pass, `${size} ${place.id}: after settling: ${JSON.stringify(settled)}`);
    await page.shot(`${file}-${size}`);
  }
}

for (const url of urls) {
  const area = new URL(url).searchParams.get('area');
  assert.ok(PICTURED[area], `a researched area: ${area}`);
  const desk = await openPage(`${url}&q=high`, 1280, 720, false);
  try {
    const list = await checkList(desk, area, true);
    await desk.read(`document.getElementById('placesButton').click()`); await sleep(400);
    assert.equal(await desk.read(`!document.getElementById('placesPanel').hidden && document.activeElement?.dataset.place===${JSON.stringify(list.first)}`), true, `${area}: panel opens with focus on the first place`);
    await desk.shot(`${area}-panel-desktop`);
    await desk.read(`document.getElementById('placesClose').click()`);
    for (const place of [...list.researched, ...list.turbines]) {
      const s = judgeJump(await jump(desk, place), place);
      results.push({ area, id: place.id, researched: list.researched.includes(place), ...s });
      console.log(`${s.pass ? 'PASS' : 'FAIL'} ${area} ${place.id}: ${s.pass ? `on ${s.road} at rest, note "${s.card.split('\n')[0]}"` : JSON.stringify(s)}`);
      if (!s.pass) process.exitCode = 1;
    }
    await takePictures(desk, list, area, 'desktop');
    assert.equal(desk.errors.length, 0, `${area}: no page errors: ${desk.errors.join(' | ')}`);
    desk.assertHealthy();
  } finally { await desk.close(); }

  const farViews = area === 'pointtupper';
  const phone = await openPage(`${url}&touch=1&q=low${farViews ? '&far=full' : ''}`, 390, 844, true);
  try {
    const list = await checkList(phone, area, farViews);
    assert.equal(await phone.read(`(()=>{const b=document.getElementById('placesButton');const r=b.getBoundingClientRect();return !b.hidden&&r.width>=40&&r.height>=40&&r.right<=innerWidth&&r.bottom<=innerHeight;})()`), true, `${area}: phone PLACES button is on screen`);
    await phone.read(`document.getElementById('placesButton').click()`); await sleep(400);
    assert.equal(await phone.read(`(()=>{const c=document.getElementById('placesCard').getBoundingClientRect();const l=document.getElementById('placesList').lastElementChild;l.scrollIntoView({block:'end'});const r=l.getBoundingClientRect();return c.left>=0&&c.right<=innerWidth&&c.top>=0&&c.bottom<=innerHeight&&r.bottom<=innerHeight&&r.top>=0&&document.querySelectorAll('#placesList button').length===mmm.places.places.length;})()`), true, `${area}: phone panel fits the screen and its last place scrolls into view`);
    await phone.shot(`${area}-panel-phone`);
    await phone.read(`document.getElementById('placesClose').click()`);
    await takePictures(phone, list, area, 'phone');
    console.log(`PASS ${area} phone panel and pictured jumps`);
    assert.equal(phone.errors.length, 0, `${area}: no phone page errors: ${phone.errors.join(' | ')}`);
    phone.assertHealthy();
  } finally { await phone.close(); }
}
writeFileSync(`${out}/places-areas-browser.json`, JSON.stringify(results, null, 2));
if (urls.length === 4) assert.equal(results.filter(r => r.researched).length, 20, 'every researched place was tried');
console.log(`${process.exitCode ? 'FAIL' : 'PASS'} ${results.filter(r => r.pass).length}/${results.length} jumps; pictures in ${out}`);
exitCheck();
