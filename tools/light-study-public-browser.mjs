// Production-like default-brand proof. No DEV hooks and no test URL keys on player links.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {cdp,cdpFetch,sleep} from './cdp.mjs';
const out=process.argv[2],port=process.env.CDP_PORT,origin=process.env.LIGHT_STUDY_PUBLIC_ORIGIN;
const tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json(),c=await cdp(tab.webSocketDebuggerUrl),receipts=[];
const read=async expression=>{const r=await c.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
async function until(expression){const t=Date.now();while(Date.now()-t<180000){if(await read(expression))return;await sleep(500);}throw Error('Timed out: '+expression);}
async function ready(){await until('document.documentElement.dataset.mmmReady==="true"');await sleep(500);}
async function shot(name){const r=await c.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${name}.png`,Buffer.from(r.result.data,'base64'));console.log('CAPTURED',name);}
async function playerState(name){
  await ready();await until('!!document.getElementById("radio")');
  const state=await read(`({title:document.title,card:!!document.getElementById('title')&&!document.getElementById('title').hidden,credits:[...document.querySelectorAll('#settings button')].some(b=>b.textContent==='Controls, credits and data'),mail:!!document.getElementById('modeMail'),explore:!!document.getElementById('modeExplore'),plays:window.__studyPlays,dev:typeof window.mmm,search:location.search})`);
  assert.equal(state.title,'Mabou Mail Madness','normal public tab title');assert.equal(state.card,true,'normal player title card');assert.equal(state.credits,true,'credits/mode-switch route retained');
  assert.equal(state.mail,true);assert.equal(state.explore,true);assert.equal(state.plays,0,'radio has not started before title tap');assert.equal(state.dev,'undefined','real production build has no DEV hooks');
  assert.equal(new URLSearchParams(state.search).has('at'),false,'study link is not a test placement');receipts.push({name,...state});return state;
}
const bounds=()=>{const p=document.getElementById('settings');p.scrollTop=p.scrollHeight;const r=p.getBoundingClientRect(),last=[...p.querySelectorAll('button,input,select,a[href]')].filter(el=>el.getClientRects().length&&!el.closest('[hidden]')).at(-1),b=last.getBoundingClientRect();return {width:innerWidth,height:innerHeight,panel:{top:r.top,bottom:r.bottom,height:r.height},last:{top:b.top,bottom:b.bottom},credit:document.documentElement.style.getPropertyValue('--map-credit-space'),tcOn:document.body.classList.contains('tcOn')};};
try {
  await c.send('Page.enable');
  await c.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__studyPlays=0;HTMLMediaElement.prototype.play=function(){window.__studyPlays++;return Promise.resolve();};
    const original=window.fetch;window.fetch=async function(input,options){const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.hostname.endsWith('novascotia.ca')){const canvas=document.createElement('canvas');canvas.width=canvas.height=640;const blob=await new Promise(resolve=>canvas.toBlob(resolve));return new Response(blob,{headers:{'Content-Type':'image/png'}});}return original(input,options);};`});
  await c.send('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:1,mobile:false});
  await c.send('Page.navigate',{url:origin+'/?mode=explore&date=2026-12-21&time=16:30&driveAt=622951.3,5104332.1,270&touch=1&q=low'});
  await playerState('shared study initial');
  await read('document.getElementById("titleStart").click();true');await until('window.__studyPlays>0');
  await read('document.getElementById("gear").click();document.querySelector("#lightStudy [type=time]").value="16:45";document.querySelector("#lightStudy button").click();true');
  await sleep(700);await playerState('Apply reload');
  await read('document.getElementById("titleStart").click();true');await until('window.__studyPlays>0');
  await read(`for(const [side,value] of Object.entries({top:59,bottom:34,left:0,right:0}))document.documentElement.style.setProperty('--test-safe-'+side,value+'px');document.getElementById('gear').click();true`);
  await sleep(300);const phone=await read(`(${bounds})()`);assert.ok(phone.panel.bottom<=810&&phone.last.bottom<=818);receipts.push({name:'phone panel',...phone});
  await read('document.getElementById("settings").scrollTop=0');await shot('phone-panel-public');
  // Fly hides the touch pad and removes tcOn; Settings pauses keys, so close it to enter fly, then reopen it there.
  await read(`document.getElementById('gear').click();document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF',key:'f',bubbles:true}));document.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyF',key:'f',bubbles:true}));true`);
  await until('!document.body.classList.contains("tcOn")');
  await read(`document.getElementById('gear').click();true`);await sleep(300);
  const fly=await read(`(${bounds})()`);assert.equal(fly.tcOn,false);assert.ok(fly.panel.bottom<=818&&fly.last.bottom<=818);receipts.push({name:'phone pad hidden in fly',...fly});
  await read(`document.getElementById('gear').click();document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF',key:'f',bubbles:true}));document.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyF',key:'f',bubbles:true}));true`);
  await until('document.body.classList.contains("tcOn")');
  await read(`document.getElementById('gear').click();true`);await sleep(300);
  // Leave at the current place, removing only the study controls and preserving the PLAYER placement.
  const beforeLeave=await read('new URLSearchParams(location.search).get("driveAt")');
  await read('document.querySelector("#lightStudy .lightLeave").click();true');await sleep(700);const left=await playerState('Leave study reload');
  const leftQuery=new URLSearchParams(left.search);for(const key of ['date','time','hour','at','exag'])assert.equal(leftQuery.has(key),false);
  assert.equal(leftQuery.get('driveAt'),beforeLeave);assert.ok(leftQuery.get('driveAt'));assert.equal(await read('document.querySelector("#lightStudy .lightLeave").hidden'),true);
  // Both mode buttons can actually be reached through the restored title/credits route.
  await read('document.getElementById("modeMail").click();true');await sleep(700);await playerState('mail mode switch');
  assert.equal(await read('document.getElementById("modeMail").getAttribute("aria-pressed")'),'true');
  await read('document.getElementById("modeExplore").click();true');await sleep(700);await playerState('explore mode switch');
  await read('document.getElementById("titleStart").click();document.getElementById("gear").click();true');
  await read(`([...document.querySelectorAll('#settings button')].find(b=>b.textContent==='Controls, credits and data')).click();true`);
  assert.equal(await read('document.getElementById("title").hidden'),false);assert.equal(await read('!!document.getElementById("modeMail")&&!!document.getElementById("modeExplore")'),true);
  // Desktop panel with the actual property-lines control/credit. Province images are intercepted locally.
  await c.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await c.send('Page.navigate',{url:origin+'/?mode=explore&date=2026-12-21&time=16:30&driveAt=622951.3,5104332.1,270'});await playerState('desktop study');
  await read(`document.getElementById('titleStart').click();for(const [side,value] of Object.entries({top:59,bottom:34}))document.documentElement.style.setProperty('--test-safe-'+side,value+'px');document.getElementById('gear').click();document.getElementById('propertyLines').click();document.getElementById('propertyAgree').click();true`);
  await until('document.body.classList.contains("propertyLinesOn")');await sleep(500);
  const desktop=await read(`(()=>{const b=(${bounds})();const c=document.getElementById('propertyCredit').getBoundingClientRect();return {...b,creditBox:{top:c.top,bottom:c.bottom},maxHeight:getComputedStyle(document.getElementById('settings')).maxHeight};})()`);
  assert.ok(parseFloat(desktop.credit)>0);assert.ok(desktop.panel.height<=900-84-parseFloat(desktop.credit)-59-34+.01,'desktop reserves credit and both insets');
  assert.ok(desktop.panel.bottom<desktop.creditBox.top);receipts.push({name:'desktop property credit',...desktop});
  await read('document.getElementById("settings").scrollTop=0');await shot('desktop-panel-public');
  await read(`(()=>{const d=document.querySelector('#lightStudy [type=date]');d.value='1884-06-21';d.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  assert.equal(await read(`document.querySelector('#lightStudy output').textContent.includes('Before 15 June 1902 Halifax kept local mean time (GMT−4:14:24).')`),true);
  await read(`(()=>{const d=document.querySelector('#lightStudy [type=date]');d.value='1902-06-14';d.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  assert.equal(await read(`document.querySelector('#lightStudy output').textContent.includes('Before 15 June 1902')`),true);
  await read(`(()=>{const d=document.querySelector('#lightStudy [type=date]');d.value='1902-06-15';d.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  assert.equal(await read(`document.querySelector('#lightStudy output').textContent.includes('Before 15 June 1902')`),false);
  // The explicitly malformed legacy hour is a test key; check its field-specific correction separately.
  for(const hour of ['-2','bad']) {
    await c.send('Page.navigate',{url:origin+'/?mode=explore&date=2026-12-21&hour='+hour+'&driveAt=622951.3,5104332.1,270'});await ready();
    const badHour=await read('({date:document.querySelector("#lightStudy [type=date]").value,text:document.querySelector("#lightStudy output").textContent})');
    assert.equal(badHour.date,'2026-12-21');assert.match(badHour.text,/invalid hour/);receipts.push({name:'bad hour',hour,...badHour});
  }
  // A valid legacy hour must remain the selected time when the hill slider creates a player link.
  await c.send('Page.navigate',{url:origin+'/?mode=explore&date=2026-12-21&hour=22&driveAt=622951.3,5104332.1,270&touch=1&q=low'});await ready();
  await read('document.getElementById("exag").value="1.2";document.getElementById("exag").dispatchEvent(new Event("change",{bubbles:true}));true');
  await sleep(700);const slider=await playerState('hour-only slider reload');const sliderQuery=new URLSearchParams(slider.search);
  assert.equal(sliderQuery.get('time'),'22:00');assert.equal(sliderQuery.has('hour'),false);assert.equal(sliderQuery.get('exag'),'1.2');
  writeFileSync(`${out}/public-receipts.json`,JSON.stringify(receipts,null,2)+'\n');console.log('PASS public default-brand title, tab title, radio gate, credits/mode flow, Leave, desktop credit, phone/fly layout, history note and bad hour.');
} finally {c.close();await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});}
