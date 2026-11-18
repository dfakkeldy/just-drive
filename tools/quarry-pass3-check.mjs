// Last-review behavioral regressions; the same tests run against QUARRY_REVIEW_REF.
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {bootTripParams} from '../web/src/quarry-trip';
import * as route from '../web/src/quarry-route';
const {quarryRoute,routeJunctionSamples}=route;
import {Coast} from '../web/src/coast';
import * as pool from '../web/src/quarry-water';
import {QuarryJourney} from '../web/src/quarry-journey';
import {APRON} from '../web/src/quarry-site';
export function pass3Tests(test,read){
 test('P3-1 failed feature import and factory use the retryable area screen',()=>{
  const main=read('web/src/main.ts'),screen=read('web/src/area-screen.ts');
  assert.match(main,/import\('\.\/quarry-feature'\)[\s\S]{0,140}\.catch\(/,'import AND factory must be in the handled promise');
  assert.match(screen,/location\.reload\(/,'existing area screen offers retry');
 });
 test('P3-2 shoreline discard stops at the drawn water plane',()=>{
  const shader=read('web/src/shaders.ts'),cut=shader.match(/if\(vCoast\.(?:y|z)>[^\n]+discard;/)?.[0];assert.ok(cut);
  assert.match(cut,/quarryWaterBacked\(vWorld\)/,'test actual drawn vertex height and screen ray');
  assert.match(shader,/quarryLakePlanes; \/\/ actual drawn planes/);
  assert.match(shader,/p\.y<plane\|\|/,'real land discard stops at the drawn plane; only artificial skirts can be higher');
  assert.match(shader,/abs\(back-id\)<\.1/,'every discard is backed by the drawn lake triangle footprint');
  const geo=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(new Array(9).fill(0),3));
  const mask=pool.quarryLakeMask([new THREE.Mesh(geo,new THREE.MeshBasicMaterial())],[631900,5064500]);
  assert.ok(mask.data.every(v=>v===0),'a degenerate lake triangle cannot back any discarded land');
 });
 test('P3-3 expanded Just Drive address honours a changed area path',()=>{
  const saved={location:globalThis.location,history:globalThis.history};
  try{for(const path of ['/judique','/westbay']){
   globalThis.location={hostname:'localhost',pathname:path,search:'?site=just&trip=quarry&area=westbay&mode=explore&vehicle=truck&trailer=1',hash:''};
   globalThis.history={state:null,replaceState(_s,_t,a){const u=new URL(a,'http://localhost');Object.assign(globalThis.location,{pathname:u.pathname,search:u.search});}};
   const q=bootTripParams();assert.equal(location.pathname,path);assert.equal(q.has('trip'),path==='/westbay');assert.equal(q.get('area'),path.slice(1));
  }
   globalThis.location={hostname:'localhost',pathname:'/judique',search:'?site=just&trip=quarry&area=porthood&mode=explore&vehicle=truck&trailer=1',hash:''};
   const explicit=bootTripParams();assert.equal(explicit.has('trip'),false);assert.equal(explicit.get('area'),'porthood','a contradictory explicit area query retains precedence');assert.equal(location.pathname,'/porthood');
  }finally{Object.assign(globalThis,saved);}
 });
 test('P3-4 an endpoint can join an earlier segment of its own road',()=>{
  const road=(id,pts)=>({id,pts,name:id===1?'Eagle Creek Road':null,kind:3,bridge:false,halfWidth:2});
  const roads=[road(1,[[0,100],[0,0],[100,0],[100,100],[50,100],[50,0]]),road(1672,[[25,0],[25,-100]])];
  const r=quarryRoute(roads,[APRON.e-25,APRON.n],()=>0);assert.ok(Math.abs(r.length-80)<1e-8,'80 m shortest path, actual '+r.length);
  assert.ok(routeJunctionSamples(roads).some(p=>p.x===50&&p.z===0),'sample self junction elevation');
 });
 test('P3-5 small quarry chunks remain exposed on their drawn bedding',()=>{
  const terrain={exag:1,low:false,uniforms:{},drawnRevision:1,meshHeightAt:()=>20,fitCoastRecesses(){}};
  const block={x:0,z:0,size:.4,height:.3,turn:0,y:0,burial:0},site={quarry:true,box:[-1,-1,1,1],village:[0,0]};
  const c=new Coast(site,terrain,false,{candidates:[block],capacity:1,bedding:.85,minHeight:0,maxHeight:100});c.update(new THREE.Vector3());
  c.mesh.geometry.computeBoundingBox();assert.equal(c.mesh.count,1);assert.ok(block.y+c.mesh.geometry.boundingBox.max.y*block.height-20>=.20,'at least 20 cm of this 30 cm chunk is exposed');
 });
 test('P3-7 journey follows the live driven vehicle on update, save and recovery',()=>{
  const saved={document:globalThis.document,sessionStorage:globalThis.sessionStorage},store=new Map();
  const element=()=>({dataset:{},setAttribute(){},append(){},hidden:false,parentElement:null});
  globalThis.document={createElement:element,getElementById:()=>null,head:{append(){}},body:{append(){}}};
  globalThis.sessionStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
  try{
   const truck={x:10,z:0,heading:0,speed:0,restart(x,z,heading){Object.assign(this,{x,z,heading});}},bike={...truck,x:60};let driven=truck;
   const route={points:[{x:0,z:0},{x:100,z:0}],cumulative:[0,100],length:100,turns:[],joins:[],gaps:[],start:{x:0,z:0,heading:0},near:{x:0,z:0,heading:0},destination:{x:100,z:0}};
   // Carry the initial pose on the callable too, so the old constructor reproduces 90/10,
   // rather than failing only because its old argument type was concrete.
   const current=Object.assign(()=>driven,truck);
   const journey=new QuarryJourney(new URLSearchParams('trip=quarry'),{},[0,0],current,null,route);
   journey.update(2,true);assert.equal(journey.remaining,90);assert.equal(JSON.parse(store.get('mmm.trip.quarry')).x,10);
   driven=bike;journey.update(2,true);console.log('P3-7 observed',JSON.stringify({remaining:journey.remaining,saved:JSON.parse(store.get('mmm.trip.quarry')).x}));assert.equal(journey.remaining,40,'100 m route follows bike at x=60');
   assert.equal(JSON.parse(store.get('mmm.trip.quarry')).x,60,'save follows bike, not initial truck');
   store.set('mmm.trip.quarry',JSON.stringify({x:75,z:0,heading:.2}));journey.place();assert.equal(bike.x,75,'recovery targets the current bike');assert.equal(truck.x,10,'initial truck stays parked');
  }finally{Object.assign(globalThis,saved);}
 });
 test('P3-6 LOW quarry budget rows fit the existing 1.48 million ceiling',()=>{
  const rows=JSON.parse(read('tools/baseline/frame-budget.json'));const text=JSON.stringify(rows);assert.ok(text.includes('quarry'));
  const visit=o=>{if(!o||typeof o!=='object')return;for(const [key,value]of Object.entries(o)){if(key.toLowerCase().includes('quarry')&&key.toLowerCase().includes('phone'))assert.ok(value.triangles<=1480000,'LOW quarry row '+key+' costs '+value.triangles);else visit(value);}};visit(rows);
  assert.ok(read('web/src/main.ts').includes('terrain.split = AREA.quarry ?'),'existing split knob is area scoped');
 });
}
