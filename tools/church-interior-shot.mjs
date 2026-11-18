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
          const {Interiors}=await import('/src/interiors.ts');const tick=Interiors.prototype.update;
          Interiors.prototype.update=function(...args){window.doorsInspection=this;window.carInspection=args[2];return tick.apply(this,args)};
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
    const ui = await run(`({title:document.title,interior:document.getElementById('interiorHud')?.textContent,hudHidden:document.getElementById('interiorHud')?.hidden,prompt:document.getElementById('doorPrompt')?.textContent,promptHidden:document.getElementById('doorPrompt')?.hidden,overflow:document.documentElement.scrollWidth>innerWidth,driveHud:${shown('hud')},places:${shown('placesButton')},map:${shown('miniMap')},go:${shown('tcGo')},brake:${shown('tcBrake')},steer:${shown('tcSteer')}})`);
    writeFileSync(file.replace('.png', '.json'), JSON.stringify({ ui, logs }, null, 2)); console.log('  UI:', JSON.stringify(ui));
    if (ui.overflow) throw Error('Viewport overflow'); if (logs.some(l => l.startsWith('EXCEPTION'))) throw Error(logs.join('\n'));
    if (!inside) {
      // A drive, not the mail game: the prompt shows at the steps, G goes in, Esc comes out, and G goes in again.
      if (ui.promptHidden || !/River Denys Mountain church/.test(ui.prompt) || !/Step inside for a quiet look/.test(ui.prompt)) throw Error('No door prompt at the church steps: ' + ui.prompt);
      await key('KeyG', 'g'); await delay(1300);
      if (!await run('window.doorsInspection.busy&&!!window.churchInspection&&!document.getElementById("interiorHud").hidden')) throw Error('G did not open the church door on a drive');
      const hud = await run('document.getElementById("interiorHud").textContent');
      if (!/STEP OUT · Esc/.test(hud) || !/RIVER DENYS MOUNTAIN CHURCH/.test(hud) || /DAY|CLIMB/.test(hud) || !/One room\./.test(hud)) throw Error('Wrong words inside: ' + hud);
      const car = await run('({x:window.carInspection.x,z:window.carInspection.z})');
      await key('Escape', 'Escape'); await delay(1300);
      if (await run('window.doorsInspection.busy')) throw Error('Escape did not leave the church');
      const after = await run('({x:window.carInspection.x,z:window.carInspection.z})');
      if (car.x !== after.x || car.z !== after.z) throw Error('The car moved while the visitor was inside');
      await key('KeyG', 'g'); await delay(1300);
      if (!await run('window.doorsInspection.busy')) throw Error('A second visit on the same drive was refused');
      await key('Escape', 'Escape'); await delay(1300);
      console.log('  Door: prompt at the steps; G in, Esc out, G in again; car did not move');
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
        console.log('  Controls: WALK, BACK and LOOK on the phone; W and D on the keyboard');
      }
    }
  } finally { ws.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {}); }
}
