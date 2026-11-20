// Two actual game pages against a local room only. Run through the M4 remote runner.
import { multiplayerPage } from './mp-browser-page.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AREAS } from '../web/src/area.ts';
import { cdp, cdpFetch, exitCheck, sleep } from './cdp.mjs';
const [rootOut,first]=process.argv.slice(2),base=new URL(first).origin,port=process.env.CDP_PORT,server=process.env.MP_SERVER;
const areas=process.env.MP_RACE_AREA ? process.env.MP_RACE_AREA.split(',') : AREAS.map(a=>a.id);
assert.ok(areas.length && areas.every(id=>AREAS.some(a=>a.id===id)),'known race areas');
assert.match(server,/^ws:\/\/(127\.0\.0\.1|localhost):\d+$/);
async function raceArea(area){
const out=join(rootOut,area);mkdirSync(out,{recursive:true});
const pages=[],receipt={};
async function open(){
  const tab=await multiplayerPage(port);
  const {ws,send,errors}=await cdp(tab.webSocketDebuggerUrl);
  const read=async expression=>{await send('Page.bringToFront');const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.result?.exceptionDetails,JSON.stringify(r.result?.exceptionDetails));return r.result.result.value;};
  const until=async expr=>{for(let i=0;i<1000;i++){if(await read(expr))return;await sleep(150);}throw Error('Timeout: '+expr);};
  const close=async()=>{await tab.close();ws.close();};
  const shot=async name=>writeFileSync(`${out}/${name}.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
  // read() brings the page to front, which can restore a minimized window; peek() reads without that.
  const peek=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true});assert.ok(!r.result?.exceptionDetails,JSON.stringify(r.result?.exceptionDetails));return r.result.result.value;};
  // A real tab switch: minimize or restore this visitor's own window through the browser target.
  const windowState=async state=>{
    const browser=await cdp((await(await cdpFetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);
    try{const {windowId}=(await browser.send('Browser.getWindowForTarget',{targetId:tab.webSocketDebuggerUrl.split('/').pop()})).result;
      await browser.send('Browser.setWindowBounds',{windowId,bounds:{windowState:state}});}finally{browser.ws.close();}
  };
  const p={read,until,close,shot,errors,send,peek,windowState};pages.push(p);
  await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  const url=new URL(base);url.search=new URLSearchParams({area,mode:'explore',road:area==='westbay'?'Marble Mountain Road':'Highway 19',f:'.4',mp:'1',room:'race',mpserver:server,res:'1',hud:'1'}).toString();
  await send('Page.navigate',{url:url.href});await until('!!window.mmm && document.title.startsWith("settled")');
  await read(`if(!document.getElementById('title').hidden)document.getElementById('titleStart').click()`);
  await until('mmm.mp.current?.net.status === "on" && !!mmm.mp.current.net.race?.host');
  await read('mmm.vehicle.update=()=>{};mmm.vehicle.vx=mmm.vehicle.vz=mmm.vehicle.speed=0;document.getElementById("racePanel").open=true');
  return p;
}
async function pose(p,x,z){await p.read(`mmm.vehicle.place(${x},${z},0);mmm.vehicle.vx=mmm.vehicle.vz=mmm.vehicle.speed=0`);}
async function drive(p,from,to){const n=Math.ceil(Math.hypot(to.x-from.x,to.z-from.z)/8);for(let i=1;i<=n;i++){await pose(p,from.x+(to.x-from.x)*i/n,from.z+(to.z-from.z)*i/n);await sleep(220);}}
let failed;
try{
  const a=await open(),b=await open();await a.until('mmm.mp.current.net.count===1');
  await a.until('document.querySelector("#racePanel select").options.length>1');
  await b.until('document.querySelector("#racePanel select").disabled');
  receipt.area=await a.read('mmm.area.id');assert.equal(receipt.area,area,'requested area loaded');
  receipt.local=await a.read('({pose:{x:mmm.vehicle.x,z:mmm.vehicle.z},sameRoads:mmm.mp.current.host.roads===mmm.roads.roads,roadCount:mmm.roads.roads.length,choices:mmm.mp.current.race.choices})');
  console.log('AREA '+JSON.stringify({...receipt.local,choices:receipt.local.choices.map(r=>({roadId:r.roadId,start:r.gates[0],gates:r.gates.length}))}));
  assert.ok(receipt.local.sameRoads,'race uses current area roads');
  assert.ok(receipt.local.choices.length,'current area has courses');
  const startDistance=Math.hypot(receipt.local.choices[0].gates[0].x-receipt.local.pose.x,receipt.local.choices[0].gates[0].z-receipt.local.pose.z);
  receipt.startDistance=startDistance;console.log('START_DISTANCE '+startDistance);
  assert.ok(startDistance<=12,'a player on a long named road has a start ring within 12 m, got '+startDistance);
  assert.ok(await b.read('document.querySelector("#racePanel select").disabled'),'guest controls disabled');
  await a.until('document.querySelector("#racePanel select").options.length>1');
  await a.read('(()=>{const e=document.querySelector("#racePanel select");e.value="0";e.dispatchEvent(new Event("change"));})()');
  await b.until('!!mmm.mp.current.net.race.route');
  const route=await a.read('mmm.mp.current.net.race.route');receipt.route=route;
  assert.ok(route.gates.length>=3);
  receipt.geometry=await a.read(`(() => {
    const m=mmm.mp.current,r=m.net.race.route,road=mmm.roads.roads.find(p=>p.id===r.roadId),bounds=mmm.vehicle.bounds;
    const offRoad=p=>Math.min(...road.pts.slice(1).map((b,i)=>{const a=road.pts[i],dx=b[0]-a[0],dz=b[1]-a[1],d=dx*dx+dz*dz;
      const t=d?Math.max(0,Math.min(1,((p.x-a[0])*dx+(p.z-a[1])*dz)/d)):0;return Math.hypot(p.x-a[0]-t*dx,p.z-a[1]-t*dz);}));
    return {name:road.name,maxOffRoad:Math.max(...r.gates.map(offRoad)),inside:r.gates.every(p=>!bounds||(p.x>=bounds[0]&&p.z>=bounds[1]&&p.x<=bounds[2]&&p.z<=bounds[3]))};
  })()`);
  assert.ok(receipt.geometry.name,'selected course belongs to a named road in this area');
  assert.ok(receipt.geometry.maxOffRoad<.01,'every gate follows the current area road geometry');
  assert.ok(receipt.geometry.inside,'every gate is inside the playable area');await a.until('mmm.mp.current.race.group.visible && mmm.mp.current.race.group.children.length===mmm.mp.current.net.race.route.gates.length');
  await pose(a,route.gates[0].x,route.gates[0].z);await pose(b,route.gates[0].x,route.gates[0].z);await sleep(650);
  receipt.grid=await Promise.all([a,b].map(p=>p.read('({x:mmm.vehicle.x,z:mmm.vehicle.z,speed:mmm.vehicle.speed,told:mmm.mp.current.net.told,button:document.querySelector("#racePanel button").disabled,host:mmm.mp.current.net.race.host,me:mmm.mp.current.net.me.id})')));console.log('GRID '+JSON.stringify(receipt.grid));
  await a.until('!document.querySelector("#racePanel button").disabled');
  await a.until('mmm.mp.current.race.group.children.every(p=>mmm.mp.current.host.ground(p.position.x,p.position.z)!==null)');
  receipt.markers=await a.read('mmm.mp.current.race.group.children.map(p=>({x:p.position.x,z:p.position.z,y:p.position.y,ground:mmm.mp.current.host.ground(p.position.x,p.position.z),visible:p.visible}))');
  assert.ok(receipt.markers.every((p,i)=>p.x===route.gates[i].x&&p.z===route.gates[i].z&&Math.abs(p.y-p.ground-.5)<.01&&p.visible),'start and checkpoint rings stand on the loaded ground');
  await a.read(`(()=>{window.countdownCues=[];window.countdownObserver=new MutationObserver(()=>{for(const e of document.querySelectorAll('body > .roomCountdownSay'))if(e.textContent&&countdownCues.at(-1)!==e.textContent)countdownCues.push(e.textContent);});countdownObserver.observe(document.body,{subtree:true,childList:true,characterData:true});})()`);
  await a.read('document.querySelector("#racePanel button").click()');await b.until('mmm.mp.current.net.race.startAt>0');
  const start=await a.read('mmm.mp.current.net.race.startAt');assert.equal(await b.read('mmm.mp.current.net.race.startAt'),start);
  assert.equal(await a.read('mmm.mp.current.net.race.racers.length'),2);
  await a.until('document.querySelector("#racePanel p").textContent.startsWith("Stay inside the start ring until GO.") && [...document.querySelectorAll("body > .roomCountdownSay")].some(e=>e.textContent==="Start in 5")');await a.shot('race-countdown');
  await sleep(Math.max(0,start-Date.now()+300));
  await a.until('countdownCues.includes("GO")');
  assert.deepEqual(await a.read('countdownCues'),['Start in 5','Start in 3','GO'],'body live region speaks only 5, 3 and GO');
  await a.read('countdownObserver.disconnect()');
  for(let i=1;i<route.gates.length;i++){
    await drive(a,route.gates[i-1],route.gates[i]);await drive(b,route.gates[i-1],route.gates[i]);
    for(const p of [a,b])await p.until(`mmm.mp.current.net.race.racers.every(r=>r.next>=${i+1})`);
  }
  await a.until('mmm.mp.current.net.race.racers.every(r=>r.time!==null)');await b.until('mmm.mp.current.net.race.racers.every(r=>r.time!==null)');
  receipt.a=await a.read('mmm.mp.current.net.race.racers');receipt.b=await b.read('mmm.mp.current.net.race.racers');assert.deepEqual(receipt.a,receipt.b);assert.ok(receipt.a.every(r=>r.time>0&&!r.out));
  await a.until('/Finished/.test(document.querySelector("#racePanel p").textContent)');
  assert.equal(await a.read('document.querySelectorAll("#racePanel li").length'),2);await a.shot('race-results-host');await b.shot('race-results-guest');
  await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  // The race card sits in the room column (room-cards.ts), refitted every half second to clear the HUD and credit
  // line; the column scrolls inside itself. On the phone the column stays on screen, the card fits its width, and the
  // last result scrolls into view uncovered (1 px for fractional layout under a whole-pixel scroll).
  await sleep(1200);
  const phoneFit=await b.read('(()=>{const c=document.getElementById("mpCards").getBoundingClientRect(),r=document.getElementById("racePanel").getBoundingClientRect(),last=document.querySelector("#racePanel li:last-child");last.scrollIntoView({block:"nearest"});const l=last.getBoundingClientRect(),hit=document.elementFromPoint(l.left+l.width/2,l.top+l.height/2);return {column:[c.left,c.top,c.right,c.bottom],panel:[r.left,r.right],last:[l.left,l.top,l.right,l.bottom],ok:c.left>=0&&c.top>=0&&c.right<=innerWidth&&c.bottom<=innerHeight&&r.left>=c.left&&r.right<=c.right&&l.top>=c.top-1&&l.bottom<=c.bottom+1&&!!hit&&(hit===last||last.contains(hit))};})()');
  await b.shot('race-results-phone');
  assert.ok(phoneFit.ok,'phone race panel fits '+JSON.stringify(phoneFit));
  // Clear, refresh at the finish, and start the nearby course through the actual controls.
  await a.read('document.querySelectorAll("#racePanel button")[1].click()');await a.until('!mmm.mp.current.net.race.route');
  await a.until('document.querySelector("#racePanel select").value===""');
  const moved=route.gates.at(-1);await pose(a,moved.x,moved.z);await pose(b,moved.x,moved.z);
  await a.until(`Math.hypot(mmm.mp.current.race.choices[0].gates[0].x-(${moved.x}),mmm.mp.current.race.choices[0].gates[0].z-(${moved.z}))<=12`);
  receipt.refreshed=await a.read('mmm.mp.current.race.choices[0]');
  assert.notDeepEqual(receipt.refreshed.gates[0],route.gates[0],'cleared course list follows the player after driving');
  await a.read('(()=>{const e=document.querySelector("#racePanel select");e.value="0";e.dispatchEvent(new Event("change"));})()');await b.until('!!mmm.mp.current.net.race.route');
  await pose(a,receipt.refreshed.gates[0].x,receipt.refreshed.gates[0].z);await pose(b,receipt.refreshed.gates[0].x,receipt.refreshed.gates[0].z);await sleep(650);
  // Tab return in a room (#187): the pause screen comes up, the room stays live, and a real Escape resumes play.
  const g=receipt.refreshed.gates[0],bId=await b.read('mmm.mp.current.net.me.id');
  const hiddenWithin=async want=>{for(let i=0;i<40;i++){if(await a.peek('document.hidden')===want)return true;await sleep(150);}return false;};
  assert.ok(await a.read('document.hidden===false && document.getElementById("pauseScreen").hidden'),'before the tab switch the room page is visible and not paused');
  await a.windowState('minimized');
  receipt.tabSwitch={hiddenAfterMinimize:await hiddenWithin(true)};
  assert.ok(receipt.tabSwitch.hiddenAfterMinimize,'minimizing the window makes the room page hidden');
  await a.windowState('normal');
  receipt.tabSwitch.visibleAfterRestore=await hiddenWithin(false);
  assert.ok(receipt.tabSwitch.visibleAfterRestore,'restoring the window makes the room page visible');
  await a.until('!document.getElementById("pauseScreen").hidden');
  assert.ok(await a.read('!document.querySelector("#pauseScreen .roomPauseNote").hidden'),'the pause screen says a room does not pause');
  // peers is refreshed only by the frame loop (Multiplayer.update), never by this read: it proves the room frame runs.
  const peer=`(()=>{const v=mmm.mp.current.peers.find(v=>v.id===${bId});return v?{x:v.x,z:v.z}:null;})()`;
  await pose(b,g.x+20,g.z);
  await a.until(`(()=>{const v=${peer};return !!v&&Math.abs(v.x-(${g.x+20}))<1&&Math.abs(v.z-(${g.z}))<1;})()`);
  assert.ok(!await a.read('document.getElementById("pauseScreen").hidden'),'the peer moved on the paused page: the room stays live');
  await pose(b,g.x,g.z);
  await a.until(`(()=>{const v=${peer};return !!v&&Math.abs(v.x-(${g.x}))<1&&Math.abs(v.z-(${g.z}))<1;})()`);
  await a.shot('race-tab-return-paused');
  for(const type of ['keyDown','keyUp'])await a.send('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  let resumed=false;for(let i=0;i<40&&!resumed;i++){resumed=await a.read('document.getElementById("pauseScreen").hidden');if(!resumed)await sleep(150);}
  receipt.tabSwitch.escapeResumed=resumed;
  assert.ok(resumed,'a real Escape closes the pause screen in a room (if not: #187/#200 bug)');
  await a.until('!document.querySelector("#racePanel button").disabled');
  await a.read('document.querySelector("#racePanel button").click()');await b.until('mmm.mp.current.net.race.startAt>0');
  // The returned page must hear the start itself, with itself on the grid, before its reset can be judged.
  await a.until('mmm.mp.current.net.race.startAt>0 && mmm.mp.current.net.race.racers.some(r=>r.id===mmm.mp.current.net.me.id)');
  // A reset that does not move at all must still be reported explicitly.
  await a.read('mmm.vehicle.respawn=()=>{};document.activeElement?.blur()');
  await a.send('Input.dispatchKeyEvent',{type:'keyDown',key:'r',code:'KeyR',windowsVirtualKeyCode:82,text:'r'});
  await a.send('Input.dispatchKeyEvent',{type:'keyUp',key:'r',code:'KeyR',windowsVirtualKeyCode:82});
  await a.until('mmm.mp.current.net.race.racers.find(r=>r.id===mmm.mp.current.net.me.id)?.out===true');
  const sentBeforeRepeat=await a.read('mmm.mp.current.net.sent');
  for(let i=0;i<40;i++){await a.send('Input.dispatchKeyEvent',{type:'keyDown',key:'r',code:'KeyR',windowsVirtualKeyCode:82,autoRepeat:true});await sleep(25);}
  assert.ok(await a.read('mmm.mp.current.net.sent')-sentBeforeRepeat<=1,'held reset does not flood');
  assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);
  await a.close();pages.splice(pages.indexOf(a),1);await b.until('mmm.mp.current.net.race.host===mmm.mp.current.net.me.id');assert.equal(await b.read('mmm.mp.current.net.race.route'),null);
  console.log('PASS '+area+' two local game pages: host road choice, gate meshes, shared countdown, ordered road traversal, identical finish times, phone results, host handoff');
}catch(e){failed=e;console.error(e.stack);receipt.failure=[];for(const p of pages){try{receipt.failure.push(await p.read('({pose:{x:mmm.vehicle.x,z:mmm.vehicle.z,speed:mmm.vehicle.speed},net:mmm.mp.current.net.status,state:mmm.mp.current.net.race,told:mmm.mp.current.net.told,panel:document.getElementById("racePanel").textContent,disabled:document.querySelector("#racePanel button").disabled})'));await p.shot('race-failure-'+receipt.failure.length);}catch{}}console.error('RACE_DIAGNOSTIC '+JSON.stringify(receipt.failure));}finally{writeFileSync(`${out}/race-browser.json`,JSON.stringify(receipt,null,2)+'\n');for(const p of pages)await p.close();}
return failed?1:0;
}
let failed=false;
for(const area of areas){if(await raceArea(area))failed=true;}
exitCheck(failed?1:0);
