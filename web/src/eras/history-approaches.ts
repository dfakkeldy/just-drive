import {TimberApron} from './timber-apron';
import type * as THREE from 'three';
import type{Terrain,Site}from'../terrain';import type{Road,Roads}from'../roads';import{timberPlan}from'./timber-bridge';
type ApproachRoads=Pick<Roads,'roads'>&Partial<Pick<Roads,'group'|'trimTimberApproaches'>>;
interface Span{start:number;end:number;length:number;x:number;z:number;startApron?:TimberApron;endApron?:TimberApron;planes:{id:number;y0:number;y1:number;level:number}[]}
/** Fictional cart-road cuts at bridge banks. Only the era applies them to private decoded height tiles. */
export class HistoryBridgeApproaches{
 readonly sites:Site[]=[];readonly audit={spans:0,approaches:0,missing:0};
 readonly aprons:TimberApron[]=[];
 private spans:Span[]=[];
 private updateRevision=-1;private updateX=Infinity;private updateZ=Infinity;
 private terrain:Terrain;
 private apronEnds=new Map<number,{start:boolean;end:boolean}>();
 private planes=new Map<number,{y0:number;y1:number;level:number}>();
 constructor(private roads:ApproachRoads,terrain:Terrain,ground:(x:number,z:number)=>number|null, timber=true){
  this.terrain=terrain;
  const chains=new Map<string,Span>(),world=(raw:number)=>raw>terrain.seaLevel?terrain.seaLevel+(raw-terrain.seaLevel)*terrain.exag:raw;
  const coarse=(x:number,z:number)=>{const m=terrain.manifest;for(const level of [8,7]){const size=m.size/2**level,i=Math.floor((x+m.village[0]-m.origin[0])/size),j=Math.floor((z-m.village[1]+m.origin[1])/size);if(m.levels[level]?.includes(i+'_'+j))return false;}return true;};
  for(const road of roads.roads)if(road.bridge){
   const p=timberPlan(road,roads.roads);let span=chains.get(p.chainKey);
   if(!span){
    const a=ground(p.ax,p.az),b=ground(p.bx,p.bz);if(a===null||b===null){this.audit.missing++;continue;}
    // Exaggerated banks can turn a cart bridge into an unclimbable ramp. Keep its surveyed
    // centre height, cap the drawn deck grade, and cut/fill only its short road approaches.
    const middle=(a+b)/2+.05,delta=Math.max(-p.total*.12/terrain.exag,Math.min(p.total*.12/terrain.exag,b-a));
    span={start:middle-delta/2,end:middle+delta/2,length:p.total,x:p.path[0][0],z:p.path[0][1],planes:[]};this.spans.push(span);chains.set(p.chainKey,span);this.audit.spans++;
    const corePath=p.path,coreCum=[0];for(let i=1;i<corePath.length;i++)coreCum.push(coreCum[i-1]+Math.hypot(corePath[i][0]-corePath[i-1][0],corePath[i][1]-corePath[i-1][1]));
    const clipStart=span.start,clipEnd=span.end,clipLength=span.length,half=road.halfWidth+.8,max=half+1.5;
    const coreBox:[number,number,number,number]=[Math.min(...corePath.map(p=>p[0]))-max,Math.min(...corePath.map(p=>p[1]))-max,Math.max(...corePath.map(p=>p[0]))+max,Math.max(...corePath.map(p=>p[1]))+max];
    this.sites.push({box:coreBox,surface:()=>null,height(x,z,surveyed){let best=max*max,along=-1;
      for(let i=1;i<corePath.length;i++){const a=corePath[i-1],b=corePath[i],dx=b[0]-a[0],dz=b[1]-a[1],n=coreCum[i]-coreCum[i-1],t=((x-a[0])*dx+(z-a[1])*dz)/(n*n);if(t<0||t>1)continue;const d=(x-a[0]-dx*t)**2+(z-a[1]-dz*t)**2;if(d<best){best=d;along=coreCum[i-1]+t*n;}}
      if(along<0)return surveyed;const top=clipStart+(clipEnd-clipStart)*along/clipLength-.10,blend=Math.max(0,Math.min(1,(max-Math.sqrt(best))/(max-half)));return surveyed+(Math.min(surveyed,top)-surveyed)*blend;
    }});

    for(const edge of ['start','end'] as const){
     const path:[number,number][]=[edge==='start'?p.path[0]:p.path[p.path.length-1]],used=new Set(p.chainKey.split(',').map(Number));let distance=0;
     for(let step=0;step<16&&distance<48;step++){
      const at=path[path.length-1],next=roads.roads.filter(r=>r.kind<=4&&!used.has(r.id)&&[r.pts[0],r.pts[r.pts.length-1]].some(q=>Math.hypot(q[0]-at[0],q[1]-at[1])<.3)).sort((a,b)=>(a.name===road.name?-1:1)-(b.name===road.name?-1:1))[0];
      if(!next)break;used.add(next.id);let points=next.pts;if(Math.hypot(points[0][0]-at[0],points[0][1]-at[1])>=.3)points=[...points].reverse();
      for(let i=1;i<points.length&&distance<48;i++){
       const a=path[path.length-1],b=points[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!len)continue;
       if(distance+len>48){const t=(48-distance)/len;path.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);distance=48;}else{path.push(b);distance+=len;}
      }
     }
     if(distance<48){const a=path[path.length-1],b=path.length>1?path[path.length-2]:edge==='start'?p.path[1]:p.path[p.path.length-2],dx=a[0]-b[0],dz=a[1]-b[1],n=Math.hypot(dx,dz)||1;path.push([a[0]+dx/n*(48-distance),a[1]+dz/n*(48-distance)]);distance=48;}
     const tail=path[path.length-1],outside=ground(tail[0],tail[1]);if(outside===null){this.audit.missing++;continue;}
     const core=edge==='start'?span.start:span.end,slope=(span.end-span.start)/span.length*(edge==='start'?-1:1),cum=[0];for(let i=1;i<path.length;i++)cum.push(cum[i-1]+Math.hypot(path[i][0]-path[i-1][0],path[i][1]-path[i-1][1]));
     const half=road.halfWidth+.8,max=half+2.4,box:[number,number,number,number]=[Math.min(...path.map(p=>p[0]))-max,Math.min(...path.map(p=>p[1]))-max,Math.max(...path.map(p=>p[0]))+max,Math.max(...path.map(p=>p[1]))+max];
     this.sites.push({box,surface:()=>null,height(x,z,surveyed){
      let best=max*max,along=-1;
      for(let i=1;i<path.length;i++){
       const a=path[i-1],b=path[i],dx=b[0]-a[0],dz=b[1]-a[1],len=cum[i]-cum[i-1],raw=((x-a[0])*dx+(z-a[1])*dz)/(len*len);if(i===1&&raw*len< -3)continue;
       const t=Math.max(i===1?-3/len:0,Math.min(1,raw)),px=a[0]+t*dx,pz=a[1]+t*dz,d=(x-px)**2+(z-pz)**2;if(d<best){best=d;along=cum[i-1]+t*len;}
      }
      if(along< -3)return surveyed;
      const t=Math.max(0,along)/distance,t2=t*t,t3=t2*t,secant=(outside-core)/distance,outer=Math.max(-.14,Math.min(.14,secant));
      const target=along<0?core+slope*along-.08:(2*t3-3*t2+1)*(core-.08)+(t3-2*t2+t)*distance*slope+(-2*t3+3*t2)*outside+(t3-t2)*distance*outer;
      const smooth=(a:number,b:number,v:number)=>{const u=Math.max(0,Math.min(1,(v-a)/(b-a)));return u*u*(3-2*u);};
      const blend=(1-smooth(half,max,Math.sqrt(best)))*(1-smooth(Math.max(distance*.5,distance-6),distance,along));
      return surveyed+(target-surveyed)*blend;
     }});this.audit.approaches++;
     // Geometry-only callers need the same cuts and planes, without scene or tile records.
     if(timber&&roads.group&&terrain.manifest&&coarse(path[0][0],path[0][1])){
       // Overlap the core by two metres: the bank road may turn at its endpoint.
       // This closes the triangular inside corner without a rounded invisible deck cap.
       const endPoint=path[0],inside=edge==='start'?p.path[1]:p.path[p.path.length-2],n=Math.hypot(inside[0]-endPoint[0],inside[1]-endPoint[1]),overlap=Math.min(2,n);
       const apronPath:[number,number][]=[[endPoint[0]+(inside[0]-endPoint[0])*overlap/n,endPoint[1]+(inside[1]-endPoint[1])*overlap/n],...path];
       const apron=new TimberApron(terrain,apronPath,world(core)-slope*terrain.exag*overlap,slope*terrain.exag,road.halfWidth+.9);
       if(edge==='start')span.startApron=apron;else span.endApron=apron;
       this.aprons.push(apron);this.sites.push(apron.site);roads.group.add(apron.group);
     }
    }
   }
   const reversed=Math.hypot(p.path[0][0]-span.x,p.path[0][1]-span.z)>.3,start=reversed?span.end:span.start,end=reversed?span.start:span.end;
   const ends={start:p.before<.001&&!!(reversed?span.endApron:span.startApron),end:p.total-p.before-p.own<.001&&!!(reversed?span.startApron:span.endApron)};this.apronEnds.set(road.id,ends);roads.trimTimberApproaches?.(road.id,ends.start,ends.end);
   const plane={id:road.id,y0:world(start+(end-start)*p.before/p.total),y1:world(start+(end-start)*(p.before+p.own)/p.total),level:6};span.planes.push(plane);this.planes.set(road.id,plane);
  }
 }
 update(camera:THREE.Vector3):void{
  const revision=this.terrain.contactRevision,x=Math.floor(camera.x/64),z=Math.floor(camera.z/64);
  if(revision===this.updateRevision&&x===this.updateX&&z===this.updateZ)return;
  this.updateRevision=revision;this.updateX=x;this.updateZ=z;
  for(let i=0;i<this.spans.length;i++){
   const s=this.spans[i],a=s.startApron,b=s.endApron;if(!a&&!b||Math.hypot(camera.x-s.x,camera.z-s.z)>2000)continue;
   if(a&&!a.prepare()||b&&!b.prepare())continue;
   const rise=Math.max(a?.clearance()??0,b?.clearance()??0);
   if(rise>.001){a?.raise(rise);b?.raise(rise);for(let j=0;j<s.planes.length;j++){const p=s.planes[j];p.y0+=rise;p.y1+=rise;const ends=this.apronEnds.get(p.id)!;this.roads.trimTimberApproaches?.(p.id,ends.start,ends.end);}}
   a?.update();b?.update();
  }
 }
 /** Filled abutments are solid ground; unlike the span, there is no driveable underside. */
 apronHeight(x:number,z:number):number|null{let result:number|null=null;for(let i=0;i<this.aprons.length;i++){const a=this.aprons[i],b=a.site.box;if(x<b[0]||x>b[2]||z<b[1]||z>b[3])continue;const h=a.height(x,z);if(h!==null&&h!==undefined)result=result===null?h:Math.max(result,h);}return result;}
 hasApron(road:Road,side:'start'|'end'):boolean{return this.apronEnds.get(road.id)?.[side]??false;}
 planeFor(road:Road):{y0:number;y1:number;level:number}|null{return this.planes.get(road.id)??null;}
 install(terrain:Terrain):void{terrain.bridgeApproaches=this;terrain.sites.push(...this.sites);}
}
