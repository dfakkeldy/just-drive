import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readMode, chooseMode } from '../web/src/mode';
import { placesFor,findPlace,placePosition,arrivalAt,nearestPlacement,villageStart,ARRIVAL_RADIUS } from '../web/src/places';
import { FreeDrive, SceneryContact, quietInteriors, quietRelief, quietEndings, quietYardJob, exploreKey } from '../web/src/explore';
import { Roads } from '../web/src/roads';
import { Props } from '../web/src/props';
import { CAR_SPEC } from '../web/src/vehicle-spec';
import { TRUCK_SPEC } from '../web/src/truck';
import { SXS_SPEC } from '../web/src/sxs';
const ok=(name,fn)=>{fn();console.log('PASS '+name);};
ok('mode query wins without reading storage',()=>{for(const mode of ['mail','explore'])assert.equal(readMode(new URLSearchParams('mode='+mode),()=>{throw Error('storage accessed');}),mode);});
ok('saved choice, invalid query, invalid save and blocked storage',()=>{const saved={getItem:()=> 'explore'};assert.equal(readMode(new URLSearchParams(),()=>saved),'explore');assert.equal(readMode(new URLSearchParams('mode=other'),()=>saved),'explore');assert.equal(readMode(new URLSearchParams(),()=>({getItem:()=> 'bad'})),'mail');assert.equal(readMode(new URLSearchParams(),()=>{throw Error();}),'mail');});
ok('choice saves, keeps query consistent, and falls back when storage is blocked',()=>{
 const oldStore=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),oldLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
 try{let saved=null,reloads=0;const location={search:'?exag=1.5',reload(){reloads++;}},store={getItem:()=>saved,setItem:(_key,value)=>{saved=value;}};
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:store});Object.defineProperty(globalThis,'location',{configurable:true,value:location});
 chooseMode('explore');assert.equal(saved,'explore');assert.equal(reloads,1);assert.equal(location.search,'?exag=1.5');
 location.search='?exag=1.5&mode=explore';chooseMode('mail');assert.equal(new URLSearchParams(location.search).get('mode'),'mail');assert.equal(new URLSearchParams(location.search).get('exag'),'1.5');
 location.search='?exag=1.5';Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('blocked');}});chooseMode('explore');assert.equal(new URLSearchParams(location.search).get('mode'),'explore');
 }finally{if(oldStore)Object.defineProperty(globalThis,'localStorage',oldStore);else delete globalThis.localStorage;if(oldLocation)Object.defineProperty(globalThis,'location',oldLocation);else delete globalThis.location;}
});
const root=process.env.MMM_ROOT??process.cwd(),manifest=JSON.parse(readFileSync(`${root}/web/public/terrain/manifest.json`)),data=JSON.parse(readFileSync(`${root}/web/public/terrain/${manifest.roads.file}`));
const roads=new Roads(data,manifest.village,{}),places=placesFor(manifest.village),village=findPlace(places,'village');
ok('unique typed source-backed places inside the map box',()=>{assert.ok(places.length>=3);assert.equal(new Set(places.map(x=>x.id)).size,places.length);assert.ok(places.every(p=>p.e>manifest.mid[0]&&p.e<manifest.mid[2]&&p.n>manifest.mid[1]&&p.n<manifest.mid[3]));for(const p of places){const d=nearestPlacement(roads,p,manifest.village)?.dist;assert.ok(d<=(p.radius??ARRIVAL_RADIUS),p.id+' is '+d+' m from a road');}assert.ok(places.every(p=>p.area==='mabou'&&p.sources.length&&p.note));assert.equal(findPlace(places,'missing'),undefined);});
ok('manifest origin and EPSG coordinate signs',()=>{assert.deepEqual([village.e,village.n],manifest.village);assert.deepEqual(placePosition(village,manifest.village),{x:0,z:0});assert.deepEqual(placePosition({e:100,n:200},[90,220]),{x:10,z:20});});
ok('arrival radius enters, nearest wins and leaving clears',()=>{assert.equal(arrivalAt(places,manifest.village,0,0),village);assert.equal(arrivalAt(places,manifest.village,ARRIVAL_RADIUS,0),village);assert.equal(arrivalAt(places,manifest.village,ARRIVAL_RADIUS+1,0),undefined);assert.equal(arrivalAt(places,manifest.village,10000,10000),undefined);const wide=[{id:'a',e:0,n:0,radius:500},{id:'b',e:100,n:0}];assert.equal(arrivalAt(wide,[0,0],90,0)?.id,'b');assert.equal(arrivalAt(wide,[0,0],300,0)?.id,'a');assert.equal(arrivalAt([wide[1],wide[0]],[0,0],90,0)?.id,'b');assert.equal(arrivalAt(wide,[0,0],501,0),undefined);});
ok('trail seed meets drivable road and the mapped kind-5 trail',()=>{const t=findPlace(places,'rail-trail'),p=placePosition(t,manifest.village);const trail=roads.nearest(p.x,p.z,3,r=>r.kind===5&&r.name==='Mabou Rivers Trail');assert.ok(trail&&trail.dist<.01);assert.ok(nearestPlacement(roads,t,manifest.village).dist<2);});
ok('places are apart: no two arrival circles of road places overlap',()=>{const road=places.filter(p=>!p.radius);for(const p of road)for(const o of road)if(o!==p)assert.ok(Math.hypot(o.e-p.e,o.n-p.n)>=2*ARRIVAL_RADIUS,p.id+' is near '+o.id);});
ok('view matches the fixed-shot coordinate',()=>{const p=findPlace(places,'harbour-view');assert.deepEqual([p.e,p.n],[622951.3,5104332.1]);});
ok('all jumps land exactly on drivable roads, facing the segment or the view',()=>{for(const p of places){const hit=nearestPlacement(roads,p,manifest.village);assert.ok(hit&&hit.road.kind<=(p.spawn?.roadId === hit.road.id ? 4 : 3)&&hit.road.kind>=1);const again=roads.nearest(hit.x,hit.z,1,r=>r.id===hit.road.id);assert.ok(again.dist<1e-6);
  // A view faces its view (its own spawn heading), on its named road, inside its own arrival circle.
  if(p.spawn){assert.equal(hit.road.name,p.spawn.road,p.id);assert.equal(hit.heading,p.spawn.heading,p.id);assert.ok(hit.dist<1,p.id);assert.equal(arrivalAt(places,manifest.village,hit.x,hit.z),p,p.id+' jump arrives at its own place');continue;}const[a,b]=[hit.road.pts[hit.seg],hit.road.pts[hit.seg+1]];assert.equal(hit.heading,Math.atan2(b[0]-a[0],-(b[1]-a[1])));}});
