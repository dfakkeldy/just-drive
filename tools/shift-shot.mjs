#!/usr/bin/env node
import { cdp, cdpFetch } from './cdp.mjs';
// Take settled screenshots of the game with headless Chromium (software WebGL).
// Usage: node tools/shot.mjs <outDir> <url> [<url> ...]   (a url's name= parameter names its file)
// Needs a running preview server and Chromium started by tools/shots.sh.
import { writeFileSync } from 'node:fs';

const [outDir, ...urls] = process.argv.slice(2);
const PORT = process.env.CDP_PORT ?? '9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


for (let n = 0; n < urls.length; n++) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const c = await cdp(tab.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: Number(process.env.SHOT_WIDTH ?? 1200), height: Number(process.env.SHOT_HEIGHT ?? 900), deviceScaleFactor: 1, mobile: false });
  await c.send('Page.navigate', { url: urls[n] });
  const t0 = Date.now();
  let state = '';
  while (Date.now() - t0 < 240000) {
    await sleep(1500);
    const r = await c.send('Runtime.evaluate', { expression: 'document.title + "|" + (document.getElementById("hud")?.textContent ?? "")' });
    state = r.result?.result?.value ?? '';
    if (state.startsWith('settled')) break;
  }
  await sleep(1000);
  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  const file = `${outDir}/${new URL(urls[n]).searchParams.get('name') ?? `shot-${n + 1}`}.png`;
  writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
  console.log(file, `${((Date.now() - t0) / 1000).toFixed(0)}s`, state.replace(/\n/g, ' / ').slice(0, 160));
  const details = await c.send('Runtime.evaluate', { expression: `JSON.stringify({shift:document.getElementById('shiftHud')?.textContent,verdict:document.getElementById('reportVerdict')?.textContent,calls:document.getElementById('callCount')?.textContent,missed:document.getElementById('reportMissed')?.textContent,photo:document.getElementById('photoCaption')?.textContent,report:!document.getElementById('shiftReport')?.hidden,stats:document.getElementById('reportStats')?.textContent,scrollable:document.getElementById('reportPanel')?.scrollHeight>document.getElementById('reportPanel')?.clientHeight,overflow:document.documentElement.scrollWidth>innerWidth})` });
  const diagnostics = details.result?.result?.value ?? '{}';
  writeFileSync(file.replace('.png', '.json'), diagnostics);
  console.log('  UI:', diagnostics);
  if (c.logs.some(line => line.startsWith('EXCEPTION'))) throw Error('Browser exception: ' + c.logs.join(' | '));
  if (!state.startsWith('settled')) throw Error('Game did not settle: ' + urls[n]);
  if (JSON.parse(diagnostics).overflow) throw Error('Page overflows the viewport');
  // The phone HUD must fit on two lines at 390px, even in the 420px review window.
  const layout = await c.send('Runtime.evaluate', { expression: `(() => {
    const el=document.getElementById('shiftHud'),s=getComputedStyle(el),c=document.createElement('canvas').getContext('2d');
    c.font=s.font;const lines=el.textContent.split('\\n');
    return {lines:lines.length,width:Math.max(...lines.map(line=>c.measureText(line).width))+24};
  })()` , returnByValue:true });
  const hudLayout=layout.result?.result?.value;
  if (new URL(urls[n]).searchParams.get('touch') === '1' && (hudLayout?.lines !== 2 || hudLayout.width > 370)) throw Error('Phone HUD does not fit: ' + JSON.stringify(hudLayout));
  if (c.logs.length) console.log('  console:', c.logs.slice(0, 8).join(' | ').slice(0, 900));
  await cdpFetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`);
  c.close();
}
