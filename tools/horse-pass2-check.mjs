import { readBaseline } from './baseline-source.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from '../web/node_modules/typescript/lib/typescript.js';
import {spy} from './world-update-fixture.mjs';
import {createHorse,HORSE_SPEC} from '../web/src/horse.ts';
import {CAR_SPEC} from '../web/src/vehicle-spec.ts';
import {rideFeatures} from '../web/src/ride-features.ts';
import {horseKeys,vehicleButtons} from '../web/src/vehicle-choice.ts';
import {Vehicle} from '../web/src/vehicle.ts';
import {Group} from '../web/node_modules/three/build/three.module.js';
import {HistoryBridgeApproaches} from '../web/src/eras/history-approaches.ts';
import {Roads} from '../web/src/roads.ts';
import {RoadScene} from '../web/src/road-scene.ts';
import {Mail} from '../web/src/mail.ts';
import {Props} from '../web/src/props.ts';
import {HorseSound} from '../web/src/horse-sound.ts';
const base=process.env.HORSE_PASS2_BASE;
const source=p=>base?execFileSync('git',['show',base+':'+p],{encoding:'utf8'}):readFileSync(p,'utf8');
// Compare the merge and its predecessor as frozen, independent of subsequent edits.
const landed=p=>base?source(p):readBaseline('horse-merge',p);
const cases=[];const test=(name,run)=>cases.push({name,run});
const main=source('web/src/main.ts');
const listeners={};globalThis.window={addEventListener(n,f){listeners[n]=f;}};
globalThis.document={getElementById:()=>null};globalThis.localStorage={getItem:()=>null};
const dummy=()=>({car:createHorse(),surfaceName:'grass'});
test('1-story',()=>{
 const result=spy(main,false,true,false,{horse:true});
 assert.equal(result.context.vehicle.damageActive,false,'horse repairs remain immune in the real frame');
 const step=main.match(/roadScene\?\.step\(1 \/ 120, vehicle, ([^)]+)\)/)[1];
 const playing=new Function('c','with(c){return ('+step+')}')(result.context);
 assert.equal(playing,true,'horse roadside story remains eligible while repairs are immune');
 globalThis.addEventListener=()=>{};
 const terrain={manifest:{village:[618982.72,5109266.90]},heightAt:()=>0};
 const shift={career:{day:1},ended:false,roadside:[],complaints:{add(){}},elapsed:0};
 const scene=new RoadScene({nearest:()=>({road:{id:1,pts:[[0,-100],[0,100]]},seg:0,t:.5})},terrain,shift,new URLSearchParams('scene=fish'));
 const player={x:6,z:20,heading:0,vx:0,vz:0,spec:HORSE_SPEC};
 scene.step(1/120,player,playing);assert(scene.rules.seen,'horse story sets seen');
 for(let i=0;i<3;i++){scene.honk(player);for(let j=0;j<120;j++)scene.step(1/120,player,playing);}
 for(let j=0;j<6000;j++)scene.step(1/120,player,playing);
 assert(scene.rules.cleared&&scene.rules.honks===3&&scene.rules.truckAlong>4,'horse whinnies clear the road');
});
test('2-mail',()=>{
 const features=rideFeatures(dummy(),{id:'horse'}, {},false);
 const state={mailMode:true,help:'',showRuts:true};features.hud?.(state);
 assert.equal(state.mailMode,true,'horse HUD retains real mail mode');
 const rows=horseKeys(false,true).flat().join(' ');
 for(const key of ['M / E','C','Esc / P','B','Enter'])assert(rows.includes(key),'horse mail controls include '+key);
 assert(!/places/i.test(rows),'mail horse does not advertise unavailable Places');
 const rig=createHorse(),terrain={heightAt:()=>0,surfaceAt:()=>null};
 const props=new Props({crs:'EPSG:2961',mailboxes:[{x:0,y:0,heading:270,style:0,tilt:0,group:null,parcelBox:false}],communityBoxes:[],poles:[]},[0,0],terrain);
 const mail=new Mail(terrain,props,[],[0,0],true),v={car:rig,x:-5.6,z:.34,y:0,heading:0,vx:0,vz:0,spec:HORSE_SPEC};
 mail.service={condition:()=> 'ready',deliver:()=>true,ground(){}};
 rig.root.position.set(v.x,0,v.z);rig.animate(0,0,()=>0);rig.root.updateMatrixWorld(true);
 mail.update(0,v,true);const piece=mail.pieces[0];assert(piece.y>1.8&&piece.y<2.6,'rider hand height for mail');
 for(let n=0;n<180&&!mail.delivered;n++)mail.update(1/120,v,false);
 assert.equal(mail.delivered,1,'rider mail reaches the box');
});
test('3-motor-decks',()=>{
 const s=source('tools/era-deck-check.mjs').replace(/\s/g,'');
 assert(s.includes('for(constsideof[0,road.halfWidth+.8])'),'original motor reset samples remain intact');
 assert(s.includes('Math.abs(car.speed)>9?-.15:0'),'original motor throttle policy remains intact');
 const motor=landed('tools/era-deck-check.mjs').replace("import {horseDeckCases} from './horse-deck-cases.mjs';\n",'').replace('  await horseDeckCases({terrain,roads,road,hill,at,path,pathCum,before,len});\n','');
 assert.equal(motor,readBaseline('before-horse','tools/era-deck-check.mjs'),'historical PR #103 check: all original motor cases remained byte-identical');
 assert(!s.includes('mount===horse?(direction===1?0:len)'),'horse cases begin on inbound approaches');
});
test('4-coarse-evidence',()=>{
 const s=source('tools/horse-browser.mjs');
 assert(/assert[^;]+trace\.(completed|progress)/.test(s),'coarse browser requires completed crossing');
 assert(/(drawnTile|selectedContactTile)/.test(s)&&/tileLevels/.test(s),'coarse browser reads actual supporting tile levels');
});
const point=(node,x,y,z,out)=>{out.set(x,y,z).applyMatrix4(node.matrixWorld);};
function slip(speed,turn=0){
 const rig=createHorse(),feet=[0,1,2,3].map(i=>rig.root.getObjectByName('Hoof '+i));
 const anchors=feet.map(()=>Array.from({length:4},()=>feet[0].position.clone()));
 const p=feet[0].position.clone();const previous=Array(4).fill(false);let max=0,stances=0;
 for(let n=0;n<120*7;n++){
  const dt=1/120,h=n*dt*turn;rig.root.position.x+=Math.sin(h)*speed*dt;rig.root.position.z-=Math.cos(h)*speed*dt;rig.root.rotation.y=-h;
  rig.body.position.y=0;rig.body.rotation.set(0,0,0);rig.animate(dt,speed,()=>0);rig.root.updateMatrixWorld(true);
  for(let l=0;l<4;l++){
   const hoof=feet[l],planted=hoof.userData.planted,corners=[[-.5,-.5,-.5],[.5,-.5,-.5],[-.5,-.5,.5],[.5,-.5,.5]];
   if(planted){if(!previous[l])stances++;for(let j=0;j<4;j++){point(hoof,...corners[j],p);if(!previous[l])anchors[l][j].copy(p);else max=Math.max(max,p.distanceTo(anchors[l][j]));}}
   previous[l]=planted;
  }
 }
 return{speed,turn,max,stances};
}
test('5-slip',()=>{
 for(const [speed,turn]of [[.8,0],[1.67,0],[3.8,0],[6.5,0],[10,0],[-.8,0],[0,.7],[1.67,.25]]){
  const report=slip(speed,turn);console.log('SLIP',JSON.stringify(report));assert(report.max<.03,'planted hoof world slip below 3 cm');assert(report.stances>=4,'measure complete stance intervals');
 }
});
test('6-car-hooks',()=>{
 const features=rideFeatures(dummy(),{id:'car',spec:CAR_SPEC},{},false);let calls=0;
 assert(!features.update&&!features.hud&&!features.pause,'car has no horse frame/pause/HUD hooks');
 for(let i=0;i<1000;i++){features.update?.(++calls,true);features.pause?.(++calls);features.hud?.({get mailMode(){calls++;return true;}});}
 assert.equal(calls,0,'car horse-hook counter stays zero');
});
test('7-no-refinement',()=>{
 for(const p of ['web/src/terrain.ts','tools/terrain-lifecycle-check.mjs'])assert.equal(landed(p),readBaseline('before-horse',p),'historical PR #103 check: main land/lifecycle text left exactly as before');
 assert(!/meshSpacing/.test(source('web/src/eras/history-approaches.ts')),'era does not request finer land');
 let selected=5;const terrain={contactRevision:1,exag:1,seaLevel:-.2,manifest:{size:256,origin:[0,0],village:[0,0],levels:{}},surfaceAt:()=>({level:6}),meshContactSource:(_x,_z,land)=>land?6:selected,meshContactAt(_x,_z,out){out.height=selected===5?100:0;out.source=selected;out.drawn=true;return true;}};
 const roads={roads:[{id:1,name:null,kind:4,halfWidth:1,bridge:true,pts:[[0,0],[0,4]]}],group:new Group(),trimTimberApproaches(){}};const abutment=new HistoryBridgeApproaches(roads,terrain,()=>0).aprons[0];assert.equal(abutment.prepare(),false,'do not construct from a transient lower LOD while level 6 is arriving');selected=6;terrain.contactRevision++;assert.equal(abutment.prepare(),true,'construct when actual selected and loaded bank sources agree');
});
test('7a-geometry-only-approaches',()=>{
 const road={id:1,name:null,kind:4,halfWidth:1.5,bridge:true,pts:[[0,0],[0,20]]};
 const ground=(_x,z)=>z<0?2:4,terrain={seaLevel:-.2,exag:1.5};
 const networks=[{roads:[road]},new Roads({roads:[road]},[0,0],{cartRoads:true})];
 for(const roads of networks){
  const expected=new HistoryBridgeApproaches(roads,terrain,ground,false);
  const approaches=new HistoryBridgeApproaches(roads,terrain,ground);
  assert.deepEqual(approaches.audit,{spans:1,approaches:2,missing:0});
  assert.equal(approaches.aprons.length,0,'geometry-only inputs create no scene objects');
  assert.deepEqual(approaches.planeFor(road),expected.planeFor(road));
  assert.deepEqual(approaches.sites.map(s=>s.box),expected.sites.map(s=>s.box));
  for(let z=-50;z<=70;z++)for(const x of [-5,0,5])assert.deepEqual(approaches.sites.map(s=>s.height(x,z,10)),expected.sites.map(s=>s.height(x,z,10)));
  approaches.update({x:0,z:0});
  if(roads.group)assert.equal(roads.group.children.length,0);
 }
 const noScene={...terrain,get manifest(){throw Error('plain network must not read tile records');}};
 assert.equal(new HistoryBridgeApproaches(networks[0],noScene,ground).aprons.length,0);
});
test('8-animation-cost',()=>{
 const rig=createHorse();rig.phase=.84;let queries=0,forced=0;const original=rig.root.updateMatrixWorld;
 rig.root.updateMatrixWorld=function(force){if(force)forced++;return original.call(this,force);};
 rig.body.position.y=0;rig.body.rotation.set(0,0,0);rig.animate(0,10,()=>{queries++;return 0;});
 assert.equal(queries,0,'flight hooves do not query ground');assert.equal(forced,0,'animation does not force a root subtree update');
 const text=source('web/src/horse.ts'),ast=ts.createSourceFile('horse.ts',text,ts.ScriptTarget.Latest,true);let body;
 function find(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='animate')body=n.initializer;ts.forEachChild(n,find);}find(ast);assert(body);
 let allocations=0;function visit(n){if(ts.isNewExpression(n)||ts.isArrayLiteralExpression(n)||ts.isObjectLiteralExpression(n))allocations++;if(n!==body&&(ts.isArrowFunction(n)||ts.isFunctionExpression(n)))allocations++;ts.forEachChild(n,visit);}visit(body);
 assert.equal(allocations,0,'animation body has no per-frame allocation expressions');
 const startQueries=rig.audit.groundQueries,startLandings=rig.audit.landings;
 for(let i=0;i<1000;i++){rig.root.position.z-=10/120;rig.body.position.y=0;rig.body.rotation.set(0,0,0);rig.animate(1/120,10,()=>0);}
 const report={frames:1000,queries:rig.audit.groundQueries-startQueries,landings:rig.audit.landings-startLandings,forced};
 assert(report.queries<2000,'steady animation queries only contact and imminent landing feet');assert.equal(forced,0);console.log('ANIMATION_COUNTERS',JSON.stringify(report));
 const changing=createHorse();changing.animate(0,0,()=>0,0);changing.body.position.y=0;changing.body.rotation.set(0,0,0);changing.animate(0,0,x=>x*.5,1);changing.root.updateMatrixWorld(true);const hoof=changing.root.getObjectByName('Hoof 0'),up=hoof.up.clone().applyQuaternion(hoof.getWorldQuaternion(hoof.quaternion.clone())),normal=up.clone().set(-.5,1,0).normalize();assert(up.dot(normal)>.9999,'planted sole refits its tilt when supporting ground changes');
 const rising=createHorse(),plane=(x,z)=>x*.2-z*.35;let gap=Infinity,tested=false;for(let n=0;n<300;n++){rising.root.position.z-=10/120;rising.root.position.y=plane(0,rising.root.position.z);rising.body.position.y=0;rising.body.rotation.set(0,0,0);rising.animate(1/120,10,plane,0);rising.root.updateMatrixWorld(true);if(n>120&&rising.phase>.895&&rising.phase<.92){tested=true;for(let i=0;i<4;i++){const h=rising.root.getObjectByName('Hoof '+i);assert(!h.userData.planted);for(const x of [-.5,.5])for(const z of [-.5,.5]){const q=h.up.clone().set(x,-.5,z).applyMatrix4(h.matrixWorld);gap=Math.min(gap,q.y-plane(q.x,q.z));}}break;}}assert(tested&&Number.isFinite(gap)&&gap>.03,'swing clearance follows the cached ground plane on a rising grade');
});
test('9-audio-idle',async()=>{
 class Audio{state='running';sampleRate=32;currentTime=0;destination={};createGain(){return{gain:{value:0,setTargetAtTime(){},setValueAtTime(){}},connect(){}};}createBuffer(){return{getChannelData:()=>new Float32Array(16)};}async resume(){this.state='running';}async suspend(){this.state='suspended';}}
 globalThis.AudioContext=Audio;const sound=new HorseSound();sound.update(0,true);listeners.keydown();sound.update(0,false);await Promise.resolve();assert.equal(sound.audio.state,'suspended','idle horse audio context is suspended');
});
test('10-exact-oracles',()=>{
 const mutations=source('tools/horse-mutations.mjs'),offline=source('tools/horse-offline-browser.mjs');
 assert(/expectedAssertion/.test(mutations),'mutants require their own expected assertion');
 assert(/afterPosition|displacement/.test(offline)&&/Math\.hypot/.test(offline),'offline acceptance requires world displacement');
});
test('11-camera-support',()=>{
 // Same position, same loaded tiles; only what the camera sees changes. The ground under a hoof must not move.
 let visible=true;
 const terrain={heightAt:()=>43.705,surfaceAt:()=>({deck:false}),
  meshHeightAt:(x,z,drawnOnly)=>drawnOnly&&!visible?null:50.269,
  meshContactAt:(x,z,out)=>{out.height=50.269;out.source=6;out.drawn=visible;return true;}};
 const horse=new Vehicle(createHorse(),terrain,{deckHeight:()=>null},-.2,HORSE_SPEC);
 const seen=horse.groundAt(5117.01,4577);visible=false;const turned=horse.groundAt(5117.01,4577);
 assert.equal(seen,50.269,'hoof stands on the selected mesh triangle');
 assert.equal(turned,seen,'turning the camera away does not change hoof support');
});
test('12-today-picker',()=>{
 const make=()=>{const el={children:[],style:{},dataset:{},attrs:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(){},appendChild(c){this.children.push(c);},append(...c){this.children.push(...c);}};return el;};
 const saved={document:globalThis.document,location:globalThis.location};
 const picker=search=>{globalThis.document={createElement:make};globalThis.location={search,hostname:'127.0.0.1',pathname:'/'};
  try{const g=vehicleButtons({kind:'car',choose(){}});return {kinds:g.children.map(b=>b.dataset.vehicle),labels:g.children.map(b=>b.textContent),css:g.style.cssText};}
  finally{globalThis.document=saved.document;globalThis.location=saved.location;}};
 for(const q of ['?mode=explore&vehicle=car','?mode=explore&vehicle=truck','?mode=explore']){
  const p=picker(q);assert.deepEqual(p.kinds,['car','sxs','bike','drone'],'today keeps the four-button picker: '+q);
  assert.deepEqual(p.labels,['Car','Side by side','Dirt bike','Drone']);assert.equal(p.css,'display:flex;flex-wrap:wrap;gap:6px;margin:0 0 16px','today picker wraps cleanly in narrow panels');}
 assert.deepEqual(picker('?mode=explore&era=1884').kinds,['horse','car','sxs','bike','drone'],'1884 adds the horse in front');
});
const only=process.env.HORSE_PASS2_CASE;
for(const c of cases)if(!only||only===c.name){await c.run();console.log('PASS PASS2',c.name);}
