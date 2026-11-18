import type { Place } from './places';
import type { Building } from './buildings';
import type { Terrain } from './terrain';
import type { YardSite } from './yard-site';
import { StuntPark,type StuntPlacement,type StuntRunup } from './stunt-kit';
import {type DressingPlacement,startArch,lineFurniture,lineMarker,laneArrow,timingHut,pitArea,floodMast,edgeStacks} from './stunt-dressing';
import { archTunnel,footbridge,gapPair,slipKicker,stepDown,tableTop,tankRow,whoops } from './stunt-pieces';

// Hard-frame height follows ordinary loaded-rig clearance tests; terrain and feet stay fixed.
export const HARD_ARCH_RISE=8.05;

/** Fourteen test pieces on the Mabou field. Banked turns are excluded. */
export function testParkLayout(yard:YardSite):StuntPlacement[]{
  const put=(piece:StuntPlacement['piece'],u:number,v:number,du=0,dv=1):StuntPlacement=>({...yard.world(u,v),piece,heading:yard.heading(du,dv)});
  return[
    // The easy line follows the open field east of the works yard, clear of its jump and all its stock.
    put(slipKicker('small'),650,40),put(tableTop(),650,80),put(archTunnel(),650,160),put(whoops(),650,210),
    // An independent hard line, so a landing cannot enter the easy run-up.
    put(gapPair(8,true),615,330,0,-1),put(tankRow(),615,304),put(stepDown(1.6),615,256,0,-1),
    put(slipKicker('medium'),600,210,0,-1),put(slipKicker('large'),640,236,0,-1),put(gapPair(4),565,380,1,0),
    put(footbridge(),550,290,0,-1),put(stepDown(.8),565,220),put(stepDown(2.4),580,300,0,-1),put(whoops(true),575,190),
  ];
}
const STARTS=[{lead:15,lateral:0},{lead:35,lateral:-2}] as const;
/** Shared player and fixture starts: keep the complete coupled rig on the natural run-up. */
export function testParkStarts(park:StuntPark){
 return park.dressing.filter(d=>d.placement.piece.id==='start-arch').map((arch,index)=>{
  const {lead,lateral}=STARTS[index];
  return{id:index===0?'stunt-easy':'stunt-hard',name:index===0?'Test park: easy start':'Test park: hard start',
   ...arch.world(-lead,lateral),heading:arch.placement.heading+Math.atan2(-lateral,lead),lead,lateral};
 });
}
/** Eleven metres covers the 2.55 m rig plus 2 m each side, including its offset start.
 *  The extra canopy margin covers the largest crown and the 2 m clearing-cell boundary. */
export function testParkRunups(dressing:readonly DressingPlacement[]):StuntRunup[]{
 return dressing.filter(p=>p.piece.id==='start-arch').map((p,index)=>{const {lead,lateral}=STARTS[index];return{x:p.x,z:p.z,heading:p.heading+Math.atan2(-lateral,lead),
  from:-Math.hypot(lead,lateral)-30,to:30,halfWidth:5.5,canopyMargin:16};});
}
export function testParkPlaces(park:StuntPark,origin:readonly[number,number]):Place[]{
 return testParkStarts(park).map(s=>{const e=origin[0]+s.x,n=origin[1]-s.z;return{
  id:s.id,name:s.name,area:'mabou',kind:'site',e,n,radius:20,sources:['src/stunt-test-park.ts'],
  note:s.id==='stunt-easy'?'An invented practice course. Start at rest on the easy run-up.':'An invented practice course. Start at rest on the hard run-up.',
  start:{e,n,heading:s.heading}};});
}
/** Decorative pieces are separate from the frozen graded and driving footprints. */
export function testParkDressing(yard:YardSite):DressingPlacement[]{
 const put=(piece:DressingPlacement['piece'],u:number,v:number,du=0,dv=1):DressingPlacement=>({...yard.world(u,v),piece,heading:yard.heading(du,dv)}),out:DressingPlacement[]=[];
 out.push(put(startArch(),650,25),put(startArch('TEST PARK',HARD_ARCH_RISE),615,350,0,-1),put(timingHut(),662,24),put(pitArea(),645.8,35));
 for(const start of [42,82,122,162,202])out.push(put(lineFurniture(34,7,true),650,start));
 out.push(put(lineFurniture(58,8,false),615,332,0,-1),put(lineFurniture(45,8,false),615,258,0,-1));
 for(const [u,v,easy]of [[657,26,true],[623,344,false],[657,118,true],[623,270,false]] as const)out.push(put(lineMarker(easy),u,v));
 for(const [u,v,easy]of [[650,30,true],[650,113,true],[650,195,true],[615,340,false],[615,268,false]] as const)out.push(put(laneArrow(easy),u,v,0,easy?1:-1));
 for(const [u,v]of [[642,25],[624,345],[624,280]])out.push(put(floodMast(),u,v));
 out.push(put(edgeStacks(8),619,232,0,-1),put(edgeStacks(9,true),607,308,0,-1));
 return out;
}
/** This check precedes definitions, Site registration, materials and model construction. */
export async function createTestPark(params:URLSearchParams,terrain:Terrain,yard:YardSite|null,low:boolean,buildings:readonly Building[]=[]):Promise<StuntPark|null> {
  if(params.get('park')!=='test'||!yard||yard.mode==='closed')return null;
  const exclusions=buildings.map(b=>({x:b.x-terrain.manifest.village[0],z:terrain.manifest.village[1]-b.y,radius:60+Math.hypot(b.length,b.width)/2}));
  const dressing=testParkDressing(yard);
  const park=new StuntPark(terrain,testParkLayout(yard),low,exclusions,dressing,testParkRunups(dressing));
  await park.prepare();
  return park;
}
