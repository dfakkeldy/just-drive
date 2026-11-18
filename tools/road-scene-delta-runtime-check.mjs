import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {readFileSync} from 'node:fs';
import {railLand} from './guardrail-land.mjs';
import {Props} from '../web/src/props.ts';
import {mailboxShape} from '../web/src/mailbox-rules.ts';
import {Roads} from '../web/src/roads.ts';
import {planRails,RAIL,railStation} from '../web/src/guardrail-rules.ts';
import {RAIL_METAL_POST} from '../web/src/guardrail-look.ts';
const terrain={cartRoads:false,low:false,dataRevision:1,exag:1,seaLevel:0,heightAt:()=>20,meshHeightAt:()=>20,surfaceAt:()=>({ground:20,level:8,canopy:10})};
const road={id:1,name:'Invented test road',kind:2,halfWidth:3,bridge:false,pts:[[0,0],[0,-200]],guardrailRuns:[{start:40,end:110,side:1,posts:'metal'}]};
const spans=planRails(road,()=>20,()=>false,0,200,{canopy:()=>10,coast:()=>false});
assert.ok(spans.length>30);assert.ok(spans.every(s=>s.side===1&&s.a.along>=40&&s.b.along<=110));
assert.equal(planRails({...road,guardrailRuns:[]},()=>20,()=>false).length,0);
assert.equal(planRails(road,()=>null,()=>false).length,0);
assert.equal(planRails(road,()=>20,()=>true).length,0,'observations never close access gaps');
assert.equal(planRails({...road,bridge:true},()=>20,()=>false).length,0);
for(const low of [false,true]){
 terrain.low=low;const roads=new Roads({roads:[road]},[0,0],terrain),g=roads.guardrails;
 for(let i=0;i<2000;i++){g.update(new THREE.Vector3(-5,22,70));if(!g.audit.pending)break;}
 const metals=g.group.children.flatMap(m=>Array.from(m.geometry.attributes.rail.array).filter((_,i)=>i%3===2)).filter(n=>n===RAIL_METAL_POST);
 assert.ok(metals.length>100,'actual runtime mesh has metal posts');
 assert.ok(g.chunks.flatMap(c=>c.solids).length>20,'same rail collider path');
}
const camera=new THREE.PerspectiveCamera();camera.position.set(0,3,8);camera.updateMatrixWorld();
for(const style of [0,6,7]){
 const box={x:0,y:0,heading:0,style,tilt:0,group:null,parcelBox:false};
 const props=new Props({crs:'EPSG:2961',mailboxes:[box],communityBoxes:[],poles:[]},[0,0],terrain);
 props.update(camera,0);const meshes=props.group.children.flatMap(g=>g.children),names=meshes.map(m=>m.name);
 assert.ok(names.includes('box-'+style));
 assert.ok(names.includes(style===6?'curved-pedestal':style===7?'plastic-pedestal':'wood'));
 if(style===6){
  assert.ok(names.includes('house-mail-roof'));assert.ok(names.includes('house-mail-gable'));
  const roof=meshes.find(m=>m.name==='house-mail-roof'),matrix=new THREE.Matrix4();
  assert.equal(roof.count,2);
  for(let i=0;i<2;i++){
   roof.getMatrixAt(i,matrix);const points=[-.5,.5].map(x=>new THREE.Vector3(x,0,0).applyMatrix4(matrix)).sort((a,b)=>Math.abs(a.x)-Math.abs(b.x));
   assert.ok(points[0].y>points[1].y,'gable roof rises toward centre ridge');
  }
 }
 const shape=mailboxShape(style);
 const y=20+1.05+shape.height/2;
 assert.equal(props.mailHit(0,y,-2,0,y,2,false),0,'drawn opening accepts mail');
 assert.equal(props.mailHit(0,y,2,0,y,-2,false),-1,'back rejects mail');
 assert.equal(props.mailHit(shape.width,y,-2,shape.width,y,2,false),-1,'side rejects mail');
 props.knockMailbox(0,1,0);props.update(camera,2);assert.equal(props.downCount,1);
 props.resetShift();assert.equal(props.downCount,0);assert.deepEqual([props.mail[0].x,props.mail[0].z],[0,0]);
}
console.log('PASS real Props geometry/openings/damage and observed metal rail planner/mesh/LOW/access/unknown-ground gates');

if(process.argv.includes('--land')){
 const land=railLand(),v=land.village;
 const rule=JSON.parse(readFileSync('pipeline/dashcam_20261116.json')).guardrail;
 const hit=land.roads.nearest(rule.point[0]-v[0],v[1]-rule.point[1],15,r=>r.name===rule.name&&!r.bridge);
 assert.ok(hit);assert.equal(hit.road.id,111);
 const s=railStation(hit.road,hit.seg,hit.t);
 hit.road.guardrailRuns=[{start:s-rule.halfLength,end:s+rule.halfLength,side:rule.side,posts:rule.posts}];
 const actual=planRails(hit.road,land.ground,land.access,s-80,s+80,land.context);
 assert.ok(actual.length>10,'real observed rail must survive ground/access gates');
 assert.ok(actual.every(p=>p.side===1&&p.a.x<land.roads.nearest(p.a.x,p.a.z,10,r=>r.id===111).x),'west/left side');
 console.log('PASS real Southwest Ridge rail',JSON.stringify({spans:actual.length,metres:actual.length*RAIL.pitch,start:s-30,end:s+30,reads:land.reads}));
}
