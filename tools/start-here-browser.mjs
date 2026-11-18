// PARENT ONLY: no browser is launched by this module. The existing starter owns it.
// VITE_MP=1 RUN=start-here-browser.mjs VIEWS='start-here|mode=explore&q=low' tools/yard-shots.sh 844 390
// Covers actual CDP location permission/overrides, cross-area reload, refusal, privacy,
// playable bounds, title gating, multiplayer sockets/frames, and Just Drive phone fit. OUT receives the phone pictures.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
import { BFCACHE_RESULT_KEY, bfcacheRecorder, safeCondition, waitForStableDocument, viteInitiator } from './start-here-browser-state.mjs';
const [out] = process.argv.slice(2), port = process.env.CDP_PORT ?? '9471', web = process.env.WEB_PORT ?? '5173';
const origin = `http://localhost:${web}`;
const cases = [
  ['mabou','mail',46.0719861794,-61.3930087328,1280,900],
  ['judique','mail',45.878,-61.492,1280,900],
  ['outside','mail',45,-63,1280,900],
  ['refused','mail',46.0719861794,-61.3930087328,1280,900],
  ['mabou','just',46.0719861794,-61.3930087328,390,844],
  ['mabou','just',46.0719861794,-61.3930087328,844,390],
  ['judique','just',45.878,-61.492,844,390],
  ['invitation-off-cross','just',45.878,-61.492,844,390],
  ['pending-off-cross','just',45.878,-61.492,844,390],
  ['mp-open-layout','just',46.0719861794,-61.3930087328,844,390],
  ['bfcache-return','just',45.878,-61.492,844,390],
  ['inside-bounds','mail',46.14355285129771,-61.286561756751624,1280,900],
  ['mail-hidden','mail',0,0,1280,900],
  ['1884-hidden','just',0,0,844,390],
];
for(const [name,brand,latitude,longitude,width,height] of cases) {
  const tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  const requests=[],sockets=new Map(),roomSockets=[],roomFrames=[],documents=[];
  let navigationEpoch=0,mainFrame=null,navigationPending=false;
  const c=await cdp(tab.webSocketDebuggerUrl,{onEvent:m=>{
    if(m.method==='Network.requestWillBeSent'){requests.push(m.params.request);if(m.params.type==='Document'&&(!mainFrame||m.params.frameId===mainFrame)){navigationEpoch++;navigationPending=true;documents.push({url:m.params.request.url,initiator:m.params.initiator});}}
    if(m.method==='Page.frameNavigated'&&!m.params.frame.parentId){mainFrame=m.params.frame.id;navigationPending=false;navigationEpoch++;}
    if(['Page.frameStartedLoading','Page.frameStartedNavigating'].includes(m.method)&&m.params.frameId===mainFrame){navigationPending=true;navigationEpoch++;}
    if(m.method==='Page.frameStoppedLoading'&&m.params.frameId===mainFrame){navigationPending=false;navigationEpoch++;}
    if(m.method==='Page.navigatedWithinDocument'&&m.params.frameId===mainFrame)navigationEpoch++;
    if(m.method==='Network.webSocketCreated'){sockets.set(m.params.requestId,m.params.url);if(/\/mp\//.test(m.params.url))roomSockets.push(m.params.url);}
    if(['Network.webSocketFrameSent','Network.webSocketFrameReceived'].includes(m.method)&&/\/mp\//.test(sockets.get(m.params.requestId)??''))roomFrames.push(m.params.response);
  }});
  const send=async(method,params)=>{const r=await c.send(method,params);assert.ok(!r.error,JSON.stringify(r.error));return r.result;};
  const read=async(expression)=> (await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;
  const until=async(expression)=>{const end=Date.now()+120000;while(Date.now()<end){try{if(await read(safeCondition(expression)))return;}catch(e){if(!/context|navigat/i.test(e.message))throw e;}await sleep(150);}const state=await read(`({path:location.pathname,queryKeys:[...new URLSearchParams(location.search).keys()],ready:document.documentElement.dataset.mmmReady,vehicle:!!window.mmm?.vehicle,titleHidden:document.getElementById('title')?.hidden,errorHidden:document.getElementById('gameError')?.hidden,error:document.getElementById('gameError')?.textContent,boot:document.getElementById('boot')?.textContent})`).catch(e=>({diagnostic:e.message}));throw Error(`timeout: ${expression}; state ${JSON.stringify(state)}`);};
  try {
    await send('Page.enable');await send('Network.enable');mainFrame=(await send('Page.getFrameTree')).frameTree.frame.id;
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<1000});
    await send('Emulation.setTouchEmulationEnabled',{enabled:width<1000});
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(!sessionStorage.getItem('mmm.start-here')){localStorage.setItem('mmm.mp','0');localStorage.removeItem('mmm.mp.room');}window.__geoAsks=0;window.__startHereDocument=Math.random().toString(36);window.__lastPageShowPersisted=false;window.__pageHidden=false;addEventListener('pagehide',()=>{window.__pageHidden=true;});addEventListener('pageshow',event=>{window.__pageHidden=false;window.__lastPageShowPersisted=event.persisted;});const get=navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);navigator.geolocation.getCurrentPosition=(...args)=>{window.__geoAsks++;return get(...args);};${bfcacheRecorder}`});
    if(name==='refused') await send('Browser.setPermission',{origin,permission:{name:'geolocation'},setting:'denied'});
    else await send('Browser.grantPermissions',{origin,permissions:['geolocation']});
    await send('Emulation.setGeolocationOverride',{latitude,longitude,accuracy:10});
    const path=brand==='just'?'/mabou?site=just&':'/?';
    const query=name==='mail-hidden'?'mode=mail':name==='1884-hidden'?'era=1884':'mode=explore';
    const invitation=name==='invitation-off-cross'||name==='pending-off-cross'||name==='mp-open-layout';
    await send('Page.navigate',{url:origin+path+query+'&q=low&radio=0&vehicle=car&title=1'+(invitation?'&room=abcd':'&mp=0')});
    await until(`document.documentElement.dataset.mmmReady==='true' && !!window.mmm?.vehicle && !!document.getElementById('titleStart')`);
    assert.equal(await read('__geoAsks'),0,'never request on load');
    if(name==='invitation-off-cross'){
      await until(`!!document.querySelector('#title .mpToggle')`);
      assert.equal(await read(`document.querySelector('#title .mpToggle').getAttribute('aria-checked')`),'true');
      await read(`document.querySelector('#title .mpToggle').click()`);
      assert.equal(await read(`document.querySelector('#title .mpToggle').getAttribute('aria-checked')`),'false');
      assert.deepEqual(roomSockets,[],'invitation never connects before explicit start');assert.deepEqual(roomFrames,[]);
    }
    if(name==='pending-off-cross'){
      await until(`!!document.querySelector('#title .mpToggle')`);
      assert.equal(await read(`document.querySelector('#title .mpToggle').getAttribute('aria-checked')`),'true');
    }
    if(name==='mp-open-layout'){
      await until(`!!document.querySelector('#title .mpToggle')`);
      assert.equal(await read(`document.querySelector('#title .mpToggle').getAttribute('aria-checked')`),'true');
      assert.equal(await read(`document.querySelector('#title .mpRooms').hidden || document.querySelector('#title .mpPrivateControls').hidden`),false,'multiplayer and private-room controls are open');
    }
    if(name.endsWith('-hidden')) {assert.equal(await read(`!!document.getElementById('titleStartHere')`),false);continue;}
    assert.equal(await read(`document.getElementById('titleStartHere').textContent`),'Start where I am');
    assert.match(await read(`document.getElementById('startHereHint').innerText`),/Drive with others.*other players see your car/,'multiplayer disclosure line is rendered');
    if(brand==='just') {
      const fit=await read(`(()=>{const ids=['titleCard','titleStart','titleStartHere','startHereHint'];if(document.querySelector('#title .mpControl'))ids.push('mpControl');return ids.map(id=>{const el=id==='mpControl'?document.querySelector('#title .mpControl'):document.getElementById(id),r=el.getBoundingClientRect();const style=getComputedStyle(el),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {id,left:r.left,top:r.top,right:r.right,bottom:r.bottom,scroll:el.scrollWidth,width:el.clientWidth,visible:r.width>0&&r.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0,uncovered:!!hit&&(el===hit||el.contains(hit))};});})()`);
      for(const box of fit)assert.ok(box.left>=0&&box.top>=0&&box.right<=width&&box.bottom<=height&&box.scroll<=box.width+1&&box.visible&&box.uncovered,JSON.stringify({width,height,box}));
      const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/start-here-${brand}-${name}-${width}.png`,Buffer.from(shot.data,'base64'));
    }
    if(name==='pending-off-cross'){
      await until(`!!document.querySelector('#title .mpToggle')`);
      assert.equal(await read(`document.querySelector('#title .mpToggle').getAttribute('aria-checked')`),'true');
    }
    if(name==='mp-open-layout'){assert.deepEqual(roomSockets,[]);assert.deepEqual(roomFrames,[]);console.log('PASS private multiplayer controls fit phone landscape with location button and disclosure visible');continue;}
    const departingDocument=await read('window.__startHereDocument');
    const before=await read(`({x:mmm.vehicle.x,z:mmm.vehicle.z,heading:mmm.vehicle.heading})`);
    if(name==='inside-bounds'){
      const outside=await read(`(async()=>{const m=await import('/src/start-here.ts');const p=m.latLonToUtm20(${latitude},${longitude});const manifest=await(await fetch('/terrain/manifest.json')).json();const x=p.e-manifest.village[0],z=manifest.village[1]-p.n,b=mmm.vehicle.bounds;return x<b[0]||x>b[2]||z<b[1]||z>b[3];})()`);
      assert.equal(outside,true,'Blackstone GPS fixture begins outside playable bounds');
    }
    if(name==='pending-off-cross'){
      // Same task: position callbacks run later, so Off is selected while the location is pending.
      const selected=await read(`(()=>{document.getElementById('titleStartHere').click();const toggle=document.querySelector('#title .mpToggle');toggle.click();return toggle.getAttribute('aria-checked');})()`);
      assert.equal(selected,'false');
    } else await read(`document.getElementById('titleStartHere').click()`);
    if(name==='judique'||name==='invitation-off-cross'||name==='pending-off-cross'||name==='bfcache-return') {
      await until(`location.${brand==='just'?"pathname==='/judique'":"search.includes('area=judique')"} && document.documentElement.dataset.mmmReady==='true' && !!window.mmm?.vehicle && document.getElementById('title')?.hidden`);
      assert.equal(await read(`sessionStorage.getItem('mmm.start-here')`),null,'handoff deleted at once');
      assert.equal(await read('__geoAsks'),0,'arrival never asks again');
    } else {
      await until(`document.getElementById('title')?.hidden`);
      assert.equal(await read('__geoAsks'),1,'exactly one request');
    }
    if(name==='invitation-off-cross'||name==='pending-off-cross'){
      const documents=requests.filter(r=>new URL(r.url).pathname==='/judique');
      assert.ok(documents.length>0,'cross-area document request observed');
      for(const request of documents){const query=new URL(request.url).searchParams;assert.equal(query.has('room'),false,'departing request already removed the invitation');assert.equal(query.get('mp'),'0','departing request already carries Off');}
      assert.equal(await read(`new URLSearchParams(location.search).has('room')`),false,'Off navigation removes invitation');
      assert.equal(await read(`new URLSearchParams(location.search).get('mp')`),'0');
      assert.equal(await read(`document.querySelector('#title .mpToggle').getAttribute('aria-checked')`),'false','arrival stays Off');
      await sleep(2500);assert.deepEqual(roomSockets,[],'no multiplayer WebSocket before or after reload');assert.deepEqual(roomFrames,[],'no room frames before or after reload');
    }
    if(name==='outside'||name==='refused') {
      const after=await read(`({x:mmm.vehicle.x,z:mmm.vehicle.z,heading:mmm.vehicle.heading})`);
      assert.ok(Math.hypot(after.x-before.x,after.z-before.z)<.05,'usual start unchanged');
      assert.match(await read(`document.getElementById('startHereStatus').textContent`),name==='outside'?/outside the game's land/:/refused/);
    } else {
      // Check integration with the real loaded road set, not just stand-in roads.
      const distance=await read(`(async()=>{const m=await import('/src/start-here.ts');const area=(brand=>brand==='just'?location.pathname.slice(1):new URLSearchParams(location.search).get('area')??'mabou')(${JSON.stringify(brand)});const base=area==='mabou'?'terrain':'areas/'+area;const manifest=await(await fetch('/'+base+'/manifest.json')).json();const data=await(await fetch('/'+base+'/roads.json')).json();const roads=data.roads.map(r=>({...r,pts:r.pts.map(([e,n])=>[e-manifest.village[0],manifest.village[1]-n])}));const p=m.snapToRoad(m.latLonToUtm20(${latitude},${longitude}),manifest.village,roads,mmm.buildings?.clear??[],mmm.vehicle.bounds);return {distance:Math.hypot(mmm.vehicle.x-p.x,mmm.vehicle.z-p.z),heading:Math.abs(Math.sin(mmm.vehicle.heading-p.heading))};})()`);
      assert.ok(distance.distance<.5,JSON.stringify(distance));assert.ok(Math.abs(distance.heading)<.01,JSON.stringify(distance));
    }
    const bounded=await read(`(()=>{const v=mmm.vehicle,b=v.bounds;return {x:v.x,z:v.z,bounds:b};})()`);
    if(bounded.bounds){const [w,s,e,n]=bounded.bounds;assert.ok(bounded.x>w&&bounded.x<e&&bounded.z>s&&bounded.z<n,'start inside playable vehicle bounds: '+JSON.stringify(bounded));}
    assert.equal(await read(`sessionStorage.getItem('mmm.start-here')`),null,'no position remains after start');
    const address=await read('location.href');assert.equal(new URL(address).hash,'');assert.equal(new URL(address).searchParams.has('at'),false);
    for(const request of requests) for(const value of [String(latitude),String(longitude)]) {
      if(value==='45'||value==='-63')continue;
      assert.ok(!(request.url+' '+(request.postData??'')).includes(value),'raw position absent from requests');
    }
    if(name==='bfcache-return') {
      const firstPose=await read(`({x:mmm.vehicle.x,z:mmm.vehicle.z})`);
      const backDocumentIndex=documents.length;
      // Mark before Back, but do not mistake a briefly-ready restored realm for the final one:
      // Vite's HMR client can reload after its frozen WebSocket reconnects.
      await read('sessionStorage.removeItem("mmm.check.start-here.bfcache");window.__startHereDeparting=true;history.back()');
      const backReady=`!window.__startHereDeparting && location.pathname==='/mabou' && document.documentElement.dataset.mmmReady==='true' && !!document.getElementById('titleStartHere') && !document.getElementById('title').hidden && !window.__pageHidden`;
      await until(backReady);
      let asks;const probeDeadline=Date.now()+120000;
      while(!asks&&Date.now()<probeDeadline) {
        const realm=await waitForStableDocument(read,backReady,{navigation:()=>navigationEpoch,busy:()=>navigationPending});
        const captured=await read(`JSON.parse(sessionStorage.getItem(${JSON.stringify(BFCACHE_RESULT_KEY)}))`);
        assert.ok(captured?.persisted,'actual BFCache pageshow snapshot was captured before any dev reload');
        assert.equal(captured.realm,departingDocument,'snapshot belongs to the original Mabou realm');
        assert.equal(captured.buttonPresent,true);assert.equal(captured.disabled,false,'game re-enables the button at actual pageshow');
        assert.equal(captured.status,'','game clears pending status at actual pageshow');assert.equal(captured.geoAsks,1,'Back did not request location again');
        const reloads=documents.slice(backDocumentIndex).filter(d=>new URL(d.url).pathname==='/mabou');
        for(const reload of reloads)assert.ok(viteInitiator(reload.initiator),'game or unattributed reload after Back: '+JSON.stringify(reload));
        // One evaluation guards the realm and controls, then activates the fresh request. If a
        // further navigation won the race after stability was observed, sample again instead.
        asks=await read(`(()=>{let button,status;try{if(window.__startHereDocument!==${JSON.stringify(realm)}||!(${backReady}))return null;button=document.getElementById('titleStartHere');status=document.getElementById('startHereStatus');if(!button||!status)return null;}catch{return null;}const disabled=button.disabled,message=status.textContent,before=__geoAsks;if(!disabled&&message==='')button.click();return {disabled,message,before,after:__geoAsks};})()`);
      }
      assert.ok(asks,'returned document kept changing before the fresh-request probe');
      assert.equal(asks.disabled,false,'stable returned document has enabled control');assert.equal(asks.message,'');
      assert.equal(asks.after,asks.before+1,'fresh location request works after Back');
      await until(`location.pathname==='/judique' && document.documentElement.dataset.mmmReady==='true' && document.getElementById('title')?.hidden`);
      const nextPose=await read(`({x:mmm.vehicle.x,z:mmm.vehicle.z})`);assert.ok(Math.hypot(nextPose.x-firstPose.x,nextPose.z-firstPose.z)<.5);
      for(const reload of documents.slice(backDocumentIndex).filter(d=>new URL(d.url).pathname==='/mabou'))assert.ok(viteInitiator(reload.initiator),'game or unattributed reload after Back: '+JSON.stringify(reload));
      console.log('PASS actual BFCache restoration captured at pageshow, stable realm and fresh request; dev-client reloads '+documents.slice(backDocumentIndex).filter(d=>new URL(d.url).pathname==='/mabou').length);
    }
    c.assertHealthy();console.log(`PASS start-here ${brand} ${name} ${width}x${height}`);
  } finally {
    await c.send('Browser.resetPermissions').catch(()=>{});
    await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});c.close();
  }
}
