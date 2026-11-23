#!/usr/bin/env node
import { cdp, cdpFetch } from './cdp.mjs';
// The actual fixed-step car and main frame, in a browser owned by yard-shots.sh.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { assertMailCar } from './mail-car-body.mjs';
import { parkMainFrame } from './park-frame.mjs';
const [out, first] = process.argv.slice(2), base = new URL(first).origin, port = process.env.CDP_PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const errors = [];
const { ws, send } = await cdp(tab.webSocketDebuggerUrl, { deadline: 180000, onEvent: m => {  if(m.method==='Runtime.consoleAPICalled' && m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' ')); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); } });
const read = async expression => { const m = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (m.error || m.result.exceptionDetails) throw Error(JSON.stringify(m)); return m.result.result.value; };
const shot = async name => { await read(`(async()=>{if(!window.ft)return;for(let i=0;i<80;i++){ft.terrain.update(ft.camera);mmm.trees?.update(ft.terrain.drawnFine,ft.camera.position);mmm.grass?.update(.1,ft.camera,ft.c.x,ft.c.z,ft.c.heading,ft.c.spec);ft.c.roads.update(ft.camera.position);ft.f.update(0,ft.camera.position);ft.draw();await new Promise(r=>setTimeout(r,80));if(ft.terrain.pending===0 && !(mmm.trees?.pending??0) && !(mmm.grass?.pending??0) && i>10)break;}})()`); const m = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/${name}.png`, Buffer.from(m.result.data, 'base64')); };
const key = async (code, value, vk) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, code, key: value, windowsVirtualKeyCode: vk, ...(type === 'keyDown' && value === 'Enter' ? { text: '\r' } : {}) }); };
async function load(query='') {
  const url=new URL(base);url.search='at=wharf-road&cam=618710,5104885,125,180,-40,55&exag=1.5&hud=1&radio=0&title=1';
  for(const [k,v] of new URLSearchParams(query))url.searchParams.set(k,v);
  await send('Page.navigate',{url:url.href});
  let ready=false;
  for(let i=0;i<240;i++){await sleep(250);if(await read(`document.title==='settled' && mmm.fishing?.triangles>0`)){ready=true;break;}}
  assert.ok(ready,'wharf and actual terrain loaded');
  await assertMailCar(read,'blender','fishing');      // these checks read the car's sign, lamp and glass: a fallback car fails them
  await read(`document.getElementById('titleStart').click();document.activeElement?.blur()`);await key('KeyF','f',70);
  await parkMainFrame(read,sleep);
  await read(`(()=>{
    const mainFrame=window.nextFrame;if(typeof mainFrame!=='function')throw Error('main frame not parked');
    // Resize/layout callbacks also use rAF. Preserve the actual game loop across emulated phone rotations.
    window.requestAnimationFrame=fn=>{if(fn===mainFrame)window.nextFrame=fn;else setTimeout(()=>fn(performance.now()),0);return 0};
    const {vehicle:c,fishing:f,terrain,camera,endings,shift,renderer:r}=mmm,s=f.site;
    window.ft={c,f,s,terrain,camera,endings,shift,r,now:performance.now()};
    ft.frame=(dt=1/30)=>{ft.now=Math.max(ft.now,performance.now())+dt*1000;mainFrame(ft.now)};
    ft.endingAt=seconds=>{endings.update(Math.max(0,seconds-endings.seconds));ft.frame()};
    ft.tick=(input,n=1)=>{const live={...input,touch:input.touch??new URLSearchParams(location.search).get('touch')==='1'};for(let i=0;i<n;i++)mmm.driveVehicle(1/120,live)};
    ft.draw=(visible=true)=>{f.group.visible=visible;r.localClippingEnabled=mmm.low&&visible;r.info.reset();mmm.water?.update(camera);r.render(f.group.parent,camera);mmm.water?.settle();mmm.water?.afterRender(camera);return {calls:r.info.render.calls,triangles:r.info.render.triangles}};
    ft.view=(u,v,h,tu,tv,th=1)=>{camera.position.set(s.x+u,h,s.z+v);camera.lookAt(s.x+tu,th,s.z+tv);camera.updateMatrixWorld();for(let i=0;i<3;i++){terrain.update(camera);mmm.trees?.update(terrain.drawnFine,camera.position);}c.roads.update(camera.position);f.update(0,camera.position);ft.draw()};
    ft.clean=(hide=true)=>{for(const id of ['hud','shiftHud','miniMap','relief','gear','endShift','cameraButton','mailButton','mailScore','stopHint','credit','touch']){const e=document.getElementById(id);if(e)e.style.visibility=hide?'hidden':''}};
    ft.fixture=()=>{endings.close();f.judge.reset();ft.place(7,46);ft.stop(240);return endings.busy};
    ft.guard=(u,v,heading,n=1200)=>{endings.close();f.judge.reset();ft.place(u,v,heading);let minU=99,maxU=-99,maxV=-99,minY=99;for(let i=0;i<n;i++){ft.tick({throttle:1,steer:0,handbrake:false});minU=Math.min(minU,c.x-s.x);maxU=Math.max(maxU,c.x-s.x);maxV=Math.max(maxV,c.z-s.z);minY=Math.min(minY,c.y)}return {minU,maxU,maxV,minY,offer:endings.busy}};
    ft.pass=()=>{endings.close();f.judge.reset();ft.place(7,25);let speed=0;for(let i=0;i<1400 && c.z<s.z+58;i++){ft.tick({throttle:1,steer:0,handbrake:false});if(Math.abs(c.z-s.z-46)<.2)speed=c.speed}return {speed,offer:endings.busy}};
    ft.place=(u,v,heading=Math.PI)=>{c.place(s.x+u,s.z+v,heading,s.deckHeight(s.x+u,s.z+v)??undefined);c.speed=0;c.assist=0;c.steerAngle=0};
    ft.stop=(n=400)=>ft.tick({throttle:0,steer:0,handbrake:true},n);
    ft.route=async()=>{
      c.assist=0;const pts=c.roads.roads.find(r=>r.id===922).pts.slice(1).map(([x,z])=>[x,z]);
      pts.push([s.x+2,s.z+3],[s.x+7,s.z+12],[s.x+7,s.z+46]);
      // Follow the real car and settle its land selection. A fixed quay camera leaves the
      // moving controller on coarse, distant triangles that normal driving never uses.
      const follow=async()=>{
        camera.position.set(c.x-Math.sin(c.heading)*18,c.y+12,c.z+Math.cos(c.heading)*18);
        camera.lookAt(c.x,c.y,c.z);camera.updateMatrixWorld();let quiet=0;
        for(let n=0;n<240;n++){
          terrain.update(camera);mmm.trees?.update(terrain.drawnFine,camera.position);c.roads.update(camera.position);
          quiet=terrain.pending===0?quiet+1:0;if(quiet>=3)return;
          await new Promise(r=>setTimeout(r,10));
        }
        throw Error('driving land did not settle');
      };
      await follow();ft.stop(1200);
      let k=0,worst=0,air=0,minY=999,trace=[],maxVy=0,maxStep=0,entryVy=0,entryStep=0,lastY=c.y;
      for(let i=0;i<20000 && !endings.busy;i++){
        if(i%120===0)await follow();
        const [x,z]=pts[k],d=Math.hypot(x-c.x,z-c.z);
        if(d<4 && k<pts.length-1){k++;continue;}
        const target=Math.atan2(x-c.x,-(z-c.z));const err=Math.atan2(Math.sin(target-c.heading),Math.cos(target-c.heading));
        const final=k===pts.length-1,desired=final?Math.min(3,Math.max(0,(d-.2)*.8)):4;
        mmm.driveVehicle(1/120,{throttle:Math.max(-1,Math.min(1,(desired-c.speed)*1.8)),steer:Math.max(-1,Math.min(1,err*2.2)),handbrake:final&&d<.6,touch:new URLSearchParams(location.search).get('touch')==='1'});
        if(i%120===0)trace.push({i,k,u:c.x-s.x,v:c.z-s.z,y:c.y,speed:c.speed,err});
        const step=Math.abs(c.y-lastY),vy=Math.max(Math.abs(c.vy),step*120);lastY=c.y;maxStep=Math.max(maxStep,step);maxVy=Math.max(maxVy,vy);if(c.z-s.z>=-20){entryStep=Math.max(entryStep,step);entryVy=Math.max(entryVy,vy);}
        worst=Math.max(worst,Math.abs(err));air+=Number(c.airborne);minY=Math.min(minY,c.y);
        if(final && d<.6 && Math.abs(c.speed)<.05){ft.stop(300);break;}
      }
      return {k,points:pts.length,worst,air,minY,maxVy,maxStep,entryVy,entryStep,u:c.x-s.x,v:c.z-s.z,y:c.y,speed:c.speed,offer:endings.busy,stopped:f.judge.stopped,trace};
    };
  })()`);
}

export {assert,writeFileSync,out,base,port,sleep,tab,ws,errors,send,read,shot,key,load};
