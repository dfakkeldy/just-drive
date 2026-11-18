// Independent outward-facing check. Face normals alone cannot detect an inside-out solid if recomputed with it.
export function inspectSolids(rig) {
  let closed=0,inward=0;const bad=[];
  rig.root.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const g=mesh.geometry,p=g.attributes.position,index=g.index,count=(index?.count??p.count)/3;
    const parents=Array.from({length:count},(_,i)=>i),edges=new Map(),volumes=[];
    const root=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
    const join=(a,b)=>{a=root(a);b=root(b);if(a!==b)parents[b]=a;};
    const point=i=>[p.getX(i),p.getY(i),p.getZ(i)];
    const key=a=>a.map(v=>Math.round(v*1e6)).join(',');
    for(let i=0;i<count;i++){
      const ids=[0,1,2].map(j=>index?index.getX(i*3+j):i*3+j),[a,b,c]=ids.map(point),keys=[a,b,c].map(key);
      volumes[i]=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
      for(let j=0;j<3;j++){
        const v=keys[j],w=keys[(j+1)%3],edge=v<w?v+'|'+w:w+'|'+v,list=edges.get(edge)??[];
        if(list.length)join(i,list[0]);list.push(i);edges.set(edge,list);
      }
    }
    const components=new Map();
    for(let i=0;i<count;i++){const k=root(i),c=components.get(k)??{volume:0,closed:true,faces:0};c.volume+=volumes[i];c.faces++;components.set(k,c);}
    for(const list of edges.values())if(list.length!==2)for(const i of list)components.get(root(i)).closed=false;
    for(const c of components.values())if(c.closed){closed++;if(c.volume< -1e-10){inward++;bad.push({material:mesh.material.name,faces:c.faces,volume:c.volume});}}
  });
  return {closed,inward,bad};
}
