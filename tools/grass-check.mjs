#!/usr/bin/env node
import { cdp, cdpFetch } from './cdp.mjs';
// Check actual desktop planting and phone isolation through the dev server, using yard-shots.sh's browser.
// Views: one desktop view in a hay field WITH grass=1 (the override cases need it) and one phone view, for example
//   RUN=grass-check.mjs VIEWS="field|shot=1&grass=1 phone|shot=1&grass=1&q=low&touch=1" tools/yard-shots.sh 1280 720
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

const [outDir, ...urls] = process.argv.slice(2);
if (!outDir || !urls.length) { console.error('grass-check: give an output folder and at least one view (VIEWS for the shots script)'); process.exit(2); }
const port = process.env.CDP_PORT ?? '9401';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
for (const url of urls) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const errors = [];
  const { ws, send } = await cdp(tab.webSocketDebuggerUrl, { onEvent: message => {
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? 'exception');
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((a) => a.value ?? a.description).join(' '));
  } });
  const read = async (expression) => {
    const message = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert(!message.result?.exceptionDetails, JSON.stringify(message.result?.exceptionDetails));
    return message.result?.result?.value;
  };
  // After a reload or a navigation the game object appears when the page has started; a fixed pause was too short on a loaded machine.
  // The old document can live for a moment after a reload: wait for a NEW document (another time origin) that has started.
  const again = async (go) => {
    const origin = await read('performance.timeOrigin'); await go();
    for (let n = 0; n < 150; n++) { await sleep(400); if (await read(`performance.timeOrigin !== ${origin} && !!window.mmm?.grass && document.readyState === "complete"`).catch(() => false)) return; }
    assert.fail('the page did not start again');
  };
  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.navigate', { url });
    for (let n = 0; n < 100; n++) {
      await sleep(400);
      if (await read('document.title === "settled"')) break;
    }
    assert(await read('document.title === "settled"'), 'scene did not settle');
    const phone = new URL(url).searchParams.get('q') === 'low';
    if (phone) {
      assert(await read(`window.mmm.grass === null && !performance.getEntriesByType('resource').some((r) => r.name.includes('/src/grass.ts'))`), 'phone loaded or created grass');
      assert(await read(`![...document.querySelectorAll('#settings label')].some((l) => l.textContent === 'Grass')`), 'phone has grass settings');
      console.log('PASS phone: no grass module, instance or switch, even with grass=1');
    } else {
      const result = await read(`(() => {
        const g = window.mmm.grass, t = g.terrain;
        let count = 0, invalid = 0, badHeight = 0, lawns = 0, fields = 0, rough = 0;
        const layers = {};
        for (const [layer, map] of Object.entries({far:g.patches, dense:g.dense})) {
          let tufts = 0;
          for (const patch of map.values()) for (let i = 0; i < patch.count; i++) {
            const [x, , z] = patch.roots.subarray(i * 4, i * 4 + 3), s = t.surfaceAt(x, z), cls = t.coverAt(x, z);
            const edge = s.roadDist - s.halfWidth, shoulder = s.kind <= 2 ? 2.1 : 1.25;
            if (cls === 4 || s.canopy > 1.801 || s.ground < t.seaLevel + 1.449 || (s.kind && edge < shoulder + 0.249)
              || t.clear.some((b) => x > b[0] && x < b[2] && z > b[1] && z < b[3])) invalid++;
            const verge = s.kind > 0 && edge < shoulder + 4;
            const lawn = cls === 3 && !verge, field = cls === 2 && !verge;
            const h = patch.shapes[i * 4];
            if (h < (lawn ? 0.0499 : field ? 0.3499 : 0.3999) || h > (lawn ? 0.1001 : field ? 0.6001 : 0.8001)) badHeight++;
            if (lawn) lawns++; else if (field) fields++; else rough++;
            count++; tufts++;
          }
          layers[layer] = {patches:map.size,tufts};
        }
        return {count, invalid, badHeight, lawns, fields, rough, layers, drawn:g.drawn, buildMaxMs:g.buildMaxMs, enabled:g.enabled, pending:g.pending};
      })()`);
      assert(result.enabled && result.count > 100 && !result.pending, 'grass did not finish growing: ' + JSON.stringify(result));
      assert.equal(result.invalid, 0, 'planting exclusions: ' + JSON.stringify(result));
      assert.equal(result.badHeight, 0, 'land-specific heights: ' + JSON.stringify(result));
      assert(result.layers.dense.tufts > 100 && result.drawn.dense.triangles > 0, 'no visible dense grass');
      assert(result.drawn.far.triangles + result.drawn.dense.triangles <= 600000, 'grass exceeds 600,000 submitted triangles');
      assert(result.buildMaxMs < 4, 'building exceeded 4 ms: ' + JSON.stringify(result));
      console.log('PASS placement, heights, both layers, triangle budget and <4 ms building:', JSON.stringify(result));
      const name = new URL(url).searchParams.get('name') ?? 'view';
      writeFileSync(outDir + '/geometry-' + name + '.json', JSON.stringify(result, null, 2) + '\n');
      assert(await read(`(() => {
        const g = window.mmm.grass;
        const p = [...g.dense.values()].find((p) => p.mesh && p.count > 10);
        const before = Array.from(p.roots.slice(0, 40));
        const camera = {position:{x:g.focus.x + 0.3, z:g.focus.y + 0.3, y:g.terrain.heightAt(g.focus.x,g.focus.y) + 1.5}};
        g.update(0.016, camera, window.mmm.vehicle.x, window.mmm.vehicle.z, window.mmm.vehicle.heading, window.mmm.vehicle.spec);   // the spec is required since #46
        return before.every((v,i) => v === p.roots[i]);
      })()`), 'moving the camera moved or reseeded existing dense roots');
      assert(await read(`(() => {
        const label = [...document.querySelectorAll('#settings label')].find((l) => l.textContent === 'Grass');
        const box = label?.querySelector('input');
        if (!box) return false;
        box.checked = false; box.dispatchEvent(new Event('change'));
        const g = window.mmm.grass;
        return !g.enabled && !g.group.visible && !g.group.children.length && !g.dense.size && g.focus.z === 0 && localStorage.getItem('mmm.grass') === '0';
      })()`), 'switch did not remove and remember grass');
      await again(() => send('Page.reload'));
      assert(await read('window.mmm.grass.enabled'), 'grass=1 did not override saved off');
      const u = new URL(url); u.searchParams.delete('grass');
      await again(() => send('Page.navigate', { url: u.href }));
      assert(await read('!window.mmm.grass.enabled'), 'saved off did not survive navigation');
      await read(`localStorage.setItem('mmm.grass', '1')`);
      u.searchParams.set('grass', '0');
      await again(() => send('Page.navigate', { url: u.href }));
      assert(await read('!window.mmm.grass.enabled && !window.mmm.grass.group.children.length && window.mmm.grass.terrain.coverPixels === null'),
        'grass=0 did not override saved on or ran the grass readback');
      await read(`localStorage.removeItem('mmm.grass')`);
      console.log('PASS settings: removal, persistence, forced on and forced off');
    }
    assert.deepEqual(errors, [], 'browser or shader errors');
  } finally {
    await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); ws.close();
  }
}
