import type { Road } from '../roads';
import { readRoute, type RaceRoute } from './race-wire';
/** Follow one actual road polyline. No chords across bends: each gate is a source vertex or subdivision. */
export function raceRoutes(roads: readonly Road[], origin: {x:number;z:number}): RaceRoute[] {
  const choices: RaceRoute[] = [];
  for (const road of roads) {
    if (!road.name || road.kind > 3 || road.railway || road.tags?.railway) continue;
    // Long roads can cross a whole area. Their endpoints are not the nearest place to race.
    let segment = -1, distance = Infinity, start: [number, number] = [0, 0];
    for (let i=1;i<road.pts.length;i++) {
      const a=road.pts[i-1],b=road.pts[i],dx=b[0]-a[0],dz=b[1]-a[1],length2=dx*dx+dz*dz;
      if (!length2) continue;
      const t=Math.max(0,Math.min(1,((origin.x-a[0])*dx+(origin.z-a[1])*dz)/length2));
      const p: [number,number]=[a[0]+t*dx,a[1]+t*dz],d=Math.hypot(p[0]-origin.x,p[1]-origin.z);
      if(d<distance){segment=i;distance=d;start=p;}
    }
    if(segment<0)continue;
    const along=[
      [start,...road.pts.slice(segment)],
      [start,...road.pts.slice(0,segment).reverse()],
    ];
    const local: RaceRoute[]=[];
    const add=(pts: readonly [number,number][])=>{
      if (pts.length < 2) return;
      const gates = [{x:pts[0][0],z:pts[0][1]}]; let length = 0;
      for (let i=1;i<pts.length && length<600 && gates.length<24;i++) {
        const a=pts[i-1], b=pts[i], d=Math.hypot(b[0]-a[0],b[1]-a[1]);
        const n=Math.max(1,Math.ceil(d/60));
        for(let j=1;j<=n && length<600 && gates.length<24;j++) {
          const p={x:a[0]+(b[0]-a[0])*j/n,z:a[1]+(b[1]-a[1])*j/n},last=gates[gates.length-1];
          const step=Math.hypot(p.x-last.x,p.z-last.z);
          // Very short source vertices are retained only as path shape; don't create overlapping checkpoints.
          if(step<15) continue;
          gates.push(p);length+=step;
        }
      }
      if(length>=100 && gates.length>=3) { const route=readRoute({roadId:road.id,gates},1000000);if(route)local.push(route); }
    };
    along.forEach(add);
    // A short road may have <100 m in either direction from its middle. Keep its full-length courses.
    if(!local.length){add(road.pts);add([...road.pts].reverse());}
    choices.push(...local);
  }
  return choices.sort((a,b)=>Math.hypot(a.gates[0].x-origin.x,a.gates[0].z-origin.z)-Math.hypot(b.gates[0].x-origin.x,b.gates[0].z-origin.z)).slice(0,12);
}
