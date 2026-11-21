#!/usr/bin/env node
// Real-page mode, session, places and phone regression. Run through yard-shots.sh:
// RUN=explore-check.mjs HUD=1 VIEWS="explore|mode=explore" WEB_PORT=5241 CDP_PORT=9441 tools/yard-shots.sh 1600 1000
// EXPLORE_BASE=1 captures the original mail UI before implementation. SHOTS=1 captures the test views.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { assertMailCar } from './mail-car-body.mjs';
const [out, first] = process.argv.slice(2), base = new URL(first).origin, port = process.env.CDP_PORT ?? '9441';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const missing = ['shiftHud','stopHint','cameraButton','endShift','mailButton','mailScore','shiftReport','photoTag','photoFlash','startOver','relief','reliefCard','doorPrompt','interiorHud','endingFrame'];
const visible = `id => { const e=document.getElementById(id); if(!e || e.hidden)return false;const r=e.getBoundingClientRect();return r.width>0 && r.height>0 && getComputedStyle(e).visibility!=='hidden' && getComputedStyle(e).display!=='none'; }`;
// Captured from the real page at b2a491b before the mode seam. Hash avoids duplicating its credits.
// END SHIFT now lives in closed Settings; all other shown mail ids and the title hash stay pinned.
const mailBaseline = {"hash":"80ae3b403ba84a165e6735231c15bc9190cc97eb3f048274cddf9d71ea698f1a","shown":["shiftHud","stopHint","cameraButton","mailButton","mailScore","photoFlash","relief"]};
const results = [], ownedTabs = [];
process.on('uncaughtException', async error => { console.error(error.stack); for(const tab of ownedTabs){try{await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);tab.ws?.close();}catch{}}process.exit(1); });
function check(value, name) { results.push({name,pass:!!value}); console.log(`${value?'PASS':'FAIL'} ${name}`); if(process.env.EXPLORE_PROBE===name)throw new Error((value?'MUTATION MISSED: ':'MUTATION DETECTED: ')+name); }

function watchPictures() {
 const {renderer, camera, drone, vehicle} = window.mmm;
 const canvas = renderer.domElement;
 const {render} = renderer, {toBlob} = canvas, {click} = HTMLAnchorElement.prototype;
 let draw, capture;
 window.pictures = [];
 window.pictureReads = 0;
 window.pictureShares = 0;
 window.pictureDownloads = 0;
 renderer.render = function (scene, view) {
  if (view === camera) draw = {drone: drone.group.visible, car: vehicle.car.root.visible};
  return render.call(this, scene, view);
 };
 canvas.toBlob = function (...args) {
  window.pictureReads++;
  capture = {draw, drone: drone.group.visible};
  return toBlob.apply(this, args);
 };
 async function inspect(blob, filename, delivery) {
  const atRead = capture, bitmap = await createImageBitmap(blob);
  const sample = document.createElement('canvas'); sample.width = sample.height = 8;
  const ctx = sample.getContext('2d'); ctx.drawImage(bitmap, 0, 0, 8, 8);
  const rgba = ctx.getImageData(0, 0, 8, 8).data;
  const colors = new Set();
  for (let i = 0; i < rgba.length; i += 4) colors.add(rgba.slice(i, i + 4).join(','));
  const valid = blob.type === 'image/png' && blob.size > 0 && bitmap.width === canvas.width && bitmap.height === canvas.height && colors.size > 1;
  bitmap.close();
  window.pictures.push({valid, filename, delivery, atRead, restored: drone.group.visible});
 }
 HTMLAnchorElement.prototype.click = function () {
  if (this.download?.endsWith('.png')) {
   window.pictureDownloads++;
   const {download, href} = this;
   void fetch(href).then(res => res.blob()).then(blob => inspect(blob, download, 'download'));
  } else click.call(this);
 };
 Object.defineProperties(navigator, {
  canShare: {value: ({files}) => window.pictureShare === true && files.length === 1 && files[0].type === 'image/png'},
  share: {value: async ({files}) => {
   window.pictureShares++;
   if (window.cancelPicture) throw Object.assign(new Error('Share cancelled'), {name: 'AbortError'});
   await inspect(files[0], files[0].name, 'share');
  }},
 });
 window.picturePreservesBuffer = renderer.getContext().getContextAttributes().preserveDrawingBuffer;
}

