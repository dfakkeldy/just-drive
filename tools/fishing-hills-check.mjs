#!/usr/bin/env node
// Permanent full-road, physical-step and departure coverage at every Hill height setting.
import {assert,writeFileSync,out,port,tab,ws,errors,send,read,shot,key,load} from './fishing-browser.mjs';
import {wheelRays} from './fishing-wheel-rays.mjs';
const results=[];
try {
  await send('Runtime.enable');await send('Page.enable');
  for(const mode of ['desktop','phone'])for(const hill of [1,1.5,2,2.5]){
    await load(`&fishingCheck=1&exag=${hill}&q=${mode==='phone'?'low':'high'}&touch=${mode==='phone'?1:0}`);
    await read('ft.clean();ft.view(-3,-50,12,7,25,2)');
    if(mode==='desktop'&&hill===1.5)await shot('wharf-road');
    const surface=await read(`(()=>{let overshoot=-99;for(let u=2.1;u<12;u+=.5)for(let v=10.1;v<64;v+=.5){const h=ft.terrain.meshHeightAt(ft.s.x+u,ft.s.z+v);if(h!==null)overshoot=Math.max(overshoot,h-ft.s.top)}return overshoot})()`);
    assert.ok(surface<.001,'R14 rendered land does not project through cap '+surface);
    const drive=await read('ft.route()');writeFileSync(`${out}/hill-drive-${mode}-${hill}.json`,JSON.stringify(drive,null,2));
    const row={mode,hill,meshOvershoot:surface,...drive,trace:undefined,top:await read('ft.s.top'),aboveWater:await read('ft.s.top+.2')};results.push(row);
    console.log('HILL',JSON.stringify(row));
    assert.ok(drive.offer && drive.air===0,'R14 real road and stop offer at hill '+hill);
    assert.ok(drive.entryStep<.035 && drive.entryVy<3,'R14 no entrance jolt '+JSON.stringify(row));
    assert.ok(Math.abs(drive.y-row.top)<.02 && row.aboveWater<=2.8+.001,'R14 capped deck carries car');
    await read('ft.endings.close();ft.clean();ft.view(48,97,7,11,34,2)');
    if(mode==='desktop'&&(hill===1 || hill===2.5))await shot('wharf-water-hill-'+hill);
    const guard=await read('ft.guard(7,15,Math.PI)');assert.ok(guard.maxV<61.71 && guard.minY>=row.top-.04,'R14 guard at hill '+hill);
    const rays=await wheelRays(read);for(const r of rays)assert.ok(r.count>0 && r.min>=-.051 && r.max<=.051,'R18 drawn wheel-ray gap '+JSON.stringify({mode,hill,...r}));
    row.rays=rays;
    await read('ft.fixture();ft.view(28,15,15,9,48,1.4)');await key('Enter','Enter',13);
    assert.ok(await read('ft.endings.finished'),'R14 acceptance at hill '+hill);
    await read('ft.endingAt(4)');if(mode==='desktop'&&hill===1.5)await shot('ending-start');
    await read('ft.endingAt(105)');if(mode==='desktop'&&hill===1.5)await shot('ending-middle');
    const duration=await read('ft.f.departureDuration()');await read(`ft.endingAt(${duration})`);
    if(mode==='desktop'&&hill===1.5)await shot('ending-end');
    assert.ok(await read('ft.camera.position.y<8 && ft.f.art.boat.position.x < -1800 && Math.abs(ft.f.art.boat.position.y+.2)<.06'),'R14 sea-height boat, low camera and gulf at hill '+hill);
    // The camera really is behind the boat, looking forward rather than down at the map.
    const view=await read(`(()=>{const f=ft.f,b=f.art.boat.position,c=f.course,dx=ft.camera.position.x-f.site.x-b.x,dz=ft.camera.position.z-f.site.z-b.z;return {astern:dx*c.de-dz*c.dn,height:ft.camera.position.y+.2,pitch:ft.camera.rotation.x}})()`);
    assert.ok(view.astern< -20 && view.height<6 && Math.abs(view.pitch)<.3,'R15 low astern course view '+JSON.stringify(view));
    await key('Space',' ',32);await read('ft.frame()');
    assert.ok(await read('!ft.f.group.visible && !ft.r.localClippingEnabled'),'R13 distant route disables site clipping as well as the model');
  }
  assert.equal(errors.length,0,errors.join('\n'));writeFileSync(`${out}/hill-results.json`,JSON.stringify(results,null,2));
  console.log('PASS four Hill heights in desktop and phone modes: full road from rest, fixed-step jolt/flight bounds, guards, offer, water-level boat and complete low-astern departure.');
} finally {await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);ws.close();}
