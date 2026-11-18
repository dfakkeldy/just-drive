import type { Road } from './roads';
import { APRON, GATE } from './quarry-site';
import type { TripPose } from './quarry-trip';
export type {TripPose} from './quarry-trip';
export interface RoutePoint {x:number;z:number}
export interface RouteGap {a:RoutePoint;b:RoutePoint;metres:number}
export interface RouteTurn {at:number;name:string;side:'Left'|'Right'|'Continue';x:number;z:number}
export interface QuarryRoute {points:RoutePoint[];length:number;cumulative:number[];turns:RouteTurn[];gaps:RouteGap[];joins:RouteGap[];start:TripPose;near:TripPose;destination:RoutePoint}
type Edge={to:number;length:number;road:Road;gap?:RouteGap};
const eligible=(r:Road):boolean=>r.kind>=1&&(r.kind<=3||r.name==='Eagle Creek Road'||r.id===1672);
/** Geometry-only sampling pass. No graph edges or shortest-path solve are built before elevations arrive. */
export function routeJunctionSamples(roads:readonly Road[]):RoutePoint[]{
  const allowed=roads.filter(eligible),segments:{a:RoutePoint;b:RoutePoint;road:Road}[]=[],cells=new Map<string,number[]>(),samples=new Map<string,RoutePoint>();
  for(const road of allowed)for(let i=1;i<road.pts.length;i++){
    const a={x:road.pts[i-1][0],z:road.pts[i-1][1]},b={x:road.pts[i][0],z:road.pts[i][1]},id=segments.length;segments.push({a,b,road});
    for(let x=Math.floor(Math.min(a.x,b.x)/16);x<=Math.floor(Math.max(a.x,b.x)/16);x++)for(let z=Math.floor(Math.min(a.z,b.z)/16);z<=Math.floor(Math.max(a.z,b.z)/16);z++){
      const key=x+','+z,list=cells.get(key)??[];list.push(id);cells.set(key,list);
    }
  }
  for(const road of allowed)for(const point of [road.pts[0],road.pts.at(-1)!]){
    const p={x:point[0],z:point[1]},cx=Math.floor(p.x/16),cz=Math.floor(p.z/16);
    for(let x=cx-1;x<=cx+1;x++)for(let z=cz-1;z<=cz+1;z++)for(const i of cells.get(x+','+z)??[]){
      const s=segments[i],a=s.a,b=s.b;if(s.road.bridge!==road.bridge||(a.x===p.x&&a.z===p.z)||(b.x===p.x&&b.z===p.z))continue;
      const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1))),q={x:a.x+dx*t,z:a.z+dz*t};
      if(Math.hypot(p.x-q.x,p.z-q.z)<=.35){samples.set(p.x+','+p.z,p);samples.set(q.x+','+q.z,q);}
    }
  }
  return [...samples.values()];
}
const heading=(a:RoutePoint,b:RoutePoint)=>Math.atan2(b.x-a.x,a.z-b.z);
/** Shortest distance on mapped drivable roads, the named start lane and the mapped park access.
 * Only endpoint-to-segment cartographic joins within 0.35 m are admitted. EVERY nonzero join is
 * retained in gaps (and disclosed by the HUD); a larger break throws, never invents a connecting road.
 */
