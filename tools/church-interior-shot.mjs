#!/usr/bin/env node
import { cdp, cdpFetch } from './cdp.mjs';
// The real room and rules, reached through temporary prototype inspection. No debug globals in shipped code.
// tools/church-interior-shots.sh owns Chromium, server, ports and cleanup. inspect= is consumed only here.
import { writeFileSync } from 'node:fs';
const [out, ...urls] = process.argv.slice(2), port = process.env.CDP_PORT ?? '9343';
const delay = ms => new Promise(r => setTimeout(r, ms));
for (const url of urls) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const logs = [];
  const { ws, send } = await cdp(tab.webSocketDebuggerUrl, { deadline: 180000, onEvent: m => {
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  } });
  const run = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text); return r.result?.result?.value; };
  const key = async (code, k, ms = 150) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k }); await delay(ms); await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); };
  const press = async (id, test, what) => {
    const p = await run(`(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await delay(150);
    if (!await run(test)) throw Error(what);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  };
  try {
    await send('Runtime.enable'); await send('Page.enable');
    const query = new URL(url).searchParams, inspect = query.get('inspect'), inside = query.has('interior');
    await send('Emulation.setDeviceMetricsOverride', { width: Number(query.get('shotw') ?? process.env.SHOT_WIDTH ?? 1200), height: Number(query.get('shoth') ?? process.env.SHOT_HEIGHT ?? 900), deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    let armed = false;
    for (let i = 0; i < 180; i++) {
      await delay(1000);
      if (!armed && await run('!!document.getElementById("interiorHud")')) {
        await run(`(async()=>{
          if(!new URLSearchParams(location.search).has('interior')) {
            const {Vehicle}=await import('/src/vehicle.ts');
            const original=Vehicle.prototype.update;
            const at=new URLSearchParams(location.search).get('at').split(',').map(Number);
            const manifest=await(await fetch('/terrain/manifest.json')).json();
            Vehicle.prototype.update=function(dt){original.call(this,dt,{throttle:0,steer:0,handbrake:true});this.place(at[0]-manifest.village[0],manifest.village[1]-at[1],at[2]*Math.PI/180);this.speed=0;};
          }
          const {ChurchInterior}=await import('/src/interior-church.ts');
          const update=ChurchInterior.prototype.update;
          ChurchInterior.prototype.update=function(dt,input){window.churchInspection=this;window.churchInput=input;return update.call(this,window.churchFrozen?0:dt,input)};
          const {Interiors}=await import('/src/interiors.ts');const tick=Interiors.prototype.update,sync=Interiors.prototype.syncSpeed;
          Interiors.prototype.update=function(...args){window.doorsInspection=this;window.carInspection=args[2];if(window.churchTestPose)args[2]=window.churchTestPose;else if(window.churchTestSpeed!==undefined&&args[2])args[2]={...args[2],speed:window.churchTestSpeed};return tick.apply(this,args)};
          Interiors.prototype.syncSpeed=function(s){return sync.call(this,window.churchTestPose?window.churchTestPose.speed:window.churchTestSpeed!==undefined?window.churchTestSpeed:s)};
        })()`); armed = true;
      }
      if (armed && await run(`document.title === "settled" && (${!inside} || !!window.churchInspection)`)) break;
      if (i === 179) throw Error('Game did not settle: ' + url + ' ' + logs.slice(-5).join(' | '));
    }
    if (inspect) {
      const diagnostics = await run(`(async()=>{
        window.churchFrozen=true;
        const room=window.churchInspection,v=room.visit,mode=${JSON.stringify(inspect)};
        for(let i=0;i<60*400&&v.stop.id!==mode;i++)v.update(1/60,{walk:v.halted&&i%2?0:1,look:0});
        if(v.stop.id!==mode)throw Error('The walk did not reach '+mode);
        room.settled=false;room.update(0,{throttle:0,steer:0,handbrake:false,touch:${query.get('touch') === '1'}});
        let visibleTriangles=0,drawCalls=0;room.scene.traverseVisible(o=>{if(o.isMesh){drawCalls++;visibleTriangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}});
        const fps=await new Promise(done=>{let n=0;const t0=performance.now();const f=()=>{n++;performance.now()-t0<2000?requestAnimationFrame(f):done(n/2)};requestAnimationFrame(f)});
        return {stop:v.stop.id,distance:v.distance,eye:room.camera.position.toArray().map(n=>+n.toFixed(2)),visibleTriangles,drawCalls,fps,letter:room.parts.letter.visible,loft:room.parts.groups.loft.visible};
      })()`); console.log('  Church:', JSON.stringify(diagnostics));
      if (diagnostics.drawCalls > 24) throw Error('More than 24 draw calls');
      if (diagnostics.fps < 30) throw Error('Below 30 frames a second in the headless browser');
      if (diagnostics.letter) throw Error('A letter was left outside the mail game');
      if (diagnostics.loft !== (inspect === 'gallery')) throw Error('Gallery furniture drawn from the wrong place');
    }
    await delay(500);
    const screenshot = await send('Page.captureScreenshot', { format: 'png' }), name = query.get('name') ?? 'church-shot', file = `${out}/${name}.png`;
    writeFileSync(file, Buffer.from(screenshot.result.data, 'base64')); console.log(file);
    const shown = id => `(e=>e?getComputedStyle(e).display:'absent')(document.getElementById('${id}'))`;
    const ui = await run(`({title:document.title,interior:document.getElementById('interiorHud')?.textContent,hudHidden:document.getElementById('interiorHud')?.hidden,prompt:document.getElementById('doorPrompt')?.textContent,promptHidden:document.getElementById('doorPrompt')?.hidden,overflow:document.documentElement.scrollWidth>innerWidth,driveHud:${shown('hud')},places:${shown('placesButton')},map:${shown('miniMap')},go:${shown('tcGo')},brake:${shown('tcBrake')},steer:${shown('tcSteer')},donateLinks:[...document.querySelectorAll('a[href*="formsite"]')].map(a=>({id:a.id,href:a.href,target:a.target,rel:a.rel,text:a.textContent,parent:a.parentElement?.id,boxText:a.parentElement?.textContent}))})`);
    writeFileSync(file.replace('.png', '.json'), JSON.stringify({ ui, logs }, null, 2)); console.log('  UI:', JSON.stringify(ui));
    if (ui.overflow) throw Error('Viewport overflow'); if (logs.some(l => l.startsWith('EXCEPTION'))) throw Error(logs.join('\n'));
    const DONATE_URL = 'https://fs26.formsite.com/DioceseofAntigonish/jdqh7w8ymr/index.html';
    const DONATE_TEXT = "Support this church: donate through the Diocese of Antigonish. Choose parish St. Mary of the Angels, Glendale, and write 'St. Margaret of Scotland, River Denys Mountain' in the comments.";
    const checkDonateLink = (link, id, where) => {
      if (!link || link.id !== id || link.href !== DONATE_URL || link.target !== '_blank' || !link.rel.split(/\s+/).includes('noopener') || link.text !== 'Support this church' || link.boxText !== DONATE_TEXT) {
        throw Error(`Bad donation link (${where}): ` + JSON.stringify(link));
      }
    };
    const installFakePad = () => run(`(() => {
      if (window.__churchFakePad) return;
      const button = () => ({ pressed: false, touched: false, value: 0 });
      const pad = { id: 'Fake church pad', index: 0, mapping: 'standard', connected: true, timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, button) };
      Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] });
      dispatchEvent(new Event('gamepadconnected'));
      window.__churchFakePad = {
        set(i, v) { pad.buttons[i] = { pressed: v >= 0.5, touched: v > 0, value: v }; pad.timestamp++; },
      };
    })()`);
    const padPress = async btn => { await run(`window.__churchFakePad.set(${btn}, 1)`); await delay(150); await run(`window.__churchFakePad.set(${btn}, 0)`); await delay(150); };
    if (!inside) {
      // A drive, not the mail game: the prompt shows at the steps (with the donation link), G goes in, Esc comes out, and G goes in again.
      if (ui.promptHidden || !/River Denys Mountain church/.test(ui.prompt) || !/Step inside for a quiet look/.test(ui.prompt)) throw Error('No door prompt at the church steps: ' + ui.prompt);
      if (ui.donateLinks.length !== 1) throw Error('Expected 1 donation link parked at the church: ' + JSON.stringify(ui.donateLinks));
      checkDonateLink(ui.donateLinks[0], 'doorSupportLink', 'door prompt');
      const hitDesktop = await run(`(() => { const a = document.getElementById('doorSupportLink'), r = a.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { w: r.width, h: r.height, inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, hit: h === a || a.contains(h) }; })()`);
      if (!(hitDesktop.inView && hitDesktop.hit && hitDesktop.h >= 40)) throw Error('Door donation link not reachable on desktop: ' + JSON.stringify(hitDesktop));
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await delay(150);
      const hitPhone = await run(`(() => { const a = document.getElementById('doorSupportLink'), r = a.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { w: r.width, h: r.height, overflow: document.documentElement.scrollWidth > innerWidth, inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, hit: h === a || a.contains(h) }; })()`);
      await send('Emulation.setDeviceMetricsOverride', { width: Number(query.get('shotw') ?? process.env.SHOT_WIDTH ?? 1200), height: Number(query.get('shoth') ?? process.env.SHOT_HEIGHT ?? 900), deviceScaleFactor: 1, mobile: false });
      await delay(100);
      if (!(hitPhone.inView && hitPhone.hit && !hitPhone.overflow && hitPhone.h >= 40)) throw Error('Door donation link not reachable on phone: ' + JSON.stringify(hitPhone));
      // Moving slowly (2 km/h forward or reverse) at the church steps must keep the link out of the door prompt and pause screen.
      for (const speed of [2 / 3.6, -2 / 3.6]) {
        await run(`window.churchTestSpeed = ${speed}`); await delay(150);
        if (!await run(`!document.getElementById('doorPrompt').hidden && document.querySelectorAll('a[href*="formsite"]').length === 0`)) throw Error(`Donation link appeared while moving at ${speed} m/s`);
        await key('KeyP', 'p'); await delay(150);
        if (!await run(`!document.getElementById('pauseScreen').hidden && document.querySelectorAll('a[href*="formsite"]').length === 0`)) throw Error(`Real pause screen exposed donation link while moving at ${speed} m/s`);
        await key('KeyP', 'p'); await delay(150);
      }
      // First-frame transition above 0.5 km/h starting from parked (link visible):
      // (a) production syncSpeed at the end of a frame where vehicle.speed crosses 0.5 km/h clears #doorSupportLink immediately;
      // (b) synchronous pause on that speed (with zero intervening frames) clears both links immediately via syncPauseUI.
      await run('window.churchTestSpeed = undefined'); await delay(150);
      if (!await run(`!!document.getElementById('doorSupportLink')`)) throw Error('Expected parked door link before first-frame transition check');
      const syncPauseOk = await run(`(() => {
        window.carInspection.speed = 0.55 / 3.6;
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true, cancelable: true }));
        const paused = !document.getElementById('pauseScreen').hidden;
        const links = document.querySelectorAll('a[href*="formsite"]').length;
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true, cancelable: true }));
        window.carInspection.speed = 0;
        return { paused, links, closed: document.getElementById('pauseScreen').hidden };
      })()`);
      if (!(syncPauseOk.paused && syncPauseOk.links === 0 && syncPauseOk.closed)) throw Error('Synchronous first-frame pause exposed donation link: ' + JSON.stringify(syncPauseOk));
      await delay(150);
      if (!await run(`!!document.getElementById('doorSupportLink')`)) throw Error('Expected parked door link before production-frame speed transition check');
      const frameClearOk = await run(`(async () => {
        const { Vehicle } = await import('/src/vehicle.ts');
        const prev = Vehicle.prototype.update;
        const { Interiors } = await import('/src/interiors.ts');
        const prevUpdate = Interiors.prototype.update;
        let linksAtEnd = -1, fired = false;
        Interiors.prototype.update = function(...args) {
          if (fired) { linksAtEnd = document.querySelectorAll('a[href*="formsite"]').length; Interiors.prototype.update = prevUpdate; Vehicle.prototype.update = prev; }
          return prevUpdate.apply(this, args);
        };
        Vehicle.prototype.update = function(dt) {
          prev.call(this, dt);
          if (!fired) { fired = true; this.speed = 0.55 / 3.6; }
        };
        // Break waitingToDrive so main.ts does not clamp vehicle.speed back to 0 on the test frame.
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
        for (let i = 0; i < 30 && linksAtEnd < 0; i++) await new Promise(r => requestAnimationFrame(r));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true }));
        Interiors.prototype.update = prevUpdate; Vehicle.prototype.update = prev;
        return { fired, linksAtEnd };
      })()`);
      if (!(frameClearOk.fired && frameClearOk.linksAtEnd === 0)) throw Error('Production frame failed to clear door donation link on first frame above 0.5 km/h: ' + JSON.stringify(frameClearOk));
      await delay(150);
      await key('KeyG', 'g'); await delay(1300);
      if (!await run('window.doorsInspection.busy&&!!window.churchInspection&&!document.getElementById("interiorHud").hidden')) throw Error('G did not open the church door on a drive');
      const hud = await run('document.getElementById("interiorHud").textContent');
      if (!/STEP OUT · Esc/.test(hud) || !/RIVER DENYS MOUNTAIN CHURCH/.test(hud) || /DAY|CLIMB/.test(hud) || !/One room\./.test(hud)) throw Error('Wrong words inside: ' + hud);
      if (await run(`document.querySelectorAll('a[href*="formsite"]').length`) !== 0) throw Error('Donation link must not show at the first stop of the walk');
      const car = await run('({x:window.carInspection.x,z:window.carInspection.z})');
      await key('Escape', 'Escape'); await delay(1300);
      if (await run('window.doorsInspection.busy')) throw Error('Escape did not leave the church');
      const after = await run('({x:window.carInspection.x,z:window.carInspection.z})');
      if (car.x !== after.x || car.z !== after.z) throw Error('The car moved while the visitor was inside');
      // Gamepad at the steps: Start opens pause with the link, D-pad reaches it, A clicks it, B closes; Y enters the church, B leaves.
      await installFakePad();
      await padPress(9); // START
      const pauseCheck = await run(`(() => { const a = document.getElementById('pauseSupportLink'); if (!a) return null; window.__pauseLinkClicked = 0; a.addEventListener('click', e => { e.preventDefault(); window.__pauseLinkClicked++; }); return { id: a.id, href: a.href, target: a.target, rel: a.rel, text: a.textContent, parent: a.parentElement?.id, boxText: a.parentElement?.textContent }; })()`);
      checkDonateLink(pauseCheck, 'pauseSupportLink', 'pause screen at steps');
      let reachedPause = false;
      for (let i = 0; i < 10 && !reachedPause; i++) { await padPress(13); reachedPause = await run(`document.activeElement?.id === 'pauseSupportLink'`); }
      if (!reachedPause) throw Error('Gamepad D-pad did not reach #pauseSupportLink on pause screen');
      await padPress(0); // A
      if (await run('window.__pauseLinkClicked') !== 1) throw Error('Gamepad A did not click #pauseSupportLink');
      await padPress(1); // B
      if (!await run(`document.getElementById('pauseScreen').hidden && !document.getElementById('pauseSupportLink')`)) throw Error('Gamepad B did not close pause and clear link');
      await padPress(3); await delay(1300); // Y enters church
      if (!await run('window.doorsInspection.busy')) throw Error('Gamepad Y did not open the church door');
      await padPress(1); await delay(1300); // B leaves church
      if (await run('window.doorsInspection.busy')) throw Error('Gamepad B did not leave the church');
      console.log('  Door: prompt and donation link at the steps (desktop, phone, gamepad); G/Y in, Esc/B out; car did not move');
    }
    if (inspect && inspect !== 'gallery') {
      if (ui.donateLinks.length !== 0) throw Error(`Donation link must not show at ${inspect}: ` + JSON.stringify(ui.donateLinks));
      if (inspect === 'door' && query.get('touch') !== '1') {
        await key('KeyP', 'p'); await delay(150);
        if (!await run(`!document.getElementById('pauseScreen').hidden && document.querySelectorAll('a[href*="formsite"]').length === 0`)) throw Error('Real pause screen at door stop must not expose donation link');
        await key('KeyP', 'p'); await delay(150);
      }
    }
    if (inspect === 'gallery') {
      if (ui.donateLinks.length !== 1) throw Error('Expected 1 donation link at the gallery caption: ' + JSON.stringify(ui.donateLinks));
      checkDonateLink(ui.donateLinks[0], 'interiorSupportLink', 'gallery stop');
      const hitGallery = await run(`(() => { const a = document.getElementById('interiorSupportLink'), r = a.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { w: r.width, h: r.height, inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, hit: h === a || a.contains(h) }; })()`);
      if (!(hitGallery.inView && hitGallery.hit && hitGallery.h >= 40)) throw Error('Gallery donation link not reachable: ' + JSON.stringify(hitGallery));
      // Gamepad directly reaches #interiorSupportLink via D-pad + A without pausing.
      await installFakePad();
      await run(`(() => { window.__hudLinkClicked = 0; document.getElementById('interiorSupportLink').addEventListener('click', e => { e.preventDefault(); window.__hudLinkClicked++; }); })()`);
      await padPress(12); // D-pad UP -> last focusable (#interiorSupportLink)
      if (!await run(`document.activeElement?.id === 'interiorSupportLink' && document.activeElement.classList.contains('padFocus')`)) throw Error('Gamepad D-pad did not focus #interiorSupportLink in walk HUD');
      await padPress(0); // A
      if (await run('window.__hudLinkClicked') !== 1) throw Error('Gamepad A did not activate #interiorSupportLink');
      console.log('  Gallery: donation link verified on desktop and via gamepad D-pad + A');
    }
    if (inspect === 'door') {
      await run('window.churchFrozen=false');
      if (ui.hudHidden || ui.driveHud !== 'none' || ui.map !== 'none' || ui.places === 'block') throw Error('Driving HUD or map shows inside: ' + JSON.stringify(ui));
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' }); await delay(900);
      const walked = await run('({throttle:window.churchInput.throttle,distance:window.churchInspection.visit.distance})');
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' });
      if (!(walked.throttle > 0 && walked.distance > .3)) throw Error('W did not walk: ' + JSON.stringify(walked));
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyD', key: 'd' }); await delay(500);
      if (!await run('window.churchInspection.visit.lookAngle>.3')) throw Error('D did not look to the right');
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyD', key: 'd' });
      if (query.get('touch') === '1') {
        const labels = await run(`({go:getComputedStyle(document.getElementById('tcGo'),'::after').content,brake:getComputedStyle(document.getElementById('tcBrake'),'::after').content,steer:getComputedStyle(document.getElementById('tcKnob'),'::after').content,
          clear:(()=>{const h=document.getElementById('interiorHud').getBoundingClientRect();return ['tcGo','tcBrake','tcSteer'].every(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.width>40&&r.height>40&&r.top>=h.bottom&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})})(),
          apart:(()=>{const a=document.getElementById('tcGo').getBoundingClientRect(),b=document.getElementById('tcBrake').getBoundingClientRect(),c=document.getElementById('tcSteer').getBoundingClientRect();const hit=(p,q)=>p.left<q.right&&q.left<p.right&&p.top<q.bottom&&q.top<p.bottom;return !hit(a,b)&&!hit(a,c)&&!hit(b,c)})()})`);
        console.log('  Phone:', JSON.stringify(labels));
        if (labels.go !== '"WALK"' || labels.brake !== '"BACK"' || labels.steer !== '"LOOK"') throw Error('Phone controls keep the mine words');
        if (!labels.clear || !labels.apart) throw Error('Phone controls overlap each other or the words');
        const d0 = await run('window.churchInspection.visit.distance');
        await press('tcGo', 'window.churchInput.throttle>0', 'Phone WALK did not reach the church');
        await delay(400); if (!(await run('window.churchInspection.visit.distance') > d0)) throw Error('Phone WALK did not walk');
        await press('tcBrake', 'window.churchInput.throttle<0', 'Phone BACK did not reach the church');
        // Advance to gallery on phone and verify the donation link is tappable and stays clear of WALK/BACK/LOOK.
        await run(`(() => { window.churchFrozen = true; const v = window.churchInspection.visit; for (let i = 0; i < 60 * 400 && v.stop.id !== 'gallery'; i++) v.update(1 / 60, { walk: v.halted && i % 2 ? 0 : 1, look: 0 }); })()`);
        await delay(250);
        const phoneGallery = await run(`(() => {
          const a = document.getElementById('interiorSupportLink');
          if (!a) return null;
          const r = a.getBoundingClientRect(), h = document.getElementById('interiorHud').getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          const clear = ['tcGo', 'tcBrake', 'tcSteer'].every(id => document.getElementById(id).getBoundingClientRect().top >= h.bottom);
          return { id: a.id, href: a.href, target: a.target, rel: a.rel, text: a.textContent, parent: a.parentElement?.id, boxText: a.parentElement?.textContent,
            inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, hit: hit === a || a.contains(hit), h: r.height, clear, overflow: document.documentElement.scrollWidth > innerWidth };
        })()`);
        checkDonateLink(phoneGallery, 'interiorSupportLink', 'phone gallery stop');
        if (!(phoneGallery.inView && phoneGallery.hit && phoneGallery.clear && !phoneGallery.overflow && phoneGallery.h >= 40)) throw Error('Phone gallery donation link layout failed: ' + JSON.stringify(phoneGallery));
        // Step out onto the church steps with real touch controls and verify portrait + short landscape (568x320) fit without clipping or blocking steering/GO/BRAKE.
        await run(`(() => {
          const pos = window.doorsInspection.doors.get('church').position;
          window.churchTestPose = { x: pos.x, z: pos.z, speed: 0 };
          window.doorsInspection.leave();
        })()`);
        for (let i = 0; i < 40 && await run('window.doorsInspection.busy || document.getElementById("doorPrompt").hidden || !document.getElementById("doorSupportLink")'); i++) await delay(150);
        const touchCases = [
          { label: '568x320', w: 568, h: 320, vars: {} },
          { label: '568x320-standalone', w: 568, h: 320, vars: { '--phone-top-gap': '16px' } },
          { label: '568x320-insets', w: 568, h: 320, vars: { '--test-safe-left': '47px', '--test-safe-right': '47px', '--test-safe-bottom': '21px' } },
          { label: '390x844', w: 390, h: 844, vars: {} },
        ];
        const expectedControls = ['pauseButton', 'gear', 'placesButton', 'droneButton', 'tcReset', 'tcView', 'tcHorn', 'tcSteer', 'tcBrake', 'tcGo'];
        for (const tc of touchCases) {
          await send('Emulation.setDeviceMetricsOverride', { width: tc.w, height: tc.h, deviceScaleFactor: 1, mobile: true });
          await run(`(() => {
            const root = document.documentElement.style, body = document.body.style;
            for (const k of ['--phone-top-gap', '--test-safe-top', '--test-safe-left', '--test-safe-right', '--test-safe-bottom']) { root.removeProperty(k); body.removeProperty(k); }
            for (const [k, v] of Object.entries(${JSON.stringify(tc.vars)})) { root.setProperty(k, v); body.setProperty(k, v); }
            window.dispatchEvent(new Event('resize'));
          })()`);
          await delay(250);
          const touchDoor = await run(`(() => {
            const p = document.getElementById('doorPrompt'), a = document.getElementById('doorSupportLink');
            if (!p || p.hidden || !a) return null;
            const pr = p.getBoundingClientRect(), ar = a.getBoundingClientRect();
            const hitLink = document.elementFromPoint(ar.left + ar.width / 2, ar.top + ar.height / 2);
            const overlaps = (x, y) => x.left < y.right - 0.5 && y.left < x.right - 0.5 && x.top < y.bottom - 0.5 && y.top < x.bottom - 0.5;
            const controls = ${JSON.stringify(expectedControls)}.map(id => {
              const el = document.getElementById(id);
              if (!el || el.hidden || getComputedStyle(el).display === 'none' || getComputedStyle(el).visibility === 'hidden') return { id, present: false, ok: false };
              const r = el.getBoundingClientRect();
              const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              const clear = !overlaps(pr, r);
              return { id, present: true, clear, ok: r.width >= 40 && r.height >= 40 && clear && !!hit && (hit === el || el.contains(hit)), hitId: hit?.id ?? hit?.tagName ?? null, r: { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) } };
            });
            return {
              id: a.id, href: a.href, target: a.target, rel: a.rel, text: a.textContent, parent: a.parentElement?.id, boxText: a.parentElement?.textContent,
              clipped: ar.top < pr.top - 0.5 || ar.bottom > pr.bottom + 0.5 || ar.left < pr.left - 0.5 || ar.right > pr.right + 0.5,
              inView: ar.left >= 0 && ar.top >= 0 && ar.right <= innerWidth + 0.5 && ar.bottom <= innerHeight + 0.5,
              hit: hitLink === a || a.contains(hitLink), h: ar.height, overflow: document.documentElement.scrollWidth > innerWidth,
              controls, pr: { l: Math.round(pr.left), t: Math.round(pr.top), r: Math.round(pr.right), b: Math.round(pr.bottom) }, ar: { t: Math.round(ar.top), b: Math.round(ar.bottom) },
            };
          })()`);
          checkDonateLink(touchDoor, 'doorSupportLink', `phone touch door prompt ${tc.label}`);
          if (touchDoor.clipped || !touchDoor.inView || !touchDoor.hit || touchDoor.overflow || touchDoor.h < 40 || touchDoor.controls.length !== expectedControls.length || !touchDoor.controls.every(c => c.present && c.ok)) {
            throw Error(`Touch door prompt layout failed at ${tc.label}: ` + JSON.stringify(touchDoor));
          }
        }
        console.log('  Controls: WALK, BACK and LOOK on the phone; W and D on the keyboard; gallery and touch door prompt donation link clear of all 10 controls on 568x320 (default, standalone, insets) and 390x844');
      }
    }
  } finally { ws.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {}); }
}
