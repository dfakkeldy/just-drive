// The Places panel in Port Hood, Point Tupper, Canso Causeway and Judique, in the real page.
// Run only through tools/yard-shots.sh (it starts the browser with tools/browser.sh):
// OUT=<dir> HUD=1 RUN=places-areas-browser.mjs VIEWS="porthood|area=porthood&mode=explore pointtupper|area=pointtupper&mode=explore cansocauseway|area=cansocauseway&mode=explore judique|area=judique&mode=explore" tools/yard-shots.sh 1280 720
// For each area: the list equals web/src/places-areas.ts (Judique keeps its two hand-built places first, and the
// area's cemetery places follow); every
// button jumps onto a road at rest and shows that place's arrival note; desktop and phone pictures of the panel
// and of one place. SHOT_PLACE_<area>=<id> picks the pictured place.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep, waitForSettled, exitCheck } from './cdp.mjs';

const [out, ...urls] = process.argv.slice(2), port = process.env.CDP_PORT;
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
// The same filter nearestPlacement uses for an ordinary place, so a crossing road cannot answer instead.
const onRoad = `(()=>{const h=mmm.places.roads.nearest(mmm.vehicle.x,mmm.vehicle.z,1,r=>r.kind>=1&&r.kind<=3);
  return {dist:h?.dist??null,road:h?.road.name??null,rail:h?h.road.name==='Railroad'||!!h.road.railway:null,speed:mmm.vehicle.speed,
  heading:h?Math.abs(Math.atan2(Math.sin(mmm.vehicle.heading-h.heading),Math.cos(mmm.vehicle.heading-h.heading))):null,
  card:document.getElementById('placeArrival').hidden?'':document.getElementById('placeArrival').innerText,
  panel:!document.getElementById('placesPanel').hidden};})()`;
async function jump(page, id) {
  await page.read(`document.getElementById('placesButton').click()`);
  assert.equal(await page.read(`!document.getElementById('placesPanel').hidden`), true, 'PLACES opens the panel');
  await page.read(`document.querySelector('[data-place="${id}"]').click()`);
  const name = await page.read(`mmm.places.places.find(p=>p.id===${JSON.stringify(id)}).name`);
  for (let i = 0; i < 40; i++) { await sleep(150); if ((await page.read(onRoad)).card.includes(name)) break; }
  return page.read(onRoad);
}

for (const url of urls) {
  const area = new URL(url).searchParams.get('area');
  assert.ok(PICTURED[area], `a researched area: ${area}`);
  const desk = await openPage(url, 1280, 720, false);
  try {
    const list = await desk.read(`(async()=>{const {areaPlaces}=await import('/src/places-areas.ts');
      return {shown:mmm.places.places.map(p=>p.id),buttons:[...document.querySelectorAll('#placesList button')].map(b=>b.dataset.place),
      expected:areaPlaces(mmm.area.id).map(p=>p.id),cemeteries:(mmm.cemeteries?.places??[]).map(p=>p.id),names:Object.fromEntries(mmm.places.places.map(p=>[p.id,p.name])),
      marks:mmm.places.marks.length,area:mmm.area.id};})()`);
    const expected = [...(area === 'judique' ? ['home', 'church'] : []), ...list.expected, ...list.cemeteries];
    assert.ok(list.cemeteries.length > 0 && list.cemeteries.every(id => id.startsWith('cemetery-')), `${area}: its cemetery places come from the cemetery pack`);
    assert.equal(list.area, area);
    assert.deepEqual(list.shown, expected, `${area}: the list main.ts shows`);
    assert.deepEqual(list.buttons, expected, `${area}: one button per place`);
    assert.equal(list.marks, expected.length, `${area}: one minimap mark per place`);
    await desk.read(`document.getElementById('placesButton').click()`); await sleep(400);
    assert.equal(await desk.read(`!document.getElementById('placesPanel').hidden && document.activeElement?.dataset.place===${JSON.stringify(expected[0])}`), true, `${area}: panel opens with focus on the first place`);
    await desk.shot(`${area}-panel-desktop`);
    await desk.read(`document.getElementById('placesClose').click()`);
    for (const id of list.expected) {
      const s = await jump(desk, id);
      const pass = !s.panel && s.speed === 0 && s.dist !== null && s.dist < 0.01 && !s.rail && s.heading < 0.001 && s.card.includes(list.names[id]);
      results.push({ area, id, ...s, pass });
      console.log(`${pass ? 'PASS' : 'FAIL'} ${area} ${id}: on ${s.road} at rest, note "${s.card.split('\n')[0]}"`);
      if (!pass) process.exitCode = 1;
    }
    await jump(desk, PICTURED[area]); await quiet(desk);
    assert.ok((await desk.read(onRoad)).card.includes(list.names[PICTURED[area]]), `${area}: pictured place note`);
    await desk.shot(`${area}-place-desktop`);
    assert.equal(desk.errors.length, 0, `${area}: no page errors: ${desk.errors.join(' | ')}`);
    desk.assertHealthy();
  } finally { await desk.close(); }

  const phone = await openPage(`${url}&touch=1`, 390, 844, true);
  try {
    assert.equal(await phone.read(`(()=>{const b=document.getElementById('placesButton');const r=b.getBoundingClientRect();return !b.hidden&&r.width>=40&&r.height>=40&&r.right<=innerWidth&&r.bottom<=innerHeight;})()`), true, `${area}: phone PLACES button is on screen`);
    await phone.read(`document.getElementById('placesButton').click()`); await sleep(400);
    assert.equal(await phone.read(`(()=>{const c=document.getElementById('placesCard').getBoundingClientRect();const l=document.getElementById('placesList').lastElementChild;l.scrollIntoView({block:'end'});const r=l.getBoundingClientRect();return c.left>=0&&c.right<=innerWidth&&c.top>=0&&c.bottom<=innerHeight&&r.bottom<=innerHeight&&r.top>=0&&document.querySelectorAll('#placesList button').length===mmm.places.places.length;})()`), true, `${area}: phone panel fits the screen and its last place scrolls into view`);
    await phone.shot(`${area}-panel-phone`);
    await phone.read(`document.getElementById('placesClose').click()`);
    const s = await jump(phone, PICTURED[area]); await quiet(phone);
    const note = (await phone.read(onRoad)).card;
    assert.ok(s.dist < 0.01 && s.speed === 0 && note.length > 0, `${area}: phone jump rests on the road with its note: ${JSON.stringify(s)}`);
    await phone.shot(`${area}-place-phone`);
    console.log(`PASS ${area} phone panel and ${PICTURED[area]}`);
    assert.equal(phone.errors.length, 0, `${area}: no phone page errors: ${phone.errors.join(' | ')}`);
    phone.assertHealthy();
  } finally { await phone.close(); }
}
writeFileSync(`${out}/places-areas-browser.json`, JSON.stringify(results, null, 2));
if (urls.length === 4) assert.equal(results.length, 20, 'every researched place was tried');
console.log(`${process.exitCode ? 'FAIL' : 'PASS'} ${results.filter(r => r.pass).length}/${results.length} jumps; pictures in ${out}`);
exitCheck();
