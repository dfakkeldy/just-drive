// Run exclusively via the leased check-all browser row. No scene or frame overrides.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
const [out, first] = process.argv.slice(2), port=process.env.CDP_PORT;
const pictures=process.env.ERA_DOOR_PICTURES ?? out;
mkdirSync(pictures,{recursive:true});
const base=new URL(first);base.hostname='localhost';
const records=[];
const overlap=(a,b)=>Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1;
async function page(path,width,height,check){
 const tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
 const c=await cdp(tab.webSocketDebuggerUrl),{send}=c;
 const read=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.error)throw Error(r.error.message);return r.result.result.value;};
 const until=async expression=>{for(let i=0;i<240;i++){try{if(await read(expression))return;}catch(error){if(!/context.*destroy|cannot find context|context.*not found/i.test(error.message))throw error;}await sleep(250);}throw Error('timeout '+expression);};
 const ready=`!!window.mmm?.vehicle && document.documentElement.dataset.mmmReady==='true' && !!document.getElementById('titleStart')`;
 const shot=async name=>{const file=`${pictures}/${name}.png`;writeFileSync(file,Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).result.data,'base64'));console.log('PICTURE '+file);};
 const click=async selector=>{
  await read(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await sleep(100);
  const point=await read(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),b=e.getBoundingClientRect();return {x:(b.left+b.right)/2,y:(b.top+b.bottom)/2,hit:document.elementFromPoint((b.left+b.right)/2,(b.top+b.bottom)/2)===e};})()`);
  assert.ok(point.hit,'link receives actual pointer');
  if(width<500){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y,id:1}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  else{await send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});}
 };
 const inspect=async(era,name,area='mabou')=>{
  const place=area==='judique'?'Judique':'Mabou';
  await until(ready);assert.equal(await read('mmm.era.id'),era);assert.equal(await read('mmm.area.id'),area);assert.equal(await read('document.title'),era==='1884'?place+', 1884':'Just Drive: '+place);
  assert.equal(await read(`document.getElementById('titleEra')?.textContent`),era==='1884'?'Back to today →':'Go back to '+place+' in 1884 →');
  const href=new URL(await read(`document.getElementById('titleEra').href`));assert.equal(href.pathname,era==='1884'?'/'+area:'/'+area+'-1884');
  assert.equal(href.searchParams.get('site'),'just');assert.equal(href.searchParams.get('q'),'low');assert.equal(href.searchParams.get('keep'),'yes');
  for(const k of ['era','trip','start','driveAt'])assert.equal(href.searchParams.has(k),false,k+' removed');
  if(era==='1884'){assert.equal(await read('mmm.vehicleId'),'horse');assert.equal(await read('!!mmm.mp'),false);assert.equal(await read(`!!document.querySelector('.mpControl')`),false);assert.equal(await read(`!!document.getElementById('startHere')`),false);}
  await read(`document.getElementById('titleEra').scrollIntoView({block:'center'})`);await sleep(100);
  const boxes=await read(`(()=>{const ids=['titleEra','titleStart','vehicleChoice','tcGo','tcBrake','tcSteer','gear','hud','phoneLine'];return ids.flatMap(id=>{const e=document.getElementById(id);if(!e)return [];const r=e.getBoundingClientRect(),s=getComputedStyle(e);if(!r.width||!r.height||s.visibility==='hidden'||s.display==='none'||e.closest('[hidden]'))return [];const p=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);return [{id,left:r.left,right:r.right,top:r.top,bottom:r.bottom,exposed:p===e||e.contains(p)}];});})()`);
  const door=boxes.find(b=>b.id==='titleEra');assert.ok(door&&door.left>=0&&door.right<=width&&door.top>=0&&door.bottom<=height,'door fits viewport');
  for(const b of boxes.filter(b=>['titleStart','vehicleChoice'].includes(b.id)||b.exposed&&b.id!=='titleEra'))assert.ok(!overlap(door,b),'era link overlaps '+b.id+JSON.stringify(boxes));
  records.push({width,height,era,href:href.href,boxes});if(name)await shot(name);
 };
 try{
  await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});await send('Emulation.setTouchEmulationEnabled',{enabled:width<500,maxTouchPoints:5});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.clear();sessionStorage.clear();`});
  await send('Page.navigate',{url:new URL(path,base).href});await until(ready);
  await check({read,send,until,ready,inspect,shot,click});c.assertHealthy();assert.deepEqual(c.errors,[]);
 }finally{await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});c.close();}
}
for(const [w,h,label]of [[1280,900,'desktop'],[390,844,'phone'],[360,640,'small-phone']]){
 await page('/mabou?site=just&q=low&keep=yes&title=1'+(w<500?'&touch=1':''),w,h,async p=>{
  await p.inspect('today',label+'-today');await p.click('#titleEra');await p.until(`location.pathname==='/mabou-1884' && window.mmm?.era?.id==='1884'`);await p.inspect('1884',label+'-1884');
  await p.click('#titleEra');await p.until(`location.pathname==='/mabou' && window.mmm?.era?.id==='today'`);await p.inspect('today');
  await p.click('#titleStart');await p.until(`document.getElementById('title').hidden`);assert.equal(await p.read(`document.getElementById('titleEra').getClientRects().length`),0,'era door disappears while driving');
 });
}
// Judique has its own door: today to 1884 and back, on desktop and phone.
for(const [w,h,label]of [[1280,900,'judique-desktop'],[390,844,'judique-phone']]){
 await page('/judique?site=just&q=low&keep=yes&title=1'+(w<500?'&touch=1':''),w,h,async p=>{
  await p.inspect('today',label+'-today','judique');await p.click('#titleEra');await p.until(`location.pathname==='/judique-1884' && window.mmm?.era?.id==='1884'`);await p.inspect('1884',label+'-1884','judique');
  assert.equal(await p.read('mmm.history.area'),'judique');assert.equal(await p.read('mmm.history.trades.length'),37);
  await p.click('#titleEra');await p.until(`location.pathname==='/judique' && window.mmm?.era?.id==='today'`);await p.inspect('today',undefined,'judique');
 });
}
for(const path of ['/judique-1884?site=just&q=low&keep=yes','/judique?site=just&era=1884&q=low&keep=yes'])await page(path,1280,900,p=>p.inspect('1884',undefined,'judique'));
// Direct short-address entry, old query address, all non-Mabou areas and both mail-era cases.
for(const path of ['/mabou-1884?site=just&q=low&keep=yes','/mabou?site=just&era=1884&q=low&keep=yes'])await page(path,1280,900,p=>p.inspect('1884'));
for(const path of ['/porthood?site=just','/pointtupper?site=just','/westbay?site=just','/cansocauseway?site=just','/?mode=mail','/?mode=explore','/?era=1884','/mabou-1884'])await page(path+(path.includes('?')?'&':'?')+'q=low&title=1',390,844,async p=>{assert.equal(await p.read(`!!document.getElementById('titleEra')`),false,path);});
// Real host path, without the localhost brand override.
base.hostname='justdrive.localhost';await page('/mabou-1884?q=low&title=1',1280,900,async p=>{
 assert.equal(await p.read('mmm.era.id'),'1884');assert.equal(new URL(await p.read(`document.getElementById('titleEra').href`)).pathname,'/mabou');
 await p.click('#titleStart');await p.click('#gear');
 await p.read(`const area=document.getElementById('siteArea');area.value='porthood';area.dispatchEvent(new Event('change'));`);
 await p.until(`location.pathname==='/porthood' && window.mmm?.era?.id==='today' && document.documentElement.dataset.mmmReady==='true'`);
 assert.equal(await p.read(`!!document.getElementById('titleEra')`),false);
 assert.equal(await p.read(`new URLSearchParams(location.search).has('era')`),false,'alias does not become an era query during an area change');
 await p.read(`const area=document.getElementById('siteArea');area.value='mabou';area.dispatchEvent(new Event('change'));`);
 await p.until(`location.pathname==='/mabou' && window.mmm?.era?.id==='today' && document.documentElement.dataset.mmmReady==='true'`);
 assert.equal(await p.read(`document.getElementById('titleEra').textContent`),'Go back to Mabou in 1884 →');
});
writeFileSync(`${pictures}/rectangles.json`,JSON.stringify(records,null,2));
console.log('PASS era door visibility, real mouse/touch round trips, direct alias, title/horse/MP, phone rectangles and hidden driving link');
