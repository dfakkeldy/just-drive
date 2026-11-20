// Two actual game pages against a local room only. Run through the M4 remote runner.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { multiplayerPage } from './mp-browser-page.mjs';
import { cdp, exitCheck, sleep } from './cdp.mjs';
const [out,first]=process.argv.slice(2),base=new URL(first).origin,port=process.env.CDP_PORT,server=process.env.MP_SERVER;
assert.match(server,/^ws:\/\/(127\.0\.0\.1|localhost):\d+$/);mkdirSync(out,{recursive:true});
const pages=[],receipt={};
async function open(name,touch=false){
  const tab=await multiplayerPage(port);
  const {ws,send,errors}=await cdp(tab.webSocketDebuggerUrl);
  const read=async expression=>{await send('Page.bringToFront');const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.result?.exceptionDetails,JSON.stringify(r.result?.exceptionDetails));return r.result.result.value;};
  const until=async expr=>{for(let i=0;i<1000;i++){if(await read(expr))return;await sleep(150);}throw Error('Timeout: '+expr);};
  const close=async()=>{await tab.close();ws.close();};
  const shot=async name=>writeFileSync(`${out}/${name}.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
  const p={read,until,close,shot,errors,send};pages.push(p);
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('mmm.mp.handle',${JSON.stringify(name)});`});
  await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:touch?390:1280,height:touch?844:800,deviceScaleFactor:1,mobile:touch});
  const url=new URL(base);url.search=new URLSearchParams({mode:'explore',road:'Highway 19',f:'.4',mp:'1',touch:touch?'1':'0',room:'social',mpserver:server,res:'1',hud:'1'}).toString();
  await send('Page.navigate',{url:url.href});await until('!!window.mmm && document.title.startsWith("settled")');
  await read(`if(!document.getElementById('title').hidden)document.getElementById('titleStart').click()`);
  await until('mmm.mp.current?.net.status === "on" && !!mmm.mp.current.net.race?.host');
  await read('mmm.vehicle.update=()=>{};mmm.vehicle.vx=mmm.vehicle.vz=mmm.vehicle.speed=0;document.getElementById("racePanel").open=true');
  return p;
}
async function pose(p,x,z){await p.read(`mmm.vehicle.place(${x},${z},0);mmm.vehicle.vx=mmm.vehicle.vz=mmm.vehicle.speed=0`);}
const bubblesClear = `(()=>{const tags=mmm.mp.current.ghosts.tagBoxes;return tags.length>0&&[...document.querySelectorAll('#mpChatBubbles [data-sender]')].filter(e=>!e.hidden).every(e=>{const b=e.getBoundingClientRect();return tags.every(t=>b.right<=t.left||b.left>=t.right||b.bottom<=t.top-7||b.top>=t.bottom+7)})})()`;
async function roomCardsLayout(p) {
  await p.read(`window.savedRoomRoster=document.getElementById('mpRoster').innerHTML;document.querySelector('#mpSocial details').open=true;document.getElementById('mpRoster').replaceChildren(...Array.from({length:24},(_,i)=>Object.assign(document.createElement('li'),{textContent:'Dusty Window '+i})))`);
  for (const [width,height] of [[1440,900],[1280,720],[720,480]]) {
    await p.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await p.read(`document.querySelectorAll('#mpCards>details').forEach(e=>e.open=true);document.getElementById('mpChatButton').click()`);
    await sleep(700);
    const measured=await p.read(`(()=>{const home=document.getElementById('mpCards'),h=home.getBoundingClientRect(),cards=[...home.children].filter(e=>!e.hidden).map(e=>{const r=e.getBoundingClientRect();return [e.id,r.left,r.top,r.right,r.bottom]});return {cards,scroll:getComputedStyle(home).overflowY,box:[h.left,h.top,h.right,h.bottom],blockers:['hud','miniMap','radio','pauseButton','placesButton','gear','endShift','credit','mpChip','gameResults'].flatMap(id=>{const e=document.getElementById(id),r=e?.getBoundingClientRect();return !e||e.hidden||!r.width||!r.height?[]:[[id,r.left,r.top,r.right,r.bottom]]})}})()`);
    assert.deepEqual(measured.cards.map(b=>b[0]),['mpSocial','racePanel','gamePanel']);
    assert.equal(measured.scroll,'auto');
    const [l,t,r,b]=measured.box; assert.ok(l>=0&&t>=0&&r<=width&&b<=height);
    for(let i=0;i<measured.cards.length;i++) {const c=measured.cards[i];assert.equal(c[1],l);assert.ok(c[3]<=r);if(i)assert.ok(c[2]>=measured.cards[i-1][4]+7);}
    for(const [id,x,y,z,q] of measured.blockers) assert.ok(r<=x||l>=z||b<=y||t>=q,`column clears ${id} at ${width}x${height}`);
    await p.read(`(()=>{const e=document.querySelector('#gamePanel button:last-of-type');e.scrollIntoView({block:'nearest'})})()`);
    assert.ok(await p.read(`(()=>{const e=document.querySelector('#gamePanel button:last-of-type'),r=e.getBoundingClientRect(),at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return at===e||e.contains(at)})()`),'last card remains reachable through the column scroll');
  }
  await p.read(`document.getElementById('mpRoster').innerHTML=savedRoomRoster;document.querySelector('#mpSocial details').open=false`);
  await p.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
}
let failed;
try {
  const a=await open('Dusty Tire'), b=await open('Foggy Window',true);
  await a.until('mmm.mp.current.net.count===1');
  assert.equal(await a.read('mmm.mp.current.net.me.name'),'Dusty Tire');
  assert.equal(await b.read('mmm.mp.current.net.me.name'),'Foggy Window');
  await a.until('document.getElementById("mpRoster").textContent.includes("Foggy Window")');
  const front=await a.read('({x:mmm.vehicle.x+Math.sin(mmm.vehicle.heading)*12,z:mmm.vehicle.z-Math.cos(mmm.vehicle.heading)*12})');
  await pose(b,front.x,front.z); await sleep(700);
  assert.ok(await b.read('(()=>{const s=document.getElementById("settings"),g=document.getElementById("mpRoom");return s.firstElementChild.id==="settingsHeader"&&g.previousElementSibling.id==="settingsHeader"&&g.querySelector("h3").textContent==="Room"&&[...g.querySelectorAll(":scope>details")].map(e=>e.id).join() === "mpSocial,racePanel,gamePanel"})()'),'phone Room group follows the Settings header in a fixed order');
  assert.ok(await a.read('document.getElementById("mpSocial").parentElement.id==="mpCards"&&getComputedStyle(document.getElementById("mpCards")).position==="fixed"'),'desktop cards share one fixed column');
  for (const p of [a,b]) await p.read('document.getElementById("mpSocial").open=true');
  await roomCardsLayout(a);
  await b.read('document.getElementById("settings").classList.add("open")');
  await b.read('document.getElementById("mpChatButton").click();document.getElementById("mpChatGrid").scrollIntoView({block:"center"})');
  // Eight road phrases, and the three game phrases in a room that runs games (this one does).
  assert.equal(await b.read('[...document.querySelectorAll("#mpChatGrid button")].filter(e=>!e.hidden).length'),11);
  assert.equal(await b.read('[...document.querySelectorAll("#mpChatGrid button")].filter(e=>!e.hidden&&e.dataset.game).length'),3);
  await b.read('document.querySelectorAll("#mpChatGrid button")[4].click()');
  await a.until('document.getElementById("mpChatLog").textContent.includes("Foggy Window: Look at this")');
  await b.until('document.getElementById("mpChatLog").textContent.includes("Look at this")');
  await a.read('document.activeElement?.blur()');
  await a.send('Input.dispatchKeyEvent',{type:'keyDown',key:'1',code:'Digit1',windowsVirtualKeyCode:49});
  await a.send('Input.dispatchKeyEvent',{type:'keyUp',key:'1',code:'Digit1',windowsVirtualKeyCode:49});
  await b.until('document.getElementById("mpChatLog").textContent.includes("Dusty Tire: Race you!")');
  await a.until('Array.from(document.querySelectorAll("#mpChatBubbles [data-sender]")).some(e=>!e.hidden)');
  assert.ok(await a.read(bubblesClear),'desktop bubbles clear all drawn name tags');
  await a.shot('social-desktop');
  await sleep(4300); await a.until('document.getElementById("mpChatBubbles").children.length===0');
  await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await b.read('document.getElementById("mpChatButton").click();document.getElementById("mpChatGrid").scrollIntoView({block:"center"})');
  await b.read('document.getElementById("mpChatGrid").scrollIntoView({block:"nearest"})');
  assert.ok(await b.read('(()=>{const r=document.getElementById("mpChatGrid").getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()'),'phone phrase grid fits on screen');
  assert.ok(await b.read('Array.from(document.querySelectorAll("#mpChatGrid button")).every(e=>{const r=e.getBoundingClientRect();return r.height>=44&&r.right<=innerWidth})'),'phone phrase buttons are full touch size');
  await b.shot('social-phone');
  await b.read('document.getElementById("settings").classList.remove("open")');
  await b.send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true});
  const ahead=await b.read('({x:mmm.vehicle.x+Math.sin(mmm.vehicle.heading)*12,z:mmm.vehicle.z-Math.cos(mmm.vehicle.heading)*12})');
  await pose(a,ahead.x,ahead.z);await sleep(700);
  await a.read('mmm.mp.current.net.chat(4)');
  await b.until('mmm.mp.current.ghosts.tagBoxes.length>0&&[...document.querySelectorAll("#mpChatBubbles [data-sender]")].some(e=>!e.hidden)');
  assert.ok(await b.read(bubblesClear),'landscape phone bubbles clear every drawn name tag');
  assert.ok(await b.read('mmm.mp.current.ghosts.tagBoxes.every(t=>t.bottom-t.top>=19.9&&t.bottom-t.top<=20.1)'),'landscape phone name planes have 10 px ink in a 20 px plane');
  await b.shot('social-phone-landscape');
  await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await b.read('document.getElementById("settings").classList.add("open")');
  // Names in races are the same validated handles.
  await a.until('document.querySelector("#racePanel select").options.length>1');
  await a.read('(()=>{const e=document.querySelector("#racePanel select");e.value="0";e.dispatchEvent(new Event("change"));})()');
  await b.until('!!mmm.mp.current.net.race.route');
  const route=await a.read('mmm.mp.current.net.race.route');
  await pose(a,route.gates[0].x,route.gates[0].z); await pose(b,route.gates[0].x,route.gates[0].z);await sleep(700);
  await a.until('!document.querySelector("#racePanel button").disabled');
  await a.read('document.querySelector("#racePanel button").click()');
  await b.until('document.getElementById("racePanel").textContent.includes("Dusty Tire") && document.getElementById("racePanel").textContent.includes("Foggy Window")');
  await b.read('(()=>{const e=document.querySelector(".mpControl[data-mp=settings] .mpName");e.value="sh1t";e.dispatchEvent(new Event("change"));})()');
  await b.until('mmm.mp.current?.net.status==="on" && mmm.mp.current.net.me.name!=="Foggy Window"');
  assert.notEqual(await b.read('mmm.mp.current.net.me.name'),'sh1t');
  assert.equal(await b.read('localStorage.getItem("mmm.mp.handle")'),null);
  await b.read('document.querySelector(".mpControl[data-mp=settings] .mpDice").click()');
  await b.until('mmm.mp.current?.net.status==="on" && mmm.mp.current.net.me.name===localStorage.getItem("mmm.mp.handle")');
  assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);
  console.log('PASS two local clients: handles, roster, desktop key, phrase grid, authoritative log, expiry, phone fit and race handles');
}catch(e){failed=e;console.error(e.stack);}finally{for(const p of pages)await p.close();}
exitCheck(failed?1:0);