async function checkPictureOptions() {
 const { savePicture } = await import('/src/save-picture.ts');
 const canvas = document.createElement('canvas');
 canvas.width = 2; canvas.height = 1;
 const context = canvas.getContext('2d');
 let overlayCanvas, filename, png;
 const click = HTMLAnchorElement.prototype.click;
 HTMLAnchorElement.prototype.click = function () {
  filename = this.download;
  png = fetch(this.href).then(response => response.blob()).then(blob => createImageBitmap(blob));
 };
 try {
  const saved = await savePicture({
   canvas, place: 'Mabou', touch: false, prefix: 'sun-seeker', when: new Date('2026-07-01T02:30Z'),
   render: () => { context.fillStyle = '#00f'; context.fillRect(0, 0, 2, 1); },
   overlay: (ctx, width, height) => {
    overlayCanvas = ctx.canvas;
    ctx.fillStyle = '#f00'; ctx.fillRect(width - 1, 0, 1, height);
   },
  });
  const bitmap = await png;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return saved && filename === 'sun-seeker-mabou-2026-06-30-2330.png'
    && canvas.width === 2 && canvas.height === 1 && overlayCanvas?.width === 0 && overlayCanvas.height === 0
    && String(context.getImageData(0, 0, 2, 1).data) === '0,0,255,255,255,0,0,255';
 } finally {
  HTMLAnchorElement.prototype.click = click;
 }
}

async function picture(p, index, delivery, flying) {
 for (let attempt = 0; attempt < 40 && !await p.read(`pictures.length > ${index}`); attempt++) await sleep(125);
 const result = await p.read(`pictures[${index}]`);
 const title = `${flying ? 'drone' : 'drive'} ${delivery}`;
 check(result?.valid && /^just-drive-mabou-\d{4}-\d\d-\d\d-\d{4}\.png$/.test(result.filename) && result.delivery === delivery,
  `${title} delivers a non-blank PNG with an area filename`);
 check(result?.atRead?.draw?.drone === false && result.atRead.drone === false && result.restored === flying &&
  await p.read(`!picturePreservesBuffer && mmm.drone.group.visible === ${flying}`),
  `${title} hides the drone at draw and read, then restores it`);
 if (!flying) check(result?.atRead?.draw?.car, `${title} leaves the car in the picture`);
}

