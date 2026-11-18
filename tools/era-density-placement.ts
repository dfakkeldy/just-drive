import {qMetres,qHeight,qAngle,codeUnitCompare,metricDistance} from '../web/src/eras/history-precision';
import {footprintsOverlap,type Footprint} from '../web/src/eras/history-footprints';
import type { Building } from '../web/src/buildings';
import { farmBarn, siteCorners, siteHash, type PeriodSite, type Zone } from '../web/src/eras/history-sites';
import { MABOU_DENSITY, densityCellId, inSpecVillage, specCellAt, type DensitySpec } from '../web/src/eras/history-density';

interface RoadHit { x:number; z:number; dist:number }
interface Street {id:number;kind:number;pts:readonly (readonly number[])[]}
export interface DensityEnvironment {
  origin:readonly [number,number];
  safe:(site:PeriodSite, occupied:readonly PeriodSite[])=>boolean;
  ground:(x:number,z:number,id?:string)=>number|null;
  cover:(x:number,z:number)=>number;
  road:(x:number,z:number,reach:number)=>RoadHit|null;
  roads?:readonly Street[];
  drawn?:(x:number,z:number,id?:string)=>number|null;
  boards?:readonly Footprint[];
}
export interface DensityDeficit {cell:string;counted:number;built:number;reason:string}
export interface DensityAudit {
  cells:Record<string,{counted:number;built:number}>;
  deficits:DensityDeficit[];
  ruralBeyond60m:number;
  sources:Record<'modern'|'road'|'open'|'forest',number>;
}
/** Every half metre of the footprint, on the finest baked ground and the drawn triangle plane. */
export function gentleFarmGround(site:PeriodSite, ground:DensityEnvironment['ground']):boolean {
  let low=Infinity,high=-Infinity;
  for(let u=-Math.ceil(site.width/2+1);u<=site.width/2+1;u+=.5)for(let v=-Math.ceil(site.length/2+1);v<=site.length/2+1;v+=.5){
    const x=site.x+u*Math.cos(site.yaw)+v*Math.sin(site.yaw),z=site.z-u*Math.sin(site.yaw)+v*Math.cos(site.yaw),h=ground(qMetres(x),qMetres(z),site.id);
    if(h===null)return false;low=Math.min(low,qHeight(h));high=Math.max(high,qHeight(h));
    for(const [dx,dz] of [[1,0],[0,1],[Math.SQRT1_2,Math.SQRT1_2],[Math.SQRT1_2,-Math.SQRT1_2]]){
      const a=ground(qMetres(x-dx/2),qMetres(z-dz/2),site.id),b=ground(qMetres(x+dx/2),qMetres(z+dz/2),site.id);
      if(a===null||b===null||qHeight(Math.abs(qHeight(b)-qHeight(a)))>.2)return false;
    }
  }
  return qHeight(high-low)<=1.8;
}
export function playableFootprint(site:PeriodSite,origin:readonly [number,number],margin=5,spec:DensitySpec=MABOU_DENSITY):boolean {
  const o=spec.origin;
  return siteCorners(site,margin).every(([x,z])=>qMetres(x+origin[0])>=o[0]+120&&qMetres(x+origin[0])<=o[0]+spec.width-120&&qMetres(origin[1]-z)>=o[1]+120&&qMetres(origin[1]-z)<=o[1]+spec.height-120);
}

