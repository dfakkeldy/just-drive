// RUN=port-hawkesbury-mail-browser.mjs VIEWS="mabou|x=1 desktop|area=pointtupper&at=627834,5052408,315 low|area=pointtupper&q=low&at=627834,5052408,315" tools/yard-shots.sh 1600 900
// Proves in the live browser that:
// - No roadside mailbox or post stands inside the Town of Port Hawkesbury's legal limits.
// - Mailboxes outside the town limits (Point Tupper, Port Hastings side, rural roads) stay intact.
// - The Port Hawkesbury Post Office stands on Pitt Street with its generic "POST OFFICE" sign, replaces surveyed
//   building 149 and its wings, pushes the real car out with its solids, and acts as the town's one mail drop.
// - Mabou never loads ph-post-office.ts and keeps all its mailboxes.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { open, sleep } from './cdp.mjs';

const boundary = JSON.parse(readFileSync(new URL('../web/src/port-hawkesbury-boundary.json', import.meta.url), 'utf8'));
const CEILING = { desktop: { triangles: 8000, meshes: 6 }, low: { triangles: 6000, meshes: 4 } };
// Three road poses facing the Port Hawkesbury Post Office from Pitt Street and the SW lot entrance.
const POSES = [
  { tag: 'front', at: [627834, 5052408], look: 315 },
  { tag: 'entrance', at: [627834, 5052414], look: 300 },
  { tag: 'sw-lot', at: [627796, 5052396], look: 20 },
];

const [out, ...urls] = process.argv.slice(2);
const keep = process.env.PH_MAIL_PICTURES;
if (keep) mkdirSync(keep, { recursive: true });
const saveShot = async (page, file) => {
  await page.shot(`${out}/${file}`);
  if (keep) writeFileSync(`${keep}/${file}`, readFileSync(`${out}/${file}`));
};

