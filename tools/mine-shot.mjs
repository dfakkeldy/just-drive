#!/usr/bin/env node
import { cdp, cdpFetch } from './cdp.mjs';
// Uses the real rules and scene via temporary prototype inspection. No debug globals in shipped code.
// tools/mine-shots.sh owns Chromium, server, ports and cleanup. inspect= is consumed only here.
import { writeFileSync } from 'node:fs';
const [out,...urls]=process.argv.slice(2),port=process.env.CDP_PORT??'9343';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
for(const url of urls){
  const tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  const logs=[];
  const { ws, send } = await cdp(tab.webSocketDebuggerUrl, { deadline: 180000, onEvent: m => {if(m.method==='Runtime.exceptionThrown')logs.push('EXCEPTION '+(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text));if(m.method==='Runtime.consoleAPICalled')logs.push(m.params.args.map(a=>a.value??a.description).join(' '));} });
  const run=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error(r.result.exceptionDetails.exception?.description??r.result.exceptionDetails.text);return r.result?.result?.value;};
  try{
    await send('Runtime.enable');await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride',{width:Number(new URL(url).searchParams.get('shotw')??process.env.SHOT_WIDTH??1200),height:Number(new URL(url).searchParams.get('shoth')??process.env.SHOT_HEIGHT??900),deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url});
    let armed=false;
    for(let i=0;i<180;i++){
      await delay(1000);
      if(!armed&&await run('!!document.getElementById("interiorHud")')){
        await run(`(async()=>{
          if(!new URLSearchParams(location.search).has('interior')) {
            const {Vehicle}=await import('/src/vehicle.ts');
            const original=Vehicle.prototype.update;
            const at=new URLSearchParams(location.search).get('at').split(',').map(Number);
            const manifest=await(await fetch('/terrain/manifest.json')).json();
            Vehicle.prototype.update=function(dt){original.call(this,dt,{throttle:0,steer:0,handbrake:true});this.place(at[0]-manifest.village[0],manifest.village[1]-at[1],at[2]*Math.PI/180);this.speed=0;};
            window.restoreMineVehicle=()=>{Vehicle.prototype.update=original};
          }
          const {MineInterior}=await import('/src/interior-mine.ts');
          const update=MineInterior.prototype.update;
          MineInterior.prototype.update=function(dt,input){window.mineInspection=this;window.mineInput=input;return update.call(this,window.mineFrozen?0:dt,input)};
          const {Interiors}=await import('/src/interiors.ts');const tick=Interiors.prototype.update;
          Interiors.prototype.update=function(...args){window.doorsInspection=this;window.carInspection=args[2];return tick.apply(this,args)};
          const {Shift}=await import('/src/shift.ts');const clock=Shift.prototype.updateIndoors;
          Shift.prototype.updateIndoors=function(dt){window.shiftInspection=this;return clock.call(this,window.mineFrozen?0:dt)};
        })()`);armed=true;
      }
      if(armed && await run('document.title === "settled" && (!new URLSearchParams(location.search).has("interior") || !!window.mineInspection)'))break;
      if(i===179)throw Error('Game did not settle: '+url+' '+logs.slice(-5).join(' | '));
    }
    const query=new URL(url).searchParams,inspect=query.get('inspect');
    if(inspect){
      const diagnostics=await run(`(async()=>{
        window.mineFrozen=true;
        const mine=window.mineInspection;const {MineRun}=await import('/src/mine-rules.ts');mine.run=new MineRun(${Number(query.get('day')??1)});
        const mode=${JSON.stringify(inspect)},r=mine.run;
        const careful=()=>({brake:r.speed>(r.stage===3&&r.progress>18?.95:3.65),lean:r.layout[Math.min(2,r.stage)].direction});
        for(let i=0;i<7000;i++){
          if(mode==='start'||mode==='fork'&&r.stage===0&&r.progress>=35||mode==='tip'&&r.phase==='tipped'||mode==='face'&&r.phase==='signed')break;
          r.update(1/60,mode==='tip'?{brake:false,lean:1}:careful());
        }
        if(mode==='tip')r.update(.55,{brake:true,lean:0});
        if(mode==='face')r.update(.8,{brake:true,lean:0});
        mine.update(0,{throttle:0,steer:0,handbrake:false});
        if(window.shiftInspection)window.shiftInspection.elapsed=r.elapsed*20;
        let visibleTriangles=0;mine.scene.traverseVisible(o=>{if(o.isMesh)visibleTriangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;});
        return {phase:r.phase,stage:r.stage,progress:r.progress,elapsed:r.elapsed,visibleTriangles,boards:r.layout};
      })()`);console.log('  Mine:',JSON.stringify(diagnostics));
    }
    await delay(500);
    const screenshot=await send('Page.captureScreenshot',{format:'png'}),name=query.get('name')??'mine-shot',file=`${out}/${name}.png`;
    writeFileSync(file,Buffer.from(screenshot.result.data,'base64'));console.log(file);
    const ui=await run(`({title:document.title,interior:document.getElementById('interiorHud')?.textContent,prompt:document.getElementById('doorPrompt')?.textContent,overflow:document.documentElement.scrollWidth>innerWidth,driveHidden:getComputedStyle(document.getElementById('hud')).display,brake:document.getElementById('tcBrake')?getComputedStyle(document.getElementById('tcBrake')).display:'no phone',steer:document.getElementById('tcSteer')?getComputedStyle(document.getElementById('tcSteer')).display:'no phone'})`);
    writeFileSync(file.replace('.png','.json'),JSON.stringify({ui,logs},null,2));console.log('  UI:',JSON.stringify(ui));
    if(ui.overflow)throw Error('Viewport overflow');if(logs.some(l=>l.startsWith('EXCEPTION')))throw Error(logs.join('\n'));
    if(inspect==='face'){
      console.log('  Delivery:',JSON.stringify(await run(`(async()=>{
        window.mineFrozen=false;await new Promise(resolve=>setTimeout(resolve,8200));
        if(window.doorsInspection.busy)throw Error('Automatic winch did not return to car');
        if(window.shiftInspection.indoorParcels!==1)throw Error('Delivered parcel missing from real shift');
        if(window.shiftInspection.complaints.all.some(c=>c.kind==='indoors'))throw Error('Successful delivery filed a complaint');
        return {automaticReturn:'car',indoorParcels:1,complaints:0};
      })()`)));
    }
    if(inspect==='fork'){
      console.log('  Wrong branch:',JSON.stringify(await run(`(async()=>{
        const {MineRun}=await import('/src/mine-rules.ts'),m=window.mineInspection,r=new MineRun(1);m.run=r;
        while(r.phase==='rolling'&&r.elapsed<40)r.update(1/60,{brake:r.speed>3.65,lean:-r.layout[0].direction});
        m.update(0,{throttle:0,steer:0,handbrake:false});
        if(r.phase!=='deadEnd'||Math.sign(m.rig.root.position.x)!==-r.layout[0].direction)throw Error('Cart did not reach wrong physical branch');
        return {phase:r.phase,cartX:m.rig.root.position.x,note:r.message};
      })()`)));
    }
    if(inspect==='start'){
      await send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyS',key:'s'});await delay(150);
      if(!await run('window.mineInput.throttle<0'))throw Error('Keyboard brake did not reach mine');
      await send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyS',key:'s'});
      if(query.get('touch')==='1'){
        const b=await run(`(()=>{const r=document.getElementById('tcBrake').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        await send('Input.dispatchMouseEvent',{type:'mousePressed',x:b.x,y:b.y,button:'left',clickCount:1});await delay(150);
        if(!await run('window.mineInput.throttle<0'))throw Error('Phone brake did not reach mine');
        await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:b.x,y:b.y,button:'left',clickCount:1});
        const p=await run(`(()=>{const r=document.getElementById('tcTrack').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        await send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});
        await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+65,y:p.y,button:'left',buttons:1});await delay(150);
        if(!await run('window.mineInput.steer>.25'))throw Error('Phone lean did not reach mine');
        await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+65,y:p.y,button:'left',clickCount:1});
        console.log('  Controls: keyboard brake, phone brake and steering pad reach the same mine input');
      }
      const checks=await run(`(async()=>{
        const d=window.doorsInspection,v=window.carInspection,s=window.shiftInspection,old={x:v.x,z:v.z,elapsed:s.elapsed};
        document.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape',bubbles:true}));
        window.mineFrozen=false;
        await new Promise(resolve=>setTimeout(resolve,1100));
        if(d.busy)throw Error('Escape did not leave the interior');
        if(s.complaints.all.filter(c=>c.kind==='indoors').length!==1)throw Error('Early exit did not file exactly one complaint');
        if(v.x!==old.x||v.z!==old.z)throw Error('Driving world moved inside');
        if(s.elapsed<=old.elapsed)throw Error('Shift clock did not advance');
        return {escape:'returned to frozen car',complaint:'one indoors',clock:'advanced'};
      })()`);console.log('  Interactions:',JSON.stringify(checks));
    }
    if(!query.has('interior')){
      console.log('  Door:',JSON.stringify(await run(`(async()=>{
        const prompt=document.getElementById('doorPrompt');
        if(prompt.hidden)throw Error('Expected stopped GO IN prompt');
        prompt.querySelector('button').click();await new Promise(resolve=>setTimeout(resolve,1000));
        if(!document.body.classList.contains('indoorOn'))throw Error('GO IN failed');
        if(getComputedStyle(document.getElementById('hud')).display!=='none')throw Error('Driving HUD visible indoors');
        return {goIn:'entered',hud:'driving hidden'};
      })()`)));
    }
    console.log('  console:',logs.slice(-8).join(' | ').slice(0,1800));
  } finally {await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);ws.close();}
}
