import { readBaseline } from './baseline-source.mjs';
// Node only. Projection references: GDAL 3.9.0 / PROJ, EPSG:4617 -> EPSG:2961,
// gdaltransform -s_srs EPSG:4617 -t_srs EPSG:2961 (longitude latitude input).
// Mutants compile source in memory; no game file is rewritten.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from '../web/node_modules/typescript/lib/typescript.js';
import { BFCACHE_RESULT_KEY, bfcacheRecorder, safeCondition, waitForStableDocument, viteInitiator } from './start-here-browser-state.mjs';
import { pageDom } from './start-here-dom.mjs';
import { build } from '../web/node_modules/esbuild/lib/main.js';
const file = new URL('../web/src/start-here.ts', import.meta.url);
const source = readFileSync(file, 'utf8');
const pipeline = readFileSync(new URL('../pipeline/areas.py', import.meta.url), 'utf8');
const main = readFileSync(new URL('../web/src/main.ts', import.meta.url), 'utf8');
const browserSource = readFileSync(new URL('./start-here-browser.mjs',import.meta.url),'utf8');
const mpSource = readFileSync(new URL('../web/src/mp/switch.ts', import.meta.url),'utf8');
let rigModule;
async function realRig() {
  if(!rigModule)rigModule=build({entryPoints:[new URL('./start-here-rig.mjs',import.meta.url).pathname],bundle:true,format:'esm',platform:'node',write:false,define:{'import.meta.env.DEV':'false'},logLevel:'silent'}).then(b=>import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64')));
  return rigModule;
}
async function compile(text) {
  const bundle = await build({ stdin: { contents: text, sourcefile: file.pathname, resolveDir: new URL('../web/src/', import.meta.url).pathname, loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false, define: { 'import.meta.env.DEV': 'false' }, logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
}
const reference = [
  [46.0719861794, -61.3930087328, 624271.00000157, 5103300.99988597],
  [45.878, -61.492, 617023.901908748, 5081598.23647026],
  [45, -63, 500000, 4982950.40010685],
  [45.63, -61.36, 627832.407487997, 5054247.26613083],
];
function rules(m) {
  for (const [lat, lon, e, n] of reference) {
    const p = m.latLonToUtm20(lat, lon);
    assert.ok(Math.hypot(p.e - e, p.n - n) < 1, 'projection within one metre of PROJ');
  }
  // Read the actual six Python registry entries; resolve inherited origins, not golden boxes.
  const origins = new Map(), expected = [];
  for (const match of pipeline.matchAll(/^(\w+) = Area\(([\s\S]*?)\)\n/gm)) {
    const [, name, body] = match, id = body.match(/id='([^']+)'/)[1];
    const origin = body.match(/origin=(\([\d, ]+\)|\w+\.origin)/)[1];
    const xy = origin.startsWith('(') ? origin.match(/\d+/g).map(Number) : origins.get(origin.split('.')[0]);
    assert.ok(xy, 'pipeline origin resolved: ' + name); origins.set(name, xy);
    const [i0, j0, i1, j1] = body.match(/mid_tiles=\(([^)]+)\)/)[1].split(',').map(Number);
    expected.push({ id, box: [xy[0] + i0 * 2048, xy[1] - j1 * 2048, xy[0] + i1 * 2048, xy[1] - j0 * 2048] });
  }
  assert.equal(expected.length, 6); assert.deepEqual(m.AREA_BOXES, expected, 'shared start-area table matches pipeline mid boxes');
  for (const { id, box: [w, s, e, n] } of expected) {
    for (const p of [{ e: (w + e) / 2, n: (s + n) / 2 }, { e: w, n: s }, { e, n }]) assert.equal(m.pickArea(p, id), id);
  }
  assert.equal(m.pickArea({ e: 618000, n: 5100000 }, 'porthood'), 'porthood', 'overlap retains loaded area');
  assert.equal(m.pickArea({ e: 618000, n: 5100000 }), 'mabou', 'overlap has stable registry order');
  for (const point of [{e:0,n:0}, {e:NaN,n:5103301}, {e:624271,n:Infinity}]) assert.equal(m.pickArea(point), null);
  assert.equal(m.MAX_START_CANDIDATES,8,'fixed small retry bound');
  const dense=Array.from({length:30},(_,i)=>({kind:2,pts:[[-40,i],[40,i]]}));
  const choices=m.roadStarts({e:0,n:0},[0,0],dense,[],[-50,-50,50,50]);
  assert.equal(choices.length,8);assert.ok(choices.every((p,i)=>!i||p.distance>=choices[i-1].distance));
  const ahead=m.roadStarts({e:0,n:0},[0,0],[{kind:2,pts:[[-40,0],[40,0]]}],[[10,-5,30,5]],[-50,-50,50,50]);
  assert.ok(ahead.every(p=>p.x<10||p.x>30),'retry offsets must also avoid buildings beyond the nearest point');
  const road = (kind, pts) => ({kind, pts});
  const village = [624271, 5103301], point = { e: village[0] + 10, n: village[1] - 20 };
  const roads = [road(4, [[0,20],[20,20]]), road(5, [[0,20],[20,20]]), road(0, [[0,20],[20,20]]), road(2, [[0,30],[100,30]])];
  assert.deepEqual(m.snapToRoad(point, village, roads), {x:10,z:30,heading:Math.PI/2,distance:10}, 'nearest point on public road, world north flips');
  for (const kind of [1,2,3]) assert.deepEqual(m.snapToRoad(point, village, [road(kind, [[0,0],[0,-100]])]), {x:0,z:0,heading:0,distance:Math.hypot(10,20)}, 'segment endpoint clamp');
  const blockedRoad = [road(2, [[0,30],[100,30]])];
  const safe = m.snapToRoad(point,village,blockedRoad,[[5,25,15,35]]);
  assert.ok(Math.abs(Math.abs(safe.x - 10) - 5.01) < 1e-8 && safe.z === 30, 'nearest public centreline point outside building envelope');
  assert.equal(m.snapToRoad(point,village,blockedRoad,[[-10,20,110,40]]),null,'wholly occupied road cannot supply a start');
  const vertical=m.snapToRoad({e:village[0],n:village[1]},village,[road(1,[[0,100],[0,-100]])],[[-5,-5,5,5]]);
  assert.ok(Math.abs(vertical.z)>5 && vertical.x===0,'vertical road exits building envelope');
  assert.equal(m.snapToRoad(point, village, []), null);
  assert.equal(m.snapToRoad(point, village, [road(1, [[0,0],[0,0]])]), null);
  for (const kind of [0,4,5,6,1.5]) assert.equal(m.snapToRoad(point, village, [road(kind, [[0,0],[100,0]])]), null);
  assert.ok(m.snapToRoad(point, village, [road(3, [[1000,0],[1000,100]])]).distance > 500, 'no radius cutoff');
  for (const [brand, expected] of [['just','/judique'],['mail','/play']]) {
    const address = m.startHereAddress({brand,area:'mabou'}, 'judique', new URL('https://example.test/play?mode=explore&vehicle=bike&at=1,2&road=3&demo=60&cam=1&room=abcd#private'));
    const url = new URL(address, 'https://example.test');
    assert.equal(url.pathname, expected); assert.equal(url.hash, '');
    assert.equal(url.searchParams.get('area'), brand === 'mail' ? 'judique' : null);
    assert.equal(url.searchParams.get('vehicle'),'bike'); assert.equal(url.searchParams.get('room'),null); assert.equal(url.searchParams.get('mp'),'0');
    assert.equal(url.searchParams.get('mode'),'explore'); assert.equal(url.searchParams.get('title'),'1');
    for(const key of ['at','road','demo','cam']) assert.equal(url.searchParams.has(key),false);
    for(const p of reference) for(const value of p) assert.ok(!address.includes(String(value)), 'coordinates never reach navigation');
  }
}
function storage() {
  const values = new Map(), ops = [];
  return { values, ops, getItem(k) {ops.push(['get',k]);return values.get(k)??null;}, setItem(k,v) {ops.push(['set',k,v]);values.set(k,v);}, removeItem(k) {ops.push(['delete',k]);values.delete(k);} };
}
function handoff(m) {
  const point = {e:617024,n:5081598}, store = storage();
  assert.equal(m.carryPoint(store,point,'judique',100),true);
  assert.equal(store.values.size,1);
  assert.deepEqual(m.takePoint(store,'judique',101),{...point,multiplayer:{on:false,room:null}});
  assert.equal(store.values.size,0); assert.equal(m.takePoint(store,'judique',102),null,'read once');
  assert.deepEqual(store.ops.slice(1,3).map(v=>v[0]),['get','delete'],'delete immediately after read');
  for(const text of ['bad JSON','null', JSON.stringify({...point,area:'mabou',time:100}),JSON.stringify({...point,area:'judique',time:-300001}), JSON.stringify({...point,area:'judique',time:101}),JSON.stringify({e:0,n:0,area:'judique',time:100}),JSON.stringify({...point,area:'judique',time:'100'})]) {
    store.setItem(m.START_HERE_KEY,text); assert.equal(m.takePoint(store,'judique',100),null); assert.equal(store.values.size,0,'invalid data removed');
  }
  for(const multiplayer of [undefined,{on:'1',room:null},{on:true,room:1234},{on:true,room:'abcde'}]) {
    store.setItem(m.START_HERE_KEY,JSON.stringify({...point,area:'judique',time:100,multiplayer}));
    assert.equal(m.takePoint(store,'judique',100),null,'malformed consent cannot authorize automatic start');assert.equal(store.values.size,0);
  }
  const blocked = {getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
  assert.equal(m.carryPoint(blocked,point,'judique'),false); assert.equal(m.carryPoint(undefined,point,'judique'),false); assert.equal(m.takePoint(blocked,'judique'),null);
}
const good = {coords:{latitude:46.0719861794,longitude:-61.3930087328,accuracy:10}};
async function refusals(m) {
  for(const [code,word] of [[1,'refused'],[2,'unavailable'],[3,'too long'],[99,'unavailable']]) {
    const result=await m.requestPosition({getCurrentPosition(_yes,no,options){assert.deepEqual(options,{timeout:10000,maximumAge:60000,enableHighAccuracy:true});no({code});}});
    assert.match(result.message,new RegExp(word)); assert.match(result.message,/usual place/);
  }
  assert.match((await m.requestPosition(undefined)).message,/no location service/);
  assert.match((await m.requestPosition({getCurrentPosition(){throw Error('insecure context');}})).message,/unavailable/);
  for(const coords of [{...good.coords,accuracy:2001},{...good.coords,accuracy:Infinity},{...good.coords,latitude:NaN},{...good.coords,latitude:91},{...good.coords,longitude:-181},{...good.coords,accuracy:-1}]) {
    assert.match((await m.requestPosition({getCurrentPosition(yes){yes({coords});}})).message,/uncertain/);
  }
  assert.ok('point' in await m.requestPosition({getCurrentPosition(yes){yes({coords:{...good.coords,accuracy:2000}});}}));
}

// Minimal event/DOM boundary. The real production controller runs; no browser or GPU.
async function ui(m) {
  const original = Object.getOwnPropertyDescriptors(globalThis);
  try {
    for(const scenario of ['success','era-door','far','edge-far','empty-roads','blocked-road','denied','timeout','unavailable','missing','uncertain','outside','cross-mail','cross-just','blocked-cross','blocked-same','normal-first','pending','mail','1884','query-1884','no-title']) {
      const store = storage(), timers = new Map(), microtasks = [], navigations = [], placed = [];
      class Element {
        children=[];listeners={};disabled=false;id='';textContent='';attributes={};
        append(...nodes){for(const n of nodes){this.children.push(n);n.parent=this;}}
        appendChild(node){this.append(node);return node;}
        after(node){if(node.parent){const old=node.parent.children.indexOf(node);node.parent.children.splice(old,1);}const i=this.parent.children.indexOf(this);this.parent.children.splice(i+1,0,node);node.parent=this.parent;}
        before(node){const i=this.parent.children.indexOf(this);this.parent.children.splice(i,0,node);node.parent=this.parent;}
        setAttribute(k,v){this.attributes[k]=v;}
        addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}
        click(){if(!this.disabled) for(const f of this.listeners.click??[]) f();}
      }
      const body=new Element(), head=new Element(), start=new Element();start.id='titleStart';
      let starts=0, asks=0, answer;
      start.addEventListener('click',()=>{starts++;});if(scenario!=='no-title') body.append(start);
      if(scenario==='era-door'){const door=new Element();door.id='titleEra';body.append(door);}
      const find=(node,id)=>node.id===id?node:node.children.map(n=>find(n,id)).find(Boolean);
      globalThis.document={body,head,createElement:()=>new Element(),getElementById:id=>find(body,id),querySelector:s=>find(body,s.slice(1))};
      globalThis.setTimeout=(fn)=>{const id=timers.size+1;timers.set(id,fn);return id;};globalThis.clearTimeout=id=>timers.delete(id);
      globalThis.queueMicrotask=fn=>microtasks.push(fn);globalThis.addEventListener=()=>{};
      const just=scenario==='cross-just';
      globalThis.location={search:scenario==='query-1884'?'?era=1884':'?mode=explore',href:just?'http://localhost/mabou?site=just':'https://example.test/?mode=explore',assign:value=>navigations.push(value)};
      Object.defineProperty(globalThis,'sessionStorage',{configurable:true,get(){if(scenario.startsWith('blocked'))throw Error('blocked');return store;}});
      Object.defineProperty(globalThis,'navigator',{configurable:true,value:{geolocation:scenario==='missing'?undefined:{getCurrentPosition(yes,no){
        asks++;answer=()=>{
          if(scenario==='denied')no({code:1});else if(scenario==='timeout')no({code:3});else if(scenario==='unavailable')no({code:2});
          else yes(scenario==='outside'?{coords:{latitude:45,longitude:-63,accuracy:10}}:scenario==='uncertain'?{coords:{...good.coords,accuracy:2001}}:scenario.includes('cross')?{coords:{latitude:45.878,longitude:-61.492,accuracy:10}}:good);
        };if(scenario!=='normal-first')answer();
      }}}});
      if(scenario==='pending')m.carryPoint(store,m.latLonToUtm20(good.coords.latitude,good.coords.longitude),'mabou');
      const roads=scenario==='empty-roads'?[]:[{kind:2,pts:scenario==='far'?[[1000,0],[1000,100]]:scenario==='edge-far'?[[0,0],[1100,0]]:[[-100,0],[100,0]]}];
      m.startHere({mode:scenario==='mail'?'mail':'explore',era:scenario==='1884'?'1884':'today',area:'mabou',site:{brand:just?'just':'mail',area:'mabou'},village:[624271,5103301],roads,buildings:scenario==='blocked-road'?[[-200,-100,200,100]]:[],bounds:scenario==='edge-far'?[1000,-100,1200,100]:null,place:s=>{placed.push(s);return true;}});
      assert.equal(asks,0,scenario+': never on load');
      const button=find(body,'titleStartHere');
      if(['mail','1884','query-1884','no-title'].includes(scenario)){assert.equal(button,undefined,scenario);continue;}
      assert.match(find(body,'startHereHint').textContent,/^Use your location to start on a nearby public road\. Other players see your car if you drive with others\.$/);
      assert.equal(button.attributes['aria-describedby'], 'startHereHint');
      if(scenario==='era-door')assert.deepEqual(button.parent.children.map(n=>n.id), ['titleStartHere','startHereHint','titleEra'], 'location hint stays beside its button before the era link');
      if(scenario==='pending'){assert.equal(store.values.size,0);microtasks.forEach(fn=>fn());}
      else button.click();
      if(scenario==='normal-first'){button.click();assert.equal(asks,1,'double tap one request');start.click();answer();}
      await Promise.resolve();await Promise.resolve();
      const message=find(body,'startHereStatus').textContent;
      if(scenario.startsWith('cross-')) {
        assert.equal(starts,0);assert.equal(placed.length,0);assert.equal(navigations.length,1);
        const next=new URL(navigations[0],'http://localhost');assert.equal(just?next.pathname:next.searchParams.get('area'),just?'/judique':'judique');
        assert.equal(store.values.size,1);assert.equal(m.takePoint(store,'judique')?.e>617000,true);
      } else {
        assert.equal(navigations.length,0);assert.equal(starts,1,scenario+': normal start exactly once');
        assert.equal(placed.length,['success','era-door','far','edge-far','blocked-same','pending'].includes(scenario)?1:0,scenario+': snapped or usual');
        if(scenario==='far'||scenario==='edge-far')assert.match(message,/over 500 m/);
        if(scenario==='edge-far')assert.ok(placed[0].x>=1002,'outside-playable GPS starts on the clipped road, not at the boundary off road');
        if(scenario==='outside')assert.equal(message,m.OUTSIDE);
        if(scenario==='denied')assert.match(message,/refused/);
        if(scenario==='timeout')assert.match(message,/too long/);
        if(scenario==='missing')assert.match(message,/no location service/);
        if(scenario==='uncertain')assert.match(message,/uncertain/);
        if(scenario==='empty-roads'||scenario==='blocked-road')assert.match(message,/No public road/);
        if(scenario==='blocked-cross')assert.match(message,/cannot carry/);
        if(scenario==='normal-first')assert.equal(message,'','cancelled request leaves no finding message');
      }
    }
  } finally {
    for(const key of ['document','setTimeout','clearTimeout','queueMicrotask','location','sessionStorage','navigator','addEventListener']) {
      if(original[key])Object.defineProperty(globalThis,key,original[key]);else delete globalThis[key];
    }
  }
}
// Execute the actual main.ts call and callback. No hand-written replacement for its place adapter.
function captureMain(text,vehicle,placeAtStart,multiplayer={choice:{on:false,room:null}}) {
  const call=text.match(/^startHere\(.*\);$/m)?.[0];assert.ok(call,'main startHere call exists');let options;
  // The call's place adapter reads main's own startPlacement declaration. Take that declaration from the source
  // (compiled from TypeScript, with no fleet, as in an ordinary one-vehicle visit), not from a hand-written copy.
  const declaration=text.match(/^const startPlacement = [\s\S]*?^\}? ?: vehicle;$/m)?.[0];assert.ok(declaration,'main startPlacement declaration exists');
  const startPlacement=ts.transpileModule(declaration,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const run=new Function('startHere','placeAtStart','vehicle','multiplayer',`const gameMode='explore',ERA={id:'today'},AREA={id:'mabou'},SITE={brand:'mail'},manifest={village:[624271,5103301]},roads={roads:[]},buildings=null,fleet=null;let waitingToDrive=false,camReady=true,mode='fly';${startPlacement}\n${call};return ()=>({waitingToDrive,camReady,mode});`);
  const state=run(value=>options=value,placeAtStart,vehicle,multiplayer);return {options,state};
}
function mainAdapter(text,m) {
  const bounds=[-50,-50,50,50],multiplayer={choice:{on:false,room:null}},calls=[];
  const vehicle={bounds,x:0,z:0,heading:0,placementGuard:null,restart(x,z,heading){calls.push([x,z,heading]);const p={x,z,heading};if(this.placementGuard&&!this.placementGuard(p))return;Object.assign(this,p);}};
  const guard=function(){assert.equal(this,vehicle,'preserve the original guard receiver');return true;};vehicle.placementGuard=guard;
  const {options,state}=captureMain(text,vehicle,m.placeAtStart,multiplayer);
  assert.equal(options.bounds,bounds,'main passes the actual vehicle bounds');assert.equal(options.multiplayer,multiplayer);
  assert.equal(options.place({x:10,z:20,heading:1}),true,'main returns the observed placement outcome');
  assert.deepEqual(calls,[[10,20,1]],'main place calls real restart path with selected point');assert.equal(vehicle.placementGuard,guard);
  assert.deepEqual(state(),{waitingToDrive:true,camReady:false,mode:'drive'});
}
async function realPlacement(m,text=main,kinds=['nearest','nearest-reversed','next','none','same-refused']) {
  const {createStartRig}=await realRig();
  for(const kind of kinds) {
    const rig=createStartRig(kind),store=storage(),page=pageDom('http://localhost/?mode=explore',storage(),store);
    try {
      page.mountTitle();await page.flush();
      const {vehicle:v,roads,towing,point,village}=rig;
      assert.equal(towing.attached,true,'real fixture has an attached trailer');
      const guard=v.placementGuard,old={x:v.x,z:v.z,heading:v.heading,tx:towing.x,tz:towing.z};
      const {options,state}=captureMain(text,v,m.placeAtStart,null),place=options.place,attempts=[];
      m.carryPoint(store,point,'mabou');
      m.startHere({...options,village,roads:roads.roads,place(candidate){
        const accepted=place(candidate);attempts.push({...candidate,accepted,actualX:v.x,actualZ:v.z});
        assert.equal(v.placementGuard,guard,'every attempt restores the real towing guard');
        if(accepted===false)assert.deepEqual({x:v.x,z:v.z,heading:v.heading,tx:towing.x,tz:towing.z},old,'refused trial preserves both real bodies');
        return accepted;
      }});
      await page.flush();assert.equal(page.starts,1,'normal Start once after placement search');
      const message=page.document.getElementById('startHereStatus').textContent;
      if(kind==='nearest') {
        assert.ok(Math.hypot(v.x,v.z+10)<1e-6,'nearest fit is used');assert.equal(attempts.length,1);
        assert.equal(attempts[0].accepted,true);assert.equal(message,'');
      } else if(kind==='nearest-reversed') {
        assert.ok(Math.hypot(v.x,v.z-42)<1e-6&&Math.cos(v.heading)<-.99,'nearest fit may reverse along the public road');
        assert.equal(attempts.length,1);assert.equal(attempts[0].accepted,true);assert.equal(message,'');
      } else if(kind==='next') {
        assert.ok(Math.hypot(v.x+20,v.z+10)<1e-6,'refused nearest road must try a later feasible candidate');
        assert.equal(attempts[0].accepted,false);assert.ok(attempts.length>1&&attempts.at(-1).accepted===true);
        assert.equal(message,'','successful later placement clears finding message');
      } else {
        assert.deepEqual({x:v.x,z:v.z,heading:v.heading,tx:towing.x,tz:towing.z},old,'no fit retains the usual pose for truck and trailer');
        assert.match(message,/Could not find a road start that fits.*usual place/,'no fit must never claim success');
        assert.ok(attempts.every(a=>a.accepted===false));assert.equal(state().waitingToDrive,false,'failed callback does not set success-only flags');
      }
      assert.ok(attempts.length<=m.MAX_START_CANDIDATES,'small fixed attempt cap');
      for(let i=0;i<attempts.length;i++) {
        const a=attempts[i];const [w,s,e,n]=v.bounds;assert.ok(a.x>=w+2&&a.x<=e-2&&a.z>=s+2&&a.z<=n-2,'every trial inside playable bounds');
        if(i)assert.ok(a.distance>=attempts[i-1].distance-1e-9,'nearest first');
      }
      assert.equal(towing.attached,true);assert.ok(rig.couplerGap()<1e-6,'real trailer coupler remains attached at the actual final pose');
    } finally {page.close();rig.dispose();}
  }
}
async function requestLifecycle(m) {
  for(const kind of ['cross-return','hide-late','return-late','pending-away']) {
    const session=storage(),page=pageDom('http://localhost/?mode=explore',storage(),session),answers=[],placed=[];
    try {
      page.mountTitle();await page.flush();
      navigator.geolocation={getCurrentPosition(yes){answers.push(yes);}};
      if(kind==='pending-away')m.carryPoint(session,{e:624271,n:5103301},'mabou');
      m.startHere({mode:'explore',era:'today',area:'mabou',site:{brand:'mail',area:'mabou'},village:[624271,5103301],roads:[{kind:2,pts:[[-100,0],[100,0]]}],buildings:[],bounds:null,place:s=>{placed.push(s);return true;}});
      const button=page.document.getElementById('titleStartHere'),status=page.document.getElementById('startHereStatus');
      if(kind!=='pending-away')button.click();
      if(kind==='cross-return'){answers[0]({coords:{latitude:45.878,longitude:-61.492,accuracy:10}});await page.flush();assert.equal(page.navigations.length,1);assert.equal(button.disabled,true);m.takePoint(session,'judique');}
      page.dispatchWindow('pagehide');
      if(kind==='hide-late'){answers[0](good);await page.flush();assert.equal(page.starts,0,'departing answer cannot start hidden page');assert.equal(placed.length,0);assert.equal(page.navigations.length,0);}
      page.dispatchWindow('pageshow',{persisted:false});
      if(kind!=='pending-away')assert.equal(button.disabled,true,'ordinary pageshow does not reset requests');
      page.dispatchWindow('pageshow',{persisted:true});
      assert.equal(button.disabled,false,'BFCache return re-enables location button');assert.equal(status.textContent,'','BFCache return clears pending message');
      await page.flush();assert.equal(page.starts,0,'BFCache return never starts old pending work');
      button.click();assert.equal(button.disabled,true,'new request works after return');
      if(kind==='return-late'){answers[0](good);await page.flush();assert.equal(page.starts,0,'old token cannot match a fresh post-return request');assert.equal(placed.length,0);}
      answers.at(-1)(good);await page.flush();assert.equal(page.starts,1);assert.equal(placed.length,1);
    } finally {page.close();}
  }
}
function playableBounds(manifest) {
  const constant=main.match(/^const EDGE = .*;$/m)?.[0],line=main.match(/^const edge = .*;$/m)?.[0];
  assert.ok(constant&&line,'actual Edge constructor found');
  return new Function('manifest','Edge',`const [VE,VN]=manifest.village,roads={},terrain={},AREA={route:false},SITE={brand:'just'},vehicleSpec={envelope:{nose:3.2}},ERA={modern:true};${constant}${line};return edge.bounds;`)(manifest,class{constructor(_roads,_terrain,bounds){this.bounds=bounds;}});
}
function boundedRoads(m, realOnly=false) {
  const village=[624271,5103301],bounds=[-50,-50,50,50],road=(pts)=>({kind:2,pts});
  if(!realOnly) {
  for(const pts of [[[-100,0],[100,0]],[[0,-100],[0,100]],[[100,100],[-100,-100]],[[-100,48],[100,48]]]) {
    const hit=m.snapToRoad({e:village[0]+90,n:village[1]},village,[road(pts)],[],bounds);
    assert.ok(hit&&hit.x>=-48&&hit.x<=48&&hit.z>=-48&&hit.z<=48,'clip crossings, including both ends outside');
  }
  assert.equal(m.snapToRoad({e:village[0],n:village[1]},village,[road([[51,-100],[51,100]])],[],bounds),null,'wholly outside public road rejected');
  }
  const paths=['terrain','areas/judique','areas/porthood','areas/pointtupper','areas/westbay','areas/cansocauseway'];
  for(const path of paths) {
    const manifest=JSON.parse(readFileSync(new URL('../data/baked/'+path+'/manifest.json',import.meta.url),'utf8'));
    const data=JSON.parse(readFileSync(new URL('../data/baked/'+path+'/roads.json',import.meta.url),'utf8'));
    const roads=data.roads.map(r=>({...r,pts:r.pts.map(([e,n])=>[e-manifest.village[0],manifest.village[1]-n])}));
    const limits=playableBounds(manifest);
    const point=path==='terrain'?{e:632331.2,n:5111424.4}:{e:manifest.mid[2]-10,n:manifest.mid[3]-10};
    const hit=m.snapToRoad(point,manifest.village,roads,[],limits);
    assert.ok(hit, path+' has an eligible road');
    const margin=m.START_MARGIN??2;
    assert.ok(hit.x>=limits[0]+margin-1e-8&&hit.x<=limits[2]-margin+1e-8&&hit.z>=limits[1]+margin-1e-8&&hit.z<=limits[3]-margin+1e-8,path+' start inside actual vehicle bounds');
    // Independent cross-product + segment-range proof: clipping must keep the point on a public road.
    assert.ok(roads.some(r=>[1,2,3].includes(r.kind)&&r.pts.slice(1).some(([bx,bz],i)=>{const [ax,az]=r.pts[i],dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz);return len>0&&Math.abs((hit.x-ax)*dz-(hit.z-az)*dx)/len<1e-6&&(hit.x-ax)*(hit.x-bx)+(hit.z-az)*(hit.z-bz)<=1e-6;})),path+' start remains on public centreline');
    if(path==='terrain'){assert.ok(hit.distance>0,'Blackstone point is not left outside bounds');console.log('Blackstone inside-bounds snap: '+hit.distance.toFixed(2)+' m');}
  }
}
async function compileMultiplayer(dev) {
  const result=await build({stdin:{contents:mpSource,sourcefile:new URL('../web/src/mp/switch.ts',import.meta.url).pathname,resolveDir:new URL('../web/src/mp/',import.meta.url).pathname,loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,define:{'import.meta.env.DEV':String(dev)},plugins:[{name:'transport-boundary',setup(b){b.onResolve({filter:/^\.\/index$/},()=>({path:'transport',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export class Multiplayer { constructor(host,room){globalThis.__connections.push({area:host.area,room});} update(){} dispose(){} }'}));}}],logLevel:'silent'});
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
async function multiplayerHandoff(m) {
  for(const dev of [false,true]) {
    const {multiplayerSwitch}=await compileMultiplayer(dev);
    for(const kind of ['off','room','on-from-url-off','open','blocked-open','tap-snapshot','pending-room','pending-open','arrival-off','arrival-on','arrival-room','arrival-late-off']) {
      const local=storage(),session=storage(),connections=[];
      const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
      let page=pageDom('http://localhost/mabou?site=just&room=abcd&mp='+ (kind==='on-from-url-off'?'0':'1') +'&mode=explore',kind==='blocked-open'?blocked:local,session);
      try {
        globalThis.__connections=connections;
        const mp=multiplayerSwitch({params:new URLSearchParams(location.search),area:'mabou',touch:false});
        page.mountTitle();await page.flush();
        const control=s=>page.title.querySelector(s);
        assert.equal(control('.mpToggle').getAttribute('aria-checked'),kind==='on-from-url-off'?'false':'true','initial invitation/URL selection');
        if(kind==='on-from-url-off')control('.mpToggle').click();
        if(kind==='off'||kind==='arrival-on')control('.mpToggle').click();
        else if(kind==='open'||kind==='blocked-open')control('.mpOpen').click();
        else {const input=control('.mpJoin input');input.value='wxyz';input.dispatch('input');control('.mpUse').click();}
        const initial={on:kind!=='off'&&kind!=='arrival-on',room:kind==='off'||kind==='arrival-on'?'abcd':kind==='open'||kind==='blocked-open'?null:'wxyz'};
        assert.deepEqual(mp.choice,initial,'real controls match the independent initial choice');
        let departing={...initial},answer;
        navigator.geolocation={getCurrentPosition(yes){answer=()=>yes({coords:{latitude:45.878,longitude:-61.492,accuracy:10}});}};
        const options={mode:'explore',era:'today',area:'mabou',site:{brand:'just',area:'mabou'},village:[624271,5103301],roads:[{kind:2,pts:[[-100,0],[100,0]]}],buildings:[],bounds:null,multiplayer:mp,place(){return true;}};
        m.startHere(options);page.document.getElementById('titleStartHere').click();
        // These changes happen AFTER the location tap but BEFORE its callback/navigation.
        if(kind==='tap-snapshot'){control('.mpToggle').click();departing.on=false;}
        if(kind==='pending-room'){const input=control('.mpJoin input');input.value='zzzz';input.dispatch('input');control('.mpUse').click();departing.room='zzzz';}
        if(kind==='pending-open'){control('.mpOpen').click();departing.room=null;}
        assert.deepEqual(mp.choice,departing,'the current control choice wins while position is pending');
        mp.update(.1,{},false);await page.flush();assert.deepEqual(connections,[],'no connection while permission/title is open');
        answer();await page.flush();assert.equal(page.navigations.length,1);
        const address=new URL(page.navigations[0],location.origin);
        assert.equal(address.searchParams.get('room'),departing.on?departing.room:null,'navigation uses CURRENT choice, never the tap snapshot');
        assert.equal(address.searchParams.get('mp'),departing.on?null:'0','Off navigation carries nothing that can switch it On');
        page.close();
        let expected={...departing};
        if(kind==='arrival-off'||kind==='arrival-late-off')expected={on:false,room:'zzzz'};
        if(kind==='arrival-room'||kind==='arrival-on')expected={on:true,room:'zzzz'};
        const saveExpected=()=>{local.setItem('mmm.mp',expected.on?'1':'0');local.setItem('mmm.mp.room',expected.room??'');};
        if(kind==='arrival-off'||kind==='arrival-room'||kind==='arrival-on')saveExpected();
        page=pageDom(address.href,kind==='blocked-open'?blocked:local,session);globalThis.__connections=connections;
        const arrived=multiplayerSwitch({params:new URLSearchParams(location.search),area:'judique',touch:false});
        page.mountTitle();m.startHere({...options,area:'judique',multiplayer:arrived});
        if(kind==='arrival-late-off')saveExpected(); // after handler setup, before its queued automatic Start
        await page.flush();
        arrived.update(.1,{},true);await page.flush();await page.flush();
        assert.deepEqual(connections,expected.on?[{area:'judique',room:expected.room}]:[],'stored Off prevents transport construction despite stale URL/state');
        assert.deepEqual(arrived.choice,expected,kind+': latest saved choice wins over carried state and invitation');
        assert.equal(page.title.querySelector('.mpToggle').getAttribute('aria-checked'),String(expected.on));
        assert.equal(page.title.querySelector('output').textContent,(expected.room??'').toUpperCase());
        const arrivedAddress=new URL(location.href);
        assert.equal(arrivedAddress.searchParams.get('room'),expected.on?expected.room:null,'arrival reconciles stale room URL');
        assert.equal(arrivedAddress.searchParams.get('mp'),expected.on?null:'0');
        assert.equal(page.starts,1);assert.equal(session.values.size,0,'point read once and deleted');
        if(!expected.on) {
          // The consumed handoff cannot be needed to keep Off on a subsequent ordinary reload.
          const reload=location.href;page.close();page=pageDom(reload,local,session);globalThis.__connections=connections;
          const reloaded=multiplayerSwitch({params:new URLSearchParams(location.search),area:'judique',touch:false});
          page.mountTitle();await page.flush();m.startHere({...options,area:'judique',multiplayer:reloaded});await page.flush();
          assert.equal(page.starts,0,'ordinary reload does not replay location start');
          page.start.click();reloaded.update(.1,{},true);await page.flush();await page.flush();
          assert.equal(reloaded.choice.on,false,'Off survives reload without any carried point/state');assert.deepEqual(connections,[]);
        }
      } finally {page.close();}
    }
  }
}
// Run the actual Back command and wait predicate against lifecycle states, without a browser.
function backNavigationWait(text=browserSource) {
  const departure=text.match(/await read\('([^']*window\.__startHereDeparting[^']*)'\);/);
  assert.ok(departure,'Back command must mark its departing document');
  const window={};let backCalls=0;
  Function('window','history','sessionStorage',departure[1])(window,{back(){assert.equal(window.__startHereDeparting,true,'mark must be set before asynchronous Back starts');backCalls++;}},{removeItem(){}});
  assert.equal(backCalls,1);
  const rest=text.slice(text.indexOf(departure[0])+departure[0].length);
  const expression=rest.match(/const backReady=`([^`]+)`;/)?.[1];assert.ok(expression,'Back readiness predicate exists');
  const evaluate=Function('window','location','document',`return (${expression});`);
  const state=(w,ready=true,button=true,hidden=false)=>evaluate(w,{pathname:'/mabou'},{documentElement:{dataset:{mmmReady:ready?'true':undefined}},getElementById:id=>id==='titleStartHere'?(button?{}:null):{hidden}});
  assert.equal(state(window),false,'departing realm cannot pass even if URL and ready/title flags already resemble Mabou');
  const original=expression.replace('!window.__startHereDeparting && ','');
  assert.equal(Function('window','location','document',`return (${original});`)(window,{pathname:'/mabou'},{documentElement:{dataset:{mmmReady:'true'}},getElementById:()=>({hidden:false})}),true,'old predicate admitted the race witness');
  assert.equal(state({__pageHidden:false}),true,'ready unmarked restored or new document is accepted');
  assert.equal(state({},false),false,'new document still loading is not ready');
  assert.equal(state({},true,false),false,'missing location control is not ready');
  assert.equal(state({},true,true,true),false,'a hidden title cannot pass');
  assert.equal(state({__pageHidden:true}),false,'wait for restored pageshow too');
}
async function conditionPolling(text=browserSource) {
  const line=text.match(/^  const until=.*$/m)?.[0];assert.ok(line,'actual until implementation is present');
  let clock=0,reads=0;
  const until=Function('read','sleep','Date','safeCondition',line+';return until;')(
    async program=>{const document=reads++===0?{documentElement:null}:reads===2?{documentElement:{dataset:{mmmReady:'false'}}}:{documentElement:{dataset:{mmmReady:'true'}}};return Function('document',`return (${program});`)(document);},
    async ms=>{clock+=ms;},{now:()=>clock},safeCondition);
  await until(`document.documentElement.dataset.mmmReady==='true'`);
  assert.equal(reads,3,'null-DOM and not-ready states are both retried by the actual until');
}
async function stableBack(stateModule={waitForStableDocument}) {
  let time=0;
  const realm=await stateModule.waitForStableDocument(async()=>time<400?{ready:true,realm:'restored'}:time<800?{ready:false,realm:'reloaded'}:{ready:true,realm:'reloaded'},'ready',{now:()=>time,delay:async ms=>{time+=ms;},navigation:()=>time<400?0:1,timeout:5000});
  assert.equal(realm,'reloaded');assert.ok(time>=1800,'new realm needs a full quiet second after its controls become ready');
  time=0;
  const same=await stateModule.waitForStableDocument(async()=>({ready:true,realm:'waiting-for-commit'}),'ready',{now:()=>time,delay:async ms=>{time+=ms;},busy:()=>time<1400,timeout:5000});
  assert.equal(same,'waiting-for-commit');assert.ok(time>=2400,'in-flight navigation is not a quiet document');
  time=0;
  await assert.rejects(()=>stateModule.waitForStableDocument(async()=>({ready:false,realm:'loading'}),'ready',{now:()=>time,delay:async ms=>{time+=ms;},timeout:300}),/timeout/);
}
async function viteBackReload(m,recorder=bfcacheRecorder) {
  const local=storage(),session=storage(),page=pageDom('http://localhost/mabou?site=just&mode=explore&q=low&vehicle=car',local,session);
  try {
    page.mountTitle();await page.flush();
    const window={__startHereDocument:'original-mabou',__geoAsks:1};
    // Register the test hook before the real game, exactly like CDP's new-document hook.
    // The recorder waits for a task (setTimeout): here that task runs at the next flush, after every game pageshow handler.
    Function('addEventListener','setTimeout','window','document','location','sessionStorage',recorder)(addEventListener,fn=>queueMicrotask(fn),window,document,location,sessionStorage);
    m.startHere({mode:'explore',era:'today',area:'mabou',site:{brand:'just',area:'mabou'},village:[624271,5103301],roads:[],buildings:[],bounds:null,place(){return false;}});
    const button=document.getElementById('titleStartHere'),status=document.getElementById('startHereStatus');button.disabled=true;status.textContent='Finding your location…';
    // Replay the installed Vite client's actual socket-close/ping/reload functions.
    const source=readFileSync(new URL('../web/node_modules/vite/dist/client/client.mjs',import.meta.url),'utf8');
    const ast=ts.createSourceFile('vite-client.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    const names=new Set(['setupWebSocket','waitForSuccessfulPing','wait','waitForWindowShow']);
    const functions=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(ast)).join('\n');
    assert.equal(ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).length,4);
    const sockets=[],messages=[],pings=[],reloads=[];let resolvePing;
    class Socket {listeners={};constructor(url,protocol){this.url=url;this.protocol=protocol;sockets.push(this);}addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}async emit(type,data){await Promise.all((this.listeners[type]??[]).map(fn=>fn(data)));}}
    const setup=Function('WebSocket','notifyListeners','handleMessage','hasDocument','console','fetch','location','document',functions+';return setupWebSocket;')(
      Socket,()=>{},()=>{},true,{log:s=>messages.push(s)},async(url,options)=>{pings.push({url,options});await new Promise(r=>resolvePing=r);return {};},{reload:()=>reloads.push(location.href)},document);
    const socket=setup('ws','localhost:5173',()=>{});await socket.emit('open',{});
    const reconnect=socket.emit('close',{wasClean:false});
    assert.equal(pings.length,1);assert.match(messages[0],/server connection lost/);assert.equal(reloads.length,0);
    page.dispatchWindow('pageshow',{persisted:true});
    assert.equal(session.getItem(BFCACHE_RESULT_KEY),null,'snapshot waits for all game pageshow handlers');
    await page.flush();
    const capture=JSON.parse(session.getItem(BFCACHE_RESULT_KEY));
    assert.deepEqual(capture,{persisted:true,realm:'original-mabou',buttonPresent:true,disabled:false,status:'',geoAsks:1},'actual game reset captured before Vite can destroy the realm');
    assert.equal(page.navigations.length,0,'game pageshow did not navigate');
    resolvePing();await reconnect;
    assert.deepEqual(reloads,[location.href],'installed Vite close handler alone causes same-URL reload after ping');
    assert.equal(pings[0].options.headers.Accept,'text/x-vite-ping');
    // A dev reload's ordinary pageshow must not overwrite the durable BFCache result.
    window.__startHereDocument='dev-reload';page.dispatchWindow('pageshow',{persisted:false});await page.flush();
    assert.deepEqual(JSON.parse(session.getItem(BFCACHE_RESULT_KEY)),capture);
    const clean=setup('ws','localhost:5173');await clean.emit('open',{});await clean.emit('close',{wasClean:true});
    assert.equal(reloads.length,1,'clean close does not reload');
  } finally {page.close();}
}
async function suite(m){rules(m);handoff(m);boundedRoads(m);await refusals(m);await ui(m);await multiplayerHandoff(m);await realPlacement(m);await requestLifecycle(m);}

const m=await compile(source);await suite(m);mainAdapter(main,m);backNavigationWait();await conditionPolling();await stableBack();await viteBackReload(m);console.log('PASS installed Vite HMR close/ping reload replay, actual game pageshow snapshot, guarded polling and one-second realm stability');
assert.match(main,/import \{ startHere, placeAtStart \} from '\.\/start-here'/);
assert.match(main,/startHere\(\{ mode: gameMode, era: ERA.id, area: AREA.id, site: SITE, village: manifest.village, roads: roads.roads/);
assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,''),/watchPosition|localStorage|indexedDB|document.cookie|\bfetch\s*\(|sendBeacon|console\./,'position module has no network/persistent sink');
console.log('PASS real Vehicle/Roads/Towing: nearest fit, refused-nearest/later fit, no fit, and refused guard already at target; BFCache return and late request cancellation');
console.log('PASS real multiplayer controller handoff (production/development, Off, room, open, blocked storage, pending changes and authoritative arrival preferences), actual main restart and vehicle bounds');
console.log('PASS projection <1 m against GDAL/PROJ; six pipeline boxes, overlap/boundaries, road snap/headings, refusal paths, one-shot UI, reload and blocked storage');
if(process.argv.includes('--mutations'))for(const [name,from,to] of [
  ['wrong central meridian','(lon + 63)','(lon + 62)'],
  ['wrong area box','616076, 5095140','616176, 5095140'],
  ['playable bounds ignored', 'const playable: [number, number] | null = bounds', 'const playable: [number, number] | null = false && bounds'],
  ['stale invitation retained', "query.delete('room');", '/* stale room retained */'],
  ['handoff choice ignored','options.multiplayer.restoreChoice(options.multiplayer.storedChoice ?? pending.multiplayer);','/* choice restore removed */'],
  ['navigation choice ignored', 'options.multiplayer?.choice ??', 'undefined ??'],
  ['driveway allowed','[1, 2, 3].includes','[1, 2, 3, 4].includes'],
  ['building ignored','if (buildings.some(', 'if (false && buildings.some('],
  ['arrival stored choice ignored', 'options.multiplayer.storedChoice ?? pending.multiplayer', 'pending.multiplayer'],
  ['arrival URL reconciliation removed', "if (url.href !== location.href) history.replaceState(history.state, '', url.pathname + url.search + url.hash);", '/* stale invitation remains */'],
  ['placement outcome ignored', 'options.place(candidate) === true', '(options.place(candidate), true)'],
  ['offset building ignored', 'if (buildings.every(', 'if (true || buildings.every('],
  ['retry cap removed', 'if (starts.length > limit) starts.pop();', '/* cap removed */'],
  ['guard result ignored', 'return accepted && sameStartPose(vehicle, start);', 'return sameStartPose(vehicle, start);'],
  ['nearest only', 'roadStarts(point, options.village, options.roads, options.buildings, options.bounds)', 'roadStarts(point, options.village, options.roads, options.buildings, options.bounds).slice(0, 1)'],
  ['restart skipped', 'vehicle.restart(start.x, start.z, start.heading);', '/* restart skipped */'],
  ['BFCache reset removed', 'if (event.persisted) resetRequest();', '/* reset removed */'],
  ['departing token retained', "addEventListener('pagehide', () => { generation++; });", "addEventListener('pagehide', () => {});"],
  ['request token reused', 'const resetRequest = () => { generation++;', 'const resetRequest = () => { generation = 0;'],
  ['accuracy ignored','accuracy > 2000','accuracy > 20000'],
  ['point retained','store?.removeItem(START_HERE_KEY);','/* deletion removed */'],
  ['late answer moves car',"if (token !== generation) return;\n      if ('message' in result)","if ('message' in result)"],
  ['era link splits button and hint', 'if (eraDoor) { hint.after(eraDoor);', 'if (eraDoor) { button.after(eraDoor);'],
  ['mail mode asks',"options.mode !== 'explore'","false"],
]){
  assert.equal(source.split(from).length,2,'unique mutation anchor: '+name);
  const mutant=await compile(source.replace(from,to));
  await assert.rejects(()=>suite(mutant),assert.AssertionError,'mutant killed: '+name);
  console.log('KILLED '+name);
}

if(process.argv.includes('--mutations')) {
  assert.throws(()=>backNavigationWait(browserSource.replace('!window.__startHereDeparting && ','')),assert.AssertionError);console.log('KILLED Back wait departing-document filter removed');
  await assert.rejects(()=>conditionPolling(browserSource.replace('read(safeCondition(expression))','read(expression)')),/dataset/);console.log('KILLED unguarded DOM polling');
  const stateText=readFileSync(new URL('./start-here-browser-state.mjs',import.meta.url),'utf8');
  const stateBundle=await build({stdin:{contents:stateText.replace('stableFor = 1000','stableFor = 0'),loader:'js'},format:'esm',platform:'node',write:false});
  const noQuiet=await import('data:text/javascript;base64,'+Buffer.from(stateBundle.outputFiles[0].text).toString('base64'));
  await assert.rejects(()=>stableBack(noQuiet),assert.AssertionError);console.log('KILLED stable-document quiet interval removed');
  await assert.rejects(()=>viteBackReload(m,bfcacheRecorder.replace('setTimeout(()=>{','((run)=>run())(()=>{')),assert.AssertionError);console.log('KILLED pageshow snapshot before game reset');
  await assert.rejects(()=>viteBackReload(m,bfcacheRecorder.replace('if(!event.persisted)return;','/* overwrite snapshot on reload */')),assert.AssertionError);console.log('KILLED BFCache snapshot overwritten by dev reload');
  assert.equal(viteInitiator({stack:{callFrames:[{url:'http://localhost:5173/@vite/client'}]}}),true);
  assert.equal(viteInitiator({stack:{callFrames:[{url:'/@vite/client'}]}}),true,'relative inspector source URL');
  assert.equal(viteInitiator({stack:{callFrames:[{url:'http://localhost:5173/src/vehicle-choice.ts'}]}}),false);
  assert.equal(viteInitiator({stack:{callFrames:[{url:'http://localhost:5173/src/vehicle-choice.ts'},{url:'http://localhost:5173/@vite/client'}]}}),false,'game navigation is not excused by a Vite ancestor');
  const tap='const token = ++generation;',fresh="const multiplayer = options.multiplayer?.choice ?? { on: false, room: null };";
  assert.equal(source.split(tap).length,2);assert.equal(source.split(fresh).length,2);
  const stale=await compile(source.replace(tap,tap+' const tapChoice = options.multiplayer?.choice ?? { on: false, room: null };').replace(fresh,'const multiplayer = tapChoice;'));
  await assert.rejects(()=>multiplayerHandoff(stale),assert.AssertionError);console.log('KILLED tap-time multiplayer snapshot');
  const anchor='placeAtStart(startPlacement, s)';assert.equal(main.split(anchor).length,2);
  assert.throws(()=>mainAdapter(main.replace(anchor,'false'),m),assert.AssertionError);
  console.log('KILLED main placement skipped');
  await assert.rejects(()=>realPlacement(m,main.replace(anchor,'(placeAtStart(startPlacement, s), true)'),['next','none']),assert.AssertionError);
  console.log('KILLED main placement lies about refusal');
  const bounds='buildings: buildings?.clear ?? [], bounds: vehicle.bounds';assert.equal(main.split(bounds).length,2);
  assert.throws(()=>mainAdapter(main.replace(bounds,'buildings: buildings?.clear ?? [], bounds: null'),m),assert.AssertionError);
  console.log('KILLED main bounds omitted');
}
if(process.argv.includes('--prior')) {
  const prior=await compile(readBaseline('start-here-first','web/src/start-here.ts'));
  assert.throws(()=>boundedRoads(prior,true),assert.AssertionError);console.log('REJECTED 5e73010: Blackstone Road start outside playable bounds');
  await assert.rejects(()=>multiplayerHandoff(prior),assert.AssertionError);console.log('REJECTED 5e73010: real multiplayer cross-area handoff');
}

if(process.argv.includes('--prior')) {
 const prior=await compile(readBaseline('start-here-invite','web/src/start-here.ts'));
 const priorMain=readBaseline('start-here-invite','web/src/main.ts');
 await assert.rejects(()=>realPlacement(prior,priorMain,['next']),assert.AssertionError);console.log('REJECTED d264555: real towing refusal must try another road');
 await assert.rejects(()=>realPlacement(prior,priorMain,['none']),assert.AssertionError);console.log('REJECTED d264555: no-fit real towing start cannot claim success');
 await assert.rejects(()=>requestLifecycle(prior),assert.AssertionError);console.log('REJECTED d264555: disabled button on BFCache return');
}

if(process.argv.includes('--prior')) {
 const stale=await compile(readBaseline('start-here-stale','web/src/start-here.ts'));
 await assert.rejects(()=>multiplayerHandoff(stale),assert.AssertionError);console.log('REJECTED c732230: late Off must override tap-time On');
}
