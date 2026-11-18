#!/usr/bin/env node
// Run through the existing browser wrapper; it owns and closes the browser and server.
// WEB_PORT=5265 CDP_PORT=9465 RUN=mp-ghosts-check.mjs VIEWS='ghosts|mp=1' OUT="$PWD/data/work/mp" tools/yard-shots.sh 1440 1000
import assert from 'node:assert/strict';
import { ghostContracts, ghostGeometryStats } from './mp-ghosts-contracts.mjs';
import { CAR_GHOST_SIZE } from './mp-models-build.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [out, first] = process.argv.slice(2), base = new URL(first).origin, port = process.env.CDP_PORT ?? '9465';
mkdirSync(out, { recursive: true });
const results = [];
let sampledAllocations = 0;
async function open(query) {
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(), errors = [];
  ws.onmessage = event => {
    const d = JSON.parse(event.data);
    if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map(a => a.value ?? a.description).join(' '));
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id; const timer = setTimeout(() => { pending.delete(n); reject(new Error(`CDP timeout: ${method}`)); }, 60000);
    pending.set(n, result => { clearTimeout(timer); if (result.error) reject(new Error(JSON.stringify(result.error))); else resolve(result); });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const read = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    assert.ok(!r.result?.exceptionDetails, JSON.stringify(r.result?.exceptionDetails));
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: `${base}/mp-ghosts.html?still=1&${query}` });
  let settled = false;
  for (let i = 0; i < 120; i++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    if (await read('document.title === "settled"')) { settled = true; break; }
  }
  assert.ok(settled, `preview settled: ${errors.join(' | ')}`);
  await read('ghostsPreview.freeze(); ghostsPreview.render()');
  return { read, send, errors, close: async () => { await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); ws.close(); } };
}

