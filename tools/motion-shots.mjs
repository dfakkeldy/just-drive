#!/usr/bin/env node
// Pictures in a row from one moving page, to judge things that only show in motion (thin wires, tree fades).
// A view with demo=<seconds> (the car drives itself) warms up for WARM seconds, then FRAMES pictures are taken EVERY
// milliseconds apart: <name>-01.png, <name>-02.png, ... Give it more demo seconds than WARM + FRAMES * EVERY / 1000.
// A view without demo waits until it has settled and gives one picture, <name>.png (as tools/shot.mjs does).
//   RUN=motion-shots.mjs VIEWS="run|demo=120 run-old|demo=120&finish=0" OUT=<folder> tools/yard-shots.sh 1600 1000
//   FRAMES=8 (default)   EVERY=400   WARM=20
import { writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
const [outDir, ...urls] = process.argv.slice(2), port = process.env.CDP_PORT ?? '9333';
const FRAMES = Number(process.env.FRAMES ?? 8), EVERY = Number(process.env.EVERY ?? 400), WARM = Number(process.env.WARM ?? 20);
if (!outDir || !urls.length) { console.error('motion-shots: give an output folder and views (VIEWS to the shots script)'); process.exit(2); }
for (const url of urls) {
  const name = new URL(url).searchParams.get('name') ?? 'view';
  let tab, c;
  try {
    tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    c = await cdp(tab.webSocketDebuggerUrl);
    await c.send('Page.enable');
    await c.send('Page.navigate', { url });
    const moving = new URL(url).searchParams.has('demo'), deadline = Date.now() + 240000;
    if (moving) await sleep(WARM * 1000);
    else for (;;) {
      await sleep(1500);
      const r = await c.send('Runtime.evaluate', { expression: 'document.title' });
      if (String(r.result.result.value ?? '').startsWith('settled')) break;
      if (Date.now() > deadline) throw Error(`page did not settle: ${url}`);
    }
    const count = moving ? FRAMES : 1;
    for (let n = 1; n <= count; n++) {
      await sleep(moving ? EVERY : 1000); c.assertHealthy();
      const shot = await c.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${outDir}/${name}${moving ? '-' + String(n).padStart(2, '0') : ''}.png`, Buffer.from(shot.result.data, 'base64'));
    }
    console.log(`${name}: ${count} picture${count > 1 ? 's' : ''}`);
  } catch (error) { console.error('motion-shots: ' + error.message); process.exitCode = 1; }
  finally {
    c?.close();
    if (tab) await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {});
  }
}
