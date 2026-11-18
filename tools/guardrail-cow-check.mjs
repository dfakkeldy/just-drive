import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname} from 'node:path';
import {Group,Box3} from '../web/node_modules/three/build/three.module.js';
import {cowBody,cowRailGap,cowRest,COW_REST} from '../web/src/cow-rest.ts';
import {Animals,createRoadCow} from '../web/src/animals.ts';
import {Guardrails} from '../web/src/guardrails.ts';
import {RAIL,planRails,roadLength,railPoint} from '../web/src/guardrail-rules.ts';
import {railLand} from './guardrail-land.mjs';
import {AREAS} from '../web/src/area.ts';
const road={id:1,name:'Cow placement fixture',kind:3,halfWidth:3,bridge:false,pts:[[0,0],[100,0]]};
const height=(x,z)=>20-Math.max(0,z-4)*.8;
const terrain={cartRoads:false,seaLevel:0,low:false,heightAt:height,surfaceAt:(x,z)=>({ground:height(x,z),level:8,canopy:0})};
const roads={roads:[road],nearest:()=>null};roads.guardrails=new Guardrails(roads,terrain);
const animals=Object.create(Animals.prototype);animals.roads=roads;animals.terrain=terrain;animals.group=new Group();animals.openField=()=>true;
const resident={kind:'cow',spot:{road,x:50,z:0,heading:Math.PI/2},along:50,home:{x:50,z:4.2},place:{x:50,z:4.2},herd:[],side:1};
assert.ok(animals.buildPasture(resident),'real placement hook builds pasture');
let body=cowBody(resident.home.x,resident.home.z,resident.homeHeading,height);
assert.ok(body);assert.ok(roads.guardrails.cowClearance(body)>=.2-1e-6,'production cow home leaves the whole body clear of rails');
assert.ok(resident.home.z<4.2&&4.2-resident.home.z<4,'move a few metres to the road side');assert.equal(resident.herd.length,4,'herd unchanged');
const old=cowBody(50,4.2,Math.PI/2,height);assert.ok(roads.guardrails.cowClearance(old)<0,'fixture detects original overlap');
// A local obstruction must search along the same road, nearest quarter metre first.
const rest=cowRest(road,50,1,()=>20,b=>Math.abs(b.x-50)>=3.25);assert.ok(rest);assert.equal(rest.along,53.25,'nearest along-road fallback');
assert.equal(cowRest(road,50,1,()=>null,()=>true),null,'unknown land defers placement');
// Enclose the real cow through the permitted ground tilt, head tracking and hoof adjustment range.
const rig=createRoadCow();assert.equal(rig.shoulder,COW_REST.shoulder,'support probes match actual cow rig');const legY=rig.legs.map(l=>l.position.y);
for(const pitch of [-.55,0,.55])for(const roll of [-.55,0,.55])for(const leg of [-.4,0,.4])for(let yaw=-1.2;yaw<=1.201;yaw+=.15){
 rig.root.rotation.set(pitch,0,roll,'YXZ');rig.head.rotation.y=yaw;rig.legs.forEach((l,i)=>l.position.y=legY[i]+leg);rig.root.updateMatrixWorld(true);
 const b=new Box3().setFromObject(rig.root,true),vertical=COW_REST.height*Math.cos(roll)+COW_REST.width*Math.abs(Math.sin(roll));
 const w=COW_REST.width*Math.cos(roll)+COW_REST.height*Math.abs(Math.sin(roll))+COW_REST.padding,l=COW_REST.length*Math.cos(pitch)+vertical*Math.abs(Math.sin(pitch))+COW_REST.padding;
 assert.ok(Math.max(Math.abs(b.min.x),Math.abs(b.max.x))<=w,'envelope contains tilted/tracking whole cow width');assert.ok(Math.max(Math.abs(b.min.z),Math.abs(b.max.z))<=l,'envelope contains whole cow length');
}
console.log('PASS production home, old-home control, nearest fallback and real cow envelope');
const report=[];
for(const area of AREAS){
 const land=railLand(area.base),spans=[];
 for(const r of land.roads.roads)for(let start=0;start<roadLength(r);start+=RAIL.chunk)spans.push(...planRails(r,land.ground,land.access,start,Math.min(start+RAIL.chunk,roadLength(r)),land.context));
 const g=land.roads.guardrails;let minimum=Infinity,placed=0;
 const ground=(x,z)=>{const h=land.ground(x,z);return h!==null&&h>.5?h*1.5:null;};
 // Every rail span is a possible old home, including chunk seams, curves and area edges.
 for(const s of spans){
  const along=(s.a.along+s.b.along)/2,home=g.cowRest(s.road,along,s.side,ground);assert.ok(home,`${area.id}: a road-side home exists at ${s.road.id}/${along}`);
  let gap=Infinity;
  for(const t of spans){if(Math.abs(t.a.x-home.x)>10&&Math.abs(t.b.x-home.x)>10)continue;gap=Math.min(gap,cowRailGap(home,t.a,t.b));}
  assert.ok(gap>=.2-1e-6,`${area.id}: body intersects span at ${s.road.id}/${along}, gap ${gap}`);minimum=Math.min(minimum,gap);placed++;
 }
 report.push({area:area.id,sites:placed,minimumBodyToRail:minimum});console.log('PASS cow clearance',JSON.stringify(report.at(-1)));
}
const out=process.env.COW_RAIL_REPORT??'data/work/threads/guardrails-r2/cow-clearance.json';mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2));
if(process.argv.includes('--mutations')){const r=spawnSync(process.execPath,['tools/guardrail-fix-mutations.mjs','--r2'],{stdio:'inherit'});assert.equal(r.status,0);}
