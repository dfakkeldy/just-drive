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
let failed;
try {
  const a=await open('Dusty Tire'), b=await open('Foggy Window',true);
  await a.until('mmm.mp.current.net.count===1');
  assert.equal(await a.read('mmm.mp.current.net.me.name'),'Dusty Tire');
  assert.equal(await b.read('mmm.mp.current.net.me.name'),'Foggy Window');
  await a.until('document.getElementById("mpRoster").textContent.includes("Foggy Window")');
  const front=await a.read('({x:mmm.vehicle.x+Math.sin(mmm.vehicle.heading)*12,z:mmm.vehicle.z-Math.cos(mmm.vehicle.heading)*12})');
  await pose(b,front.x,front.z); await sleep(700);
  // A phone keeps the panel in Settings after the race, never over the driving controls at the screen edges.
  assert.ok(await b.read('(()=>{const s=document.getElementById("mpSocial");return !!s.closest("#settings")&&s.previousElementSibling?.id==="racePanel"&&getComputedStyle(s).position!=="fixed"})()'),'phone social panel lives in Settings after the race');
  assert.ok(await a.read('getComputedStyle(document.getElementById("mpSocial")).position==="fixed"'),'desktop social panel floats');
  await b.read('document.getElementById("settings").classList.add("open")');
  await b.read('document.getElementById("mpChatButton").click()');
  assert.equal(await b.read('document.querySelectorAll("#mpChatGrid button").length'),8);
  await b.read('document.querySelectorAll("#mpChatGrid button")[4].click()');
  await a.until('document.getElementById("mpChatLog").textContent.includes("Foggy Window: Look at this")');
  await b.until('document.getElementById("mpChatLog").textContent.includes("Look at this")');
  await a.read('document.activeElement?.blur()');
  await a.send('Input.dispatchKeyEvent',{type:'keyDown',key:'1',code:'Digit1',windowsVirtualKeyCode:49});
  await a.send('Input.dispatchKeyEvent',{type:'keyUp',key:'1',code:'Digit1',windowsVirtualKeyCode:49});
  await b.until('document.getElementById("mpChatLog").textContent.includes("Dusty Tire: Race you!")');
  await a.until('Array.from(document.querySelectorAll("#mpChatBubbles [data-sender]")).some(e=>!e.hidden)');
  await a.shot('social-desktop');
  await sleep(4300); await a.until('document.getElementById("mpChatBubbles").children.length===0');
  await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await b.read('document.getElementById("mpChatButton").click()');
  await b.read('document.getElementById("mpChatGrid").scrollIntoView({block:"nearest"})');
  assert.ok(await b.read('(()=>{const r=document.getElementById("mpChatGrid").getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()'),'phone phrase grid fits on screen');
  assert.ok(await b.read('Array.from(document.querySelectorAll("#mpChatGrid button")).every(e=>{const r=e.getBoundingClientRect();return r.height>=44&&r.right<=innerWidth})'),'phone phrase buttons are full touch size');
  await b.shot('social-phone');
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
