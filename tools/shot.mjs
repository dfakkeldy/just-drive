#!/usr/bin/env node
// Take settled screenshots through the shared bounded CDP client. Failed pages write no picture.
// SHOT_TIMEOUT_MS overrides the 240 s settling deadline for repeatable fault fixtures.
import { writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
const [outDir, ...urls] = process.argv.slice(2), port = process.env.CDP_PORT ?? '9333';
const timeout = Number(process.env.SHOT_TIMEOUT_MS ?? 240000);
if (!outDir || !urls.length || !Number.isFinite(timeout) || timeout <= 0) {
  console.error('shot: give an output folder, URLs, and a positive SHOT_TIMEOUT_MS'); process.exit(2);
}
for (let n = 0; n < urls.length; n++) {
  let tab, c, timer;
  try {
    tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    c = await cdp(tab.webSocketDebuggerUrl);
    await c.send('Page.enable');
    const start = Date.now();
    let state = '';
    const settled = (async () => {
      await c.send('Page.navigate', { url: urls[n] });
      for (;;) {
        await sleep(Math.min(1500, timeout));
        const r = await c.send('Runtime.evaluate', { expression: 'document.title + "|" + (document.getElementById("hud")?.textContent ?? "")' });
        state = r.result.result.value ?? '';
        if (state.startsWith('settled')) return;
      }
    })();
    await Promise.race([settled, new Promise((_, reject) => {
      timer = setTimeout(() => { reject(Error(`page did not settle within ${timeout}ms: ${urls[n]}`)); c.close(); }, timeout);
    })]);
    clearTimeout(timer);
    await sleep(1000); c.assertHealthy();
    const shot = await c.send('Page.captureScreenshot', { format: 'png' });
    c.assertHealthy();
    const file = `${outDir}/${new URL(urls[n]).searchParams.get('name') ?? `shot-${n + 1}`}.png`;
    writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    console.log(file, `${((Date.now() - start) / 1000).toFixed(0)}s`, state.replace(/\n/g, ' / ').slice(0, 160));
    if (c.logs.length) console.log('  console:', c.logs.slice(0, 8).join(' | ').slice(0, 900));
  } catch (error) { console.error('shot: ' + error.message); process.exitCode = 1; }
  finally {
    clearTimeout(timer); c?.close();
    if (tab) await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {});
  }
}
