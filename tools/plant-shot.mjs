#!/usr/bin/env node
import { cdp, cdpFetch } from './cdp.mjs';
// Uses the real steel plant rules and scene via temporary prototype inspection. No debug globals in shipped code.
// tools/plant-shots.sh owns Chromium, server, ports and cleanup. inspect= is consumed only here.
import { writeFileSync } from 'node:fs';

const [out, ...urls] = process.argv.slice(2);
const port = process.env.CDP_PORT ?? '9343';
const delay = ms => new Promise(r => setTimeout(r, ms));

for (const url of urls) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const logs = [];
  const { ws, send } = await cdp(tab.webSocketDebuggerUrl, {
    deadline: 180000,
    onEvent: m => {
      if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
      if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    },
  });
  const run = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  try {
    await send('Runtime.enable');
    await send('Page.enable');
    const query = new URL(url).searchParams;
    const inspect = query.get('inspect');
    const inside = query.has('interior');
    await send('Emulation.setDeviceMetricsOverride', {
      width: Number(query.get('shotw') ?? process.env.SHOT_WIDTH ?? 1280),
      height: Number(query.get('shoth') ?? process.env.SHOT_HEIGHT ?? 800),
      deviceScaleFactor: 1,
      mobile: false,
    });
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
          const {PlantInterior}=await import('/src/interior-plant.ts');
          const update=PlantInterior.prototype.update;
          PlantInterior.prototype.update=function(dt,input){window.plantInspection=this;window.plantInput=input;return update.call(this,window.plantFrozen?0:dt,input)};
          const {Interiors}=await import('/src/interiors.ts');const tick=Interiors.prototype.update;
          Interiors.prototype.update=function(...args){window.doorsInspection=this;window.carInspection=args[2];return tick.apply(this,args)};
          const {Shift}=await import('/src/shift.ts');const clock=Shift.prototype.updateIndoors;
          Shift.prototype.updateIndoors=function(dt){window.shiftInspection=this;return clock.call(this,window.plantFrozen?0:dt)};
        })()`);
        armed = true;
      }
      if (armed && await run(`document.title === "settled" && (${!inside} || !!window.plantInspection)`)) break;
      if (i === 179) throw Error('Game did not settle: ' + url + ' ' + logs.slice(-5).join(' | '));
    }

    if (inspect) {
      const diagnostics = await run(`(async()=>{
        window.plantFrozen=true;
        const plant=window.plantInspection;
        const {PlantRun, hotSpotState}=await import('/src/plant-rules.ts');
        const r=new PlantRun(${Number(query.get('day') ?? 1)});
        plant.run=r;
        const mode=${JSON.stringify(inspect)};
        if(mode==='hotfloor'){
          const s=r.layout.hotSpots[5];
          let t=10;while(hotSpotState(s,t).state!=='hot'&&t<30)t+=0.05;
          r.elapsed=t;r.x=-0.5;r.z=63.5;
        } else if(mode==='cranes'){
          r.elapsed=24.2;r.x=0.8;r.z=97.5;
        } else if(mode==='win'){
          r.elapsed=64.0;r.x=0;r.z=132.2;r.update(0.3,{forward:1,side:0});
        } else if(mode==='loss'){
          const s=r.layout.hotSpots[0];
          let t=5;while(hotSpotState(s,t).state!=='hot'&&t<25)t+=0.05;
          for(let h=0;h<3;h++){r.invuln=0;r.stagger=0;r.elapsed=t;r.x=s.x;r.z=s.z;r.update(1/60,{forward:0,side:0});}
        } else if(mode==='start'){
          r.elapsed=1.2;r.x=0;r.z=4.2;
        }
        plant.update(0,{throttle:0,steer:0,handbrake:false,touch:${query.get('touch') === '1'}});
        if(window.shiftInspection)window.shiftInspection.elapsed=r.elapsed*20;
        let visibleTriangles=0,drawCalls=0;
        plant.scene.traverseVisible(o=>{if(o.isMesh){drawCalls++;const c=o.geometry.index?.count??o.geometry.attributes.position.count;visibleTriangles+=(c/3)*(o.isInstancedMesh?o.count:1);}});
        return {phase:r.phase,bay:r.bay,z:+r.z.toFixed(1),integrity:r.integrity,score:r.score,bonus:r.bonus,drawCalls,visibleTriangles};
      })()`);
      console.log('  Plant:', JSON.stringify(diagnostics));
      if (diagnostics.drawCalls > 18) throw Error('Too many draw calls in plant: ' + diagnostics.drawCalls);
    }

    await delay(500);
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    const name = query.get('name') ?? 'plant-shot';
    const file = `${out}/${name}.png`;
    writeFileSync(file, Buffer.from(screenshot.result.data, 'base64'));
    console.log(file);

    const shown = id => `(e=>e?getComputedStyle(e).display:'absent')(document.getElementById('${id}'))`;
    const ui = await run(`({
      title:document.title,
      interior:document.getElementById('interiorHud')?.textContent,
      hudHidden:document.getElementById('interiorHud')?.hidden,
      prompt:document.getElementById('doorPrompt')?.textContent,
      promptHidden:document.getElementById('doorPrompt')?.hidden,
      overflow:document.documentElement.scrollWidth>innerWidth,
      driveHud:${shown('hud')},
      go:${shown('tcGo')},
      brake:${shown('tcBrake')},
      steer:${shown('tcSteer')}
    })`);
    writeFileSync(file.replace('.png', '.json'), JSON.stringify({ ui, logs }, null, 2));
    console.log('  UI:', JSON.stringify(ui));
    if (ui.overflow) throw Error('Viewport overflow');
    if (logs.some(l => l.startsWith('EXCEPTION'))) throw Error(logs.join('\n'));

    if (!inside) {
      console.log('  Door:', JSON.stringify(await run(`(async()=>{
        const prompt=document.getElementById('doorPrompt');
        if(prompt.hidden)throw Error('Expected stopped GO IN prompt at Harbour Ridge Shop');
        if(!/Harbour Ridge Shop/.test(prompt.textContent))throw Error('Unexpected prompt: '+prompt.textContent);
        prompt.querySelector('button').click();
        await new Promise(resolve=>setTimeout(resolve,1100));
        if(!document.body.classList.contains('indoorOn')||!document.body.classList.contains('indoorGo'))throw Error('GO IN did not enter steel plant');
        if(getComputedStyle(document.getElementById('hud')).display!=='none')throw Error('Driving HUD visible indoors');
        return {goIn:'entered',hud:'driving hidden'};
      })()`)));
    }

    if (inspect === 'win') {
      console.log('  Win return:', JSON.stringify(await run(`(async()=>{
        window.plantFrozen=false;
        for(let i=0;i<90&&window.doorsInspection.busy;i++)await new Promise(resolve=>setTimeout(resolve,100));
        if(window.doorsInspection.busy)throw Error('Winning run did not automatically return to car');
        if(window.shiftInspection.indoorParcels!==1)throw Error('Delivered parcel missing from shift');
        if(window.shiftInspection.indoorBonus<=0)throw Error('Shift bonus missing after plant win');
        if(window.shiftInspection.complaints.all.some(c=>c.kind==='indoors'))throw Error('Winning run filed a complaint');
        const hint=document.getElementById('stopHint')?.textContent??'';
        return {returned:'car',indoorParcels:window.shiftInspection.indoorParcels,indoorBonus:window.shiftInspection.indoorBonus,hint};
      })()`)));
    }

    if (inspect === 'loss') {
      console.log('  Loss return:', JSON.stringify(await run(`(async()=>{
        window.plantFrozen=false;
        for(let i=0;i<90&&window.doorsInspection.busy;i++)await new Promise(resolve=>setTimeout(resolve,100));
        if(window.doorsInspection.busy)throw Error('Losing run did not automatically return to car');
        if(window.shiftInspection.indoorBonus!==0)throw Error('Losing run paid a bonus');
        if(window.shiftInspection.complaints.all.filter(c=>c.kind==='indoors').length!==1)throw Error('Losing run did not file an indoors complaint');
        return {returned:'car',indoorBonus:0,complaints:1};
      })()`)));
    }

    if (inspect === 'start') {
      await run('window.plantFrozen=false');
      const z0 = await run('window.plantInspection.run.z');
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' });
      await delay(350);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' });
      const z1 = await run('window.plantInspection.run.z');
      if (!(z1 > z0 + 0.2)) throw Error(`Keyboard W did not walk forward: ${z0} -> ${z1}`);

      if (query.get('touch') === '1') {
        const phoneCheck = await run(`({
          go:getComputedStyle(document.getElementById('tcGo'),'::after').content,
          brake:getComputedStyle(document.getElementById('tcBrake'),'::after').content,
          steer:getComputedStyle(document.getElementById('tcKnob'),'::after').content,
          clear:(()=>{const h=document.getElementById('interiorHud').getBoundingClientRect();return ['tcGo','tcBrake','tcSteer'].every(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.width>40&&r.height>40&&r.top>=h.bottom&&r.bottom<=innerHeight+1&&r.left>=0&&r.right<=innerWidth+1})})(),
          apart:(()=>{const a=document.getElementById('tcGo').getBoundingClientRect(),b=document.getElementById('tcBrake').getBoundingClientRect(),c=document.getElementById('tcSteer').getBoundingClientRect();const hit=(p,q)=>p.left<q.right&&q.left<p.right&&p.top<q.bottom&&q.top<p.bottom;return !hit(a,b)&&!hit(a,c)&&!hit(b,c)})()
        })`);
        console.log('  Phone layout:', JSON.stringify(phoneCheck));
        if (phoneCheck.go !== '"WALK"' || phoneCheck.brake !== '"BACK"' || phoneCheck.steer !== '"SIDE"') throw Error('Wrong phone control labels: ' + JSON.stringify(phoneCheck));
        if (!phoneCheck.clear || !phoneCheck.apart) throw Error('Phone controls overlap HUD or each other: ' + JSON.stringify(phoneCheck));

        const g = await run(`(()=>{const r=document.getElementById('tcGo').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g.x, y: g.y, button: 'left', clickCount: 1 });
        await delay(200);
        if (!await run('window.plantInput.throttle>0')) throw Error('Phone WALK did not reach steel plant');
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g.x, y: g.y, button: 'left', clickCount: 1 });

        const p = await run(`(()=>{const r=document.getElementById('tcTrack').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + 55, y: p.y, button: 'left', buttons: 1 });
        await delay(200);
        if (!await run('window.plantInput.steer>0.2')) throw Error('Phone SIDE pad did not reach steel plant');
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x + 55, y: p.y, button: 'left', clickCount: 1 });
      } else {
        const escCheck = await run(`(async()=>{
          const d=window.doorsInspection,v=window.carInspection,s=window.shiftInspection,old={x:v.x,z:v.z,elapsed:s.elapsed};
          document.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape',bubbles:true}));
          await new Promise(resolve=>setTimeout(resolve,1100));
          if(d.busy)throw Error('Escape did not leave the steel plant');
          if(s.complaints.all.filter(c=>c.kind==='indoors').length!==1)throw Error('Early exit did not file an indoors complaint');
          if(v.x!==old.x||v.z!==old.z)throw Error('Driving car moved while indoors');
          if(s.elapsed<=old.elapsed)throw Error('Shift clock did not advance indoors');
          return {escape:'returned to frozen car',complaint:'one indoors',clock:'advanced'};
        })()`);
        console.log('  Interactions:', JSON.stringify(escCheck));
      }
    }
  } finally {
    await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {});
    ws.close();
  }
}
