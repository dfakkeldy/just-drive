#!/usr/bin/env node
import { cdp, cdpFetch } from './cdp.mjs';
// Drive the car in headless Chromium and take pictures along the way: a test for the works yard.
// Usage (through tools/yard-shots.sh): RUN=yard-drive.mjs STEPS=$'eval:...\nkey:KeyW:8000\nshot:name' VIEWS="x|at=..." tools/yard-shots.sh
// Steps, one per line: settle | wait:<ms> | key:<code>:<ms> | eval:<javascript> | shot:<name>
import { writeFileSync } from 'node:fs';

const [outDir, url] = process.argv.slice(2);
const PORT = process.env.CDP_PORT ?? '9344';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tab = await (await cdpFetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const { ws, send } = await cdp(tab.webSocketDebuggerUrl, { onEvent: d => {
  if (d.method === 'Runtime.exceptionThrown') console.log('EXCEPTION', d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
  if (d.method === 'Runtime.consoleAPICalled' && /yard/.test(String(d.params.args[0]?.value))) console.log('  console:', d.params.args.map((a) => a.value).join(' '));
} });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url });
const settle = async () => { for (let t = 0; t < 160; t++) { await sleep(1500); if (String(await evaluate('document.title')).startsWith('settled')) return; } };
for (const step of (process.env.STEPS ?? 'settle').split('\n').map((s) => s.trim()).filter(Boolean)) {
  const [verb, ...rest] = step.split(':'), arg = rest.join(':');
  if (verb === 'settle') await settle();
  else if (verb === 'wait') await sleep(+arg);
  else if (verb === 'key') {
    const [code, ms] = rest;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: code.replace('Key', '').toLowerCase() });
    await sleep(+ms);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: code.replace('Key', '').toLowerCase() });
  } else if (verb === 'eval') console.log('  eval:', JSON.stringify(await evaluate(arg)));
  else if (verb === 'shot') {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${outDir}/${arg}.png`, Buffer.from(shot.result.data, 'base64'));
    console.log(`${outDir}/${arg}.png`);
  }
}
await cdpFetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`);
ws.close();
