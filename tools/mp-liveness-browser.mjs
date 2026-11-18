// Two independent browser identities, plus a same-browser tab takeover. Local Worker only.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cdp, cdpFetch, exitCheck, sleep } from './cdp.mjs';
import { separateWindow } from './mp-browser-page.mjs';
const [out,first]=process.argv.slice(2),base=new URL(first).origin,port=process.env.CDP_PORT,server=process.env.MP_SERVER;
assert.match(server,/^ws:\/\/(127\.0\.0\.1|localhost):\d+$/);mkdirSync(out,{recursive:true});
const version=await(await cdpFetch(`http://127.0.0.1:${port}/json/version`)).json();
const browser=await cdp(version.webSocketDebuggerUrl),contexts=[],pages=[],receipt={};
async function open(context){
  const visitor=!context;
  if(visitor){context=(await browser.send('Target.createBrowserContext')).result.browserContextId;contexts.push(context);}
  // A new visitor gets its own window; another tab of the same browser shares (and hides behind) its window.
  const id=(await browser.send('Target.createTarget',{url:'about:blank',browserContextId:context})).result.targetId;
  if(visitor)await separateWindow(browser,id);
  const wire=await cdp(`ws://127.0.0.1:${port}/devtools/page/${id}`);
  // Reading a page brings its tab to the front, as a player would.
  const read=async expression=>{await wire.send('Page.bringToFront');const r=await wire.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});return r.result.result.value;};
  const until=async(expr,tries=1200,ms=200)=>{for(let i=0;i<tries;i++){if(await read(expr))return;await sleep(ms);}throw Error('Timeout: '+expr+' '+JSON.stringify(await read('({title:document.title,status:window.mmm?.mp?.current?.net.status,count:window.mmm?.mp?.current?.net.count,hidden:document.hidden})')));};
  const peek=async expression=>(await wire.send('Runtime.evaluate',{expression,returnByValue:true})).result.result.value;
  const p={...wire,read,peek,until,context,id};pages.push(p);
  await wire.send('Page.enable');await wire.send('Runtime.enable');
  const url=new URL(base);url.search=new URLSearchParams({mode:'explore',road:'Highway 19',f:'.4',mp:'1',room:'live',mpserver:server,res:'.5',hud:'1'}).toString();
  p.url=url.href;await wire.send('Page.navigate',{url:p.url});await started(p);return p;
}
async function started(p){await p.until('!!window.mmm && document.title.startsWith("settled")');await p.read(`if(!document.getElementById('title').hidden)document.getElementById('titleStart').click()`);await p.until('mmm.mp.current?.net.status==="on"');}
let failure;
try{
  const a=await open(),b=await open();await a.until('mmm.mp.current.net.count===1');await b.until('mmm.mp.current.net.count===1');
  receipt.before=await b.read('({count:mmm.mp.current.net.count,chip:document.getElementById("mpChip").textContent})');
  const identity=await a.read('({browser:localStorage.getItem("mmm-mp-browser"),session:sessionStorage.getItem("mmm-mp-session")})');
  await a.send('Page.reload');await started(a);await b.until('mmm.mp.current.net.count===1');
  assert.deepEqual(await a.read('({browser:localStorage.getItem("mmm-mp-browser"),session:sessionStorage.getItem("mmm-mp-session")})'),identity);
  // Observe long enough for the old socket's delayed close/retry paths.
  for(let i=0;i<30;i++){assert.equal(await b.read('mmm.mp.current.net.count'),1);await sleep(100);}
  receipt.afterReload=await b.read('({count:mmm.mp.current.net.count,chip:document.getElementById("mpChip").textContent})');
  assert.match(receipt.afterReload.chip,/1 other driver/);
  const c=await open(a.context);await a.until('mmm.mp.current.net.status==="off"');await b.until('mmm.mp.current.net.count===1');
  // a is in front now, so the new tab c is hidden behind it: a short switch away keeps c's seat (no rejoin).
  const seat=await c.peek('mmm.mp.current.net.me.id');await sleep(2500);assert.equal(await a.read('mmm.mp.current.net.status'),'off');
  assert.equal(await c.peek('document.hidden'),true,'same-browser tab behind the front one is hidden');
  assert.equal(await c.read('mmm.mp.current.net.me.id'),seat);assert.equal(await c.read('mmm.mp.current.net.count'),1);
  receipt.sameBrowserTakeover=await b.read('mmm.mp.current.net.count');receipt.seatKeptAcrossTabSwitch=seat;
  await b.send('Page.bringToFront');writeFileSync(`${out}/liveness.png`,Buffer.from((await b.send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
  for(const p of pages)assert.deepEqual(p.errors,[]);
  console.log('PASS two browser identities: reload preserves keys and observer sees 1 driver; same-browser tab replaces without reconnect loop');
}catch(e){failure=e;console.error(e.stack);}finally{writeFileSync(`${out}/liveness-browser.json`,JSON.stringify(receipt,null,2)+'\n');for(const p of pages)p.ws.close();for(const browserContextId of contexts)await browser.send('Target.disposeBrowserContext',{browserContextId});browser.ws.close();}
exitCheck(failure?1:0);
