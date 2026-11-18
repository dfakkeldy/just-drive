// The invented park's Lake Loop follows two real west-wall bench roads beside the pit lake.
// It does not claim a road around the whole lake: the northern shoreline spurs are dead ends.
// Endpoints may lie inside a sampled segment; every admitted cartographic offset is returned as evidence.
export function quarryLoop(roads){
 const ids=[238,263];
 const path=[],gaps=[],chain=ids.map(id=>{const r=roads.find(r=>r.id===id);if(!r)throw Error('Lake loop road missing: '+id);return r;});
 const project=(r,p)=>{let at=0,best=null;for(let i=1;i<r.pts.length;i++){const a=r.pts[i-1],b=r.pts[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(length*length||1))),x=a[0]+dx*t,z=a[1]+dz*t,d=Math.hypot(p[0]-x,p[1]-z);if(!best||d<best.distance)best={point:[x,z],at:at+length*t,distance:d};at+=length;}return best;};
 let current=chain[0].pts[0];
 for(let k=0;k<chain.length;k++){
  const r=chain[k],next=chain[(k+1)%chain.length],entry=project(r,current),options=[];
  for(const p of[next.pts[0],next.pts.at(-1)]){const hit=project(r,p);options.push({...hit,next:p});}
  for(const p of[r.pts[0],r.pts.at(-1)]){const hit=project(next,p),exit=project(r,p);options.push({...exit,distance:hit.distance,next:hit.point});}
  options.sort((a,b)=>Math.abs(a.distance-b.distance)>.001?a.distance-b.distance:Math.abs(b.at-entry.at)-Math.abs(a.at-entry.at));const exit=options[0];
  if(entry.distance>.35||exit.distance>.35)throw Error(`Lake loop graph gap at roads ${r.id}/${next.id}: ${Math.max(entry.distance,exit.distance).toFixed(3)} m`);
  if(exit.distance>.001)gaps.push({from:r.id,to:next.id,metres:exit.distance,point:exit.point});
  const forward=exit.at>=entry.at,pts=[],cum=[0];for(let i=1;i<r.pts.length;i++)cum.push(cum.at(-1)+Math.hypot(r.pts[i][0]-r.pts[i-1][0],r.pts[i][1]-r.pts[i-1][1]));
  pts.push(entry.point);for(let i=0;i<r.pts.length;i++)if(cum[i]>Math.min(entry.at,exit.at)+.01&&cum[i]<Math.max(entry.at,exit.at)-.01)pts.push(r.pts[i]);pts.push(exit.point);
  if(!forward){const interior=pts.slice(1,-1).reverse();pts.splice(1,pts.length-2,...interior);}
  for(const[x,z]of pts){const last=path.at(-1);if(!last||Math.hypot(last.x-x,last.z-z)>.001)path.push({x,z});}
  current=exit.next;
 }
 const cumulative=[0];for(let i=1;i<path.length;i++)cumulative.push(cumulative.at(-1)+Math.hypot(path[i].x-path[i-1].x,path[i].z-path[i-1].z));
 return{points:path,cumulative,length:cumulative.at(-1),gaps,roadIds:ids};
}
