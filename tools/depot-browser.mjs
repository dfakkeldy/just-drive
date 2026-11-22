// Only run through tools/yard-shots.sh, which owns tools/browser.sh and its shared slot.
// Verifies the Port Hood Mail Depot exterior + door, all three Boss character looks, the shift-start loading bay,
// and the interrogation room on desktop (1280x800) and phone (DEPOT_PHONE=1: 390x844, touch, LOW).
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep } from './cdp.mjs';

const [out, first] = process.argv.slice(2);
const port = process.env.CDP_PORT;
const PHONE = process.env.DEPOT_PHONE === '1';
const tag = PHONE ? 'phone' : 'desktop';

const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const errors = [];
const c = await cdp(tab.webSocketDebuggerUrl, {
  deadline: 300000,
  onEvent: e => {
    if (e.method === 'Runtime.exceptionThrown') errors.push(e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text);
  },
});

const read = async expression => {
  const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.error || r.result?.exceptionDetails) throw Error(JSON.stringify(r));
  return r.result.result.value;
};
const shot = async label =>
  writeFileSync(`${out}/depot-${tag}-${label}.png`, Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
const until = async (what, expression, seconds) => {
  for (let i = 0; i < seconds * 5; i++) {
    const v = await read(expression);
    if (v) return v;
    await sleep(200);
  }
  throw Error(`${tag}: ${what} not within ${seconds} s`);
};
const fits = id => read(`(()=>{const e=document.getElementById('${id}');if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);
  return {shown:s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0,
    inside:r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,
    overflow:document.documentElement.scrollWidth>innerWidth+1,text:e.textContent};})()`);

async function open(query) {
  await c.send('Emulation.setDeviceMetricsOverride', { width: PHONE ? 390 : 1280, height: PHONE ? 844 : 800, deviceScaleFactor: 1, mobile: PHONE });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: PHONE });
  const url = new URL(`/?x=1&hud=1&radio=0&res=1&scene=0&${PHONE ? 'touch=1&q=low&' : ''}${query}`, first);
  await c.send('Page.navigate', { url: url.href });
  let ready = false;
  for (let i = 0; i < 360 && !ready; i++) {
    await sleep(500);
    ready = await read("document.documentElement.dataset.mmmReady === 'true' && !!window.mmm?.interiors").catch(() => false);
  }
  assert.equal(ready, true, `${tag}: page settles (${query})`);
  assert.equal(await read("!!document.querySelector('vite-error-overlay')"), false);
}

