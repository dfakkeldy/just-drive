#!/usr/bin/env node
// Parent-run only: one serial CDP browser job, PNGs and rectangle evidence in OUT.
// OUT="$PWD/data/work/phone-hud-delivery" WEB_PORT=5368 CDP_PORT=9568 VITE_MP=1 HUD=1 RUN=phone-hud-browser.mjs VIEWS="phone|x=1" tools/yard-shots.sh 844 390
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { cdp, cdpFetch } from './cdp.mjs';
import { mpLayoutScript } from './mp-layout-fixture.mjs';
const [out,first]=process.argv.slice(2), base=new URL(first).origin, port=process.env.CDP_PORT??'9568';
mkdirSync(out,{recursive:true});
const defaultSizes=[[844,390],[932,430],[1000,462],[390,844],[430,932],[375,553],[375,667],[390,664],[553,375],[667,375,true],[568,320],[640,360]];
const wanted=(process.env.SIZES??'').trim().split(/\s+/).filter(Boolean);
const sizeKey=([w,h,safe])=>`${w}x${h}${safe?'-safe':''}`;
for(const name of wanted)assert.ok(defaultSizes.some(s=>sizeKey(s)===name),'unknown phone size '+name);
const sizes=defaultSizes.filter(s=>!wanted.length||wanted.includes(sizeKey(s)));
const ids=['phoneLine','hud','shiftHud','stopHint','miniMap','relief','radio','photoTag','gear','tcReset','tcView','tcHorn','tcTrack','tcBrake','tcGo','tcPull','cameraButton','mailButton','placesButton','bikeJump'];
const controls=['gear','tcReset','tcView','tcHorn','tcSteer','tcBrake','tcGo','tcPull','cameraButton','mailButton','miniMapHead','relief','radio','placesButton'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const overlaps=(a,b,epsilon=1)=>Math.min(a.right,b.right)>Math.max(a.left,b.left)+epsilon && Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+epsilon;
const evidence=[],failures=[];
for(const [name,query] of [['mail','mode=mail'],['drive','mode=explore'],['just-drive','mode=explore&site=just'],['bike','mode=explore&vehicle=bike'],['just-bike','mode=explore&site=just&vehicle=bike']]) for(const [width,height,safeLandscape=false] of sizes) {
  const safe={left:safeLandscape?47:0,right:safeLandscape?47:0,bottom:safeLandscape?21:0,top:0};
  const tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  const connection=await cdp(tab.webSocketDebuggerUrl), {send}=connection;
  const read=async expression=>{
    const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    assert.ok(!r.error,JSON.stringify(r.error)); return r.result.result.value;
  };
  const until=async expression=>{for(let k=0;k<180;k++){if(await read(expression))return;await sleep(500);}throw Error('timeout: '+expression);};
  const shot=async suffix=>writeFileSync(`${out}/${name}-${width}x${height}${safeLandscape?'-safe':''}${suffix}.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).result.data,'base64'));
  const boxes=async()=>read(`(() => {
    const visible=e=>e && e.getClientRects().length && !e.closest('[hidden]') && getComputedStyle(e).visibility!=='hidden' && getComputedStyle(e).display!=='none';
    return ${JSON.stringify([...new Set([...ids,...controls])])}.flatMap(id=>{const e=document.getElementById(id);if(!visible(e))return [];const b=e.getBoundingClientRect();return [{id,left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height}];});
  })()`);
  const inspect=async state=>{
    assert.equal(await read(`(()=>{const style=id=>getComputedStyle(document.getElementById(id)),base=style('tcReset');return ['placesButton','pauseButton'].every(id=>{const e=document.getElementById(id);if(!e||!e.getClientRects().length)return true;const s=style(id);return s.fontWeight==='700'&&s.fontSize==='12px'&&s.letterSpacing===base.letterSpacing&&s.borderTopColor===base.borderTopColor&&s.borderRadius==='10px';})&&base.fontWeight==='700'&&base.fontSize==='12px'&&base.borderRadius==='10px'&&style('gear').fontSize==='20px';})()`),true,'word tiles share touch type and rims; gear keeps its glyph size');
    assert.equal(await read(`(()=>['tcReset','tcView','tcHorn'].every(id=>{const e=document.getElementById(id),s=getComputedStyle(e),b=e.getBoundingClientRect(),r=document.createRange();r.selectNodeContents(e);const text=r.getBoundingClientRect();return text.left>=b.left+parseFloat(s.borderLeftWidth)&&text.right<=b.right-parseFloat(s.borderRightWidth)&&text.top>=b.top&&text.bottom<=b.bottom;}))()`),true,'RESET, VIEW and HORN labels fit their tiles at the shared type size');
    const all=await boxes(), list=all.filter(b=>ids.includes(b.id)), buttons=all.filter(b=>controls.includes(b.id));
    for(const b of list) assert.ok(b.left>=safe.left-1&&b.top>=safe.top-1&&b.right<=width-safe.right+1&&b.bottom<=height-safe.bottom+1,`${b.id} outside viewport`);
    for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++)assert.ok(!overlaps(list[i],list[j]),`${list[i].id} overlaps ${list[j].id}`);
    for(const id of ['tcTrack','tcBrake','tcGo','gear','tcReset','tcView','tcHorn'])assert.ok(list.some(b=>b.id===id),'missing '+id);
    for(const b of buttons){const minimum=b.id==='mailButton'?64:56;assert.ok(b.width>=minimum&&b.height>=minimum,`${b.id} too small`);}
    assert.deepEqual(await read(`(${JSON.stringify(buttons.map(b=>b.id))}).filter(id=>{const e=document.getElementById(id),b=e.getBoundingClientRect(),at=document.elementFromPoint((b.left+b.right)/2,(b.top+b.bottom)/2);return !(at===e||e.contains(at));})`),[],'control centres receive touches');
    if(name==='mail') {
      const m=list.find(b=>b.id==='mailButton'), c=list.find(b=>b.id==='cameraButton'), go=list.find(b=>b.id==='tcGo');
      assert.ok(m&&c&&go,'MAIL, CAMERA and GO present'); assert.ok(m.width>=64&&m.height>=64&&c.width>=64&&c.height>=64);
      assert.ok(m.right>=width-safe.right-24&&m.bottom<=go.top&&go.top-m.bottom<=16,'MAIL directly above GO at right edge');
      const beside=Math.abs(c.bottom-m.bottom)<=1&&c.right<=m.left&&m.left-c.right<=16;
      const above=Math.abs(c.right-m.right)<=1&&c.bottom<=m.top&&m.top-c.bottom<=16;
      assert.ok(beside||above,'CAMERA beside MAIL, or immediately above it on a short safe-area viewport');
      if(width>height){
        const band={left:width*.25,right:width*.75,top:height*.22,bottom:height*.78};
        for(const b of list)assert.ok(!overlaps(b,band,.01),`${b.id} enters central driving band`);
      }
      assert.ok(list.some(b=>b.id==='phoneLine'),'compact status present');
      assert.ok(!list.some(b=>b.id==='hud'||b.id==='shiftHud'),'old stacked status hidden');
    } else {
      assert.ok(!list.some(b=>b.id==='mailButton'||b.id==='cameraButton'||b.id==='shiftHud'||b.id==='relief'),'drive mode hides mail functions');
      assert.ok(await read(`document.body.classList.contains('compactPhone')`),'shared compact free-drive grid');
      if(name.endsWith('bike')){assert.equal(await read(`document.body.classList.contains('bikeMode')`),true);assert.ok(list.some(b=>b.id==='tcPull'),'bike pull retained');}
    }
    const clearBand=width>height ? {left:width*.25,right:width*.75,top:height*.22,bottom:height*.78}
      : {left:width*.25,right:width*.75,top:height*.30,bottom:height*.72};
    for(const b of list)assert.ok(!overlaps(b,clearBand,.01),`${b.id} enters ${width>height?'landscape':'portrait'} clear band`);
    evidence.push({name,width,height,insets:safe,state,multiplayer:true,rectangles:all});
  };
  try {
    await send('Page.enable');await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
    await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.clear();localStorage.setItem('mmm.mp','1');localStorage.setItem('mmm.picture','fast');`});
    await send('Page.addScriptToEvaluateOnNewDocument',{source:mpLayoutScript});
    const origin=new URL(base); if(name.startsWith('just-'))origin.hostname='localhost';
    await send('Page.navigate',{url:`${origin.origin}/mabou?${query}&touch=1&q=low&res=1&hud=1&title=1`});
    await until(`!!window.mmm?.vehicle && document.documentElement.dataset.mmmReady==='true' && !!document.getElementById('titleStart')`);
    await until(`!!document.querySelector('#titleCard .mpControl .mpToggle[aria-checked="true"]')`);
    await read(`document.getElementById('titleStart').click()`);
    await until(`document.body.classList.contains('tcOn') && document.documentElement.dataset.mmmReady==='true'`);
    assert.equal(await read('mmm.gameMode'),name==='mail'?'mail':'explore');
    if(name.endsWith('bike'))assert.equal(await read('mmm.vehicleId'),'bike');
    await until(`!!document.getElementById('radio') && !!mmm.mp.current && mmm.mp.current.status.includes('23 other drivers')`);
    assert.equal(await read(`mmm.radio.storageKey`),name.startsWith('just-')?'mmm.radio.just':'mmm.radio');
    assert.equal(await read(`!!document.getElementById('mpChip')`),false,'touch multiplayer stays in settings');
    if(safeLandscape){
      const override=await send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:21,left:47,right:47}});
      if(override.error)await read(`Object.entries({'--test-safe-left':'47px','--test-safe-right':'47px','--test-safe-bottom':'21px'}).forEach(([k,v])=>document.documentElement.style.setProperty(k,v))`);
      await sleep(150);
    }
    await inspect('initial');await shot('');
    assert.equal(await read('mmm.vehicle.touchSpeedLimit'),name==='mail','production mode sets cap for this ride');
    assert.equal(await read(`document.getElementById('phoneLine')?.textContent.includes('LIMIT') ?? false`),false,'resting status has no limiter marker');
    if(name==='mail') {
      const before=(await boxes()).find(b=>b.id==='phoneLine');
      // Render fixture only: physics/activation is checked by phone-speed-cap. Feed the real
      // frame and PhoneMailHud a held-cap reading so every viewport paints the longest marker.
      await read(`(()=>{const v=mmm.vehicle,update=v.update;window.restoreCapRender=()=>{delete v.activeTouchSpeedLimit;delete v.update;};Object.defineProperty(v,'activeTouchSpeedLimit',{value:100/3.6,configurable:true});v.update=function(...args){update.apply(this,args);this.speed=100/3.6;};})()`);
      await until(`document.getElementById('phoneLine').textContent.startsWith('100 km/h ▸ LIMIT 100')`);
      const marked=(await boxes()).find(b=>b.id==='phoneLine');
      assert.equal(marked.width,before.width,'marker does not widen status');
      assert.equal(marked.height,before.height,'marker does not increase status height');
      assert.equal(await read(`(()=>{const e=document.getElementById('phoneLine'),r=document.createRange();r.setStart(e.firstChild,0);r.setEnd(e.firstChild,e.textContent.indexOf('LIMIT 100')+9);return r.getBoundingClientRect().right<=e.getBoundingClientRect().right-5;})()`),true,'full speed and LIMIT marker paint before ellipsis');
      await inspect('held limit render fixture');await shot('-limit');
      await read('restoreCapRender();delete window.restoreCapRender');
      await until(`!document.getElementById('phoneLine').textContent.includes('LIMIT')`);
    }
    const menu=await read(`document.body.classList.contains('phoneReadoutsMenu')`);
    if(menu) {
      await read(`document.getElementById('gear').click()`);
      assert.deepEqual(await read(`['miniMapHead','radio',...(mmm.gameMode==='mail'?['relief']:[])].filter(id=>{const e=document.getElementById(id);if(!e||!e.closest('#settings'))return true;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.width<56||r.height<56||!(at===e||e.contains(at));})`),[],'narrow readouts remain reachable in settings');
      await read(`document.getElementById('miniMapHead').scrollIntoView({block:'center'});document.getElementById('miniMapHead').click()`);await shot('-readouts');
      await read(`document.getElementById('gear').click()`);
    } else await read(`document.getElementById('miniMapHead').click()`);
    await sleep(200);await inspect('map toggled');await shot('-map');
    if(name==='mail'&&width===844) {
      await read(`document.getElementById('radio').click()`);await sleep(100);
      assert.equal(await read(`document.getElementById('radio').classList.contains('expanded')`),true);
      await inspect('radio song');await shot('-radio');await sleep(4200);
      assert.equal(await read(`document.getElementById('radio').classList.contains('expanded')`),false,'song folds after four seconds');
    }
    // The real touch dispatcher verifies pedal hold/release; it also runs for the bike.
    const go=(await boxes()).find(b=>b.id==='tcGo');
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:(go.left+go.right)/2,y:(go.top+go.bottom)/2,id:1}]});
    await sleep(100);assert.equal(await read(`document.getElementById('tcGo').classList.contains('held')`),true);
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(100);
    assert.equal(await read(`document.getElementById('tcGo').classList.contains('held')`),false);
    if(name==='mail') {
      await read(`document.getElementById('cameraButton').click()`);await sleep(700);
      assert.equal(await read(`document.body.classList.contains('introDone')`),true,'camera dismisses intro');
      await inspect('photo note');await shot('-photo');
      if(menu)assert.ok(await read(`!!document.getElementById('photoCaption').textContent && !!document.getElementById('photoTag').closest('#settings')`),'photo feedback retained in the readout panel');
      await read(`document.getElementById('gear').click()`);
      assert.equal(await read(`(()=>{const label=[...document.querySelectorAll('#settings label')].find(e=>e.textContent==='Throw help');if(!label)return false;const b=label.querySelector('input');if(!b.checked)return false;b.click();if(localStorage.getItem('mmm.throwHelp')!=='0')return false;b.click();return localStorage.getItem('mmm.throwHelp')==='1';})()`),true,'Throw help uses saved toggle');
      await read(`document.getElementById('gear').click()`);
    }
    if(width<height) {
      await read(`document.getElementById('gear').click()`);
      assert.equal(await read(`(()=>{const s=document.querySelector('#settings .mpControl');if(!s)return false;const toggle=s.querySelector('.mpToggle');toggle.scrollIntoView({block:'center'});const r=toggle.getBoundingClientRect(),at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return toggle.getAttribute('aria-checked')==='true'&&(at===toggle||toggle.contains(at));})()`),true,'multiplayer controls shown and reachable');
      await shot('-multiplayer');await read(`document.getElementById('gear').click()`);
      await inspect('multiplayer settings closed');
    }
    if(width<height) {
      await read(`document.documentElement.style.setProperty('--test-safe-top','47px');document.documentElement.style.setProperty('--test-safe-bottom','34px')`);
      safe.top=47; safe.bottom=34;
      const browserTop=await read(`document.getElementById('phoneTop').getBoundingClientRect().top`);
      assert.ok(Math.abs(browserTop-53)<.1,'browser remains safe top plus 6 px');
      const emulation=await send('Emulation.setEmulatedMedia',{features:[{name:'display-mode',value:'standalone'}]});
      assert.ok(!emulation.error,JSON.stringify(emulation.error));
      const native=await read(`matchMedia('(display-mode: standalone)').matches`);
      if(!native) await read(`Object.defineProperty(navigator,'standalone',{value:true,configurable:true});dispatchEvent(new Event('pageshow'))`);
      await sleep(100);
      const top=await read(`document.getElementById('phoneTop').getBoundingClientRect().top`);
      assert.ok(Math.abs(top-63)<.1,'standalone row is safe top plus 16 px');
      await inspect('standalone notch');await shot('-standalone');
      console.log(`${name} ${width}x${height} standalone: native media ${native}, top ${top}`);
      // Also exercise the iOS navigator.standalone fallback, including a return to Safari.
      await send('Emulation.setEmulatedMedia',{features:[]});
      await read(`Object.defineProperty(navigator,'standalone',{value:true,configurable:true});dispatchEvent(new Event('pageshow'))`);await sleep(100);
      assert.ok(Math.abs(await read(`document.getElementById('phoneTop').getBoundingClientRect().top`)-63)<.1,'navigator.standalone fallback');
      await read(`Object.defineProperty(navigator,'standalone',{value:false,configurable:true});dispatchEvent(new Event('pageshow'))`);await sleep(100);
      assert.equal(await read(`document.getElementById('phoneTop').getBoundingClientRect().top`),browserTop,'Safari spacing unchanged');
      await read(`document.documentElement.style.removeProperty('--test-safe-top');document.documentElement.style.removeProperty('--test-safe-bottom')`);
      safe.top=0;safe.bottom=0;
    }
    if(name.endsWith('bike')) {
      const pull=(await boxes()).find(b=>b.id==='tcPull');assert.ok(pull,'PULL visible');
      await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:(pull.left+pull.right)/2,y:(pull.top+pull.bottom)/2,id:2}]});
      await sleep(100);assert.equal(await read(`document.getElementById('tcPull').classList.contains('held')`),true);
      await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(100);
      assert.equal(await read(`document.getElementById('tcPull').classList.contains('held')`),false,'PULL releases');
    }
    assert.deepEqual(connection.errors,[],'no page exceptions');console.log(`PASS ${name} ${width}x${height}`);
  } catch(error) { failures.push(`${name} ${width}x${height}: ${error.message}`);console.error(failures.at(-1));await shot('-FAILED').catch(()=>{}); }
  finally { await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);connection.close(); }
}
writeFileSync(`${out}/rectangles.json`,JSON.stringify(evidence,null,2));
assert.deepEqual(failures,[],'phone HUD browser rows');
