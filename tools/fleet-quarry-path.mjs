// Test-only physical path follower. Graph edges are the existing road vertices, never invented terrain.
export function parkRidePath(roads,start,village){
 const nodes=[],edges=[],keys=new Map(),node=(x,z,bridge=false)=>{const key=Math.round(x*100)+','+Math.round(z*100)+','+bridge;let i=keys.get(key);if(i===undefined){i=nodes.length;keys.set(key,i);nodes.push({x,z});edges.push([])}return i},link=(a,b)=>{const d=Math.hypot(nodes[a].x-nodes[b].x,nodes[a].z-nodes[b].z);edges[a].push([b,d]);edges[b].push([a,d])};
 for(const r of roads)for(let i=1;i<r.pts.length;i++)link(node(...r.pts[i-1],r.bridge),node(...r.pts[i],r.bridge));
 const access=roads.find(r=>r.id===1672);let best=null;for(let i=1;i<access.pts.length;i++){const a=access.pts[i-1],b=access.pts[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((start.x-a[0])*dx+(start.z-a[1])*dz)/(dx*dx+dz*dz))),x=a[0]+t*dx,z=a[1]+t*dz,d=Math.hypot(x-start.x,z-start.z);if(!best||d<best.d)best={i,x,z,d}}
 const from=node(best.x,best.z),source=node(start.x,start.z);link(source,from);link(from,node(...access.pts[best.i-1],access.bridge));link(from,node(...access.pts[best.i],access.bridge));
 const loop=roads.find(r=>r.id===238),target=node(...loop.pts[0],loop.bridge),distance=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),done=new Set();distance[source]=0;
 const heap=[[0,source]],push=(d,n)=>{let i=heap.length;heap.push([d,n]);while(i){const p=(i-1)>>1;if(heap[p][0]<=d)break;heap[i]=heap[p];i=p}heap[i]=[d,n]},pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1][0]<heap[c][0])c++;if(heap[c][0]>=last[0])break;heap[i]=heap[c];i=c}heap[i]=last}return first};
 while(heap.length&&!done.has(target)){const[d,at]=pop();if(done.has(at)||d!==distance[at])continue;done.add(at);for(const[next,cost]of edges[at])if(d+cost<distance[next]){distance[next]=d+cost;previous[next]=at;push(distance[next],next)}}
 if(!done.has(target))throw Error('No connected park riding road');
 const indices=[];for(let at=target;at!==-1;at=previous[at])indices.push(at);return indices.reverse().map(i=>nodes[i]);
}
export function followPath(v,path,state,maxSpeed=5){
 const cumulative=state.cumulative??=path.reduce((a,p,i)=>(a.push(i?a.at(-1)+Math.hypot(p.x-path[i-1].x,p.z-path[i-1].z):0),a),[]),length=cumulative.at(-1);let nearest=Infinity,at=state.at??0;
 if(state.reverseTicks>0){
  if(--state.reverseTicks===0){let best=Infinity,nearest=0;for(let j=1;j<path.length;j++){const a=path[j-1],b=path[j],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((v.x-a.x)*dx+(v.z-a.z)*dz)/(dx*dx+dz*dz||1))),d=(v.x-a.x-dx*t)**2+(v.z-a.z-dz*t)**2;if(d<best){best=d;nearest=cumulative[j-1]+t*(cumulative[j]-cumulative[j-1])}}state.at=nearest;state.stallTicks=0;}
  return{throttle:-.65,steer:0,handbrake:false,arrived:false,runup:true};
 }

 for(let i=1;i<path.length;i++){if(cumulative[i]<at-10||cumulative[i-1]>at+60)continue;const a=path[i-1],b=path[i],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((v.x-a.x)*dx+(v.z-a.z)*dz)/(dx*dx+dz*dz||1))),d=(v.x-a.x-dx*t)**2+(v.z-a.z-dz*t)**2;if(d<nearest){nearest=d;state.candidate=cumulative[i-1]+t*(cumulative[i]-cumulative[i-1])}}
 state.at=Math.max(at,state.candidate??at);const left=length-state.at,look=Math.min(length,state.at+Math.max(3,Math.abs(v.speed)*1.2));let i=1;while(i<path.length-1&&cumulative[i]<look)i++;const a=path[i-1],b=path[i],t=(look-cumulative[i-1])/(cumulative[i]-cumulative[i-1]||1),x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t,dx=x-v.x,dz=z-v.z,range=Math.max(1,Math.hypot(dx,dz)),error=Math.atan2(Math.sin(Math.atan2(dx,-dz)-v.heading),Math.cos(Math.atan2(dx,-dz)-v.heading));
 // A projection can finish beside the endpoint; use the controls to enter the unchanged arrival radius.
 const endDistance=Math.hypot(v.x-path.at(-1).x,v.z-path.at(-1).z),brakingLeft=left<1&&endDistance>=2?Math.max(left,endDistance-1.5):left;
 const driveSign=left<1&&endDistance>=2&&Math.cos(error)<0?-1:1;
 const speed=driveSign*Math.min(maxSpeed,Math.max(1.2,maxSpeed/(1+Math.abs(error)*3)),Math.sqrt(Math.max(0,brakingLeft)*2));
 const arrived=left<1&&endDistance<2&&Math.abs(v.speed)<.15;
 if(!arrived&&left>3&&v.spec.mass>3000&&Math.abs(v.speed)<.2){
  state.stallTicks=(state.stallTicks??0)+1;
  if(state.stallTicks>360){if((state.recoveries??0)>=2)throw Error('Physical driver cannot progress after two normal-control run-ups '+JSON.stringify({x:v.x,z:v.z,speed:v.speed,at:state.at}));state.recoveries=(state.recoveries??0)+1;state.reverseTicks=720;return{throttle:-.65,steer:0,handbrake:false,arrived:false,runup:true};}
 }else state.stallTicks=0;

 return{throttle:arrived?0:Math.max(-1,Math.min(1,(speed-v.speed)*1.4)),steer:Math.max(-1,Math.min(1,Math.atan2(2*v.spec.wheelbase*Math.sin(error),range)/v.spec.maxSteer)),handbrake:arrived,arrived,at:state.at,left,error};
}