for (const url of urls) {
  const page = await open(url);
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.navigate(url);
    const params = new URL(url).searchParams;
    const name = params.get('name') ?? 'view';

    if (params.get('area') !== 'pointtupper') {
      assert.equal(await page.read('mmm.postOffice ?? null'), null, 'Mabou has no Port Hawkesbury Post Office instance');
      const loaded = await page.read(`performance.getEntriesByType('resource').filter(e => /\\/src\\/ph-post-office\\.ts/.test(e.name)).length`);
      assert.equal(loaded, 0, 'Mabou never loads ph-post-office.ts');
      const mabouMail = await page.read('mmm.props.mail.length');
      assert.ok(mabouMail > 100, `Mabou keeps its mailboxes (${mabouMail})`);
      console.log(`PASS ${name}: Mabou unaffected (${mabouMail} mailboxes, 0 postOffice loads)`);
      assert.deepEqual(page.errors, []);
      continue;
    }

    const level = params.get('q') === 'low' ? 'low' : 'desktop';
    // Hold car still while verifying.
    await page.read(`(() => { mmm.vehicle.update = () => {}; return true; })()`);

    // Wait for the Post Office to build once fine terrain is ready near Pitt Street.
    let built = false;
    for (let i = 0; i < 180 && !built; i++) {
      await sleep(300);
      built = await page.read('Boolean(mmm.postOffice && mmm.postOffice.built)');
    }
    assert.ok(built, `${level}: Port Hawkesbury Post Office built near Pitt Street`);

    for (let i = 0; i < 80; i++) {
      await sleep(250);
      if (await page.read(`document.title.startsWith('settled')`)) break;
    }
    await sleep(800);

    // 1. Verify zero mailboxes inside Town of Port Hawkesbury legal boundary, outside preserved, and 1 Post Office mail drop.
    const mailAudit = await page.read(`((ring, bounds) => {
      const [e0, n0, e1, n1] = bounds;
      const inside = (e, n) => {
        if (e < e0 || e > e1 || n < n0 || n > n1) return false;
        let hit = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i], [xj, yj] = ring[j];
          if ((yi > n) !== (yj > n) && e < ((xj - xi) * (n - yi)) / (yj - yi) + xi) hit = !hit;
        }
        return hit;
      };
      const V = mmm.terrain.manifest.village;
      let mailInside = 0, mailOutside = 0;
      for (const m of mmm.props.mail) {
        if (inside(V[0] + m.x, V[1] - m.z)) mailInside++;
        else mailOutside++;
      }
      const sites = mmm.props.sites.map(s => ({
        kind: s.kind,
        customers: s.customers,
        label: s.label ?? null,
        inside: inside(V[0] + s.x, V[1] - s.z),
      }));
      const poSite = mmm.props.sites.find(s => s.kind === 'postOffice');
      const cellName = poSite ? 'Props cell ' + Math.floor(poSite.x / 256) + ',' + Math.floor(poSite.z / 256) : '';
      const cellMeshes = [];
      mmm.props.group.traverse(o => {
        if (o.isInstancedMesh && o.parent?.name === cellName) cellMeshes.push(o.name);
      });
      return { mailInside, mailOutside, sites, totalCustomers: mmm.props.totalCustomers, cellMeshes };
    })(${JSON.stringify(boundary.ring)}, ${JSON.stringify(boundary.bounds)})`);
    console.log(name, 'mailAudit', JSON.stringify(mailAudit));
    assert.equal(mailAudit.mailInside, 0, `${level}: ZERO roadside mailboxes inside Town of Port Hawkesbury`);
    assert.ok(mailAudit.mailOutside >= 600, `${level}: outside-town mailboxes preserved (${mailAudit.mailOutside})`);
    const townSites = mailAudit.sites.filter(s => s.inside);
    assert.equal(townSites.length, 1, `${level}: Town of Port Hawkesbury has exactly 1 mail drop`);
    assert.equal(townSites[0].kind, 'postOffice');
    assert.equal(townSites[0].label, 'Port Hawkesbury Post Office');
    assert.ok(townSites[0].customers >= 900, `town drop serves town houses (${townSites[0].customers})`);
    assert.ok(!mailAudit.cellMeshes.includes('cabinet'), `${level}: no community mailbox cabinet drawn at Post Office`);

    // 2. Verify Post Office meshes, sign, triangles, and collision solids.
    const poState = await page.read(`(() => {
      const po = mmm.postOffice;
      const drawn = [];
      po.group.traverse(o => {
        if (o.isMesh && o.visible) {
          drawn.push({ name: o.name, map: !!o.material.map, triangles: (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 });
        }
      });
      // Test collision solids against the real vehicle.
      const v = mmm.vehicle, saved = { x: v.x, z: v.z, heading: v.heading, vx: v.vx, vz: v.vz, speed: v.speed };
      let blocked = 0;
      try {
        for (const s of po.solids) {
          Object.assign(v, { x: s.x, z: s.z, vx: 0, vz: 0, speed: 0 });
          po.resolveSolids(v);
          if (Math.hypot(v.x - s.x, v.z - s.z) > 0.05) blocked++;
        }
      } finally { Object.assign(v, saved); }
      return { built: po.built, triangles: po.triangles, meshes: drawn.length, drawn, solids: po.solids.length, blocked };
    })()`);
    console.log(name, 'poState', JSON.stringify(poState));
    const ceil = CEILING[level];
    assert.ok(poState.triangles > 100 && poState.triangles <= ceil.triangles, `${level}: triangles ${poState.triangles} <= ${ceil.triangles}`);
    assert.ok(poState.meshes >= 2 && poState.meshes <= ceil.meshes, `${level}: meshes ${poState.meshes} <= ${ceil.meshes}`);
    assert.ok(poState.drawn.some(d => d.name === 'ph-post-office-sign' && d.map), `${level}: generic POST OFFICE sign mesh drawn`);
    assert.equal(poState.blocked, poState.solids, `${level}: every Post Office solid blocks the vehicle`);

    // 3. Capture street-level verification pictures of the Post Office from Pitt Street and the SW lot.
    for (const p of POSES) {
      await page.read(`(() => {
        const V = mmm.terrain.manifest.village;
        const x = ${p.at[0]} - V[0], z = V[1] - ${p.at[1]};
        const hit = mmm.roads.nearest(x, z, 25);
        const pos = hit ? { x: hit.x, z: hit.z } : { x, z };
        Object.assign(mmm.vehicle, { x: pos.x, z: pos.z, heading: ${p.look} * Math.PI / 180, vx: 0, vz: 0, speed: 0 });
        return true;
      })()`);
      await sleep(1200);
      await saveShot(page, `${name}-${p.tag}.png`);
    }

    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
}

console.log('PASS port-hawkesbury-mail-browser');
