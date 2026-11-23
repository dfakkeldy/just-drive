// Area acceptance check, or ordinary settled pictures when area= is absent.
// Optional &viewport=390,844 captures a phone-sized page in the same browser job.
// RUN=area-browser.mjs VIEWS="judique|area=judique&demo=3" tools/yard-shots.sh
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const [out, ...urls] = process.argv.slice(2), port = process.env.CDP_PORT ?? '9452';
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const url of urls) {
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {method: 'PUT'})).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl), pending = new Map(), errors = [], requests = [], failedRequests = [];
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let serial = 0, transferredBytes = 0;
  ws.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); }
    if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text);
    if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') errors.push(data.params.args.map(a => a.value ?? a.description).join(' '));
    if (data.method === 'Log.entryAdded' && data.params.entry.level === 'error') errors.push(`${data.params.entry.text} [${data.params.entry.url ?? data.params.entry.source}]`);
    if (data.method === 'Network.loadingFinished') transferredBytes += data.params.encodedDataLength;
    if (data.method === 'Network.loadingFailed' && !data.params.canceled) failedRequests.push(data.params.errorText);
    if (data.method === 'Network.responseReceived' && data.params.response.status >= 400) failedRequests.push(`${data.params.response.status} ${data.params.response.url}`);
    if (data.method === 'Network.requestWillBeSent') requests.push(data.params.request.url);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, data => { clearTimeout(timer); data.error ? reject(new Error(JSON.stringify(data.error))) : resolve(data.result); });
    ws.send(JSON.stringify({id, method, params}));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const query = new URL(url).searchParams, name = query.get('name') ?? 'area';
  let afterShot = async () => {};
  try {
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Log.enable');
    if (query.has('viewport')) {
      const size=query.get('viewport').split(',').map(Number);
      assert.ok(size.length===2 && size.every(n=>Number.isInteger(n)&&n>=240&&n<=4000), 'viewport width,height');
      await send('Emulation.setDeviceMetricsOverride', {width:size[0],height:size[1],deviceScaleFactor:1,mobile:query.get('touch')==='1'});
    }
    if (query.get('check') === 'saved-mode') await send('Page.addScriptToEvaluateOnNewDocument', {source: "localStorage.setItem('mmm.mode','mail')"});
    // The dev shell has no favicon; prevent its unrelated automatic favicon.ico 404.
    await send('Page.addScriptToEvaluateOnNewDocument', {source: `document.addEventListener('DOMContentLoaded',()=>{
      if(!document.querySelector('link[rel="icon"]')) document.head.append(Object.assign(document.createElement('link'),
        {rel:'icon',href:'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22/%3E'}));
    },{once:true});`});
    await send('Page.navigate', {url});
    const deadline = Date.now() + 180000;
    let state, initial = null;
    do {
      await sleep(200);
      state = await evaluate(`({title:document.title, message:document.getElementById('areaMessage')?.textContent,
        start:window.mmm?.endings ? {x:mmm.vehicle.x,z:mmm.vehicle.z,heading:mmm.vehicle.heading} : null})`);
      initial ??= state.start;
      assert.equal(errors.length, 0, errors.join('\n'));
      if (state.message || state.title === 'settled') break;
    } while (Date.now() < deadline);
    if (query.get('check') === 'missing') {
      assert.ok(state.message?.includes('Port Hood is not ready yet.'));
      assert.equal(await evaluate(`document.querySelector('#areaMessage a').getAttribute('href')`), '/');
      assert.equal(await evaluate('!!window.mmm'), false);
      let readyState;
      for (let i=0;i<20;i++) { readyState=await evaluate('document.readyState'); if(readyState==='complete') break; await sleep(250); }
      assert.equal(readyState,'complete','terminal screen must finish the page load');
      writeFileSync(`${out}/${name}.json`,JSON.stringify({message:state.message,readyState,errors},null,2));
    } else {
      assert.equal(state.title, 'settled', JSON.stringify(state));
      if (query.has('area')) assert.equal(await evaluate('mmm.area.id'), query.get('area'), 'requested area loaded');
      if (query.has('area') && query.get('area') !== 'mabou') {
        const result = await evaluate(`(() => {
          const m = mmm, v = m.vehicle, road = m.roads.nearest(v.x,v.z,1000,r=>r.kind>=1&&r.kind<=3);
          return {area:m.area.id, gameMode:m.gameMode, day:m.shift.career.day, elapsed:m.shift.elapsed,
            mailControlVisible:!!document.getElementById('mailButton')&&getComputedStyle(document.getElementById('mailButton')).display!=='none', absent:['yard','yardJob','animals','landmarks','mineSite'].every(k=>m[k]===null),
            sites:m.terrain.sites.length, bridgeExpected:!!m.roads.modern?.spans.length,
            bridgeSites:m.terrain.sites.filter(s=>m.roads.modern&&s.deckDriving===m.roads.modern.driving).length,
            otherSites:m.terrain.sites.filter(s=>s!==m.home?.site&&s!==m.church?.site&&s!==m.drLane?.site&&s!==m.prince?.site&&s!==m.maryville?.site&&s!==m.depot?.site&&s!==m.quarry?.site&&s!==m.airport?.site&&!m.novemberRoads?.sites.includes(s)&&!m.roughRoads?.sites.includes(s)&&!(m.roads.modern&&s.deckDriving===m.roads.modern.driving)).length, novemberSites:m.novemberRoads?.sites.length??0, roughSites:m.roughRoads?.sites.length??0, quarrySite:!!m.quarry&&m.terrain.sites.includes(m.quarry.site), homeSite:!!m.home&&m.terrain.sites.includes(m.home.site), churchSite:!!m.church&&m.terrain.sites.includes(m.church.site), drLaneSite:!!m.drLane&&m.terrain.sites.includes(m.drLane.site), princeSite:!!m.prince&&m.terrain.sites.includes(m.prince.site), ground:m.terrain.heightAt(v.x,v.z), pending:m.terrain.pending, stops:m.shift.stops, run:m.shift.run.name, x:v.x,z:v.z, heading:v.heading,
            roadDistance:road?.dist, bounds:v.bounds, edge:!!m.edge, draws:m.renderer.info.render.calls, triangles:m.renderer.info.render.triangles,
            hud:document.getElementById('hud').textContent, shiftHud:document.getElementById('shiftHud').textContent};
        })()`);
        assert.equal(failedRequests.length, 0, failedRequests.join('\n'));
        result.transferredBytes=transferredBytes; result.requestCount=requests.length;
        assert.equal(result.area, query.get('area')); assert.equal(result.absent, true);
        // Judique owns its home, church and the house on D.R.'s Lane; West Bay owns the invented quarry park.
        // Bridge contact providers are separate from these area-specific places.
        assert.equal(result.otherSites, 0, 'no mail-route site outside Mabou');
        assert.equal(result.bridgeSites, Number(result.bridgeExpected), 'one contact provider when mapped bridge spans exist');
        // Judique also owns the two Baxters Cove Road surfaces (the harbour lot and the trailhead lane).
        if (result.area==='judique') assert.equal(result.novemberSites, 2, 'the Baxters Cove lot and trailhead lane');
        const ownSites = ({pointtupper:(query.get('airport')==='0'?0:1)+(query.get('prince')==='0'?0:1),judique:3,porthood:(query.get('maryville')==='0'?0:1)+(query.get('depot')==='0'?0:1),westbay:query.get('quarry')==='0'?0:1})[result.area]??0;
        assert.equal(result.sites, ownSites + result.novemberSites + result.roughSites + result.bridgeSites, JSON.stringify({sites:result.sites,home:result.homeSite,church:result.churchSite,drLane:result.drLaneSite,prince:result.princeSite,quarry:result.quarrySite,roughSites:result.roughSites,bridges:result.bridgeSites}));
        if(result.area==='judique')assert.ok(result.homeSite&&result.churchSite&&result.drLaneSite,'Judique loads its home, church and D.R.\'s Lane sites');
        if(result.area==='pointtupper'&&query.get('prince')!=='0')assert.ok(result.princeSite,'Point Tupper loads the Prince Street house site');
        if(result.area==='westbay'&&ownSites)assert.ok(result.quarrySite,'West Bay loads its own quarry site');
        assert.ok(Number.isFinite(result.ground) && result.ground >= 0, 'land under the spawn');
        assert.equal(result.pending, 0, 'land downloads settled');
        assert.equal(result.gameMode, 'explore', 'non-mail areas force explore mode');
        assert.equal(result.day,0); assert.equal(result.elapsed,0); assert.equal(result.mailControlVisible,false);
        assert.equal(result.stops, 0); assert.equal(result.edge, true);
        assert.equal(requests.some(path => path.endsWith('/landmarks.json')), false);
        if (query.has('demo')) {
          assert.ok(initial, 'initial car state');
          const startRoad = await evaluate(`(() => { const p=${JSON.stringify(initial)}; const r=mmm.roads.nearest(p.x,p.z,1000,r=>r.kind>=1&&r.kind<=3); const centre=mmm.roads.nearest(0,0,1000,r=>r.kind>=1&&r.kind<=3); return {distance:r?.dist, heading:r?.heading, centre, ground:mmm.terrain.heightAt(p.x,p.z)}; })()`);
          assert.ok(startRoad.distance < 1, JSON.stringify(startRoad));
          assert.ok(Number.isFinite(startRoad.ground) && startRoad.ground >= 0, 'land under initial spawn');
          assert.ok(Math.hypot(initial.x, initial.z) < 1000, JSON.stringify(initial));
          assert.ok(Math.hypot(initial.x-startRoad.centre.x,initial.z-startRoad.centre.z)<1, 'nearest public road to village');
          assert.ok(Math.abs(Math.sin(initial.heading-startRoad.heading))<.15, 'heading along the public road');
          result.startRoadDistance=startRoad.distance; result.travel=Math.hypot(result.x-initial.x,result.z-initial.z);
          assert.ok(Math.hypot(result.x-initial.x,result.z-initial.z) > 3, 'demo car moved');
          // Probe after the picture, so the temporary placement cannot alter the photographed HUD.
          afterShot = async () => {
            const edge = await evaluate(`(() => {
              const v = mmm.vehicle, t = mmm.terrain, b = v.bounds;
              const mx = (b[0] + b[2]) / 2, mz = (b[1] + b[3]) / 2;
              const reach = (h, ref) => h !== null && (t.cartRoads ? true : h <= ref + 0.5);
              const groundAt = (px, pz, ref) => {
                const deck = mmm.roads.deckHeight(px, pz);
                const apron = t.bridgeApproaches?.apronHeight(px, pz) ?? null;
                if (reach(apron, ref)) return reach(deck, ref) ? Math.max(deck, apron) : apron;
                const h = t.heightAt(px, pz, ref);
                if (h === null) return null;
                return reach(deck, ref) ? Math.max(deck, h) : h;
              };
              const isWet = (px, pz, land) => {
                const g = groundAt(px, pz, land);
                if (g === null) return false;
                const s = t.surfaceAt(px, pz, g), deck = mmm.roads.deckHeight(px, pz);
                const onDeck = s?.deck === true || (deck !== null && Math.abs(g - deck) < 0.02);
                if (onDeck) return false;
                if (g < t.seaLevel + 0.02) return true;
                if (!s) return false;
                if (s.water || s.ground < t.seaLevel + 0.02) return true;
                const cover = t.coverAt?.(px, pz) ?? 0;
                const onRoad = s.kind > 0 && s.roadDist <= s.halfWidth + 0.4;
                if (cover !== 4 || onRoad || s.mineral || s.canopy >= 1.5) return false;
                const gx0 = groundAt(px - 1, pz, g), gx1 = groundAt(px + 1, pz, g), gz0 = groundAt(px, pz - 1, g), gz1 = groundAt(px, pz + 1, g);
                const slope = gx0 !== null && gx1 !== null && gz0 !== null && gz1 !== null ? Math.hypot((gx1 - gx0) * 0.5, (gz1 - gz0) * 0.5) : 0;
                return slope < 0.07;
              };
              const fracs = [0.5];
              for (let i = 1; i < 32; i++) if (i !== 16) fracs.push(i / 32);
              const sides = [
                { side: 'west', heading: -Math.PI / 2, vx: -10, vz: 0, out: f => [b[0] - 10, b[1] + f * (b[3] - b[1])], inside: [b[0] + 0.01, mz], onEdge: () => Math.abs(v.x - b[0]) < 1e-6 },
                { side: 'east', heading: Math.PI / 2, vx: 10, vz: 0, out: f => [b[2] + 10, b[1] + f * (b[3] - b[1])], inside: [b[2] - 0.01, mz], onEdge: () => Math.abs(v.x - b[2]) < 1e-6 },
                { side: 'north', heading: 0, vx: 0, vz: -10, out: f => [b[0] + f * (b[2] - b[0]), b[1] - 10], inside: [mx, b[1] + 0.01], onEdge: () => Math.abs(v.z - b[1]) < 1e-6 },
                { side: 'south', heading: Math.PI, vx: 0, vz: 10, out: f => [b[0] + f * (b[2] - b[0]), b[3] + 10], inside: [mx, b[3] - 0.01], onEdge: () => Math.abs(v.z - b[3]) < 1e-6 },
              ];
              return sides.map(({ side, heading, vx, vz, out, inside, onEdge }) => {
                // Vehicle.place refuses wet poses (water-bounds). Try loaded points outside the edge with place() itself
                // so decks and water rules match the game. When an entire edge sits in open water (such as Judique's
                // west edge in the Gulf), verify the wet refusal leaves the car put, then step across that edge from
                // loaded terrain just inside to prove the bounds wall still stops the car.
                let chosen = null, midWet = null;
                for (const f of fracs) {
                  const [px, pz] = out(f), land = t.heightAt(px, pz);
                  if (land === null) continue;
                  const prevX = v.x, prevZ = v.z, placed = v.place(px, pz, heading);
                  const cover = t.coverAt?.(px, pz) ?? 0;
                  if (placed) { chosen = { x: px, z: pz, land, cover }; break; }
                  const stayedPut = v.x === prevX && v.z === prevZ, wet = isWet(px, pz, land);
                  if (!stayedPut || !wet) return { side, placed, stayedPut, wet, land, cover, stopped: false };
                  if (f === 0.5) midWet = { land, cover };
                }
                if (chosen) {
                  v.atEdge = false; v.vx = vx; v.vz = vz; v.speed = 10; v.steerAngle = 0;
                  mmm.driveVehicle(1 / 120, { throttle: 0, steer: 0, handbrake: false });
                  const halted = v.vx * vx + v.vz * vz <= 0;
                  return { side, placed: true, wetRefused: false, land: chosen.land, cover: chosen.cover,
                    stopped: v.x >= b[0] && v.x <= b[2] && v.z >= b[1] && v.z <= b[3] && onEdge() && v.atEdge && halted };
                }
                if (!midWet) return { side, placed: false, wet: false, wetRefused: false, stopped: false };
                const [ix, iz] = inside, inLand = t.heightAt(ix, iz);
                const inSurface = inLand === null ? null : t.surfaceAt(ix, iz, inLand);
                if (inLand === null || !inSurface) {
                  return { side, placed: false, wet: true, wetRefused: true, inLoaded: false, ...midWet, stopped: false };
                }
                v.x = ix; v.z = iz; v.y = inLand;
                v.atEdge = false; v.heading = heading; v.vx = vx; v.vz = vz; v.vy = 0; v.speed = 10; v.steerAngle = 0; v.airborne = false; v.sunk = 0;
                mmm.driveVehicle(1 / 120, { throttle: 0, steer: 0, handbrake: false });
                const halted = v.vx * vx + v.vz * vz <= 0;
                return { side, placed: false, wet: true, wetRefused: true, inLoaded: true, ...midWet,
                  stopped: v.x >= b[0] && v.x <= b[2] && v.z >= b[1] && v.z <= b[3] && onEdge() && v.atEdge && halted };
              });
            })()`);
            assert.ok(edge.every(row=>row.stopped), 'all four edges stop the car: '+JSON.stringify(edge));
            result.edgeTests=edge; result.edgeStopsCar=true;
            writeFileSync(`${out}/${name}.json`, JSON.stringify({initial, ...result, errors}, null, 2));
          };
        }
        writeFileSync(`${out}/${name}.json`, JSON.stringify({initial, ...result, errors}, null, 2));
      }
    }
    if (query.get('check') === 'reload') {
      const waitReload = async predicate => {
        const until = Date.now()+120000;
        while (Date.now()<until) {
          await sleep(300);
          try { if (await evaluate(`document.title==='settled' && window.mmm?.area.id==='fixture' && (${predicate})`)) return; }
          catch (error) { if (!String(error).includes('context')) throw error; }
        }
        throw new Error('The settings reload did not retain the fixture area');
      };
      await evaluate(`(() => {const slider=document.getElementById('exag');slider.value='2';slider.dispatchEvent(new Event('change'));return true;})()`);
      await waitReload(`new URLSearchParams(location.search).get('area')==='fixture' && mmm.terrain.exag===2`);
      await evaluate(`(() => {const input=document.querySelector('#detail input');input.checked=true;input.dispatchEvent(new Event('change'));return true;})()`);
      await waitReload(`new URLSearchParams(location.search).get('area')==='fixture' && mmm.low===true`);
      writeFileSync(`${out}/${name}-reload.json`,JSON.stringify(await evaluate(`({search:location.search,area:mmm.area.id,low:mmm.low})`),null,2));
    }
    // Pin animated water for visual comparisons. This is a test-only renderer hook, never game code.
    if (query.has('cam')) await evaluate(`(() => { const r=mmm.renderer, render=r.render; r.render=function(scene,camera) {
      scene.traverse(object=>{ for (const material of object.material ? (Array.isArray(object.material)?object.material:[object.material]) : [])
        if(material.uniforms?.time) material.uniforms.time.value=120; }); return render.call(this,scene,camera);
    }; })()`);
    await sleep(200);
    const shot = await send('Page.captureScreenshot', {format:'png'});
    writeFileSync(`${out}/${name}.png`, Buffer.from(shot.data, 'base64'));
    await afterShot();
    if (query.get('check') !== 'missing') assert.equal(failedRequests.length, 0, failedRequests.join('\n'));
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(`PASS ${name}: ${state.message ?? state.title}; ${errors.length} console errors`);
  } finally {
    await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {}); ws.close();
  }
}