export type RouteHeight=(x:number,z:number,road:Road)=>number|null;
export function quarryRoute(roads:readonly Road[],village:readonly [number,number],heightAt:RouteHeight=()=>null):QuarryRoute{
  const allowed=roads.filter(eligible),points:RoutePoint[]=[],graph:Edge[][]=[],keys=new Map<string,number>();
  const node=(x:number,z:number)=>{const key=x+','+z;let i=keys.get(key);if(i===undefined){i=points.length;keys.set(key,i);points.push({x,z});graph.push([]);}return i;};
  const edge=(a:number,b:number,length:number,road:Road,gap?:RouteGap)=>{graph[a].push({to:b,length,road,gap});graph[b].push({to:a,length,road,gap});};
  const joins:RouteGap[]=[],joinKeys=new Set<string>();
  const segments:{a:number;b:number;road:Road;cuts:{t:number;id:number}[]}[]=[],ends:{id:number;road:Road}[]=[],cells=new Map<string,number[]>();
  for(const road of allowed){
    const ids=road.pts.map(([x,z])=>node(x,z));ends.push({id:ids[0],road},{id:ids[ids.length-1],road});
    for(let i=1;i<ids.length;i++){
      const a=ids[i-1],b=ids[i],p=points[a],q=points[b],index=segments.length;segments.push({a,b,road,cuts:[{t:0,id:a},{t:1,id:b}]});
      for(let x=Math.floor(Math.min(p.x,q.x)/16);x<=Math.floor(Math.max(p.x,q.x)/16);x++)for(let z=Math.floor(Math.min(p.z,q.z)/16);z<=Math.floor(Math.max(p.z,q.z)/16);z++){
        const key=x+','+z,list=cells.get(key)??[];list.push(index);cells.set(key,list);
      }
    }
  }
  // An endpoint is often in the middle of another road's sampled segment. Keep its measured offset explicit.
  for(const end of ends){
    const p=points[end.id],cx=Math.floor(p.x/16),cz=Math.floor(p.z/16);let best:{s:typeof segments[number];x:number;z:number;t:number;distance:number}|null=null;
    for(let x=cx-1;x<=cx+1;x++)for(let z=cz-1;z<=cz+1;z++)for(const index of cells.get(x+','+z)??[]){
      const s=segments[index];if(s.a===end.id||s.b===end.id)continue;
      const a=points[s.a],b=points[s.b],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1)));
      const qx=a.x+dx*t,qz=a.z+dz*t,distance=Math.hypot(p.x-qx,p.z-qz);
      // Cartographic joins are <=0.35 m, same bridge classification and <=1 m apart in baked elevation.
      // Missing elevation is never guessed. Exact shared mapped vertices already connect above.
      if(distance<=.35&&s.road.bridge===end.road.bridge){
        const hp=heightAt(p.x,p.z,end.road),hq=heightAt(qx,qz,s.road);
        if(hp!==null&&hq!==null&&Math.abs(hp-hq)<=1&&(!best||distance<best.distance))best={s,x:qx,z:qz,t,distance};
      }
    }
    if(best){const {s,x,z,t,distance}=best,q=node(x,z);s.cuts.push({t,id:q});
      if(q!==end.id){const gap={a:p,b:{x,z},metres:distance};edge(end.id,q,distance,s.road,gap);
        const key=[end.id,q].sort((a,b)=>a-b).join(':');if(!joinKeys.has(key)){joinKeys.add(key);joins.push(gap);}}
    }
  }
  const lane=allowed.find(r=>r.name==='Eagle Creek Road'),access=allowed.find(r=>r.id===1672);
  if(!lane||!access)throw Error('The mapped start lane or park access is absent.');
  const last=lane.pts.at(-1)!,before=lane.pts.at(-2)!;
  // Stop 55 m before the north end: room for the straight trailer behind the pickup.
  let remaining=55,spawn:TripPose|null=null;
  for(let i=lane.pts.length-1;i>0;i--){const [x,z]=lane.pts[i],[a,b]=lane.pts[i-1],len=Math.hypot(x-a,z-b);if(remaining<=len){spawn={x:x+(a-x)*remaining/len,z:z+(b-z)*remaining/len,heading:Math.atan2(a-x,z-b)};break;}remaining-=len;}
  if(!spawn)spawn={x:last[0],z:last[1],heading:Math.atan2(before[0]-last[0],last[1]-before[1])};
  const attach=(p:RoutePoint,road:Road)=>{
    let best:{s:typeof segments[number];t:number;x:number;z:number;d:number}|null=null;
    for(const s of segments)if(s.road===road){const a=points[s.a],b=points[s.b],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1))),x=a.x+dx*t,z=a.z+dz*t,d=Math.hypot(x-p.x,z-p.z);if(!best||d<best.d)best={s,t,x,z,d};}
    if(!best)throw Error('No segment for route endpoint');const {s,t,x,z}=best,id=node(x,z);s.cuts.push({t,id});return id;
  };
  const source=attach(spawn,lane),target=attach({x:APRON.e-village[0],z:village[1]-APRON.n},access);
  // Build every segment only after ALL junction, start and destination projections have been collected.
  for(const s of segments){s.cuts.sort((a,b)=>a.t-b.t);for(let i=1;i<s.cuts.length;i++){
    const a=s.cuts[i-1].id,b=s.cuts[i].id;if(a!==b)edge(a,b,Math.hypot(points[b].x-points[a].x,points[b].z-points[a].z),s.road);
  }}
  const distances=new Float64Array(points.length).fill(Infinity),previous=new Int32Array(points.length).fill(-1),via:(Edge|undefined)[]=new Array(points.length);
  // Binary heap, rather than a quadratic scan across the area's sampled road graph.
  const heap:{id:number;d:number}[]=[];
  const put=(id:number,d:number)=>{let i=heap.length;heap.push({id,d});while(i>0){const p=(i-1)>>1;if(heap[p].d<=d)break;heap[i]=heap[p];i=p;}heap[i]={id,d};};
  const take=()=>{const top=heap[0],tail=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].d<heap[c].d)c++;if(heap[c].d>=tail.d)break;heap[i]=heap[c];i=c;}heap[i]=tail;}return top;};
  distances[source]=0;put(source,0);
  while(heap.length){const {id,d}=take();if(d!==distances[id])continue;if(id===target)break;for(const e of graph[id]){const next=d+e.length;if(next<distances[e.to]){distances[e.to]=next;previous[e.to]=id;via[e.to]=e;put(e.to,next);}}}
  if(!Number.isFinite(distances[target]))throw Error('Mapped road graph has a gap between the end of Eagle Creek Road and the park access. No road was bridged.');
  const ids:number[]=[];for(let i=target;i!==source;i=previous[i])ids.push(i);ids.push(source);ids.reverse();
  const path=ids.map(i=>points[i]),cumulative=[0],turns:RouteTurn[]=[],gaps:RouteGap[]=[];
  let name='Eagle Creek Road';
  for(let i=1;i<ids.length;i++){
    const e=via[ids[i]]!,next=e.road.name??'park access road';cumulative.push(cumulative[i-1]+e.length);if(e.gap)gaps.push(e.gap);
    if(next!==name){const a=path[Math.max(0,i-3)],b=path[i-1],c=path[Math.min(path.length-1,i+3)],delta=Math.atan2(Math.sin(heading(b,c)-heading(a,b)),Math.cos(heading(b,c)-heading(a,b)));
      turns.push({at:cumulative[i-1],name:next,side:Math.abs(delta)<.23?'Continue':delta<0?'Left':'Right',x:b.x,z:b.z});name=next;}
  }
  const length=cumulative.at(-1)!,route:QuarryRoute={points:path,cumulative,length,turns,gaps,joins,start:{...points[source],heading:spawn.heading},near:{x:0,z:0,heading:0},destination:points[target]};
  // 600 m before the gate measured back along the SAME shortest route, not a straight-line jump.
  const gate=routeProgress(route,GATE.e-village[0],village[1]-GATE.n);route.near=poseAlong(route,Math.max(0,gate-600));
  return route;
}
export function poseAlong(route:QuarryRoute,distance:number):TripPose{
  for(let i=1;i<route.points.length;i++)if(route.cumulative[i]>=distance){const a=route.points[i-1],b=route.points[i],t=Math.max(0,(distance-route.cumulative[i-1])/(route.cumulative[i]-route.cumulative[i-1]||1));return{x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,heading:heading(a,b)};}
  const a=route.points.at(-2)!,b=route.points.at(-1)!;return{...b,heading:heading(a,b)};
}
export function routeProgress(route:QuarryRoute,x:number,z:number):number{
  let distance=Infinity,at=0;
  for(let i=1;i<route.points.length;i++){const a=route.points[i-1],b=route.points[i],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1))),d=(x-a.x-dx*t)**2+(z-a.z-dz*t)**2;if(d<distance){distance=d;at=route.cumulative[i-1]+(route.cumulative[i]-route.cumulative[i-1])*t;}}
  return at;
}