ok('jump filter excludes a closer trail; no road gives null',()=>{const net=new Roads({roads:[{id:1,name:'trail',kind:5,halfWidth:1,bridge:false,pts:[[0,0],[0,-100]]},{id:2,name:'road',kind:3,halfWidth:3,bridge:false,pts:[[10,0],[10,-100]]}]},[0,0],{});assert.equal(nearestPlacement(net,{e:0,n:30},[0,0]).road.id,2);assert.equal(nearestPlacement(new Roads({roads:[]},[0,0],{}),{e:0,n:0},[0,0]),null);});
ok('fixed village start is main-road centre, not a route start',()=>{const hit=villageStart(roads,manifest.village);assert.equal(hit.road.name,'Highway 19');assert.equal(hit.road.kind,1);assert.ok(hit.dist<60);assert.ok(roads.nearest(hit.x,hit.z,1).dist<1e-6);assert.throws(()=>villageStart(new Roads({roads:[]},[0,0],{}),[0,0]));});
ok('FreeDrive stays timeless, unfinished, empty and immune to damage',()=>{const s=new FreeDrive(roads,manifest.village);for(let i=0;i<20;i++){s.update(2000,{});s.updateIndoors(2000);s.takePhoto({},{});s.end();s.startOver();s.seenAtRoadside(1,0,0);s.interiorResult({});s.damage.hit('impact',40);s.damage.drive(100,40,'washboard');s.damage.seed('window,alignment');}assert.equal(s.elapsed,0);assert.equal(s.ended,false);assert.equal(s.stops,0);assert.equal(s.run.stops.length,0);assert.equal(s.damage.total,0);assert.equal(s.damage.pulls,false);assert.equal(s.damage.windowStuck,false);assert.equal(s.evidence.photos.length,0);assert.equal(s.complaints.all.length,0);assert.equal(s.group.children.length,0);});
ok('scenery contacts use the real truck, side by side and car post widths',()=>{
 for(const [name,spec,touches]of [['truck',TRUCK_SPEC,true],['side by side',SXS_SPEC,true],['car',CAR_SPEC,false]])for(const [speed,damage,factorOnHit,down]of [[3,2,1,0],[8,3,.91,1]]){   // 3 m/s = 10.8 km/h only dents; 8 m/s = 28.8 km/h passes mailboxDamage's 20 km/h fall threshold (#119)
  const props=new Props({crs:'EPSG:2961',mailboxes:[{x:1.1,y:0,heading:0,style:0,tilt:0,group:null,parcelBox:false}],communityBoxes:[],poles:[]},[0,0],{heightAt:()=>0});
  const contact=new SceneryContact(props),factor=contact.update(.1,{x:0,z:0,heading:0,vx:0,vz:-speed,spec},true);
  console.log(`CONTACT ${name} at ${speed} m/s: factor=${factor}, damage=${props.mail[0].motion.damage}, down=${props.downCount}`);
  assert.equal(props.mail[0].motion.damage,touches?damage:0,`${name} post damage at 1.1 m and ${speed} m/s`);
  assert.equal(factor,touches?factorOnHit:1,`${name} post contact at 1.1 m and ${speed} m/s`);
  assert.equal(props.downCount,touches?down:0,`${name} post fall at ${speed} m/s`);
 }
});
ok('scenery contacts sweep the body of the vehicle that is driven, not the mail car',()=>{const calls=[],spec={envelope:{sweepHalfWidth:1,sweepHalfLength:2}},contact=new SceneryContact({hitCar(...args){calls.push(args);return 1;}});contact.update(.1,{x:0,z:0,heading:0,vx:0,vz:-3,spec},true);assert.equal(calls[0][7],spec);});
ok('scenery contacts retain swept hit positions without scores or paper',()=>{const calls=[],contact=new SceneryContact({hitCar(...args){calls.push(args);return .5;}}),v={x:1,z:2,heading:0,vx:10,vz:0,spec:CAR_SPEC};assert.equal(contact.update(.1,v,true),.5);v.x=20;contact.update(.1,v,true);assert.deepEqual(calls[1].slice(5,7),[1,2]);assert.equal(calls[1][7],CAR_SPEC);v.x=30;contact.reset();contact.update(.1,v,true);assert.deepEqual(calls[2].slice(5,7),[30,2]);assert.equal(contact.group.children.length,0);assert.equal(contact.delivered+contact.lawn+contact.ditch,0);});
ok('quiet extensions have no UI or transitions',()=>{const i=quietInteriors();i.register({id:'mine'});i.enter('mine');assert.equal(i.busy,false);assert.equal(i.doors.size,0);const r=quietRelief();r.request();r.update(100,100,{},true);assert.equal(r.busy,false);assert.equal(r.breaks,0);assert.equal(quietEndings().busy,false);quietYardJob().step(100,true,1);quietYardJob().judge.cancel();});
ok('only mail action keys are swallowed',()=>{for(const code of ['KeyM','KeyE','KeyC','KeyB','KeyG','Enter'])assert.ok(exploreKey(code));for(const code of ['KeyW','KeyS','KeyA','KeyD','KeyH','KeyT','KeyR','KeyV','KeyF','KeyL','Space'])assert.ok(!exploreKey(code));});
