import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { Shift } from '../web/src/shift.ts';
import { Interiors } from '../web/src/interiors.ts';
import { MineInterior } from '../web/src/interior-mine.ts';
import { MineSite, mineRoadEnd } from '../web/src/mine-site.ts';
import { roads, village, terrain } from './shift-fixture.mjs';
const elements = new Map();
class Element {
  hidden=false; textContent=''; children=[]; listeners=new Map(); style={setProperty(){},removeProperty(){}}; scrollTop=0;
  classList={add(){},remove(){}};
  addEventListener(name,fn){this.listeners.set(name,fn);}
  after() {}
  append(...nodes){this.children.push(...nodes);for(const n of nodes) if(n.id)elements.set(n.id,n);}
  appendChild(node){this.append(node);return node;}
  replaceChildren(...nodes){this.children=nodes;}
  focus(){} click(){this.listeners.get('click')?.();}
  getContext(){return {fillRect(){},strokeRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}};}
}
globalThis.document={head:new Element(),body:new Element(),createElement(){return new Element();},getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);}};
Object.defineProperty(globalThis,'localStorage',{get(){throw Error('No storage');}});
let disposals=0;const receipts=[];
const factory=()=>({scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),result:null,readout:'Test delivery',update(){},render(){},leave(){this.result??={delivered:false,note:'Walked out.'};},dispose(){disposals++;}});
const door={id:'test',name:'Test desk',position:{x:0,z:0},radius:14,prompt:'A parcel.',create:factory};
const doors=new Interiors(()=>1,()=> '10:00',r=>receipts.push(r));doors.register(door);
doors.update(.1,{throttle:0,steer:0,handbrake:false},{x:0,z:0,speed:1},true);
assert.equal(elements.get('doorPrompt').hidden,true,'no prompt above 3 km/h');
doors.update(.1,{}, {x:0,z:0,speed:0},true);assert.equal(elements.get('doorPrompt').hidden,false);
doors.enter();assert.equal(doors.busy,true);doors.update(.41,{}, {},true);doors.update(.41,{}, {},true);
doors.game.result={delivered:true,note:'Signed.'};doors.update(.1,{}, {},true);doors.update(.41,{}, {},true);
assert.equal(doors.busy,false);assert.equal(receipts.length,1);assert.equal(receipts[0].result.delivered,true);assert.equal(disposals,1);
doors.update(.5,{}, {x:0,z:0,speed:0},true);assert.match(elements.get('doorPrompt').children[1].textContent,/Already visited/);
doors.enter('test');assert.equal(doors.busy,false,'once per day');
doors.reset();doors.enter('test');doors.closeForDay();assert.equal(receipts[1].result.delivered,false);assert.equal(disposals,2);
const mail={delivered:0,lawn:0,ditch:0,down:0,reset(){}};
const shift=new Shift(null,mail,roads,terrain,[],village,true,new URLSearchParams('day=1'),()=>{});
shift.updateIndoors(3);assert.equal(shift.elapsed,60,'interior uses same 20x clock');
const receipt={door,result:{delivered:true,note:'Signed.'}};
shift.interiorResult(receipt);shift.interiorResult(receipt);assert.equal(shift.indoorParcels,1,'duplicate receipt ignored');
shift.interiorResult({door:{...door,id:'other'},result:{delivered:false,note:'Walked out.'}});
assert.equal(shift.complaints.all.filter(c=>c.kind==='indoors').length,1);
assert.equal(shift.updateIndoors(2000),true);assert.equal(shift.ended,false,'caller records pending result before closing time report');
shift.interiorResult({door:{...door,id:'closing'},result:{delivered:false,note:'Shift ended.'}});shift.end();
const stats=elements.get('reportStats').children;const count=stats.findIndex(el=>el.textContent==='Parcels delivered indoors');
assert.equal(stats[count+1].textContent,'1');assert.equal(shift.complaints.all.filter(c=>c.kind==='indoors').length,2);
elements.get('startOver').click();assert.equal(shift.indoorParcels,0,'new shift resets indoor totals');
const manifest=JSON.parse(readFileSync('../data/baked/terrain/manifest.json','utf8'));
const [ve,vn]=village,edge=120;
const bounds=[manifest.mid[0]-ve+edge,vn-manifest.mid[3]+edge,manifest.mid[2]-ve-edge,vn-manifest.mid[1]-edge];
const point=mineRoadEnd(roads,bounds);assert.ok(point);
assert.ok(point.x>=bounds[0]+60&&point.x<=bounds[2]-60&&point.z>=bounds[1]+60&&point.z<=bounds[3]-60);
assert.equal(roads.nearest(point.x,point.z,1).road.name,'Mabou Mines Road');
const slope={clear:[],surfaceAt(x,z){return {ground:20+x*.01+z*.005,level:8};}};
const site=new MineSite(roads,slope,bounds,village);site.update(new THREE.Vector3(point.x,30,point.z));
assert.equal(site.group.children.length,1);assert.ok(Math.abs(Math.hypot(site.portal.x-point.x,site.portal.z-point.z)-point.halfWidth-18)<1e-6);
const nx=Math.cos(point.heading),nz=Math.sin(point.heading),o=point.halfWidth+18;
assert.ok(site.portal.y >= slope.surfaceAt(point.x-nx*o,point.z-nz*o).ground);
assert.ok(site.portal.y >= slope.surfaceAt(point.x+nx*o,point.z+nz*o).ground);
console.log('PASS: stopped-door prompt; fades and receipt; once-per-day/reset; early closing; disposal; real Shift clock/report/dedup/reset; bounded real-road end; uphill portal offset.');
console.log('Road stop EPSG:2961:',JSON.stringify({east:point.x+ve,north:vn-point.z,heading:point.heading*180/Math.PI}));

// A ray down onto the rail near a segment's far end catches the former stair-step floor occlusion.
const mine=new MineInterior(1);mine.scene.updateMatrixWorld(true);
const railRay=new THREE.Raycaster(new THREE.Vector3(.57,2,-3.8),new THREE.Vector3(0,-1,0));
const first=railRay.intersectObjects(mine.scene.children,true)[0];
assert.equal(first?.object.material?.color?.getHex(),0x8b9997,'rail remains above sloping floor');
mine.dispose();console.log('PASS: real scene ray hits rail above floor at segment end; resources dispose.');
