import {densityInputs} from './era-density-inputs.mjs';
import {pr70Sites,PR70_REF} from './era-density-pr70.mjs';
import {pinnedTradeSites,TRADE_POLICY,MABOU_TRADE_AREA} from './era-density-trades.mjs';
import {DENSITY_SPECS} from '../web/src/eras/history-density.ts';
import {JUDIQUE_1884_TRADES} from '../web/src/eras/judique-1884-trades.ts';
import {homePlaces} from '../web/src/places.ts';
import {densityCoverage} from './era-density-resolution.mjs';
import {planHistoryBoards,boardFootprint} from '../web/src/eras/history-board-sites.ts';
import {Roads} from '../web/src/roads.ts';
import {HistorySiting} from '../web/src/eras/history-sites.ts';
import {densityFarms} from './era-density-placement.ts';
import {densityGround} from './era-density-ground.mjs';
import {HistoryBridgeApproaches} from '../web/src/eras/history-approaches.ts';
import {eraRoadHalf} from '../web/src/era.ts';
import {buildingSites} from '../web/src/buildings.ts';
export const DENSITY_GENERATION_SEED=1915;
/** Per-area generation settings. Mabou's are frozen: its output must stay byte-identical. */
export const DENSITY_AREAS={
 mabou:{id:'mabou',base:'data/baked/terrain',layout:'web/src/eras/mabou-1884-layout.ts',audit:'tools/era-density-layout.json',constant:'MABOU_1884_LAYOUT_JSON',labels:MABOU_TRADE_AREA.labels,
  header:{positionErrorM:[200,400],uncertainExcluded:6}},
 judique:{id:'judique',base:'data/baked/areas/judique',layout:'web/src/eras/judique-1884-layout.ts',audit:'tools/era-density-judique-layout.json',constant:'JUDIQUE_1884_LAYOUT_JSON',labels:JUDIQUE_1884_TRADES,
  // the Red Roof by the Brook house (places.ts homePlaces): no invented 1884 building within 200 m of it.
  keepClear:homePlaces().map(p=>({e:p.e,n:p.n,half:200})),
  header:{positionErrorM:[200,400],uncertainExcluded:6}},
};
export async function generateDensity(base,seed=DENSITY_GENERATION_SEED,areaId='mabou'){
 const area=DENSITY_AREAS[areaId],spec=DENSITY_SPECS[areaId];if(!area||!spec)throw Error('No 1884 generation settings for '+areaId);
 if(areaId!=='mabou'&&!spec.residences.flat().some(n=>n>0))throw Error(areaId+': residence counts are missing');
 if(process.version!=='v26.13.1')throw Error('Density regeneration supports Node 26.13.1; received '+process.version);
 const inputs=densityInputs(base),land=densityGround(base,inputs),{manifest}=land,origin=manifest.village;
 const raw=JSON.parse(inputs.read('roads.json')),roadList=raw.roads.filter(r=>r.kind!==5).map(r=>({...r,halfWidth:eraRoadHalf(r.kind,r.halfWidth),pts:r.pts.map(([e,n])=>[e-origin[0],origin[1]-n])}));
 const roadNetwork={roads:roadList},approaches=new HistoryBridgeApproaches(roadNetwork,{seaLevel:-.2,exag:1.5},land.approachHeight);
 const dry=(x,z)=>{const c=land.cover(x,z);return c!==0&&c!==4;};
 const keepClear=(area.keepClear??[]).map(k=>({box:[k.e-origin[0]-k.half,origin[1]-k.n-k.half,k.e-origin[0]+k.half,origin[1]-k.n+k.half]}));
 const siting=new HistorySiting(roadList,JSON.parse(inputs.read('streams.json')),origin,dry,land.drawn,land.cover,keepClear.length?[...approaches.sites,...keepClear]:approaches.sites);
 // Mabou keeps its frozen PR 70 reference. Another area starts from today's siting rule on its own printed labels.
 const reference=areaId==='mabou'?await pr70Sites(base):{sites:siting.trades(origin,[],area.labels)};for(const[file,entry]of Object.entries(reference.reads??{}))inputs.confirm(file,entry);
 const tradeArea=areaId==='mabou'?MABOU_TRADE_AREA:{labels:area.labels,spec,ground:base,waterIds:reference.sites.filter(s=>s.method==='water').map(s=>s.id),keptReason:'label site retained (today\'s siting rule)'};
 const {trades,relocations,retainedExceptions,tradeAudit}=await pinnedTradeSites(base,reference.sites,siting,land,inputs,tradeArea);
 const network=new Roads(raw,origin,{cartRoads:true}),boards=planHistoryBoards(trades,network,land.cover);
 const buildings=buildingSites(JSON.parse(inputs.read('buildings.json')).buildings).map(b=>({...b,x:b.x-origin[0],y:origin[1]-b.y}));
 const result=densityFarms(buildings,trades,{origin,safe:(s,o)=>siting.safe(s,o),ground:land.height,drawn:land.drawn,cover:land.cover,roads:roadList,boards:boards.map(boardFootprint),road:(x,z,r)=>siting.road.near(x,z,r)},seed,spec);
 const q=(n,d=3)=>Number(n.toFixed(d));
 const row=s=>({id:s.id,cell:s.zone==='village'?'village':s.kind==='farm'?Object.keys(result.audit.cells).find(key=>{const [e,n]=[origin[0]+s.x,origin[1]-s.z],col=Math.floor((e-spec.origin[0])/spec.cell),north=Math.floor((n-spec.origin[1])/spec.cell);return key===`E${String(col).padStart(2,'0')}-N${String(north).padStart(2,'0')}`;}):'trade',e:q(origin[0]+s.x),n:q(origin[1]-s.z),yaw:q(s.yaw,8),kind:s.kind,width:s.width,length:s.length,barn:s.barn??null,...(s.kind!=='farm'?{word:s.word,source:s.source,method:s.method,moved:q(s.moved),...(s.water?{water:{e:q(origin[0]+s.water.x),n:q(origin[1]-s.water.z),half:s.water.half,yaw:q(s.water.yaw,8)}}:{})}:{zone:s.zone})});
 return {version:1,seed,header:{source:'A.F. Church and Co., topographical township map of Inverness County, Nova Scotia (1884). Scan: David Rumsey Map Collection, David Rumsey Map Center, Stanford Libraries.',privacy:'All dwelling positions below are invention. No household names, individual historical mark positions, scan pixels or local paths are retained.',positionErrorM:area.header.positionErrorM,uncertainExcluded:area.header.uncertainExcluded,playableInsetM:120,footprintMarginM:5,ground:'Raw spacing <=4 m on every tested footprint; finest baked ground and drawn triangles, checked at 0.5 m intervals.',nodeVersion:'26.13.1',quantisation:{positionM:.001,heightM:.0001,angleRad:1e-8,ordering:'code-unit'},coverage:densityCoverage(manifest),fingerprints:inputs.finish(),...(areaId==='mabou'?{pr70:{ref:PR70_REF,checked:48,positionToleranceM:.5,yawToleranceDegrees:1}}:{area:areaId,places:'Geological Survey of Canada, Cape Breton sheet 19 (1884); reviewed transcription ns-marks-the-spot 8223b8a; sheet-19 fit, 44 controls',reference:'today\'s HistorySiting rule on the printed labels',keepClearM:200}),tradePolicy:TRADE_POLICY,tradeRelocations:relocations,tradeRetainedExceptions:retainedExceptions,tradeAudit,deficits:result.audit.deficits,ruralBeyond60m:result.audit.ruralBeyond60m},counts:result.counts,audit:result.audit,farms:result.farms.map(row),trades:trades.map(row),boards:boards.map(b=>({id:b.id,e:q(origin[0]+b.x),n:q(origin[1]-b.z),yaw:q(b.yaw,8),width:b.width,height:b.height,roadE:q(origin[0]+b.roadX),roadN:q(origin[1]-b.roadZ)}))};
}
export function runtimeDensity(data){
 const site=r=>{const {cell,...runtime}=r;return runtime;};
 return {version:1,farms:data.farms.map(site),trades:data.trades.map(site),boards:data.boards};
}
export const densityAuditSource=data=>JSON.stringify(data,null,2)+'\n';
export function densitySource(data,areaId='mabou'){const area=DENSITY_AREAS[areaId];return areaId==='mabou'?`/** GENERATED by tools/check-era-density.sh --write. Invented house positions, never map marks.
 * A.F. Church and Co. (1884); David Rumsey Map Collection, David Rumsey Map Center, Stanford Libraries.
 * Counts only; no names; house positions in the game are invented. Source error 200–400 m.
 * Runtime fields only. Input fingerprints and audit: tools/era-density-layout.json. Node 26.13.1.
 * One string, decoded and validated only inside the 1884 constructor path.
 */
export const MABOU_1884_LAYOUT_JSON = ${JSON.stringify(JSON.stringify(runtimeDensity(data)))};
`:`/** GENERATED by DENSITY_AREA=${areaId} tools/check-era-density.sh --write. Invented house positions, never map marks.
 * Places: Geological Survey of Canada, Cape Breton sheet 19 (1884). Counts: A.F. Church and Co. (1884).
 * Scans: David Rumsey Map Collection, David Rumsey Map Center, Stanford Libraries (CC BY-NC-SA 3.0); no pixels here.
 * Counts only; no names; house and building positions in the game are invented.
 * Runtime fields only. Input fingerprints and audit: ${area.audit}. Node 26.13.1.
 * One string, decoded and validated only inside the 1884 constructor path.
 */
export const ${area.constant} = ${JSON.stringify(JSON.stringify(runtimeDensity(data)))};
`;}
