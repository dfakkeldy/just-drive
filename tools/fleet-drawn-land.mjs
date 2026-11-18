// Vertical ray/triangle intersection on the visible mesh grid. The first sample of every geometry is
// cross-checked with the independent THREE.Ray path; no placed/physics height enters either result.
export function drawnLandHeight(x,z){
 const f=window.qf,member=f.contactMember,shown=f.shownContactTile??=(t,x,z)=>{if(!t?.mesh?.visible||x<t.x0||x>=t.x0+t.size||z<t.z0||z>=t.z0+t.size)return false;const q=(x>=t.x0+t.size/2?1:0)|(z>=t.z0+t.size/2?2:0);return t.mesh.material.uniforms.hideQuad.value.getComponent(q)<.5;};
 let t=f.lastContactTile;
 if(!shown(t,x,z)){const tiles=f.contactTiles??=[];t=null;for(const tile of tiles)if(shown(tile,x,z)){t=tile;break;}if(!t){t=f.terrain.drawnTile(x,z);if(!t){if(!member||member.state==='DRIVEN'||member.state==='MOVING'||member.state==='STRAPPED'&&f.f.driven.id==='truck')return null;const old=f.parkedContactTiles?.get(member)??[];t=old.find(q=>q.mesh&&x>=q.x0&&x<q.x0+q.size&&z>=q.z0&&z<q.z0+q.size);if(!t)return null;f.contactStats.cachedParkedRays=(f.contactStats.cachedParkedRays??0)+1;}f.contactTiles.unshift(t);if(f.contactTiles.length>16)f.contactTiles.pop();}f.lastContactTile=t;}
 if(member&&t.mesh.visible){const map=f.parkedContactTiles??=new Map(),tiles=map.get(member)??[];if(!tiles.some(q=>q.mesh===t.mesh)){tiles.push({x0:t.x0,z0:t.z0,size:t.size,level:t.level,mesh:t.mesh});map.set(member,tiles);}}
 const g=t.mesh.geometry,p=g.attributes.position,n=Math.round(Math.sqrt(p.count)),seg=n-3,fa=(x-t.x0)*seg/t.size,fb=(z-t.z0)*seg/t.size,a=Math.min(seg-1,Math.max(0,Math.floor(fa))),b=Math.min(seg-1,Math.max(0,Math.floor(fb))),u=fa-a,v=fb-b,i=(b+1)*n+a+1;
 const h00=p.getY(i),h10=p.getY(i+1),h01=p.getY(i+n),h11=p.getY(i+n+1),height=u+v<=1?h00+(h10-h00)*u+(h01-h00)*v:h11+(h01-h11)*(1-u)+(h10-h11)*(1-v);
 if(!(f.fastCheckedTiles??=new WeakSet()).has(g)){
  const expected=f.nativeDown(x,z,t);if(expected===null||Math.abs(height-expected)>1e-5)throw Error('Analytical drawn ray mismatch '+JSON.stringify({height,expected,x,z}));
  const m=t.mesh.matrixWorld.elements;if(m.some((v,i)=>Math.abs(v-(i%5===0?1:0))>1e-9))throw Error('Unexpected terrain mesh transform');
  f.fastCheckedTiles.add(g);
 }
 return height;
}
