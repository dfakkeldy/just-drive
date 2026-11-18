// Short owned-browser check. The orchestrator varies this visible value between real checkouts.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
const [, first] = process.argv.slice(2), port = process.env.CDP_PORT;
if (process.env.MMM_CHECK_STANDIN === '1') {
  const html = await (await fetch(first)).text();
  const value = /<h1>(.*?)<\/h1>/.exec(html)?.[1];
  assert.equal(value, process.env.EXPECT_CHECKOUT ?? 'checkout-alpha');
  const before = await (await cdpFetch(`http://127.0.0.1:${port}/json/version`)).json();
  console.log(`PROBE own checkout=${value} WEB=${new URL(first).port} CDP=${port}`);
  await sleep(Number(process.env.PROBE_HOLD_MS ?? 1500));
  const after = await (await cdpFetch(`http://127.0.0.1:${port}/json/version`)).json();
  assert.deepEqual(after,before);
  console.log('PROBE browser survived to end (stand-in, no renderer)');
} else {
const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const c = await cdp(tab.webSocketDebuggerUrl);
try {
  const fixture = new URL('/@fs/' + fileURLToPath(new URL('./check-ports-probe.html', import.meta.url)), first);
  await c.send('Runtime.enable'); await c.send('Page.enable');
  await c.send('Page.navigate', { url: fixture.href });
  let value;
  for (let i = 0; i < 50; i++) {
    value = (await c.send('Runtime.evaluate', { expression: "document.querySelector('h1')?.textContent", returnByValue: true })).result.result.value;
    if (value) break;
    await sleep(100);
  }
  assert.equal(value, process.env.EXPECT_CHECKOUT ?? 'checkout-alpha');
  console.log(`PROBE own checkout=${value} WEB=${new URL(first).port} CDP=${port}`);
  await sleep(Number(process.env.PROBE_HOLD_MS ?? 1500));
  assert.equal((await c.send('Runtime.evaluate', { expression: '6*7', returnByValue: true })).result.result.value, 42);
  console.log('PROBE browser survived to end');
} finally {
  await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {}); c.close();
}

}
