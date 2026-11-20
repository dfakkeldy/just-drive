#!/usr/bin/env node
// Through tools/check-hikes.sh, or RUN=hikes-check.mjs HUD=1 VIEWS="hikes|mode=explore" WEB_PORT=5243 CDP_PORT=9443 tools/yard-shots.sh 1600 1000
// SHOTS=1: the requested pictures. HIKES_FAMILY=map|phone|paths|area|mail|repeat selects a mutation family.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { hikesPage, sleep } from './hikes-page.mjs';
const [out, first]=process.argv.slice(2), base=new URL(first).origin;
process.env.OUT=out;
const results=[], family=process.env.HIKES_FAMILY??'all';
function check(value,name){results.push({name,pass:!!value});console.log(`${value?'PASS':'FAIL'} ${name}`);if(process.env.HIKES_PROBE===name){const marker=(value?'MUTATION MISSED: ':'MUTATION DETECTED: ')+name;console.error(marker);throw Error(marker);}assert.ok(value,name);}
const run=async(name,query,fn,w=1600,h=1000,init='')=>{if(family!=='all'&&family!==name)return;const p=await hikesPage(base,query,w,h,init);try{await fn(p);check(!p.errors.length,`${name} ${w} has no runtime errors`);}finally{await p.close();}};
await run('map','mode=explore&at=624271,5103301,0',async p=>{
  await p.read(`window.mapHalos=[];window.mapTexts=[];const g=mmm.bigMap.g,orig=g.fillText.bind(g);g.fillText=(...a)=>{mapTexts.push(a[0]);return orig(...a)};const halo=g.strokeText.bind(g);g.strokeText=(...a)=>{mapHalos.push(a[0]);return halo(...a)};window.trailStrokes=0;const layer=mmm.bigMap.layer.getContext('2d'),stroke=layer.stroke.bind(layer);layer.stroke=(...a)=>{if(layer.getLineDash().length)trailStrokes++;return stroke(...a)};`);
  await p.read(`window.driveThrottles=[];const step=mmm.vehicle.update.bind(mmm.vehicle);mmm.vehicle.update=(...args)=>{driveThrottles.push(args[1].throttle);return step(...args)}`);
  await p.key('KeyW');await sleep(1000);await p.tap('KeyM');await sleep(600);
  check(await p.read(`!document.getElementById('bigMap').hidden`),'M opens big map');
  const paused=await p.read(`JSON.stringify([mmm.vehicle.x,mmm.vehicle.z,mmm.vehicle.speed])`);await sleep(700);
  check(await p.read(`JSON.stringify([mmm.vehicle.x,mmm.vehicle.z,mmm.vehicle.speed])`)===paused,'big map pauses the game');
  check(await p.read(`document.getElementById('c').inert&&document.activeElement.closest('#bigMap')!==null&&document.getElementById('bigMap').getAttribute('aria-modal')==='true'`),'map owns focus and makes background inert');
  check(await p.read(`mmm.bigMap.canvas.width===Math.round(mmm.bigMap.w*2)&&mmm.bigMap.canvas.height===Math.round(mmm.bigMap.h*2)`),'map canvas is sharp at Retina ratio');
  check(await p.read(`document.querySelectorAll('#mapIndex [data-map-place]').length===mmm.places.places.length&&document.querySelectorAll('#mapIndex [data-hike]').length===3&&trailStrokes>=mmm.bigMap.lines.length&&mmm.bigMap.lines.length>0&&mmm.bigMap.hitMarks.length===mmm.places.places.length`),'map shows every place and hike');
  console.log('map labels',await p.read('mapTexts'));await p.shot('01-big-map-whole');
  check(await p.read(`mapHalos.includes('Highway 19')&&mapHalos.includes('Mabou Rivers Trail')&&!mapHalos.includes('You are here')&&mapTexts.includes('Highway 19')&&mapTexts.some(t=>t==='Mabou Rivers Trail')&&mapTexts.includes('You are here')&&mapTexts.includes('↑ N')&&mapTexts.some(t=>/ km$/.test(t))`),'map draws road and trail names, heading, scale and north');
  await p.shot('01-big-map-whole');
  const cache=await p.read(`JSON.stringify([mmm.bigMap.cached,mapTexts.length,trailStrokes])`);await sleep(500);check(cache===await p.read('JSON.stringify([mmm.bigMap.cached,mapTexts.length,trailStrokes])'),'idle map keeps static layer');
  await p.read(`mmm.bigMap.view(624271,5103301,4)`);await sleep(200);await p.shot('02-map-village');
  await p.read(`mmm.bigMap.view(620350,5110800,12)`);await sleep(200);await p.shot('03-map-highlands');
  const scale=await p.read('mmm.bigMap.scale');await p.read(`document.getElementById('mapZoomIn').click()`);await sleep(100);check(await p.read('mmm.bigMap.scale')>scale,'map zoom buttons change scale');
  await p.read(`document.getElementById('mapZoomOut').click()`);await sleep(100);
  const before=await p.read('mmm.bigMap.center');const r=await p.read(`(()=>{const r=mmm.bigMap.canvas.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await p.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...r});await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:r.x+80,y:r.y+40});await p.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:r.x+80,y:r.y+40});await sleep(100);
  check(JSON.stringify(await p.read('mmm.bigMap.center'))!==JSON.stringify(before),'drag pans the map');
  const wheel=await p.read('mmm.bigMap.scale');await p.send('Input.dispatchMouseEvent',{type:'mouseWheel',deltaX:0,deltaY:-100,...r});await sleep(100);check(await p.read('mmm.bigMap.scale')>wheel,'wheel zooms the map');
  await p.tap('Escape');check(await p.read(`document.getElementById('bigMap').hidden&&!document.getElementById('c').inert`),'Escape closes map and restores background');
  await p.read('driveThrottles=[]');await sleep(600);check(await p.read('driveThrottles.length>0&&driveThrottles.every(t=>t===0)'),'key held before map does not drive after close');await p.key('KeyW',false);
  await p.tap('KeyM');await p.read(`document.getElementById('mapPlacesToggle').click()`);
  const seen=[];
  for(let i=0;i<30;i++){await p.tap('Tab');seen.push(await p.read(`document.activeElement?.dataset.mapPlace??null`));}
  check(await p.read(`mmm.places.places.every(p=>${JSON.stringify(seen)}.includes(p.id))`),'Tab reaches every map place');
  await p.read(`document.querySelector('[data-map-place="village"]').focus()`);await p.tap('Enter');
  check(await p.read(`!document.getElementById('mapCard').hidden&&document.getElementById('mapCard').textContent.includes('Mabou village')&&document.getElementById('mapGo')!==null`),'Enter opens a place card');await p.shot('04-place-card');
  await p.read(`mmm.bigMap.showCard(mmm.places.places.find(p=>p.id==='highlands-trailhead'))`);
  check(await p.read(`document.getElementById('mapCard').innerText.includes('About 30 to 35 km')&&document.getElementById('mapCard').innerText.includes('Trails change. Ask the people who keep a trail before you go. This is not a map for navigation.')`),'hike card carries facts and exact caution');await p.shot('05-hike-card');
  await p.read(`mmm.bigMap.showCard(mmm.places.places.find(p=>p.id==='rail-access'));document.getElementById('mapGo').click()`);await sleep(350);
  check(await p.read(`document.getElementById('bigMap').hidden&&mmm.vehicle.speed===0&&Math.hypot(mmm.vehicle.vx,mmm.vehicle.vz,mmm.vehicle.vy)<.001&&mmm.roads.nearest(mmm.vehicle.x,mmm.vehicle.z,1,r=>r.kind>=1&&r.kind<=3)?.dist<.01`),'map Go here rests on a road');
  check(await p.read(`document.getElementById('placeArrival').innerText.includes('19.5 km')`),'trailhead arrival adds hike facts');
  check(await p.read(`(()=>{const boxes=['#weatherSet select','#weatherSet [type=time]'].map(s=>document.querySelector(s)),fire=(box,code)=>box.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true,cancelable:true}));const ok=boxes.every(box=>box&&fire(box,'KeyM')&&fire(box,'KeyL'));return ok&&document.getElementById('bigMap').hidden&&!mmm.places.busy})()`),'M and L typed into the weather list and time box stay with them');
  await p.tap('KeyL');check(await p.read(`document.querySelector('#hikesList h3').textContent==='Hikes'&&document.querySelectorAll('#hikesList [data-hike]').length===3&&[...document.querySelectorAll('#hikesList [data-hike]')].every(b=>b.querySelector('strong').textContent.length>5&&/km/.test(b.querySelector('span').textContent)&&b.querySelector('small').textContent.startsWith('Trails change. Ask the people who keep a trail'))&&/Easy/.test(document.querySelector('#hikesList [data-hike] span').textContent)`),'places list has all hikes and facts');await p.read(`document.getElementById('hikesList').scrollIntoView({block:'start'})`);await p.shot('06-places-hikes');await p.tap('Escape');
  await p.read(`const m=document.getElementById('miniMap');if(m.classList.contains('folded'))document.getElementById('miniMapHead').click();`);await sleep(300);
  check(await p.read(`mmm.miniMap.hikeLines.length>0`),'explore corner map receives hike lines');await p.shot('07-corner-map-hike');
  // A real pointer hit on the canvas opens a card, including when another place is nearby.
  await p.tap('KeyM');await p.read(`mmm.bigMap.view(617347.3,5103189.6,5)`);await sleep(200);
  const hit=await p.read(`(()=>{const r=mmm.bigMap.canvas.getBoundingClientRect(),m=mmm.bigMap.hitMarks.find(m=>m.place.id==='west-mabou-beach');return {x:m.x+r.x,y:m.y+r.y}})()`);
  await p.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...hit});await p.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...hit});
  check(await p.read(`document.getElementById('mapCard').dataset.place==='west-mabou-beach'&&!document.getElementById('mapCard').hidden`),'canvas click selects a trailhead');
  // Fit the full set so a displaced label exercises a hit beyond the dot's 24px fallback.
  await p.read(`document.getElementById('mapCard').hidden=true;mmm.bigMap.fit()`);await sleep(150);
  const tag=await p.read(`(()=>{const map=mmm.bigMap,r=map.canvas.getBoundingClientRect(),m=map.hitMarks.find(m=>m.rect&&Math.hypot(m.rect.x+m.rect.w/2-m.x,m.rect.y+m.rect.h/2-m.y)>30);return m?{id:m.place.id,x:r.x+m.rect.x+m.rect.w/2,y:r.y+m.rect.y+m.rect.h/2}:null;})()`);
  check(!!tag,'a displaced place tag is available');
  await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',...{x:tag.x,y:tag.y}});
  const pointed=await p.read(`mmm.bigMap.canvas.style.cursor==='pointer'`);
  await p.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:tag.x,y:tag.y});
  const dragging=await p.read(`mmm.bigMap.canvas.style.cursor===''`);
  await p.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:tag.x,y:tag.y});
  check(await p.read(`document.getElementById('mapCard').dataset.place===${JSON.stringify(tag.id)}&&!document.getElementById('mapCard').hidden`),'canvas click on a place tag opens its card');
  await p.read(`document.getElementById('mapCard').hidden=true`);
  const empty=await p.read(`(()=>{const map=mmm.bigMap,r=map.canvas.getBoundingClientRect();for(let y=60;y<map.h-80;y+=30)for(let x=40;x<map.w-40;x+=30)if(!map.pick([x,y]))return {x:x+r.x,y:y+r.y};})()`);
  await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',...empty});
  check(pointed&&dragging&&await p.read(`mmm.bigMap.canvas.style.cursor===''`),'cursor shows pointer over a tag and grab elsewhere');
  const center=await p.read('mmm.bigMap.center');
  await p.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:tag.x,y:tag.y});
  await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:tag.x+40,y:tag.y+20});
  await p.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:tag.x+40,y:tag.y+20});
  check(await p.read(`document.getElementById('mapCard').hidden`)&&JSON.stringify(await p.read('mmm.bigMap.center'))!==JSON.stringify(center),'drag from a tag pans without opening a card');

});
for(const [w,h]of [[844,390],[390,844]].filter(([w])=>!process.env.HIKES_WIDTH||w===Number(process.env.HIKES_WIDTH)))await run('phone','mode=explore&touch=1&at=624271,5103301,0',async p=>{
  await p.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  const boxes=await p.read(`['hud','gear','placesButton','bigMapButton','miniMap','radio','placeArrival','tcTrack','tcGo','tcBrake','tcReset','tcView','tcHorn'].map(id=>{const e=document.getElementById(id);if(!e||e.hidden||!e.getClientRects().length||getComputedStyle(e).visibility==='hidden')return null;const r=e.getBoundingClientRect();return {id,x:r.left,y:r.top,r:r.right,b:r.bottom}}).filter(Boolean)`);
  const faults=[];for(let i=0;i<boxes.length;i++){const a=boxes[i];if(a.x<0||a.y<0||a.r>w+1||a.b>h+1)faults.push(a.id+' offscreen');for(const b of boxes.slice(i+1))if(Math.min(a.r,b.r)-Math.max(a.x,b.x)>1&&Math.min(a.b,b.b)-Math.max(a.y,b.y)>1)faults.push(a.id+' overlaps '+b.id);}
  console.log('phone boxes',JSON.stringify(boxes));check(faults.length===0,`phone ${w} controls do not overlap`);
  // On a phone the map is in the Places card: the top row keeps main's controls (a 320 px phone has no room for MAP).
  check(await p.read(`document.getElementById('bigMapButton').hidden&&!document.querySelector('#phoneTop #bigMapButton')`),`phone ${w} top row has no MAP button`);
  await p.touch('#placesButton');await sleep(250);
  check(await p.read(`(()=>{const e=document.getElementById('placesMap'),r=e.getBoundingClientRect(),at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !document.getElementById('placesPanel').hidden&&r.width>=56&&r.height>=56&&r.top>=0&&r.bottom<=innerHeight&&(at===e||e.contains(at))})()`),`phone ${w} MAP control is reachable`);
  await p.touch('#placesMap');await sleep(250);check(await p.read(`!document.getElementById('bigMap').hidden&&document.getElementById('placesPanel').hidden`),`phone ${w} touch opens map`);
  await p.shot(w===844?'13-map-phone-landscape':'14-map-phone-portrait');
  const scale=await p.read('mmm.bigMap.scale'), y=await p.read(`mmm.bigMap.canvas.getBoundingClientRect().y+mmm.bigMap.h/2`);
  await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:w/2-40,y},{id:2,x:w/2+40,y}]});
  await p.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:w/2-90,y},{id:2,x:w/2+90,y}]});
  await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(200);
  check(await p.read('mmm.bigMap.scale')>scale,`phone ${w} pinch zooms`);
  await p.touch('#mapPlacesToggle');await p.read(`document.querySelector('[data-map-place="rail-access"]').scrollIntoView({block:'center'})`);await p.touch('[data-map-place="rail-access"]');await p.shot(`hike-phone-${w}`);await p.touch('#mapGo');
  check(await p.read(`document.getElementById('bigMap').hidden&&mmm.vehicle.speed===0&&mmm.roads.nearest(mmm.vehicle.x,mmm.vehicle.z,1,r=>r.kind<=3)?.dist<.01`),`phone ${w} touch Go here rests on road`);
},w,h);
await run('paths','mode=explore&cam=619930.4,5111043.4,3,350,-14,60&camground=1',async p=>{
  await sleep(1200);
  console.log('path state',await p.read(`({visible:mmm.footpaths.mesh.visible,vertices:mmm.footpaths.mesh.geometry.getAttribute('position').count,casts:mmm.footpaths.mesh.castShadow,surface:mmm.terrain.surfaceAt(-4340.6,-7742.4)})`));await p.shot('08-highlands-footpath');
  check(await p.read(`mmm.footpaths.mesh.visible&&mmm.footpaths.mesh.geometry.getAttribute('position').count>0&&!mmm.footpaths.mesh.castShadow`),'ground footpath is drawn in one mesh');await p.shot('08-highlands-footpath');
  for(const exag of [1,1.5,3]){
    await p.navigate(`mode=explore&exag=${exag}&cam=619930.4,5111043.4,3,350,-14,60&camground=1`);await sleep(600);
    check(await p.read(`(()=>{const a=mmm.footpaths.mesh.geometry.getAttribute('position');return a.count>0&&Array.from({length:a.count},(_,i)=>Math.abs(a.getY(i)-(mmm.terrain.meshHeightAt(a.getX(i),a.getZ(i))+.025))).every(d=>d<.04)})()`),`footpath follows drawn ground at exag ${exag}`);
  }
});
await run('area','mode=explore&area=porthood&x=1',async p=>{await p.tap('KeyM');await sleep(300);check(await p.read(`(()=>{const own=mmm.places?.places.filter(p=>!p.trip)??[];return !document.getElementById('bigMap').hidden&&mmm.bigMap.hikes.length===0&&mmm.bigMap.roads.roads.length>0&&mmm.bigMap.places.length===own.length&&mmm.bigMap.places.every(p=>own.includes(p))&&!mmm.bigMap.places.some(p=>['village','rail-access','west-mabou-beach','highlands-trailhead'].includes(p.id))})()`),'other area map shows only its own places and no hikes');});
await run('area','mode=explore&area=judique&x=1',async p=>{await p.tap('KeyM');await sleep(300);check(await p.read(`!document.getElementById('bigMap').hidden&&mmm.bigMap.places.length>0&&mmm.bigMap.places.length===mmm.places.places.length&&mmm.bigMap.hikes.length===0`),'an area with its own places shows them on the map and in the list');});
await run('mail','mode=mail&at=624271,5103301,0',async p=>{
  check(await p.read(`mmm.miniMap.hikeLines.length===0&&!document.getElementById('bigMap')&&!document.getElementById('bigMapButton')`),'mail corner map receives no hikes or planning UI');
  const thrownBefore=await p.read('mmm.shift.mail.thrown');await p.tap('KeyM');await sleep(400);check(await p.read(`mmm.shift.mail.thrown===${thrownBefore}+1&&mmm.shift.elapsed>0&&!document.getElementById('bigMap')`),'mail M retains mail behavior');
});
await run('repeat','mode=explore&at=624271,5103301,0',async p=>{
  await p.read(`window.repeatInputs=[];window.sawRepeat=false;addEventListener('keydown',e=>{if(e.code==='KeyW'&&e.repeat)window.sawRepeat=true},true);const step=mmm.vehicle.update.bind(mmm.vehicle);mmm.vehicle.update=(...args)=>{repeatInputs.push(args[1].throttle);return step(...args)}`);
  await p.key('KeyW');await sleep(800);await p.tap('KeyM');await sleep(100);await p.tap('Escape');
  await p.read('repeatInputs=[]');
  await p.send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyW',key:'w',windowsVirtualKeyCode:87,autoRepeat:true});await sleep(500);
  check(await p.read('sawRepeat&&repeatInputs.length>0&&repeatInputs.every(t=>t===0)'),'map ignores held-key repeat after Escape');
  await p.key('KeyW',false);await p.read('repeatInputs=[]');await p.key('KeyW');await sleep(300);await p.key('KeyW',false);
  check(await p.read('repeatInputs.some(t=>t>0)'),'released key drives again');
});
writeFileSync(`${out}/hikes-results-${family}.json`,JSON.stringify(results,null,2));