for (const [name, query, expected] of [
  ['ghosts-near', 'view=near&n=3', 3], ['ghosts-far', 'view=far&n=6', 6],
  ['ghosts-16', 'n=16', 16], ['ghosts-low', 'low=1&n=6', 6], ['ghosts-fade', 'view=fade&n=3', 3],
  ['desktop-six', 'n=6', 6], ['phone-capped', 'low=1&n=16', 6], ['phone-sixteen', 'low=1&n=16&cap=16', 16],
]) {
  const p = await open(query);
  try {
    const stats = await p.read('ghostsPreview.stats');
    assert.equal(stats.drawn, expected, `${name}: drawn cap`);
    assert.ok(stats.perCar <= 700, `${name}: at most 700 triangles per car`);
    assert.ok(stats.calls <= 3 && stats.calls > 0, `${name}: at most three shared draw calls, including labels`);
    assert.ok(stats.triangles <= expected * 702, `${name}: total triangle budget, including labels`);
    assert.equal(stats.logDepth, !query.includes('low=1'), 'requested depth buffer mode');
    const programs = await p.read('ghostsPreview.renderer.info.programs.map(p => p.diagnostics?.runnable ?? true)');
    assert.ok(programs.every(Boolean), `${name}: shaders compiled`);
    assert.deepEqual(p.errors, [], `${name}: no runtime or shader errors`);
    console.log(name, JSON.stringify(stats)); results.push({ name, ...stats });
    if (name.startsWith('ghosts-')) {
      const shot = await p.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${out}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
    }
    if (name === 'desktop-six') {
      const fading = await p.read(`(() => {const p=ghostsPreview;for(const peer of p.peers)peer.alpha=.5;p.render();const m=p.ghosts.group.children[0];return {drawn:p.ghosts.drawn,calls:p.stats.calls,opaque:!m.material.transparent&&m.material.depthWrite,alpha:Array.from(m.geometry.attributes.fade.array).slice(0,m.count)};})()`);
      assert.equal(fading.drawn,6,'six fading cars remain drawn');assert.equal(fading.calls,2,'six fading cars share two calls');
      assert.ok(fading.opaque&&fading.alpha.every(a=>a===.5),'six fading cars use depth writes without transparent sorting');
      const shot=await p.send('Page.captureScreenshot',{format:'png'});
      writeFileSync(`${out}/ghosts-six-fade.png`,Buffer.from(shot.result.data,'base64'));
    }
    if (name === 'ghosts-16') {
      // Prime the allocation sampler once too; enabling it can change the JIT code.
      // The second batch checks steady updates, with the renderer and preview frozen.
      await p.read('ghostsPreview.bench = function(count) { for(let i=0;i<count;i++) this.ghosts.update(1/60,this.peers,this.camera); }; ghostsPreview.bench(20000)');
      for (let round=0; round<2; round++) {
        await p.send('HeapProfiler.startSampling', { samplingInterval: 128, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
        await p.read('ghostsPreview.bench(10000)');
        const sampled = await p.send('HeapProfiler.stopSampling');
        let ownBytes = 0; const sites = [];
        function visit(node) {
          if (node.callFrame.url.includes('/mp/ghosts.ts') && node.selfSize > 0) { ownBytes += node.selfSize; sites.push({ function: node.callFrame.functionName, line: node.callFrame.lineNumber, bytes: node.selfSize }); }
          for (const child of node.children ?? []) visit(child);
        }
        visit(sampled.result.profile.head);
        console.log('sampled update allocations, batch '+(round+1)+':', ownBytes, JSON.stringify(sites));
        sampledAllocations = ownBytes;
      }
      const overlaps = await p.read(`(() => { const g=ghostsPreview.ghosts,b=g.labelBounds;let n=0;for(let i=0;i<g.labelCount;i++)for(let j=i+1;j<g.labelCount;j++)if(b[4*i]<b[4*j+1]&&b[4*i+1]>b[4*j]&&b[4*i+2]<b[4*j+3]&&b[4*i+3]>b[4*j+2])n++;return n;})()`);
      assert.equal(overlaps,0,'crowded labels do not overlap');
      const geometry = await p.read(`(${ghostGeometryStats})(ghostsPreview.THREE,ghostsPreview.ghosts.group.children[0].geometry)`);
      assert.equal(geometry.base.flat,0,'every legacy car triangle has area');assert.equal(geometry.base.backwards,0,'legacy normals face with triangles');
      assert.ok(Math.abs(geometry.base.min[1])<1e-6,'legacy tyres meet zero ground');
      assert.ok(geometry.base.size[2]>4.3 && geometry.base.size[2]<4.7 && geometry.base.size[1]>1.6 && geometry.base.size[1]<1.8,'legacy car proportions, excluding other morphs');
      assert.equal(geometry.models.length,5,'five production ride targets');
      for(const [i,model] of geometry.models.entries()){
        assert.equal(model.flat,0,`model ${i}: triangles have area`);assert.equal(model.backwards,0,`model ${i}: outward normals`);
        assert.ok(Math.abs(model.min[1])<1e-5,`model ${i}: tyres meet ground`);
      }
      const car=geometry.models[0];
      assert.ok(Math.abs(car.size[2]-CAR_GHOST_SIZE.length)<.002 && Math.abs(car.size[1]-CAR_GHOST_SIZE.height)<.002,'production car dimensions at unit scale (the mail car\'s model file, off duty)');
      console.log('geometry:',JSON.stringify(geometry));
      const contracts = await p.read(`(${ghostContracts})(ghostsPreview.THREE,ghostsPreview.Ghosts,ghostsPreview.FLAG)`);
      console.log('contracts:', contracts.join('; '));
    }
  } finally { await p.close(); }
}
writeFileSync(`${out}/ghosts-stats.json`, JSON.stringify(results, null, 2)+'\n');
assert.equal(sampledAllocations, 0, 'no sampled allocations in warmed ghost module (not an exhaustive heap proof)');
console.log('PASS: ghost budgets, visibility, cap, terrain pose, flags, labels, disposal and sampled allocations.');