async function page(query, width=1600, height=1000, init='') {
 const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
 const ws=new WebSocket(tab.webSocketDebuggerUrl);ownedTabs.push({id:tab.id,ws});await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
 let seq=0;const waiting=new Map(),errors=[];
 ws.onmessage=({data})=>{const d=JSON.parse(data);if(d.id){waiting.get(d.id)?.(d);waiting.delete(d.id);}if(d.method==='Runtime.exceptionThrown')errors.push(d.params.exceptionDetails.exception?.description??d.params.exceptionDetails.text);};
 const send=(method,params={})=>new Promise((res,rej)=>{const id=++seq;const timer=setTimeout(()=>{waiting.delete(id);rej(new Error('CDP timeout '+method));},45000);waiting.set(id,d=>{clearTimeout(timer);res(d);});ws.send(JSON.stringify({id,method,params}));});
 const read=async expression=>{const d=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(d.result?.exceptionDetails)throw new Error(JSON.stringify(d.result.exceptionDetails));return d.result?.result?.value;};
 const settle=async()=>{for(let i=0;i<160;i++){await sleep(500);if(await read('document.title')==='settled')return;}console.error('Startup diagnostic',await read(`(()=>{const r=window.mmm?.vehicle?.roads;return {mode:window.mmm?.gameMode,roads:r?.roads?.length,main:r?.roads?.filter(x=>x.name==='Highway 19').map(x=>({name:x.name,first:x.pts[0]})),near:r?.nearest(0,0,300,x=>x.kind===1&&x.name==='Highway 19')};})()`));throw new Error('Page did not settle '+query+' '+errors.join('\n'));};
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<1000});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`try { if(!sessionStorage.exploreCheck){localStorage.clear();sessionStorage.exploreCheck='1';} } catch {}\n${init}`});
 await send('Page.navigate',{url:`${base}/?${query}`});await settle();
 if(process.env.EXPLORE_EXPECT_MUTATION){
  let seen=false;
  for(let i=0;i<4;i++){
   if(JSON.stringify(await read('globalThis.__mmmMutationSources'))===JSON.stringify([process.env.EXPLORE_EXPECT_MUTATION])){seen=true;break;}
   await sleep(500);await send('Page.reload',{ignoreCache:true});await settle();
  }
  assert.ok(seen,'The intended Explore source mutation was not loaded');
 }
 const key=async(code,down)=>send('Input.dispatchKeyEvent',{type:down===false?'keyUp':'keyDown',code,key:code.startsWith('Key')?code.slice(3).toLowerCase():code,windowsVirtualKeyCode:code==='Enter'?13:code==='Escape'?27:code==='Tab'?9:code.startsWith('Key')?code.charCodeAt(3):32});
 const tap=async code=>{await key(code);await key(code,false);};
 const shot=async name=>{if(process.env.SHOTS==='1')writeFileSync(`${out}/${name}.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));};
 return {read,send,key,tap,shot,settle,errors,close:async()=>{await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);ws.close();const at=ownedTabs.findIndex(x=>x.id===tab.id);if(at>=0)ownedTabs.splice(at,1);}};
}
const titleState = `(() => {const root=document.getElementById('titleCard');return {heading:root.querySelector('h1').textContent,tag:root.querySelector('.tag').textContent,description:root.querySelector('h1 + p').textContent,rows:[...root.querySelectorAll('dl>*')].map(e=>e.textContent),start:root.querySelector('#titleStart').textContent,legal:root.querySelector('#titleLegal').innerHTML};})()`;
if(process.env.EXPLORE_BASE==='1') {
 const p=await page('title=1');const title=await p.read(titleState);
 await p.read(`document.getElementById('titleStart').click()`);await sleep(600);
 const shown=await p.read(`${JSON.stringify(missing)}.filter(${visible})`);
 writeFileSync(`${out}/mail-baseline.json`,JSON.stringify({title,shown},null,2));
 console.log('BASE mail visible',JSON.stringify(shown));console.log('BASE title',JSON.stringify(title));await p.close();process.exit(0);
}
// Exported so the mutation runner can run only the affected page family.
const family=process.env.EXPLORE_FAMILY??'all';
if(family==='all'||family==='mail'){
 const p=await page('mode=mail&title=1');
 const snapshot=await p.read(titleState), baseline=mailBaseline;
 console.log('MAIL_TITLE', JSON.stringify({rows:snapshot.rows.filter((_,i)=>i%2===0),heading:snapshot.heading,tag:snapshot.tag,start:snapshot.start,legal:snapshot.legal.slice(0,120)}));
 check(snapshot.heading==='Mabou Mail Madness'&&snapshot.tag==='A route you cannot win'&&snapshot.start==='Start the shift'&&snapshot.rows.length===(snapshot.rows.includes('T')?22:20)&&snapshot.rows.includes('M or E')&&snapshot.rows.includes('Enter')&&!snapshot.rows.includes('L')&&snapshot.legal.includes('A work of satire')&&snapshot.legal.includes('Not affiliated with any postal service'),'mail title keeps its own heading, key rows, start button and satire notice');
 check(await p.read(`document.querySelector('#titleLegal > p:first-child#titleContact a')?.getAttribute('href')==='mailto:justdrive@fakkeldy.ca'&&document.getElementById('titleContact').textContent==='Something wrong, or you want a place removed? Write to justdrive@fakkeldy.ca.'`),'mail credits begin with the contact line');
 check(await p.read(`document.querySelector('#titleContact + #titleAbout a')?.getAttribute('href')==='https://mmm.fakkeldy.ca/about'`),'mail credits link the mail About page');
 check(await p.read(`document.querySelector('#titleAbout #titleHelp')?.getAttribute('href')==='https://mmm.fakkeldy.ca/help'`),'mail credits link the mail Help page');
 await p.shot('01-mail-title');await p.read(`document.getElementById('titleStart').click()`);await sleep(700);
 check(JSON.stringify(await p.read(`${JSON.stringify(missing)}.filter(${visible})`))===JSON.stringify(baseline.shown),'mail visible elements equal base');
 check(await p.read(`!document.getElementById('placesButton')&&!document.getElementById('placesPanel')&&!document.getElementById('placeArrival')`),'mail has no places UI');
 check(await p.read(`mmm.shift.stops>0 && mmm.shift.career.day===1`),'clean profile still starts mail day one');
 const elapsed=await p.read('mmm.shift.elapsed');await sleep(1200);check(await p.read('mmm.shift.elapsed')>elapsed,'mail clock still runs');
 check(p.errors.length===0,'mail has no runtime exceptions');await p.close();
}
if(family==='all'||family==='explore'){
 const p=await page('mode=explore');
 check(await p.read(`!!document.getElementById('title')&&!document.getElementById('title').hidden`),'mode-only query shows title');
 check((await p.read(titleState)).rows.includes('O'),'explore title lists O');
 check(await p.read(`(async()=>{const {EXPLORE_TITLE}=await import('/src/mode.ts');return document.querySelector('#title h1').textContent===EXPLORE_TITLE&&document.getElementById('titleStart').textContent==='Start driving'})()`),'explore title and start text');
 check(await p.read(`document.getElementById('titleCard').innerText.includes('A toy for getting a feel for the place. It is not a map for navigation or for safety. Roads and trails can differ on the day.')&&!document.getElementById('titleCard').innerText.includes('satire')&&!document.getElementById('titleLegal').textContent.includes('postal service')`),'explore caution is visible and mail satire is absent');
 check(await p.read(`document.querySelector('#titleLegal > p:first-child#titleContact a')?.getAttribute('href')==='mailto:justdrive@fakkeldy.ca'&&document.getElementById('titleContact').textContent==='Something wrong, or you want a place removed? Write to justdrive@fakkeldy.ca.'`),'explore credits begin with the contact line');
 await p.shot('02-explore-title');await p.read(`document.getElementById('titleStart').click()`);await sleep(800);
 check((await p.read(`${JSON.stringify(missing)}.filter(${visible})`)).length===0,'explore hides every mail element');
 check(await p.read(`(()=>{const ids=['bigMapButton','pauseButton','placesButton','gear'],boxes=ids.map(id=>document.getElementById(id)?.getBoundingClientRect());return boxes.every((b,i)=>b&&b.height===44&&b.top===boxes[0].top&&(i===0||Math.abs(b.left-boxes[i-1].right-8)<.1)&&document.getElementById(ids[i]).contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)))})()`),'desktop MAP, PAUSE, PLACES and gear share one clear row');
 check(await p.read(`!document.getElementById('relief')&&!document.getElementById('doorPrompt')&&!document.getElementById('endingFrame')`),'explore never creates mail-only UI');
 check(await p.read(`mmm.shift.stops===0&&!mmm.shift.ended&&mmm.shift.elapsed===0&&mmm.shift.career.day===0&&mmm.shift.complaints.all.length===0`),'explore has no shift or complaints');
 const start=await p.read(`({x:mmm.vehicle.x,z:mmm.vehicle.z,heading:mmm.vehicle.heading})`);
 check(await p.read(`mmm.places.roads.nearest(mmm.vehicle.x,mmm.vehicle.z,1)?.road.name==='Highway 19'`),'explore village start is on the main road');
 const state=`JSON.stringify([mmm.shift.elapsed,mmm.shift.ended,mmm.shift.damage.total,mmm.shift.evidence.photos.length,mmm.shift.complaints.all.length,mmm.vehicle.x,mmm.vehicle.z,mmm.vehicle.heading])`;
 const before=await p.read(state);for(const key of ['KeyE','KeyC','KeyB','KeyG','Enter'])await p.tap(key);await sleep(1500);
 check(await p.read(state)===before,'mail keys do nothing and explore clock stays zero');
 check(await p.read(`document.getElementById('hud').textContent.includes('O: save picture')`),'drive HUD explains O');
 check(await p.read(`(${checkPictureOptions})()`),'picture options stamp the chosen Halifax time, draw the overlay and release its canvas');
 await p.read(`(${watchPictures})()`);
 await p.tap('KeyO'); await picture(p, 0, 'download', false);
 await p.tap('KeyF'); await sleep(300);
 check(await p.read(`mmm.drone.active && mmm.drone.group.visible && !document.getElementById('droneHints').hidden && [...document.querySelectorAll('#droneHints dt')].some(e=>e.textContent==='O'&&e.nextElementSibling?.textContent==='Save picture')`),'drone is visible and drone keys explain O before capture');
 await p.tap('KeyO'); await picture(p, 1, 'download', true);
 check(await p.read(`document.getElementById('savePictureStatus').textContent === 'Picture saved'`),'save feedback appears');
 await p.tap('KeyF'); await sleep(300);
 // Use Mabou's quiet indoor adapter to make entry occur in the same task as the key, then leave after an indoor frame.
 check(await p.read(`(async()=> {
   const reads = pictureReads;
   const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
   dispatchEvent(new KeyboardEvent('keydown',{code:'KeyO',key:'o'}));
   mmm.interiors.busy = true;
   await frame();
   mmm.interiors.busy = false;
   await frame();
   return pictureReads === reads;
 })()`), 'entering an interior discards the queued picture');
 await p.read(`mmm.shift.damage.hit('impact',30);mmm.shift.damage.drive(40,30,'washboard');mmm.shift.damage.seed('window,alignment');`);
 check(await p.read(`mmm.shift.damage.total===0&&!mmm.shift.damage.windowStuck&&!mmm.shift.damage.pulls&&!mmm.vehicle.damageActive`),'explore damage never accrues');
 await assertMailCar(p.read,'blender','explore');      // the lamp below is the Blender car's: a fallback car fails here
 check(await p.read(`mmm.vehicle.car.beacon.material.emissiveIntensity===0`),'explore beacon is off');
 check(await p.read(`!mmm.vehicle.car.root.parent.getObjectByName('Mail and delivery dings')&&!mmm.vehicle.car.root.parent.getObjectByName('Two months of old flyers')`),'explore has no paper meshes');
 await p.key('KeyW');await sleep(700);await p.key('KeyW',false);const comparison=await p.read(`({x:mmm.vehicle.x,z:mmm.vehicle.z,heading:mmm.vehicle.heading})`);await p.shot('03-explore-village');await p.read(`mmm.vehicle.restart(${start.x},${start.z},${start.heading});mmm.vehicle.speed=0`);await sleep(300);
 check(await p.read(`document.getElementById('placeArrival').innerText.includes('Mabou village')&&!document.getElementById('placeArrival').hidden`),'arrival card appears at village');await p.shot('04-arrival');
 check(await p.read(`document.querySelector('[data-place="village"]').getAttribute('aria-current')==='location'&&document.querySelector('[data-place="village"] .youAreHere').textContent==='You are here'`),'Places marks the current village');
 await p.tap('KeyL');await p.read(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 check(await p.read(`!document.getElementById('placesPanel').hidden&&document.querySelector('[data-place="village"]').getAttribute('aria-current')==='location'&&document.querySelector('[data-place="village"] .youAreHere')?.textContent==='You are here'`),'open Places keeps the current village');
 check(await p.read(`document.getElementById('placeArrival').hidden||getComputedStyle(document.getElementById('placeArrival')).display==='none'`),'open Places hides the arrival toast');
 check(await p.read(`(()=>{const map=getComputedStyle(document.getElementById('placesMap')),close=getComputedStyle(document.getElementById('placesClose')),row=getComputedStyle(document.querySelector('#placesList button'));return map.backgroundColor==='rgba(0, 0, 0, 0)'&&map.borderTopColor!==row.borderTopColor&&close.backgroundColor==='rgba(0, 0, 0, 0)'&&close.borderTopColor===map.borderTopColor;})()`),'Places map and Close use quiet outlines distinct from place rows');
 await p.tap('Escape');
 for(const id of ['settings','pauseScreen','bigMap']){
  await p.read(`(()=>{const e=document.getElementById('${id}');if('${id}'==='settings')e.classList.add('open');else e.hidden=false;})()`);
  check(await p.read(`getComputedStyle(document.getElementById('placeArrival')).display==='none'`),'arrival stays hidden under '+id);
  await p.read(`(()=>{const e=document.getElementById('${id}');if('${id}'==='settings')e.classList.remove('open');else e.hidden=true;})()`);
 }
 await p.read(`mmm.vehicle.restart(${start.x+400},${start.z},${start.heading})`);await sleep(700);
 check(await p.read(`document.getElementById('placeArrival').hidden`),'arrival card leaves with player');
 await p.read(`mmm.vehicle.restart(${start.x},${start.z},${start.heading})`);await sleep(800);
 // Observe the actual arguments entering the existing MiniMap, plus its real 2D label drawing.
 await p.read(`window.markLabels=[];window.marksSeen=[];const old=mmm.miniMap.update.bind(mmm.miniMap);mmm.miniMap.update=(...a)=>{window.marksSeen=a[5];return old(...a)};const c=document.getElementById('miniMapCanvas').getContext('2d'),text=c.fillText.bind(c);c.fillText=(...a)=>{window.markLabels.push(a[0]);return text(...a)};document.getElementById('miniMapCanvas').click();document.getElementById('miniMapCanvas').click()`);await sleep(900);
 check(await p.read(`window.marksSeen.length===mmm.places.places.length&&mmm.places.places.every(p=>marksSeen.some(m=>m.label===p.name))`),'all place marks reach minimap');
 check(await p.read(`markLabels.includes('Mabou village')&&markLabels.every(l=>!mmm.places.places.every(p=>p.name!==l)||/^(?:[0-9 mk.N]+|[ESW])$/.test(l))&&mmm.miniMap.labels.length>=2&&mmm.miniMap.labels.length<=4`),'minimap draws a few place labels');await p.shot('06-place-map');
 check(await p.read(`['N','E','S','W'].every(letter=>markLabels.includes(letter))`),'minimap draws all four compass letters');
 await p.key('KeyW');await sleep(1800);
 check(await p.read(`Math.hypot(mmm.vehicle.x-${start.x},mmm.vehicle.z-${start.z})>1&&Math.abs(mmm.vehicle.speed)>0.5`),'W drives in explore');
 // W stays held from before the list opens until after it closes: the pause itself must clear the held key.
 await p.tap('KeyL');await sleep(250);
 check(await p.read(`!document.getElementById('placesPanel').hidden&&document.querySelectorAll('#placesList button').length===mmm.places.places.length`),'L opens all places');await p.shot('05-places-list');
 const paused=await p.read(`JSON.stringify([mmm.vehicle.x,mmm.vehicle.z,mmm.vehicle.speed])`);await sleep(800);
 check(await p.read(`JSON.stringify([mmm.vehicle.x,mmm.vehicle.z,mmm.vehicle.speed])`)===paused,'places panel pauses motion and clears held input');
 await p.tap('Escape');check(await p.read(`document.getElementById('placesPanel').hidden`),'Escape closes places');const freed=await p.read(`Math.abs(mmm.vehicle.speed)`);await sleep(900);check(await p.read(`Math.abs(mmm.vehicle.speed)`)<=freed+.01,'a key held before the list opened does not drive after it closes');await p.key('KeyW',false);
 await p.read(`document.getElementById('placesButton').click()`);await p.tap('Tab');await p.tap('Enter');await sleep(500);
 check(await p.read(`document.getElementById('placesPanel').hidden&&mmm.vehicle.speed===0&&Math.hypot(mmm.vehicle.vx,mmm.vehicle.vz)<.001&&mmm.places.roads.nearest(mmm.vehicle.x,mmm.vehicle.z,1,r=>r.kind<=3)?.dist<.01&&Math.abs(mmm.vehicle.heading-mmm.places.roads.nearest(mmm.vehicle.x,mmm.vehicle.z,1,r=>r.kind<=3)?.heading)<.001&&document.getElementById('placeArrival').innerText.includes('Mabou Rivers Trail')`),'keyboard place choice jumps onto road at rest along road');
 for(const id of ['harbour-view','village']){await p.read(`document.getElementById('placesButton').click();document.querySelector('[data-place="${id}"]').click()`);await p.settle();check(await p.read(`mmm.vehicle.speed===0&&mmm.places.roads.nearest(mmm.vehicle.x,mmm.vehicle.z,1,r=>r.kind<=3)?.dist<.01`),`touch/click jump ${id} rests on road`);}
 const village={x:comparison.x,z:comparison.z,h:comparison.heading};
 await p.send('Page.navigate',{url:`${base}/?mode=mail&at=${village.x+624271},${5103301-village.z},${village.h*180/Math.PI}`});await p.settle();await p.shot('09-mail-village');
 check(p.errors.length===0,'explore has no runtime exceptions');await p.close();
}
if(family==='all'||family==='switch'){
 // The initialization script clears only once. Further navigations retain the user's choice.
 const p=await page('mode=mail&title=1');
 await p.read(`document.getElementById('modeExplore').click()`);await p.settle();
 check(await p.read(`localStorage.getItem('mmm.mode')==='explore'&&new URLSearchParams(location.search).get('mode')==='explore'&&document.getElementById('titleStart').textContent==='Start driving'`),'switch saves explore and reloads consistent query');
 await p.read(`document.getElementById('modeMail').click()`);await p.settle();
 check(await p.read(`localStorage.getItem('mmm.mode')==='mail'&&new URLSearchParams(location.search).get('mode')==='mail'&&document.getElementById('titleStart').textContent==='Start the shift'`),'switch saves mail and reloads consistent query');
 await p.send('Page.navigate',{url:base+'/?title=1'});await p.settle();await p.read(`document.getElementById('modeExplore').click()`);await p.settle();
 check(await p.read(`localStorage.getItem('mmm.mode')==='explore'&&!new URLSearchParams(location.search).has('mode')&&document.getElementById('titleStart').textContent==='Start driving'`),'switch survives a host without a mode query');await p.close();
}
if(family==='all'||family==='phone'){
 const driveIds=['hud','gear','pauseButton','droneButton','placesButton','miniMap','radio','placeArrival','tcTrack','tcBrake','tcGo','tcReset','tcView','tcHorn','savePictureButton'];
 const flightIds=['hud','gear','pauseButton','droneLeft','droneLeft span','droneRight','droneRight span','droneReturn','savePictureButton'];
 for(const [w,h,bottom=0] of [[844,390],[390,844],[320,568],[320,460],[280,653],[568,280],[568,280,21]]){
  const p=await page('mode=explore&touch=1&title=1',w,h);
  const label=(w===844||w===390)?`phone ${w}`:`phone ${w}x${h}`;
  check((await p.read(titleState)).rows.includes('Save picture'),`${label} title lists Save picture`);
  if(w===390)await p.shot('08-phone-explore-title');
  if(bottom){
   const override=await p.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,right:0,bottom,left:0}});
   assert.ok(!override.error,JSON.stringify(override.error));
  }
  await p.read(`document.getElementById('titleStart').click()`);await sleep(500);
  check((await p.read(`${JSON.stringify(missing)}.filter(${visible})`)).length===0,`${label} has no mail controls`);
  const readBoxes=ids=>p.read(`${JSON.stringify(ids)}.flatMap(id=>{
   const e=document.querySelector('#'+id), r=e?.getBoundingClientRect();
   return r?.width && r.height ? [[id,r.left,r.top,r.right,r.bottom]] : [];
  })`);
  const faults=boxes=>{
   const issues=[];
   for(let i=0;i<boxes.length;i++){
    const [a,x,y,r,b]=boxes[i];
    if(x<0||y<0||r>w+1||b>h-bottom+1)issues.push(a+' offscreen');
    for(const [c,xx,yy,rr,bb] of boxes.slice(i+1)){
     if(Math.min(r,rr)-Math.max(x,xx)>1&&Math.min(b,bb)-Math.max(y,yy)>1)issues.push(a+' overlaps '+c);
    }
   }
   return issues;
  };
  const boxes=await readBoxes(driveIds), driveFaults=faults(boxes);
  if(driveFaults.length)console.log('Phone faults',driveFaults.join(','));
  check(driveFaults.length===0,`${label} controls and arrival do not overlap`);
  check(['tcTrack','tcGo','tcBrake','placesButton','pauseButton','droneButton','savePictureButton'].every(id=>boxes.some(b=>b[0]===id)),`${label} keeps driving and places controls`);
  check(boxes.some(([id,x,,right])=>id==='hud'&&right-x>=52),`${label} leaves room for driving status`);
  if(w===844)await p.shot('07-phone-explore-drive');
  if(w===320&&h===568)await p.shot('phone-drive-320x568');
  await p.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  // Tap like a player: if a scrolling list cuts the target off, swipe it into view first. Then require that the
  // tap point really lands on the target, so a tap on padding can no longer pass or fail by luck of layout.
  const where=selector=>p.read(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),c=e.closest('#placesBody')?.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,over:c?Math.max(0,r.bottom-c.bottom):0,sx:c?c.x+c.width/2:0,sy:c?c.bottom-8:0}})()`);
  const hit=async selector=>{let r=await where(selector);if(r.over>0){await p.send('Input.synthesizeScrollGesture',{x:r.sx,y:r.sy,yDistance:-(r.over+16),speed:800,gestureSourceType:'touch'});await sleep(300);r=await where(selector);}
   check(await p.read(`!!document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${r.x},${r.y}))`),`${label} ${selector} is tappable where the player touches`);
   await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:r.x,y:r.y}]});await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(350);};
  await p.read(`(${watchPictures})()`);
  await hit('#savePictureButton'); await picture(p, 0, 'download', false);
  await hit('#droneButton');
  check(await p.read(`mmm.drone.group.visible && (${visible})('savePictureButton')`),`${label} save button stays visible in drone view`);
  const flightBoxes=await readBoxes(flightIds), flightFaults=faults(flightBoxes);
  if(flightFaults.length)console.log('Flight faults',flightFaults.join(','));
  check(flightIds.every(id=>flightBoxes.some(b=>b[0]===id))&&flightFaults.length===0,`${label} flight controls and stick captions fit without overlap`);
  if(bottom&&process.env.SHOTS==='1'){
   for(let attempt=0;attempt<40&&await p.read("document.getElementById('savePictureStatus').textContent");attempt++)await sleep(125);
   await p.shot('phone-drone-568x280');
  }
  await p.read('window.pictureShare = true');
  await hit('#savePictureButton'); await picture(p, 1, 'share', true);
  for(const text of [null,'Could not save picture']){
   if(text)await p.read(`document.getElementById('savePictureStatus').textContent=${JSON.stringify(text)}`);
   const noticeBoxes=await readBoxes([...flightIds,'miniMap','savePictureStatus']), noticeFaults=faults(noticeBoxes);
   if(noticeFaults.length)console.log('Flight notice faults',text??'saved',noticeFaults.join(','));
   check(noticeBoxes.some(b=>b[0]==='savePictureStatus')&&noticeFaults.length===0,`${label} flight save notice (${text??'Picture saved'}) clears telemetry, map and flight controls`);
  }
  await p.read(`document.getElementById('savePictureStatus').textContent=''`);
  if(w===320&&h===568){
   await p.read('window.cancelPicture = true');
   await hit('#savePictureButton');
   for(let attempt=0;attempt<40&&!await p.read('pictureShares===2');attempt++)await sleep(125);
   check(await p.read(`pictureReads===3&&pictureShares===2&&pictureDownloads===1`),`${label} treats a named share error as cancellation`);
  }
  await hit('#droneReturn'); await hit('#droneReturn');
  await hit('#placesButton');await hit('[data-place="rail-trail"]');
  check(await p.read(`document.getElementById('placesPanel').hidden&&mmm.vehicle.speed===0&&document.getElementById('placeArrival').innerText.includes('Mabou Rivers Trail')`),`${label} real touch places jump`);
  check(p.errors.length===0,`${label} no runtime exceptions`);await p.close();
 }
}
if(family==='all'||family==='parameters'){
 for(const mode of ['mail','explore']){
  const p=await page(`mode=${mode}&at=624340,5103300,90`);
  check(await p.read(`Math.hypot(mmm.vehicle.x-69,mmm.vehicle.z-1)<.01`),`${mode} at parameter works`);
  if(mode==='explore'){await p.send('Page.navigate',{url:base+`/?mode=explore&lawn=0&at=624340,5103300,90`});await p.settle();check(await p.read(`!document.getElementById('hud').textContent.includes('Tyre strips')&&Math.hypot(mmm.vehicle.x-69,mmm.vehicle.z-1)<.01`),'explore ignores the mail lawn fixture');}
  await p.send('Page.navigate',{url:base+`/?mode=${mode}&road=Rankinville%20Road&f=0.5`});await p.settle();
  check(await p.read(`mmm.vehicle.roads.nearest(mmm.vehicle.x,mmm.vehicle.z,1)?.road.name==='Rankinville Road'`),`${mode} road parameter works`);
  await p.send('Page.navigate',{url:base+`/?mode=${mode}&cam=622951.3,5104332.1,2.2,292,-3,51&camground=1`});await p.settle();
  check(await p.read(`Math.abs(mmm.camera.position.x+1319.7)<.01&&Math.abs(mmm.camera.position.z+1031.1)<.01`),`${mode} fixed camera parameter works`);
  await p.send('Page.navigate',{url:base+`/?mode=${mode}&shot=1`});await p.settle();
  check(await p.read(`Math.abs(mmm.camera.position.x+1319.7)<.01&&Math.abs(mmm.camera.position.z+1031.1)<.01`),`${mode} shot parameter works`);
  await p.send('Page.navigate',{url:base+`/?mode=${mode}&demo=2`});await p.settle();
  check(await p.read(`Math.abs(mmm.vehicle.speed)<.15&&mmm.vehicle.roadName!==null&&Math.hypot(mmm.vehicle.x-mmm.shift.run.start.x,mmm.vehicle.z-mmm.shift.run.start.z)>1`),`${mode} demo parameter works`);await p.close();
 }
}
writeFileSync(`${out}/explore-results-${family}.json`,JSON.stringify(results,null,2));
assert.ok(results.every(x=>x.pass),`${results.filter(x=>!x.pass).length} explore checks failed`);