/** Counts drive every allocation. No map marks, labels or map-derived dwelling positions enter this rule. */
export function densityFarms(buildings:readonly Building[], trades:readonly PeriodSite[], env:DensityEnvironment, seed=1915, spec:DensitySpec=MABOU_DENSITY):
  {farms:PeriodSite[];audit:DensityAudit;counts:Record<Zone,{candidates:number;target:number;drawn:number}>} {
  const hash=(key:string)=>siteHash(`${seed}:${key}`);
  const farms:PeriodSite[]=[],occupied=[...trades];
  const audit:DensityAudit={cells:{},deficits:[],ruralBeyond60m:0,sources:{modern:0,road:0,open:0,forest:0}};
  const counts:Record<Zone,{candidates:number;target:number;drawn:number}>={village:{candidates:0,target:spec.villageResidences,drawn:0},roadside:{candidates:0,target:0,drawn:0},remote:{candidates:0,target:0,drawn:0}};
  const toMap=(x:number,z:number):[number,number]=>[qMetres(x+env.origin[0]),qMetres(env.origin[1]-z)];
  const inVillage=(e:number,n:number)=>inSpecVillage(spec,e,n),cellAt=(e:number,n:number)=>specCellAt(spec,e,n);
  const village=(s:PeriodSite)=>inVillage(...toMap(s.x,s.z));
  const cell=(s:PeriodSite)=>cellAt(...toMap(s.x,s.z));
  const bounds=(column:number,row:number):[number,number,number,number]=>[
    spec.origin[0]+column*spec.cell,spec.origin[1]+row*spec.cell,
    spec.origin[0]+Math.min(spec.width,(column+1)*spec.cell),spec.origin[1]+Math.min(spec.height,(row+1)*spec.cell)];
  const make=(id:string,x:number,z:number,yaw=0):PeriodSite=>{
    x=qMetres(x);z=qMetres(z);
    const road=env.road(x,z,120);
    return {id,kind:'farm',word:'',source:'',x,z,yaw:qAngle(road?Math.atan2(road.x-x,road.z-z):yaw),
      width:7,length:9,method:'farm',moved:0,zone:inVillage(...toMap(x,z))?'village':road?'roadside':'remote'};
  };
  // Invent a house within the modern farmyard, rather than copy its roof centre.
  // A small, universal seeded offset also keeps invented houses independent of old map dots.
  const modern=buildings.map(b=>{const id=`density-modern-${b.id}`,a=hash(id+'yard')*Math.PI*2,r=10+hash(id+'setback')*14;
    return make(id,b.x+Math.cos(a)*r,b.y+Math.sin(a)*r,b.axisDeg*Math.PI/180);})
    .sort((a,b)=>hash(a.id)-hash(b.id)||codeUnitCompare(a.id,b.id));
  // A seeded jittered lattice covers a cell, including places with no modern roof or surviving road.
  const sample=(key:string,box:readonly number[],resolution=16):PeriodSite[]=>{
    const result:PeriodSite[]=[];
    for(let n=0;n<resolution*resolution;n++){
      const id=`density-1884-${key}-${n}`,u=(n%resolution+.15+hash(id+'e')*.7)/resolution,
        v=(Math.floor(n/resolution)+.15+hash(id+'n')*.7)/resolution;
      result.push(make(id,box[0]+20+u*(box[2]-box[0]-40)-env.origin[0],env.origin[1]-box[1]-20-v*(box[3]-box[1]-40),hash(id+'yaw')*Math.PI*2));
    }
    return result.sort((a,b)=>hash(a.id+'order')-hash(b.id+'order'));
  };
  const pools=new Map<string,{site:PeriodSite;source:keyof DensityAudit['sources']}[]>();
  const street:PeriodSite[]=[];
  for(const road of env.roads??[])if(road.kind>=1&&road.kind<=3){
    let walked=0;
    for(let i=1;i<road.pts.length;i++){
      const a=road.pts[i-1],b=road.pts[i],dx=b[0]-a[0],dz=b[1]-a[1],length=metricDistance(dx,dz);if(!length)continue;
      for(let along=22-(walked%22);along<length;along+=22)for(const side of [-1,1]){
        const station=`village-street-${road.id}-${Math.round(walked+along)}-${side}`;
        for(const setback of [14,18,22]){
          const x=a[0]+dx*along/length-dz/length*side*setback,z=a[1]+dz*along/length+dx/length*side*setback;
          const s=make(station,x,z);if(!village(s))continue;
          for(const turn of [0,Math.PI/2])street.push({...s,id:station+'-'+setback+'-'+(turn?'eave':'gable'),yaw:qAngle(s.yaw+turn)});
        }
      }
      walked=qMetres(walked+length);
    }
  }
  // Favour the main-street junction, while the seed varies the street-frontage order.
  const streetRank=(s:PeriodSite)=>qMetres(metricDistance(s.x-spec.streetCentre[0],s.z-spec.streetCentre[1])+qMetres(hash(s.id+'frontage')*40));
  street.sort((a,b)=>streetRank(a)-streetRank(b)||codeUnitCompare(a.id,b.id));
  const pool=(key:string,box:readonly number[],isVillage:boolean,fine=false)=>{
    const cacheKey=key+(fine?'-fine':'');let saved=pools.get(cacheKey);if(saved)return saved;
    const belongs=(s:PeriodSite)=>isVillage?village(s):!village(s)&&cell(s)===key;
    const sampled=sample(cacheKey,box,fine?64:16).filter(belongs),open=(s:PeriodSite)=>env.cover(s.x,s.z)!==1;
    const road=sampled.filter(s=>open(s)&&env.road(s.x,s.z,120));
    saved=[...(isVillage?street.map(site=>({site,source:'road' as const})):[]),...modern.filter(s=>belongs(s)&&open(s)).map(site=>({site,source:'modern' as const})),
      ...road.map(site=>({site,source:'road' as const})),
      ...sampled.filter(open).map(site=>({site,source:'open' as const})),
      ...modern.filter(s=>belongs(s)&&!open(s)).map(site=>({site,source:'forest' as const})),
      ...sampled.filter(s=>!open(s)).map(site=>({site,source:'forest' as const}))];
    pools.set(cacheKey,saved);return saved;
  };
  const place=(key:string,box:readonly number[],number:number,isVillage=false,fine=false,allowBare=false):number=>{
    let built=0;
    const options=pool(key,box,isVillage,fine).map((p,rank)=>({...p,rank}));
    while(options.length){
      const {site:candidate,source}=options.shift()!;
      if(built===number)break;
      counts[candidate.zone!].candidates++;
      if(farms.some(p=>p.id===candidate.id||metricDistance(p.x-candidate.x,p.z-candidate.z)<(isVillage&&p.zone==='village'?18:60)))continue;
      const valid=(s:PeriodSite)=>playableFootprint(s,env.origin,5,spec)&&!(env.boards??[]).some(b=>footprintsOverlap(b,s,1))&&env.safe(s,occupied)&&gentleFarmGround(s,env.ground)&&(!env.drawn||gentleFarmGround(s,env.drawn))&&
        siteCorners(s,2).every(([x,z])=>isVillage?inVillage(...toMap(x,z)):!inVillage(...toMap(x,z))&&cellAt(...toMap(x,z))===key);
      if(!valid(candidate))continue;
      const wantsBarn=!isVillage&&!allowBare;
      let chosen:PeriodSite|undefined;
      if(wantsBarn)for(const side of [-1,1]){
        const s={...candidate,barn:{x:side*12,z:-14}},barn=farmBarn(s)!;
        if(valid(barn)){chosen=s;break;}
      }
      // Rural farms normally have a barn; do not place a half farm on an unsuitable pad.
      if(wantsBarn&&!chosen&&!isVillage)continue;
      chosen??=candidate;
      if(!isVillage)chosen.zone=env.road(chosen.x,chosen.z,400)?'roadside':'remote';
      farms.push(chosen);occupied.push(chosen);audit.sources[source]++;built++;
      counts[chosen.zone!].drawn++;
      if(isVillage){
        const joined=(s:PeriodSite)=>farms.some(p=>p.zone==='village'&&metricDistance(p.x-s.x,p.z-s.z)>=18&&metricDistance(p.x-s.x,p.z-s.z)<=30);
        options.sort((a,b)=>Number(joined(b.site))-Number(joined(a.site))||a.rank-b.rank);
      }
    }
    return built;
  };
  const vp=spec.village,box=[Math.min(...vp.map(p=>p[0])),Math.min(...vp.map(p=>p[1])),Math.max(...vp.map(p=>p[0])),Math.max(...vp.map(p=>p[1]))];
  if(spec.villageResidences&&place('village',box,spec.villageResidences,true)!==spec.villageResidences)throw Error('No buildable room for the 1884 village count');

  for(let row=0;row<spec.residences.length;row++)for(let column=0;column<spec.residences[row].length;column++){
    const key=densityCellId(column,row),target=spec.residences[row][column];let built=target?place(key,bounds(column,row),target):0;
    if(built<target)built+=place(key,bounds(column,row),target-built,false,true);
    if(built<target)built+=place(key,bounds(column,row),target-built,false,true,true);
    audit.cells[key]={counted:target,built};if(built<target)audit.deficits.push({cell:key,counted:target,built,reason:'no buildable fine-ground footprint inside playable bounds and clear of approaches'});
  }
  audit.ruralBeyond60m=farms.filter(s=>s.zone!=='village'&&!env.road(s.x,s.z,60)).length;
  counts.roadside.target=counts.roadside.drawn;counts.remote.target=counts.remote.drawn;
  return {farms,audit,counts};
}
