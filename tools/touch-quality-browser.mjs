// RUN=touch-quality-browser.mjs through yard-shots.sh. All frame times are injected, never measured on this Mac.
// TOUCH_MUTATIONS=1 also runs one broken served module per rule; no on-disk source is changed.
import assert from 'node:assert/strict';
import {DEADLINE} from './cdp.mjs';
import { writeFileSync } from 'node:fs';
const [out, first] = process.argv.slice(2), base = new URL(first).origin, port = process.env.CDP_PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mutants = [
 ['default','touch-quality-policy.ts','touch && (saved !== "high" || !writable)','false'],
 ['switch','detail.ts','saved = saveDetail(nextSaved);','saved = saveDetail("low");'],
 ['switch-clear','detail.ts','writeQuality(qualityTransition(readQuality(), { type: "reset" }).state)','true'],
 ['start-write-failure','touch-quality.ts','if (!writeVerified(DETAIL_TRYING, "try"))','if (false)'],
 ['refused-start-readback-cleanup','touch-quality.ts','writeVerified(DETAIL_TRYING, null);','/* omit cleanup */'],
 ['health','touch-quality-policy.ts','s.mark = "ok";','s.mark = null;'],
 ['stale','touch-quality-policy.ts','if (s.mark === "try") return fallback("device");','if (false) return fallback("device");'],
 ['notice','touch-quality.ts','if (!writeVerified(NOTICE, "shown:" + notice)) return;','/* omit consumption */'],
 ['context','touch-quality.ts','event({ type: "lost" })','event({ type: "show" })'],
 ['slow','main.ts','quality.frame(clockDt,','quality.frame(0,'],
 ['visibility','touch-quality.ts','type: document.hidden ? "hide" : "show"','type: "show"'],
 ['pagehide','touch-quality.ts','event({ type: "leave" })','event({ type: "show" })'],
 ['deaths','touch-quality-policy.ts','s.deaths >= 2','s.deaths >= 3'],
 ['unfinished','touch-quality-policy.ts','s.unfinished >= 3','s.unfinished >= 4'],
 ['forced','touch-quality-policy.ts','touch && !forced','touch'],
 ['ratios','picture.ts','choice === "balanced" ? 1.35','choice === "balanced" ? 1.5'],
 ['separate','picture.ts','const PHONE_KEY = "mmm.phone.picture";','const PHONE_KEY = "mmm.picture";'],
 ['duplicates','picture.ts','phone ? choices : ORDER','ORDER'],
 ['measurement','picture.ts','!touch && saved === null','saved === null'],
 ['ending-crawl','main.ts','if (!interiors.busy || endings.busy)','if (!interiors.busy && !endings.busy)'],
 ['no-draw-pause','main.ts','quality.frame(0, false);','/* omit pause */'],
 ['desktop','main.ts','if (rate < 30) detail?.nudge(rate);','/* no nudge */'],
];
async function page(mutation, block) {
  const version=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browserSocket=new WebSocket(version.webSocketDebuggerUrl);await new Promise((r,j)=>{browserSocket.onopen=r;browserSocket.onerror=j;});
  let browserId=0;const browserWaiting=new Map();
  browserSocket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){browserWaiting.get(m.id)?.(m);browserWaiting.delete(m.id);}};
  const browserSend=(method,params={})=>new Promise((r,j)=>{const id=++browserId,t=setTimeout(()=>{browserWaiting.delete(id);j(new Error('browser timeout '+method));},DEADLINE);browserWaiting.set(id,m=>{clearTimeout(t);if(m.error)j(new Error(method+': '+JSON.stringify(m.error)));else r(m);});browserSocket.send(JSON.stringify({id,method,params}));});
  const targetId=(await browserSend('Target.createTarget',{url:'about:blank',newWindow:true,background:false})).result.targetId;
  const tab=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.id===targetId);
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r,j) => { ws.onopen=r; ws.onerror=j; });
  let id=0, hits=0, interceptError=null; const pending=new Map(), errors=[];
  const send=(method,params={})=>new Promise((r,j)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);j(new Error('CDP timeout '+method));},45000);pending.set(n,m=>{clearTimeout(timer);r(m);});ws.send(JSON.stringify({id:n,method,params}));});
  ws.onmessage=async ({data})=>{
    const m=JSON.parse(data);
    if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}
    if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
    if(m.method==='Fetch.requestPaused') {
      try {
        const p=m.params, body=await send('Fetch.getResponseBody',{requestId:p.requestId});
        let source=body.result.base64Encoded ? Buffer.from(body.result.body,'base64').toString() : body.result.body;
        assert.ok(source.includes(mutation[2]),`mutation target missing: ${mutation[0]}`);
        source=source.replace(mutation[2],mutation[3]); hits++;
        await send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:200,
          responseHeaders:[{name:'Content-Type',value:'application/javascript'}],body:Buffer.from(source).toString('base64')});
      } catch(e) { interceptError=e; await send('Fetch.continueRequest',{requestId:m.params.requestId}); }
    }
  };
  const read=async expression=>{
    const m=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    assert.ok(!m.error&&!m.result?.exceptionDetails,JSON.stringify(m)); return m.result.result.value;
  };
  const until=async(expression,label)=>{
    for(let i=0;i<400;i++){if(interceptError)throw interceptError;if(await read(expression))return;await sleep(150);}
    throw new Error(`timeout: ${label}`);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled',{cacheDisabled:true});
  await send('Emulation.setFocusEmulationEnabled',{enabled:false});
  await send('Emulation.setTouchEmulationEnabled',{enabled:false});
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:3,mobile:false});
  await send('Emulation.setFocusEmulationEnabled',{enabled:false});
  if(mutation)await send('Fetch.enable',{patterns:[{urlPattern:`*/src/${mutation[1]}*`,requestStage:'Response'}]});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    // A deterministic RAF clock: no timing result depends on this shared GPU.
    window.__qualityDoc=crypto.randomUUID();
    const store=localStorage, get=Storage.prototype.getItem, set=Storage.prototype.setItem, remove=Storage.prototype.removeItem;
    window.__qualityGet=key=>get.call(store,key);
    window.__qualityStore=()=>Object.fromEntries(Array.from({length:store.length},(_,i)=>{const key=store.key(i);return [key,get.call(store,key)];}));
    window.__qualitySeed=values=>{store.clear();Object.entries(values).forEach(([k,v])=>set.call(store,k,v));};
    window.__events=[];
    document.addEventListener('visibilitychange',ev=>{window.__events.push({type:'visibilitychange',hidden:document.hidden,trusted:ev.isTrusted,at:Date.now()});});
    addEventListener('pagehide',ev=>sessionStorage.setItem('quality.lastLeave',JSON.stringify({trusted:ev.isTrusted,mark:window.__qualityGet('mmm.detail.trying')})));
    addEventListener('pageshow',ev=>window.__events.push({type:'pageshow',persisted:ev.persisted,trusted:ev.isTrusted}));
    const blocked=${JSON.stringify(block ?? null)};
    if(blocked==='read'||blocked==='all')Storage.prototype.getItem=function(key){if(this===store)throw new Error('read blocked');return get.call(this,key);};
    if(blocked==='write'||blocked==='all')Storage.prototype.setItem=function(key,value){if(this===store)throw new Error('write blocked');return set.call(this,key,value);};
    if(blocked==='mark')Storage.prototype.setItem=function(k,v){if(this===store&&k==='mmm.detail.trying'&&v==='try')return;return set.call(this,k,v);};
    const earlyGet=Storage.prototype.getItem,earlySet=Storage.prototype.setItem,earlyRemove=Storage.prototype.removeItem;
    const lateFail=(key,value)=>{
      const mode=get.call(sessionStorage,'qa.lateFault');if(!mode)return false;
      const n=Number(get.call(sessionStorage,'qa.writeCount')||0)+1;set.call(sessionStorage,'qa.writeCount',String(n));
      if(mode==='always'||mode==='detail-only'&&key==='mmm.detail'||mode==='death-counter'&&key==='mmm.detail.deaths'&&value==='1')throw new Error('late write blocked');
      if(mode==='once'&&n===1)throw new Error('one late write blocked');
      if(mode==='health-hold'&&key==='mmm.detail.trying'&&value==='ok'&&!get.call(sessionStorage,'qa.healthRelease'))throw new Error('health write held');
      if(mode==='notice-once'&&key==='mmm.detail.recovered'&&(value===null||String(value).startsWith('shown:'))&&!get.call(sessionStorage,'qa.noticeFailed')){set.call(sessionStorage,'qa.noticeFailed','1');throw new Error('one notice operation');}
      if(mode==='try-read-hold'&&key==='mmm.detail.trying'&&value===null&&!get.call(sessionStorage,'qa.readRelease'))return true;
      return mode==='drop-detail'&&key==='mmm.detail';
    };
    Storage.prototype.setItem=function(k,v){if(this===store&&lateFail(k,v))return;const result=earlySet.call(this,k,v);const mode=get.call(sessionStorage,'qa.lateFault');if(this===store&&k==='mmm.detail.trying'&&v==='try'&&mode?.startsWith('try-read-')&&!get.call(sessionStorage,'qa.readArmed')){set.call(sessionStorage,'qa.readArmed','1');set.call(sessionStorage,'qa.readPending','1');}return result;};
    Storage.prototype.getItem=function(k){if(this===store&&k==='mmm.detail.trying'&&get.call(sessionStorage,'qa.readPending')){const mode=get.call(sessionStorage,'qa.lateFault');if(mode==='try-read-hold'&&!get.call(sessionStorage,'qa.readRelease'))throw new Error('read-back held');if(mode==='try-read-once'||mode==='try-read-stale'){remove.call(sessionStorage,'qa.readPending');if(mode==='try-read-stale')return null;throw new Error('one read-back');}}return earlyGet.call(this,k);};
    Storage.prototype.removeItem=function(k){if(this===store&&lateFail(k,null))return;return earlyRemove.call(this,k);};
    window.__qaArm=mode=>{set.call(sessionStorage,'qa.lateFault',mode);set.call(sessionStorage,'qa.writeCount','0');for(const key of ['qa.healthRelease','qa.noticeFailed','qa.readRelease','qa.readArmed','qa.readPending'])remove.call(sessionStorage,key);};
    if(blocked==='access')Object.defineProperty(window,'localStorage',{get(){throw new Error('storage blocked');}});
    const raf=requestAnimationFrame; let clock=performance.now(); window.__frameStep=new URLSearchParams(location.search).has('slowPicture')?100:1000/60;
    const runFrame=fn=>{const step=window.__nextFrameStep??window.__frameStep;window.__nextFrameStep=null;fn(clock+=step);};
    window.requestAnimationFrame=fn=>raf(()=>{
      // Hold only the game loop (main.ts frame; the dev server keeps names). A rename fails 'started game' loudly.
      if(window.__qualityHoldFrames&&fn.name==='frame'){window.__qualityHeldFrame=()=>runFrame(fn);return;}
      runFrame(fn);
    });
    window.__qualityResumeFrame=()=>{window.__qualityHoldFrames=false;const frame=window.__qualityHeldFrame;window.__qualityHeldFrame=null;frame?.();};
    const fetchAsset=window.fetch.bind(window);
    window.fetch=(url,...args)=>{
      if(!window.__sawAsset && String(url).includes('manifest.json')){window.__sawAsset=true;window.__markAtAsset=window.__qualityGet('mmm.detail.trying');}
      return fetchAsset(url,...args);
    };
    const context=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){
      if(kind==='webgl2' && this.id==='c') window.__markAtContext=window.__qualityGet('mmm.detail.trying');
      return context.call(this,kind,...args);
    };
  `});
  // Enter the origin without starting the heavy game, so each test seeds before its first real start.
  await send('Page.navigate',{url:`${base}/terrain/manifest.json`});
  await until('location.origin === '+JSON.stringify(base),'seed origin');
  const seed=async values=>read(`window.__qualitySeed(${JSON.stringify(values)})`);
  const load=async(query='touch=1', settled=true)=>{
    // Inspect loading before the first production frame, then let the next document run normally.
    const hold=settled?null:(await send('Page.addScriptToEvaluateOnNewDocument',{source:'window.__qualityHoldFrames=true;'})).result?.identifier;
    if(!settled&&!hold)throw new Error('could not install the first-frame hold');
    let failed=false;
    try {
      const previous=await read('window.__qualityDoc');
      await send('Page.navigate',{url:`${base}/?x=1&hud=1&radio=0&mode=${process.env.TOUCH_MODE ?? 'mail'}&${query}`});
      await until(`window.__qualityDoc!==${JSON.stringify(previous)} && !!window.mmm && ${settled ? "document.title==='settled'" : '!!window.__qualityHeldFrame'}`,'started game');
    } catch(error) {failed=true;throw error;}
    finally {
      // Later documents run normally. A failed removal is reported unless it would hide the first error.
      if(hold){const removed=await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:hold}).catch(error=>({error}));if(removed.error&&!failed)throw new Error('could not remove the first-frame hold: '+JSON.stringify(removed.error));}
    }
  };
  const resume=()=>read('window.__qualityResumeFrame();true');
  const reload=async()=>{ const previous=await read('window.__qualityDoc');await read(`addEventListener('pagehide',()=>sessionStorage.setItem('quality.afterLeave',window.__qualityGet('mmm.detail.trying')),{once:true});location.reload()`);await until(`window.__qualityDoc!==${JSON.stringify(previous)} && !!window.mmm && document.title==='settled'`,'reloaded game'); };
  const flip=async()=>{
    const previous=await read('window.__qualityDoc');
    const point=await read(`(()=>{document.getElementById('settings').classList.add('open');const label=document.querySelector('#detail label');label.scrollIntoView({block:'center'});const r=label.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,touch:document.body.classList.contains('tcOn')};})()`);
    await send('Page.bringToFront');
    if(point.touch){
      await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
      await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:point.x,y:point.y}]});
      await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }else{
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',buttons:1,clickCount:1});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',buttons:0,clickCount:1});
    }
    await until(`window.__qualityDoc!==${JSON.stringify(previous)} && !!window.mmm && document.title==='settled'`,'switch reload');
    await send('Emulation.setTouchEmulationEnabled',{enabled:false});
    await send('Emulation.setFocusEmulationEnabled',{enabled:false});
  };
  const state=()=>read(`({low:mmm.low, ratio:mmm.renderer.getPixelRatio(),saved:window.__qualityGet('mmm.detail'),
    mark:window.__qualityGet('mmm.detail.trying'), unfinished:Number(window.__qualityGet('mmm.detail.unfinished')||0), deaths:Number(window.__qualityGet('mmm.detail.deaths')||0), disabled:document.querySelector('#detail input')?.disabled, asset:window.__markAtAsset, early:window.__markAtContext, trial:mmm.quality.state,
    touch:document.body.classList.contains('tcOn'), checked:document.querySelector('#detail input')?.checked,
    label:document.querySelector('#detail label')?.textContent, notice:document.querySelector('#detailRecovery')?.textContent ?? null,
    open:document.getElementById('settings').classList.contains('open'), measuring:mmm.picture?.measuring})`);
  const silent=async(saved)=>{
    const snapshot=saved??await read('window.__qualityStore()'), previous=await read('window.__qualityDoc');
    await send('Page.navigate',{url:`${base}/terrain/manifest.json`});
    await until(`window.__qualityDoc!==${JSON.stringify(previous)} && !window.mmm`,'fresh document for silent-kill snapshot');
    await seed(snapshot); await load();
  };
  let gameWindow=null;
  const hiddenStore=async()=>{
    const record=await read(`JSON.parse(sessionStorage.getItem('qa.hidden')||'null')`);
    assert.ok(record?.hidden&&record.trusted,'trusted hidden event captured');return record.store;
  };
  const hide=async()=>{
    await read(`sessionStorage.removeItem('qa.hidden');if(!window.__qualityObserve){window.__qualityObserve=true;document.addEventListener('visibilitychange',ev=>{const record={hidden:document.hidden,trusted:ev.isTrusted,store:window.__qualityStore()};sessionStorage.setItem('qa.lastVisibility',JSON.stringify(record));if(record.hidden&&record.trusted)sessionStorage.setItem('qa.hidden',JSON.stringify(record));if(!record.hidden&&window.__returnGap){mmm.quality.frame(window.__returnGap/1000,true,true);window.__returnGap=null;}});}`);
    gameWindow=(await browserSend('Browser.getWindowForTarget',{targetId:tab.id})).result.windowId;
    await browserSend('Browser.setWindowBounds',{windowId:gameWindow,bounds:{windowState:'minimized'}});
    await sleep(200);
  };
  const show=async()=>{
    await browserSend('Browser.setWindowBounds',{windowId:gameWindow,bounds:{windowState:'minimized'}});
    await browserSend('Browser.setWindowBounds',{windowId:gameWindow,bounds:{windowState:'normal'}});
    await browserSend('Target.activateTarget',{targetId:tab.id});await send('Page.bringToFront');await until(`!document.hidden&&!!window.mmm&&document.title==='settled'`,'visible game');
  };
  const health=()=>read(`(()=>{mmm.quality.frame(0,false,false);for(let i=0;i<1200;i++)mmm.quality.frame(1/60,true,true);return window.__qualityGet('mmm.detail.trying');})()`);
  return {send,read,until,seed,load,reload,resume,flip,state,silent,hide,show,hiddenStore,health,check:()=>{if(interceptError)throw interceptError;assert.deepEqual(errors,[]);if(mutation)assert.ok(hits>0);},
    close:async()=>{await browserSend('Target.closeTarget',{targetId:tab.id});ws.close();browserSocket.close();}};
}
const LINE='Full detail was too much for this device. Phone detail is back on.';
const UNFINISHED='Full detail did not finish loading three times. Phone detail is back on.';
const expectLow=async(p,line=LINE)=>{
 await p.until(`!!window.mmm && mmm.low && document.title==='settled'`,'phone recovery');
 const s=await p.state();assert.ok(s.saved==='low'&&s.mark===null&&s.unfinished===0&&s.deaths===0&&s.notice===line,JSON.stringify(s));
};
const cases = {
 async default(p){await p.seed({});await p.load();const s=await p.state();assert.ok(s.low&&s.touch&&!s.checked&&s.saved===null&&s.mark===null&&s.ratio===1.35&&!s.measuring,JSON.stringify(s));},
 async switch(p){
  await p.seed({'mmm.detail.unfinished':'2','mmm.detail.deaths':'1'});await p.load();await p.flip();let s=await p.state();
  assert.ok(!s.low&&s.touch&&s.checked&&s.saved==='high'&&s.mark==='try'&&s.unfinished===0&&s.deaths===0,JSON.stringify(s));
  await p.flip();s=await p.state();assert.ok(s.low&&s.saved==='low'&&s.mark===null,JSON.stringify(s));
  await p.flip();assert.equal((await p.state()).mark,'try');
 },
 async 'switch-clear'(p){await cases.switch(p);},
 async mark(p){await p.seed({'mmm.detail':'high'});await p.load();const s=await p.state();assert.ok(!s.low&&s.asset==='try'&&s.early==='try'&&s.mark==='try',JSON.stringify(s));},
 async health(p){
  await p.seed({'mmm.detail':'high','mmm.detail.unfinished':'2','mmm.detail.deaths':'1'});await p.load();
  assert.equal(await p.health(),'ok');let s=await p.state();assert.ok(s.mark==='ok'&&s.trial==='healthy'&&s.unfinished===0&&s.deaths===1,JSON.stringify(s));
  await p.reload();s=await p.state();assert.ok(!s.low&&s.mark==='try'&&s.unfinished===0&&s.deaths===0,JSON.stringify(s));
 },
 async 'reload-loading'(p){
  await p.seed({'mmm.detail':'high'});await p.load('touch=1',false);assert.notEqual(await p.read('document.title'),'settled','reload before the first settled frame');
  await p.reload();let s=await p.state();assert.ok(!s.low&&s.saved==='high'&&s.mark==='try'&&s.unfinished===1&&s.deaths===0&&s.notice===null,JSON.stringify(s));
  assert.equal(await p.read(`JSON.parse(sessionStorage.getItem('quality.lastLeave')).trusted`),true,'real pagehide');
  assert.equal(await p.read(`sessionStorage.getItem('quality.afterLeave')`),'left-try','pagehide writes before visibilitychange');
 },
 async pagehide(p){await cases['reload-loading'](p);},
 async lock(p){
  await p.seed({'mmm.detail':'high'});await p.load();await p.hide();await p.show();
  const hidden=await p.hiddenStore();assert.equal(hidden['mmm.detail.trying'],'left-try');let s=await p.state();assert.equal(s.mark,'try');assert.equal(s.deaths,0);
  assert.equal(await p.health(),'ok');await p.read(`window.__returnGap=3600000`);await p.hide();await p.show();assert.equal((await p.hiddenStore())['mmm.detail.trying'],'left-ok');
  const ok=await p.read(`mmm.quality.session.reason===null&&window.__qualityGet('mmm.detail.trying')==='ok'`);if(!ok)console.log('resume diagnostic',await p.state(),await p.read('({session:mmm.quality.session,events:window.__events,record:sessionStorage.getItem(\"qa.hidden\")})'));assert.ok(ok);
  const events=await p.read('window.__events');assert.ok(events.some(e=>e.type==='visibilitychange'&&e.hidden&&e.trusted)&&events.some(e=>e.type==='visibilitychange'&&!e.hidden&&e.trusted),JSON.stringify(events));
  await p.reload();s=await p.state();assert.ok(!s.low&&s.mark==='try'&&s.unfinished===0&&s.deaths===0&&s.notice===null,JSON.stringify(s));
 },
 async visibility(p){await cases.lock(p);},
 async 'background-discard'(p){
  await p.seed({'mmm.detail':'high'});await p.load();await p.read(`window.__returnGap=3600000`);await p.hide();await p.show();const snapshot=await p.hiddenStore();assert.equal(snapshot['mmm.detail.trying'],'left-try');
  // Restore exactly the state captured while hidden, as a discarded document would leave it.
  await p.silent(snapshot);const s=await p.state();assert.ok(!s.low&&s.mark==='try'&&s.unfinished===1&&s.deaths===0&&s.notice===null,JSON.stringify(s));
 },
 async stale(p){await p.seed({'mmm.detail':'high'});await p.load();assert.equal((await p.state()).mark,'try');await p.silent();await expectLow(p);await p.reload();assert.equal((await p.state()).notice,null);},
 async notice(p){await cases.stale(p);},
 async 'clean-healthy-leave'(p){
  await p.seed({'mmm.detail':'high','mmm.detail.deaths':'1','mmm.detail.unfinished':'2'});await p.load();assert.equal(await p.health(),'ok');
  await p.reload();const s=await p.state();assert.ok(!s.low&&s.mark==='try'&&s.unfinished===0&&s.deaths===0&&s.notice===null,JSON.stringify(s));
 },
 async deaths(p){
  await p.seed({'mmm.detail':'high'});await p.load();assert.equal(await p.health(),'ok');await p.silent();let s=await p.state();assert.ok(!s.low&&s.deaths===1,JSON.stringify(s));
  assert.equal(await p.health(),'ok');assert.equal((await p.state()).deaths,1);await p.silent();await expectLow(p);await p.reload();assert.ok((await p.state()).low);
 },
 async unfinished(p){
  await p.seed({'mmm.detail':'high'});await p.load('touch=1',false);
  for(let n=1;n<=3;n++){await p.reload();if(n<3){const s=await p.state();assert.ok(!s.low&&s.unfinished===n&&s.deaths===0&&s.notice===null,JSON.stringify(s));}}
  await expectLow(p,UNFINISHED);await p.reload();assert.equal((await p.state()).notice,null);
 },
 async context(p){
  for(const healthy of [false,true]){await p.seed({'mmm.detail':'high'});await p.load();if(healthy)await p.health();await p.read(`mmm.renderer.getContext().getExtension('WEBGL_lose_context').loseContext()`);await expectLow(p);}
 },
 async slow(p){await p.seed({'mmm.detail':'high'});await p.load();await p.health();await p.read(`window.__frameStep=200`);await expectLow(p);},
 async forced(p){
  for(const [q,saved,mark]of [['high','low',null],['low','high','ok'],['high','high','try']]){
   const values={'mmm.detail':saved,'mmm.detail.deaths':'1','mmm.detail.unfinished':'2'};if(mark)values['mmm.detail.trying']=mark;
   await p.seed(values);await p.load(`touch=1&q=${q}`);const s=await p.state();assert.ok(s.low===(q==='low')&&s.saved===saved&&s.mark===mark&&s.trial===null&&s.deaths===1&&s.unfinished===2,JSON.stringify(s));
   await p.read(`for(let i=0;i<100;i++)mmm.quality.frame(.2,true,true);document.getElementById('c').dispatchEvent(new Event('webglcontextlost'))`);
   assert.equal((await p.state()).saved,saved);
  }
 },
 async 'start-write-failure'(p){
  await p.seed({'mmm.detail':'high','mmm.detail.unfinished':'2'});await p.load();const s=await p.state();
  assert.ok(s.low&&s.disabled&&s.trial===null&&s.mark===null&&s.unfinished===2,JSON.stringify(s));
  assert.match(await p.read(`document.getElementById('detail').textContent`),/This browser does not let the game save this choice/);
 },
 async 'single-start-readback'(p){
  for(const mode of ['try-read-once','try-read-stale']){
   await p.read(`window.mmm?.quality.chosen();window.__qaArm('${mode}')`);await p.seed({'mmm.detail':'high'});await p.load();
   let s=await p.state();assert.ok(!s.low&&s.mark==='try'&&s.notice===null,JSON.stringify(s));assert.equal(await p.read(`sessionStorage.getItem('qa.readArmed')`),'1');
   await p.reload();s=await p.state();assert.ok(!s.low&&s.notice===null,JSON.stringify(s));
  }
  await p.read(`sessionStorage.removeItem('qa.lateFault')`);
 },
 async 'refused-start-readback-cleanup'(p){
  await p.read(`window.__qaArm('try-read-hold')`);await p.seed({'mmm.detail':'high'});await p.load();let s=await p.state();
  assert.ok(s.low&&s.disabled&&s.mark==='try'&&s.notice===null,JSON.stringify(s));assert.equal(await p.read(`mmm.quality.persistence.intents.wanted['mmm.detail.trying']`),null);
  await p.read(`sessionStorage.setItem('qa.readRelease','1')`);await p.hide();await p.show();assert.equal((await p.state()).mark,null);
  await p.reload();s=await p.state();assert.ok(!s.low&&s.notice===null,JSON.stringify(s));await p.read(`sessionStorage.removeItem('qa.lateFault')`);
 },
 async 'notice-single-failure'(p){
  await p.seed({'mmm.detail':'high'});await p.load();await p.read(`window.__qaArm('notice-once');mmm.renderer.getContext().getExtension('WEBGL_lose_context').loseContext()`);await expectLow(p);
  assert.equal(await p.read(`sessionStorage.getItem('qa.noticeFailed')`),'1');assert.equal(await p.read(`window.__qualityGet('mmm.detail.recovered')`),'shown:device');
  for(let n=0;n<2;n++){await p.reload();assert.equal((await p.state()).notice,null);}
  await p.read(`sessionStorage.removeItem('qa.lateFault')`);
 },
 async 'health-write-retry'(p){
  await p.seed({'mmm.detail':'high'});await p.load();
  const result=await p.read(`(()=>{window.__qaArm('health-hold');mmm.quality.frame(0,false,false);for(let i=0;i<1200;i++)mmm.quality.frame(1/60,true,true);const before={mark:window.__qualityGet('mmm.detail.trying'),...mmm.quality.persistence};sessionStorage.setItem('qa.healthRelease','1');const at=before.retryAt,descriptor=Object.getOwnPropertyDescriptor(performance,'now');let early,after;try{Object.defineProperty(performance,'now',{configurable:true,value:()=>at-1});mmm.quality.frame(.1,true,true);early=window.__qualityGet('mmm.detail.trying');Object.defineProperty(performance,'now',{configurable:true,value:()=>at+1});mmm.quality.frame(.1,true,true);after={mark:window.__qualityGet('mmm.detail.trying'),...mmm.quality.persistence};}finally{if(descriptor)Object.defineProperty(performance,'now',descriptor);else delete performance.now;}return {before,early,after};})()`);
  assert.equal(result.before.mark,'try');assert.equal(result.before.wanted.mark,'ok');assert.equal(result.before.confirmed.mark,'try');assert.equal(result.early,'try');assert.equal(result.after.mark,'ok');assert.equal(result.after.pending,false);
 },
 async 'late-recovery-faults'(p){
  await p.seed({'mmm.detail':'high'});await p.load();
  let first=true;
  for(const fault of ['always','once','detail-only','drop-detail']){
   await p.read(`sessionStorage.removeItem('qa.lateFault')`);if(!first){await p.reload();await p.flip();assert.equal((await p.state()).low,false);}first=false;await p.health();
   await p.read(`window.__qaArm('${fault}');mmm.renderer.getContext().getExtension('WEBGL_lose_context').loseContext()`);
   await p.until(`!!window.mmm&&mmm.low&&document.title==='settled'`,'unpersistable recovery phone visit');
   let s=await p.state();assert.ok(s.low&&(fault==='always'?s.notice===null:s.notice===LINE),JSON.stringify(s));if(fault!=='once')assert.equal(await p.read(`new URLSearchParams(location.search).get('q')`),'low');
   for(let n=0;n<3;n++){await p.reload();s=await p.state();assert.ok(s.low,JSON.stringify(s));assert.equal(s.notice,null,'notice only once');}
  }
  await p.read(`sessionStorage.removeItem('qa.lateFault')`);
 },
 async 'counter-resume-write-failure'(p){
  await p.seed({'mmm.detail':'high','mmm.detail.trying':'ok'});await p.read(`window.__qaArm('death-counter')`);await p.load();
  await p.health();assert.equal(await p.read(`mmm.quality.session.mark`),'ok');await p.hide();await p.show();
  assert.equal((await p.hiddenStore())['mmm.detail.trying'],'left-ok');const s=await p.state();assert.equal(s.mark,'try','unconfirmed counters retain visible evidence');
  assert.equal(await p.read('mmm.quality.persistence.pending'),true);await p.silent();await expectLow(p);
 },
 async 'ending-crawl'(p){
  await p.seed({'mmm.detail':'high'});await p.load();await p.health();
  const before=await p.read(`mmm.endings.offer('test','Paused dialog',[],[{label:'Continue',action:()=>mmm.endings.close()}]);window.__frameStep=200;({busy:mmm.endings.busy,session:mmm.quality.session})`);
  assert.equal(before.busy,true);await expectLow(p);
 },
 async 'no-draw-pause'(p){
  await p.seed({'mmm.detail':'high'});await p.load();
  const result=await p.read(`new Promise(resolve=>{mmm.quality.frame(0,false,false);for(let i=0;i<50;i++)mmm.quality.frame(.2,true,true);const before={slow:mmm.quality.session.slow,draws:mmm.renderer.info.render.frame},indoor=mmm.interiors,shift=mmm.shift,original={busy:Object.getOwnPropertyDescriptor(indoor,'busy'),update:shift.updateIndoors,close:indoor.closeForDay,end:shift.end};Object.defineProperty(indoor,'busy',{configurable:true,get:()=>true});shift.updateIndoors=()=>true;indoor.closeForDay=()=>{};shift.end=()=>{};window.__frameStep=200;requestAnimationFrame(()=>{const after={slow:mmm.quality.session.slow,draws:mmm.renderer.info.render.frame};if(original.busy)Object.defineProperty(indoor,'busy',original.busy);else delete indoor.busy;shift.updateIndoors=original.update;indoor.closeForDay=original.close;shift.end=original.end;window.__frameStep=1000/60;resolve({before,after});});})`);
  assert.ok(result.before.slow>=9.99);assert.equal(result.after.draws,result.before.draws,'transition draws no frame');assert.equal(result.after.slow,0,'a non-drawing frame pauses the runs');
 },
 async blocked(p){
  await p.seed({'mmm.detail':'high','mmm.detail.unfinished':'2','mmm.detail.deaths':'1'});await p.load();const before=await p.read('window.__qualityDoc');let s=await p.state();assert.ok(s.low&&s.disabled&&!s.checked&&s.trial===null&&s.saved==='high'&&s.unfinished===2&&s.deaths===1,JSON.stringify(s));
  assert.match(await p.read(`document.getElementById('detail').textContent`),/This browser does not let the game save this choice\./);
  await p.read(`document.querySelector('#detail input').click();document.querySelector('#detail input').dispatchEvent(new Event('change',{bubbles:true}))`);await sleep(200);
  assert.equal(await p.read('window.__qualityDoc'),before);assert.equal(await p.read(`new URLSearchParams(location.search).has('q')`),false);
  await p.read(`mmm.renderer.getContext().getExtension('WEBGL_lose_context').loseContext()`);await p.reload();assert.ok((await p.state()).low);
 },
 async 'blocked-read'(p){await cases.blocked(p);},async 'blocked-write'(p){await cases.blocked(p);},async 'blocked-access'(p){await cases.blocked(p);},
  async ratios(p) {
    await p.seed({}); await p.load();
    for(const [choice,ratio] of [['sharp',2],['fast',1],['balanced',1.35]]) {
      await p.read(`document.querySelector('[data-picture=${choice}]').click()`);
      assert.equal((await p.state()).ratio,ratio);
      assert.equal(await p.read(`localStorage.getItem('mmm.phone.picture')`),choice);
    }
    await p.reload(); assert.equal((await p.state()).ratio,1.35);
  },
  async separate(p) {
    await p.seed({'mmm.picture':'fast','mmm.phone.picture':'sharp'}); await p.load();
    assert.equal((await p.state()).ratio,2);
    await p.read(`document.querySelector('[data-picture=balanced]').click()`);
    assert.equal(await p.read(`localStorage.getItem('mmm.picture')`),'fast');
    await p.load('touch=1&q=high'); assert.equal((await p.state()).ratio,1);
    await p.read(`document.querySelector('[data-picture=sharp]').click()`);
    assert.equal(await p.read(`localStorage.getItem('mmm.phone.picture')`),'balanced');
  },
  async duplicates(p) {
    for(const [scale,choices] of [[1.25,['balanced','fast']],[1,['balanced']]]) {
      await p.seed({}); await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:scale,mobile:false}); await p.load();
      const got=await p.read(`[...document.querySelectorAll('[data-picture]')].map(b=>b.dataset.picture)`);
      assert.deepEqual(got,choices.length===1?[]:choices);
      assert.equal((await p.state()).ratio,Math.min(scale,1.35));
      if(choices.length>1) assert.equal(await p.read(`document.querySelector('[aria-pressed=true][data-picture]')?.dataset.picture`),'balanced');
    }
  },
  async measurement(p) {
    await p.seed({}); await p.load(); assert.equal((await p.state()).measuring,false);
    await p.load('touch=1&q=high'); assert.equal((await p.state()).measuring,false);
    assert.equal(await p.read(`localStorage.getItem('mmm.picture')`),null);
  },
  async desktop(p) {
    await p.seed({}); await p.load('slowPicture=1',false); let s=await p.state();
    assert.ok(!s.low&&!s.touch&&!s.checked&&s.label==='Low detail'&&s.measuring&&s.ratio===2,JSON.stringify(s));
    // Feed a deliberately slow, unhelped pixel ladder: real Picture completion must call the Low detail nudge.
    // The game's own frames are still held, so only this ladder measures.
    await p.read(`for(let i=0;i<1000;i++)mmm.picture.frame(.1,false)`);
    assert.match(await p.read(`document.querySelector('#detailNudge')?.textContent ?? ''`),/about 10 frames a second/);
    assert.equal(await p.read(`localStorage.getItem('mmm.picture')`),'sharp');
    // The nudge opens Settings, and open Settings pause the game (pause.ts): a paused game never settles.
    // Close the panel as a player would, then let the game run (tiles load only from frames) and settle.
    assert.equal(await p.read(`document.getElementById('settings').classList.contains('open')`),true,'the slow-picture nudge opens Settings');
    await p.read(`document.getElementById('settings').classList.remove('open');true`);
    await p.resume();
    await p.until(`document.title==='settled'`,'desktop settled after injected measurement');
    await p.flip(); s=await p.state(); assert.ok(s.low&&s.saved==='low'&&s.checked&&!s.touch,JSON.stringify(s));
    await p.load('q=high'); s=await p.state(); assert.ok(!s.low&&s.saved==='low'&&!s.checked,JSON.stringify(s));
    await p.flip(); await p.flip(); s=await p.state(); assert.ok(!s.low&&s.saved===null&&!s.checked,JSON.stringify(s));
  },
};
if(process.env.TOUCH_SHOTS==='1') {
  const p=await page();
  try {
    for(const [width,height] of [[390,844],[844,390],[1180,820]]) for(const mode of ['phone','full']) {
      await p.seed({}); await p.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:false});
      await p.load(`touch=1${mode==='full'?'&q=high':''}`);
      await p.read(`document.getElementById('settings').classList.add('open');document.getElementById('detail').scrollIntoView({block:'center'})`);
      const file=`${out}/settings-${mode}-${width}x${height}.png`;
      writeFileSync(file,Buffer.from((await p.send('Page.captureScreenshot',{format:'png'})).result.data,'base64')); console.log(file);
    }
    p.check();
  } finally {await p.close();}
} else {
  for(const name of (process.env.TOUCH_CASE ? [process.env.TOUCH_CASE] : process.env.TOUCH_CASES ? process.env.TOUCH_CASES.split(',') : Object.keys(cases))) {
    const p=await page(undefined,name==='start-write-failure'?'mark':name==='blocked'?'all':name.startsWith('blocked-')?name.slice(8):undefined); try {await cases[name](p);p.check();console.log(`PASS browser ${name}`);} finally {await p.close();}
  }
  if(process.env.TOUCH_MUTATIONS==='1') for(const mutation of mutants.filter(m=>!process.env.TOUCH_MUTATION_CASE||m[0]===process.env.TOUCH_MUTATION_CASE)) {
    const p=await page(mutation,mutation[0]==='start-write-failure'?'mark':undefined);let failure=null;
    try {await cases[mutation[0]](p);p.check();} catch(e){failure=e;}
    finally {p.check();await p.close();}
    if(failure?.message.startsWith('mutation target missing'))throw failure;
    assert.ok(failure,`SURVIVED browser mutation ${mutation[0]}`);
    console.log(`KILLED browser ${mutation[0]}: ${failure.message.slice(0,160)}`);
  }
}
