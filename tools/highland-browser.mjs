#!/usr/bin/env node
// Highland bull preview: matching pictures of the code-built and the Blender model, and the loaded rig's contract and costs.
// Run through tools/highland-shots.sh (one owned browser). PICTURES=0 keeps the assertions and writes no pictures.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
const [out, page] = process.argv.slice(2), port = process.env.CDP_PORT;
assert.ok(out && page && port, 'run with tools/highland-shots.sh');
const contract = JSON.parse(readFileSync(new URL('./blender/highland-contract.json', import.meta.url), 'utf8'));
const pictures = process.env.PICTURES !== '0';
// name, query. Every picture is taken still, without the page text.
const shots = [
  ['old-vs-new-side', 'view=side&animal=both'], ['old-vs-new-front', 'view=front&animal=both'],
  ['side', 'view=side&animal=blender'], ['front34', 'view=front&animal=blender'], ['head', 'view=head&animal=blender'],
  ['rear34', 'view=rear&animal=blender'], ['head-turned', 'view=front&animal=blender&dir=60'],
  ['head-left-limit', 'view=front&animal=blender&dir=69'], ['head-right-limit', 'view=rear&animal=blender&dir=-69'],   // the game turns the head up to 1.2 rad
  ['low-far', 'view=far&animal=blender&low=1'], ['far', 'view=far&animal=blender'], ['low-front34', 'view=front&animal=blender&low=1'],
  ['rail', 'view=rail&animal=blender&day=overcast&dir=55'], ['rail-close', 'view=rail-close&animal=blender&day=overcast'],
  ['rail-old', 'view=rail&animal=code&day=overcast'], ['walk-legs', 'view=side&animal=walk'],
];
const rows = [];
for (const [name, query] of shots) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const errors = [];
  const c = await cdp(tab.webSocketDebuggerUrl, { onEvent: d => { if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text); } });
  const read = async expression => { const r = await c.send('Runtime.evaluate', { expression, returnByValue: true }); assert.ok(!r.result.exceptionDetails, JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
  try {
    await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Page.navigate', { url: `${page}?${query}&still=1` });
    let ready = false;
    for (let i = 0; i < 150; i++) { await sleep(100); if (await read('document.title === "settled"')) { ready = true; break; } }
    assert.ok(ready, `${name} settled: ${errors.join('\n')}`); assert.deepEqual(errors, []);
    // Cost of each animal alone: everything else hidden, culling off, one render.
    const stats = await read(`(() => {
      const { scene, stage, camera, renderer, animals, rig } = highlandPreview;
      const result = {};
      for (const animal of animals) {
        stage.visible = false; for (const other of animals) other.visible = other === animal;
        const shadow = animal.children.find(n => n.isMesh && n.material.transparent); if (shadow) shadow.visible = false;
        const culled = []; animal.traverse(n => { if (n.isMesh) { culled.push([n, n.frustumCulled]); n.frustumCulled = false; } });
        renderer.render(scene, camera);
        result[animal.name] = { draws: renderer.info.render.calls, triangles: renderer.info.render.triangles };
        culled.forEach(([n, v]) => n.frustumCulled = v); if (shadow) shadow.visible = true;
      }
      stage.visible = true; for (const animal of animals) animal.visible = true;
      renderer.render(scene, camera);
      if (rig) {
        rig.root.updateMatrixWorld(true);
        const at = n => n.position.toArray().map(v => +v.toFixed(5));
        const turned = rig.head.rotation.y;
        const box = bounds(rig);
        result.rig = { head: at(rig.head), tail: at(rig.tail), legs: rig.legs.map(at), hooves: rig.hooves.map(h => h.toArray().map(v => +v.toFixed(5))), shoulder: rig.shoulder,
          parents: [rig.head.parent === rig.body, rig.tail.parent === rig.body, rig.legs.every(l => l.parent === rig.body), rig.body.parent === rig.root, rig.torso.parent === rig.body],
          legMeshes: rig.legs.map(l => l.children.length), headMeshes: rig.head.children.length, tailMeshes: rig.tail.children.length, order: rig.root.rotation.order, name: rig.root.name, turned, box };
      }
      return result;
      // Bounds of the rig with the head straight, in the root's space.
      function bounds(rig) {
        let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        const yaw = rig.head.rotation.y; rig.head.rotation.y = 0; rig.root.updateMatrixWorld(true);
        const inverse = rig.root.matrixWorld.clone().invert();
        rig.root.traverse(n => { if (!n.isMesh) return; const p = n.geometry.attributes.position, m = inverse.clone().multiply(n.matrixWorld), e = m.elements;
          for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
            const v = [e[0]*x+e[4]*y+e[8]*z+e[12], e[1]*x+e[5]*y+e[9]*z+e[13], e[2]*x+e[6]*y+e[10]*z+e[14]];
            for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); } } });
        rig.head.rotation.y = yaw; rig.root.updateMatrixWorld(true);
        return { min: lo.map(v => +v.toFixed(4)), max: hi.map(v => +v.toFixed(4)) };
      }
    })()`);
    const lowModel = query.includes('low=1'), walk = query.includes('animal=walk');
    if (stats.blender) {
      const budget = contract.budgets[lowModel ? 'low' : 'desktop'], snapshot = contract.snapshot[lowModel ? 'low' : 'desktop'];
      assert.equal(stats.blender.triangles, snapshot.triangles, `${name}: drawn triangles equal the model's`);
      assert.ok(stats.blender.triangles <= budget.triangles, `${name}: triangle budget`);
      assert.equal(stats.blender.draws, walk ? budget.draws + 4 : budget.draws, `${name}: draws`);
      const r = stats.rig, close = (a, b, what) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 2e-4, `${name}: ${what} ${a} vs ${b}`));
      close(r.head, contract.pivots.head, 'head pivot'); close(r.tail, contract.pivots.tail, 'tail pivot');
      contract.nodes.legs.forEach((leg, i) => {
        close(r.legs[i], contract.pivots[leg], leg);
        close(r.hooves[i], [contract.pivots[leg][0], 0, contract.pivots[leg][2]], `hoof under ${leg}`);
        assert.ok(Math.abs(r.legs[i][1] - .63 * r.shoulder) < 1e-3, 'leg pivot is .63 x shoulder, as animals.ts expects');
      });
      assert.equal(r.shoulder, contract.shoulder); assert.equal(r.order, 'YXZ'); assert.equal(r.name, 'highland');
      assert.ok(r.parents.every(Boolean), `${name}: head, tail and legs hang from body; body from root`);
      assert.deepEqual(r.legMeshes, walk ? [1, 1, 1, 1] : [0, 0, 0, 0], `${name}: legs are merged unless asked for`);
      assert.equal(r.headMeshes, 1); assert.equal(r.tailMeshes, lowModel ? 0 : 1);
      close(r.box.min, snapshot.min, 'bounds min'); close(r.box.max, snapshot.max, 'bounds max');
      if (query.includes('dir=60')) assert.ok(Math.abs(r.turned - Math.PI / 3) < 1e-6, 'the head node turns');
    }
    rows.push({ name, query, ...stats });
    // Show the leg and tail nodes at work: one stride of the game's walk (animals.ts), held still for the picture.
    if (walk) await read(`(() => { const { rig, scene, camera, renderer } = highlandPreview;
      rig.legs.forEach((leg, i) => { leg.rotation.x = (i % 3 ? -1 : 1) * .18; }); rig.tail.rotation.z = .12; rig.head.rotation.y = .5;
      renderer.render(scene, camera); return true; })()`);
    if (pictures) {
      await sleep(150);
      const shot = await c.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${out}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
    }
    console.log(name, JSON.stringify({ code: stats.code, blender: stats.blender }));
  } finally { c.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); }
}
// The page as a person opens it (not still): the idle loop must turn the head, swing the tail and step the legs without an error.
{
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const c = await cdp(tab.webSocketDebuggerUrl);
  try {
    await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Page.navigate', { url: `${page}?view=front&animal=walk` });
    const sample = async () => (await c.send('Runtime.evaluate', { returnByValue: true, expression: `document.title === 'settled' && (({ rig }) => [rig.head.rotation.y, rig.tail.rotation.z, ...rig.legs.map(l => l.rotation.x)])(highlandPreview)` })).result.result.value;
    let first = false;
    for (let i = 0; i < 150 && !first; i++) { await sleep(100); first = await sample(); }
    assert.ok(first, 'the moving page settles');
    await sleep(700);
    const second = await sample();
    assert.ok(second.every((v, i) => Math.abs(v - first[i]) > 1e-4), `head, tail and all four legs move: ${first} then ${second}`);
    c.assertHealthy();
  } finally { c.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); }
}
const old = rows.find(r => r.code).code, desktop = rows.find(r => r.name === 'side').blender, lowRow = rows.find(r => r.name === 'low-far').blender;
assert.ok(lowRow.triangles < desktop.triangles * .25, 'LOW is its own reduced model');
if (pictures) writeFileSync(`${out}/comparison.json`, JSON.stringify({ code: old, desktop, low: lowRow, rows }, null, 2) + '\n');
console.log(`Highland preview passed: code-built ${old.triangles} triangles / ${old.draws} draws; Blender ${desktop.triangles} / ${desktop.draws}; LOW ${lowRow.triangles} / ${lowRow.draws}`);
