import assert from 'node:assert/strict';
import {resolve,relative} from 'node:path';
import {requireDensityResolution} from './era-density-resolution.mjs';
import {makeGround,preload} from './phone-ground.mjs';
import {siteCorners} from '../web/src/eras/history-sites.ts';
import {periodProfile} from '../web/src/eras/history-art.ts';
import {MABOU_1884_TRADES} from '../web/src/eras/mabou-1884-trades.ts';
import {playableFootprint} from './era-density-placement.ts';
import {Roads} from '../web/src/roads.ts';
import {planHistoryBoards} from '../web/src/eras/history-board-sites.ts';
import {qHeight,qMetres,qAngle,metricDistance,codeUnitCompare} from '../web/src/eras/history-precision.ts';
export const PR70_WATER_IDS=["F14-CMB-112","F14-CMB-152","F14-CMB-155","F16-PHM-042","F16-PHM-057","F16-PHM-127","F16-PHM-132"];
export const TRADE_POLICY={surface:'production Terrain.heightAt, exag=1; 0.5 m footprint grid including edges',maxRawSpacingM:4,foundationEaveFraction:.65,maxWaterFoundationShownM:6,minimumRiseImprovementM:.25,maxLabelDistanceM:250,side:'same side of the original nearest road; no road or stream centreline crossed',water:'all seven PR70 water trades retain method=water and a real bank attachment; otherwise keep the original bank and cap the visible foundation'};
const pose=s=>({...s,x:qMetres(s.x),z:qMetres(s.z),yaw:qAngle(s.yaw),...(s.water?{water:{...s.water,x:qMetres(s.water.x),z:qMetres(s.water.z),yaw:qAngle(s.water.yaw)}}:{})});
const cross=(ax,az,bx,bz)=>qHeight(ax*bz-az*bx);
const intersects=(a,b,c,d)=>{const x=cross(b[0]-a[0],b[1]-a[1],c[0]-a[0],c[1]-a[1]),y=cross(b[0]-a[0],b[1]-a[1],d[0]-a[0],d[1]-a[1]),u=cross(d[0]-c[0],d[1]-c[1],a[0]-c[0],a[1]-c[1]),v=cross(d[0]-c[0],d[1]-c[1],b[0]-c[0],b[1]-c[1]);return Math.max(a[0],b[0])>=Math.min(c[0],d[0])&&Math.max(c[0],d[0])>=Math.min(a[0],b[0])&&Math.max(a[1],b[1])>=Math.min(c[1],d[1])&&Math.max(c[1],d[1])>=Math.min(a[1],b[1])&&x*y<=0&&u*v<=0;};
export function tradeSideRules(old,s,network,streams,origin){
 if(metricDistance(s.x-old.x,s.z-old.z)<.002)return [];
 const failures=[],road=network.nearest(old.x,old.z,250,r=>r.kind<=4);
 if(road){const next=network.nearest(s.x,s.z,1000,r=>r.id===road.road.id),sign=h=>{const a=h.road.pts[h.seg],b=h.road.pts[h.seg+1];return cross(b[0]-a[0],b[1]-a[1],h===road?old.x-h.x:s.x-h.x,h===road?old.z-h.z:s.z-h.z);};if(!next||sign(road)*sign(next)<=0)failures.push('opposite road side');}
 const a=[old.x,old.z],b=[s.x,s.z];
 if(network.roads.some(r=>r.kind<=4&&r.pts.slice(1).some((p,i)=>intersects(a,b,r.pts[i],p))))failures.push('road crossing');
 if(streams.streams.some(r=>r.pts.slice(1).some((p,i)=>intersects(a,b,[r.pts[i][0]-origin[0],origin[1]-r.pts[i][1]],[p[0]-origin[0],origin[1]-p[1]]))))failures.push('brook/river crossing');
 return failures;
}
/** One production sampled surface and one pass mark for both retained sites and candidates. */
/** Mabou's settings. Another area passes its own printed labels, density square and baked folder. */
export const MABOU_TRADE_AREA={labels:MABOU_1884_TRADES,spec:undefined,ground:undefined,waterIds:PR70_WATER_IDS};
export function tradeRules(base,siting,land,inputs,area=MABOU_TRADE_AREA){
 const labels=area.labels;
 const savedExag=process.env.PHONE_EXAG;process.env.PHONE_EXAG='1';const {terrain}=area.ground?makeGround(area.ground):makeGround();if(savedExag===undefined)delete process.env.PHONE_EXAG;else process.env.PHONE_EXAG=savedExag;terrain.cartRoads=true;
 const oldFetch=globalThis.fetch;globalThis.fetch=async path=>new Response(inputs.read(relative(resolve(base),resolve(String(path)))));
 const origin=terrain.manifest.village,raw=JSON.parse(inputs.read('roads.json')),streams=JSON.parse(inputs.read('streams.json')),network=new Roads(raw,origin,{cartRoads:true}),cache=new Map();
 const clear=()=>{for(const t of terrain.tiles.values())if(t.mesh){terrain.group.remove(t.mesh);t.mesh.geometry.dispose();t.mesh.material.dispose();}terrain.tiles.clear();};
 async function rise(s){
  const key=[s.id,s.x,s.z,s.yaw,s.width,s.length].join('|');if(cache.has(key))return cache.get(key);
  const c=Math.cos(s.yaw),a=Math.sin(s.yaw),points=[];for(let u=0;u<=Math.ceil(s.width/.5);u++)for(let v=0;v<=Math.ceil(s.length/.5);v++){const x=-s.width/2+u*s.width/Math.ceil(s.width/.5),z=-s.length/2+v*s.length/Math.ceil(s.length/.5);points.push([qMetres(s.x+x*c+z*a),qMetres(s.z-x*a+z*c)]);}
  const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs);await preload(terrain,[[x0,z0],[x0,z1],[x1,z0],[x1,z1],[s.x,s.z]],0);let low=Infinity,high=-Infinity;
  for(const[x,z]of points){const tile=terrain.find(x,z);assert(tile&&terrain.manifest.size/2**tile.level/256<=4,s.id+' missing fine tile for trade footprint');const h=qHeight(terrain.heightAt(x,z));low=Math.min(low,h);high=Math.max(high,h);}
  const value=qHeight(high-low);cache.set(key,value);return value;
 }
 function hard(s,old,occupied=[]){
  const failures=[];if(!playableFootprint(s,origin,5,area.spec))failures.push('playable wall');
  if(!siting.safe(s,occupied))failures.push('road/water/approach/building footprint');
  const label=labels.find(t=>t.id===s.id);if(metricDistance(s.x-old.x,s.z-old.z)>.002&&metricDistance(s.x-(label.e-origin[0]),s.z-(origin[1]-label.n))>250)failures.push('more than 250 m from source label');
  if(old.method==='water'){
   if(s.method!=='water'||!s.water)failures.push('water trade lost its attachment');
   else{const hit=siting.stream.near(s.water.x,s.water.z,12);if(!hit||Math.abs(hit.dist-hit.half)>.35||metricDistance(s.x-s.water.x,s.z-s.water.z)>s.width/2+2)failures.push('water attachment is not on a real bank');}
  }
  failures.push(...tradeSideRules(old,s,network,streams,origin));return failures;
 }
 function boardClear(s,occupied){try{planHistoryBoards([s,...occupied.map(p=>({...p,word:''}))],network,land.cover);return true;}catch{return false;}}
 function candidates(old){
  const result=[],label=labels.find(t=>t.id===old.id),lx=label.e-origin[0],lz=origin[1]-label.n,water=old.method==='water',line=water?siting.stream:siting.road,anchor=line.near(water?old.water.x:old.x,water?old.water.z:old.z,300);
  if(anchor)for(let along=-240;along<=240;along+=6){const a=line.near(anchor.x+anchor.dx*along,anchor.z+anchor.dz*along,50)??anchor,nx=-a.dz,nz=a.dx,side=(old.x-a.x)*nx+(old.z-a.z)*nz>=0?1:-1;
   for(const extra of water?[0,1,2]:[0,4,8,16,24,40]){const setback=water?a.half+old.width/2+.95+extra:a.half+Math.hypot(old.width,old.length)/2+7+extra;
    const x=a.x+nx*side*setback,z=a.z+nz*side*setback,yaw=water?Math.atan2(a.dx,a.dz):Math.atan2(-nx*side,-nz*side);
    result.push(pose({...old,x,z,yaw,method:water?'water':'road',...(water?{water:{x:a.x+nx*side*(a.half+.1),z:a.z+nz*side*(a.half+.1),half:a.half,yaw}}:{})}));
   }
  }
  if(!water)for(let r=12;r<=240;r+=12)for(let a=0;a<16;a++)result.push(pose({...old,x:lx+Math.cos(a*Math.PI/8)*r,z:lz+Math.sin(a*Math.PI/8)*r}));
  return [...new Map(result.map(s=>[[s.x,s.z,s.yaw].join('|'),s])).values()];
 }
 const supported=s=>{try{for(const[x,z]of [...siteCorners(s),[s.x,s.z]])requireDensityResolution(terrain.manifest,x,z,s.id);return true;}catch{return false;}};
 return {origin,network,streams,rise,hard,boardClear,candidates,supported,clear,close(){clear();globalThis.fetch=oldFetch;}};
}
export async function pinnedTradeSites(base,legacy,siting,land,inputs,area=MABOU_TRADE_AREA){
 const labels=area.labels,rules=tradeRules(base,siting,land,inputs,area),original=legacy.map(pose),trades=[...original],relocations=[],retainedExceptions=[],audit=[];
 try{
  for(let i=0;i<original.length;i++){
   const old=original[i],others=trades.filter((_,j)=>j!==i),oldRise=await rules.rise(old),limit=qHeight(periodProfile(old).eave*TRADE_POLICY.foundationEaveFraction),oldHard=rules.hard(old,old,others);let chosen=old,newRise=oldRise;
   if(oldHard.length||oldRise>limit){
    const acceptable=[];
    for(const s of rules.candidates(old)){if(rules.hard(s,old,others).length||!rules.supported(s))continue;const r=await rules.rise(s);if(r<=limit&&qHeight(oldRise-r)>=TRADE_POLICY.minimumRiseImprovementM&&rules.boardClear(s,others))acceptable.push({s,r});}
    acceptable.sort((a,b)=>a.r-b.r||metricDistance(a.s.x-old.x,a.s.z-old.z)-metricDistance(b.s.x-old.x,b.s.z-old.z)||codeUnitCompare([a.s.x,a.s.z,a.s.yaw].join('|'),[b.s.x,b.s.z,b.s.yaw].join('|')));
    if(acceptable.length){chosen=acceptable[0].s;newRise=acceptable[0].r;}
    else{assert.equal(oldHard.length,0,old.id+' no acceptable replacement; original fails hard rules: '+oldHard.join('; '));retainedExceptions.push({id:old.id,oldRiseM:oldRise,limitM:limit,reason:'No same-side, same-bank replacement within 250 m of the label meets the single foundation rule and improves rise by at least 0.25 m; original retained, displayed foundation capped.'});}
   }
   if(old.method==='water')assert(chosen.method==='water'&&chosen.water,old.id+' generation would lose water; no fallback permitted');
   chosen={...chosen,moved:metricDistance(chosen.x-(labels[i].e-rules.origin[0]),chosen.z-(rules.origin[1]-labels[i].n))};trades[i]=chosen;
   const distanceM=metricDistance(chosen.x-old.x,chosen.z-old.z),yawDegrees=qAngle(Math.abs(Math.atan2(Math.sin(chosen.yaw-old.yaw),Math.cos(chosen.yaw-old.yaw)))*180/Math.PI),moved=distanceM>.002||yawDegrees>.00001;
   if(moved)relocations.push({id:old.id,distanceM,yawDegrees,oldRiseM:oldRise,newRiseM:newRise,limitM:limit,reasons:[...oldHard,...(oldRise>limit?['fine foundation rise exceeds 65% of eave height']:[])]});
   console.log('TRADE-RISE',old.id,oldRise.toFixed(4),newRise.toFixed(4),'move',distanceM,'water',!!chosen.water);
   audit.push({id:old.id,status:moved?'moved':'kept',distanceM,yawDegrees,oldRiseM:oldRise,newRiseM:newRise,limitM:limit,waterKept:old.method==='water'?!!chosen.water&&chosen.method==='water':null,reason:relocations.find(r=>r.id===old.id)?.reasons.join('; ')??retainedExceptions.find(r=>r.id===old.id)?.reason??area.keptReason??'PR 70 site retained'});rules.clear();
  }
  assertWaterTrades(original,trades,area.waterIds);assert.equal(audit.filter(r=>r.waterKept!==null).length,area.waterIds.length);assert(audit.every(r=>r.waterKept!==false));
  return {trades,relocations,retainedExceptions,tradeAudit:audit};
 }finally{rules.close();}
}
const round=(x,d=3)=>Number(x.toFixed(d));
export const storedTradePose=(s,o)=>({id:s.id,e:round(s.x+o[0]),n:round(o[1]-s.z),yaw:round(s.yaw,8),kind:s.kind,width:s.width,length:s.length,barn:s.barn??null,method:s.method,...(s.water?{water:{e:round(s.water.x+o[0]),n:round(o[1]-s.water.z),half:s.water.half,yaw:round(s.water.yaw,8)}}:{})});
export function assertTradePoses(expected,committed,origin){assert.equal(committed.length,48);for(const s of expected){const row=committed.find(r=>r.id===s.id);assert(row,'missing committed trade '+s.id);const keys=Object.keys(storedTradePose(s,origin)),actual=Object.fromEntries(keys.map(k=>[k,row[k]]));assert.deepEqual(actual,storedTradePose(s,origin),s.id+' committed pose must equal regenerated pose');assert.equal(!!row.water,!!s.water,s.id+' exact water attachment');}}
export function compareTradeRows(legacy,data,origin,expected){
 assert(expected,'regenerated poses are required for the trade pin');assertTradePoses(expected.trades,data.trades,origin);assert.deepEqual(data.header.tradeRelocations,expected.relocations);assert.deepEqual(data.header.tradeRetainedExceptions,expected.retainedExceptions);return expected.tradeAudit;
}
/** Re-sample and validate the committed poses themselves; metadata cannot stand in for a site. */
export async function validateCommittedTrades(base,legacy,data,expected,siting,land,inputs){
 assertTradePoses(expected.trades,data.trades,land.manifest.village);const rules=tradeRules(base,siting,land,inputs),o=rules.origin;
 const sites=data.trades.map(r=>({...r,x:r.e-o[0],z:o[1]-r.n,...(r.water?{water:{x:r.water.e-o[0],z:o[1]-r.water.n,half:r.water.half,yaw:r.water.yaw}}:{})}));
 try{for(const s of sites){const old=pose(legacy.find(r=>r.id===s.id)),moved=metricDistance(s.x-old.x,s.z-old.z)>.002||Math.abs(s.yaw-old.yaw)>1e-7,failures=rules.hard(s,old,sites.filter(r=>r!==s));assert.equal(failures.length,0,s.id+' committed placement: '+failures.join('; '));const oldRise=await rules.rise(old),newRise=await rules.rise(s),limit=qHeight(periodProfile(s).eave*.65),audit=expected.tradeAudit.find(r=>r.id===s.id);assert.equal(newRise,audit.newRiseM,s.id+' committed sampled rise');if(moved){assert(newRise<=limit,s.id+' single foundation pass mark');assert(qHeight(oldRise-newRise)>=TRADE_POLICY.minimumRiseImprovementM,s.id+' minimum rise improvement');}else if(newRise>limit)assert(data.header.tradeRetainedExceptions.some(r=>r.id===s.id),s.id+' tall retained foundation must be listed');rules.clear();}
  const boards=planHistoryBoards(sites,rules.network,land.cover);assert.deepEqual(boards.map(b=>({id:b.id,e:round(o[0]+b.x),n:round(o[1]-b.z),yaw:round(b.yaw,8),width:b.width,height:b.height,roadE:round(o[0]+b.roadX),roadN:round(o[1]-b.roadZ)})),data.boards,'committed boards must be the clear regenerated plans');
 }finally{rules.close();}
}

export function assertWaterTrades(legacy,trades,waterIds=PR70_WATER_IDS){const water=legacy.filter(s=>s.method==='water');assert.deepEqual(water.map(s=>s.id).sort(codeUnitCompare),[...waterIds].sort(codeUnitCompare),waterIds===PR70_WATER_IDS?'the seven PR70 water identities must be preserved':'the reference water identities must be preserved');for(const old of water){const s=trades.find(s=>s.id===old.id);assert(s?.method==='water'&&s.water,old.id+' generation would lose water; no fallback permitted');}}
