#!/usr/bin/env node
// Road-level game pictures of the two Point Tupper stockpiles: seat and chase views, HIGH and LOW, by day (24 pictures).
// Game geometry only. JPEGs go to $MMM_CHECK_OUT/evidence/stockpiles-pictures/ (check-all keeps that folder after a
// pass and remote-check brings it back), or to the starter's output folder when run by hand.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cdp, cdpFetch, sleep, exitCheck } from './cdp.mjs';
import { stockpilePack } from './stockpiles-pack.mjs';
const [outDir, first] = process.argv.slice(2), port = process.env.CDP_PORT ?? '9333', origin = new URL(first).origin;
const out = process.env.MMM_CHECK_OUT ? join(process.env.MMM_CHECK_OUT, 'evidence', 'stockpiles-pictures') : outDir;
mkdirSync(out, { recursive: true });
// east, north (EPSG:2961), compass heading. Every stand is on a mapped road or track, picked by line of sight
// over the bare-earth heights (the paved road sees little of either pile: the land is in the way).
const POSES = [
  { name: 'logs-paved', site: 'DASA42/1039', at: [628708.8, 5050501.3, 340], note: 'Industrial Park Road, 107 m away: a bank hides most of the yard from the paved road' },
  { name: 'logs-track', site: 'DASA42/1039', at: [628516.4, 5050829.6, 123], note: 'yard track west of the stacks, 69 m away, the whole yard in view' },
  { name: 'logs-close', site: 'DASA42/1039', at: [628528.3, 5050906.3, 148], note: 'yard track north of the stacks, 22 m away' },
  { name: 'coal-paved', site: 'DAPI40/3718', at: [629062.7, 5049599.4, 183], note: 'Industrial Park Road north of the pile, 325 m away: trees and a building hide the pile from the paved road' },
  { name: 'coal-west', site: 'DAPI40/3718', at: [628739.7, 5049296.2, 108], note: 'track west of the pile, 274 m away, the afternoon sun behind the car' },
  { name: 'coal-close', site: 'DAPI40/3718', at: [629076.0, 5049258.0, 209], note: 'gravel line beside the pile, 33 m away' },
];
const pack = await stockpilePack(origin);
console.log('DATA', pack.data);
const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const c = await cdp(tab.webSocketDebuggerUrl, { onEvent: pack.onEvent });
const read = async expression => (await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result.value;
const rows = [];
try {
  await c.send('Page.enable'); await pack.enable(c);
  const only = process.env.STOCKPILE_PICTURES?.split(',');
  for (const quality of ['high', 'low']) for (const pose of POSES) for (const view of ['seat', 'chase']) {
    const name = `${pose.name}-${view}-${quality}`;
    if (only && !only.some(part => name.includes(part))) continue;
    const url = `${origin}/?name=${name}&mode=explore&area=pointtupper&mp=0&radio=0&hud=0&q=${quality}&view=${view}&at=${pose.at.join(',')}`;
    await c.send('Page.navigate', { url });
    let state = null;
    for (let i = 0; i < 480 && !state?.ok; i++) {
      await sleep(500);
      state = await read(`(()=>{try{
        if(document.documentElement.dataset.mmmReady!=='true'||!window.mmm?.stockpiles)return {ok:false};
        const s=mmm.stockpiles,v=mmm.terrain.manifest.village,site=s.sites.find(x=>x.id===${JSON.stringify(pose.site)});
        return {ok:site.group.visible&&site.refits>0,placed:Math.hypot(mmm.vehicle.x-(${pose.at[0]}-v[0]),mmm.vehicle.z-(v[1]-${pose.at[1]})),sites:s.sites.length,exag:mmm.terrain.exag};
      }catch(error){return {ok:false,error:String(error)};}})()`);
    }
    assert.ok(state?.ok, `${name}: the page settled with the pile drawn (${JSON.stringify(state)})`);
    assert.ok(state.placed < 8, `${name}: the car stands at the asked road point (${state.placed.toFixed(1)} m off)`);
    await sleep(1500); c.assertHealthy();
    let shot, jpeg = 84;
    do { shot = Buffer.from((await c.send('Page.captureScreenshot', { format: 'jpeg', quality: jpeg })).result.data, 'base64'); jpeg -= 8; }
    while (shot.length > 290000 && jpeg > 40);
    assert.ok(shot.length > 20000 && shot.length <= 300000, `${name}: a real picture under 300 kB (${shot.length} bytes)`);
    writeFileSync(join(out, `${name}.jpg`), shot);
    rows.push({ name, note: pose.note, bytes: shot.length, exag: state.exag });
    console.log('PICTURE', name, shot.length, 'bytes');
  }
  writeFileSync(join(out, 'pictures.json'), JSON.stringify({ data: pack.data, rows }, null, 2) + '\n');
  c.assertHealthy();
  console.log(`PASS ${rows.length} stockpile pictures in ${out}`);
} finally { await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {}); c.close(); }
exitCheck(0);