try {
  await c.send('Runtime.enable');
  await c.send('Page.enable');

  // 1. Desktop: capture side-by-side comparison of all three invented Boss character looks.
  if (!PHONE) {
    await open('area=porthood&interior=boss-looks');
    await until('boss looks room inside', "mmm.interiors.busy && mmm.interiors.doorId==='boss-looks'", 10);
    await sleep(700);
    await shot('boss-looks');
    console.log(`PASS ${tag}: 3 Boss character options rendered`);
  }

  // 2. Port Hood Mail Depot building & usable door on Highway 19.
  // Place camera/car on the gravel apron facing the front facade (northwest, az ~318°).
  await open('area=porthood&at=613977.5,5096014.3,318');
  await until('Port Hood depot built', '!!mmm.depot && mmm.depot.group.children.length > 0 && !mmm.depot.waiting', 20);
  await until('depot door prompt shown', "!document.getElementById('doorPrompt').hidden", 10);
  const prompt = await fits('doorPrompt');
  assert.equal(prompt?.shown, true, 'door prompt visible');
  assert.equal(prompt?.inside, true, 'door prompt fits viewport');
  assert.match(prompt?.text ?? '', /Port Hood Mail Depot/);
  await sleep(600);
  await shot('exterior');

  // Enter the depot door -> opens the Loading Bay, with the Boss's office button available.
  await read("document.querySelector('#doorPrompt button').click()");
  await until('loading bay inside', "mmm.interiors.busy && !document.getElementById('interiorHud').hidden && !!document.getElementById('depotToss')", 10);
  await sleep(900);
  const loadPanel = await fits('depotPanel');
  assert.equal(loadPanel?.shown, true, 'loading panel shown');
  assert.equal(loadPanel?.inside, true, 'loading panel fits viewport');
  assert.equal(loadPanel?.overflow, false, 'no horizontal overflow in loading bay');
  await shot('loading');

  // Toss two bundles in the loading bay and confirm counter advances.
  await read("document.getElementById('depotToss').click()");
  await sleep(500);
  await read("document.getElementById('depotToss').click()");
  await sleep(500);
  const loadedCount = await read('mmm.interiors.game.run.count');
  assert.ok(loadedCount >= 2, `tossed bundles loaded (${loadedCount})`);

  // Step into the Boss's office straight from the Port Hood depot loading bay.
  await read("document.getElementById('depotGoOffice').click()");
  await until('interrogation room opened from bay', "mmm.interiors.busy && mmm.interiors.doorId==='depot-interrogation' && !!document.getElementById('depotNext')", 10);
  await sleep(600);
  await read("document.getElementById('depotNext').click()");
  await until('complaint quote displayed', "!document.querySelector('#depotPanel .depotQuote').hidden", 5);
  const visitOffice = await fits('depotPanel');
  assert.equal(visitOffice?.shown, true);
  assert.equal(visitOffice?.inside, true);
  assert.equal(visitOffice?.overflow, false);
  await read("document.querySelector('#interiorHud button').click()");
  await until('stepped back outside depot', '!mmm.interiors.busy', 10);
  console.log(`PASS ${tag}: Port Hood depot exterior, door, loading bay and office visit`);

  // 3. Mabou mail play: shift-start loading bay (?depot=1) + skip, then suspension -> interrogation room with real complaint lines.
  await open('mode=mail&day=3&run=1&title=1&depot=1');
  await read("document.getElementById('titleStart').click();document.activeElement?.blur()");
  await until('shift start auto-opens loading bay', "mmm.interiors.busy && mmm.interiors.doorId==='depot-loading' && !!document.getElementById('depotToss')", 10);
  await sleep(500);
  // Skip the loading bay immediately: shift starts cleanly at 10:00 with zero indoor complaint.
  await read("document.querySelector('#interiorHud button').click()");
  await until('skipped loading bay back to road', '!mmm.interiors.busy', 10);
  const afterSkip = await read('({elapsed:mmm.shift.elapsed,calls:mmm.shift.complaints.all.length,indoor:mmm.shift.indoorParcels})');
  assert.equal(afterSkip.calls, 0, 'skipping loading bay files no complaint');
  assert.equal(afterSkip.indoor, 0, 'loading bay does not add indoor parcels');
  assert.ok(afterSkip.elapsed < 60, `clock reset to start of shift (${afterSkip.elapsed}s)`);

  // Trigger a suspension (lawnDamage complaint) -> shift report shows Report to the Boss's office button.
  await read(`(()=>{const v=mmm.vehicle;mmm.shift.complaints.add({kind:'lawnDamage',target:1,at:100,x:v.x,z:v.z,road:1,customer:'a customer on Highway 19 who would like it noted',line:'There are two new lanes in my lawn. Neither was requested.',seen:true});mmm.shift.end();})()`);
  await sleep(400);
  const officeBtn = await fits('bossOfficeButton');
  assert.equal(officeBtn?.shown, true, 'Report to the Boss office button shown on suspension');
  assert.equal(officeBtn?.inside, true);
  await read("document.getElementById('bossOfficeButton').click()");
  await until('interrogation room opens from report', "mmm.interiors.busy && mmm.interiors.doorId==='depot-interrogation' && !!document.getElementById('depotNext')", 10);
  await sleep(1000);
  await read("document.getElementById('depotNext').click()");
  await until('real complaint line read out', "document.querySelector('#depotPanel .depotQuote p')?.textContent.includes('two new lanes in my lawn')", 5);
  await sleep(250);
  const officePanel = await fits('depotPanel');
  assert.equal(officePanel?.shown, true, 'interrogation panel visible');
  assert.equal(officePanel?.inside, true, 'interrogation panel fits viewport');
  assert.equal(officePanel?.overflow, false, 'no horizontal overflow in interrogation room');
  await shot('interrogation');

  // Answer all complaints -> closing verdict unchanged -> leave returns to shift report cleanly.
  for (let step = 0; step < 12; step++) {
    const busy = await read('mmm.interiors.busy');
    if (!busy) break;
    const phase = await read('mmm.interiors.game?.session?.phase ?? null');
    if (phase === 'complaint') await read("document.querySelector('#depotPanel .depotActions button').click()");
    else if (phase === 'response' || phase === 'closing' || phase === 'intro') await read("document.getElementById('depotNext')?.click()");
    await sleep(250);
  }
  await until('returned to shift report after interrogation', "!mmm.interiors.busy && !document.getElementById('shiftReport').hidden", 10);
  assert.equal(await read("document.getElementById('reportVerdict').textContent"), 'One-day suspension. Without pay.', 'verdict unchanged after answers');
  console.log(`PASS ${tag}: shift-start loading bay (skip) and suspension interrogation room`);

  assert.deepEqual(errors, [], 'no runtime exceptions');
} finally {
  c.close();
  await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {});
}
