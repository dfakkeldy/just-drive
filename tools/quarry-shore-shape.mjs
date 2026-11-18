// Serializable GPU shoreline guard. Limits are referenced to a 1392-pixel-wide view.
export function shoreShape(THREE,t,k,c,r){
 const W=696,H=Math.round(W/c.aspect),scale=W/1392,window=8*scale,supportLimit=3*scale;
 const target=new THREE.WebGLRenderTarget(W,H),scene=new THREE.Scene(),land=[],wet=[],old=r.getRenderTarget(),clear=r.getClearColor(new THREE.Color()),alpha=r.getClearAlpha();
 t.group.updateMatrixWorld(true);k.water.group.updateMatrixWorld(true);
 const segments=[];
 for(const mesh of t.group.children)if(mesh.visible&&mesh.isMesh){
  const mat=mesh.material.clone(),src=mat.fragmentShader;mat.fragmentShader=src.slice(0,src.lastIndexOf('}'))+'gl_FragColor=vec4(1.0,0.0,0.0,1.0);\n}';
  const copy=new THREE.Mesh(mesh.geometry,mat);copy.onBeforeRender=mesh.onBeforeRender;copy.matrixAutoUpdate=false;copy.matrix.copy(mesh.matrixWorld);copy.frustumCulled=false;scene.add(copy);land.push(copy);
  const pos=mesh.geometry.attributes.position,uv=mesh.geometry.attributes.uv,ground=mesh.geometry.attributes.ground,idx=mesh.geometry.index.array,hide=mesh.material.uniforms.hideQuad.value;
  const m=mesh.matrixWorld.elements;if(m.some((v,i)=>Math.abs(v-([0,5,10,15].includes(i)?1:0))>1e-8))throw Error('shore guard needs untransformed terrain meshes');
  // A raised real bank can occlude the lake before the terrain/plane intersection.
  // Only front/back face transitions count: ordinary grid edges cannot excuse a mask notch.
  const flags=new Int8Array(idx.length/3),backEdges=new Set(),edgeKey=(a,b)=>a<b?a*pos.count+b:b*pos.count+a;
  for(let f=0;f<flags.length;f++){
   const a=idx[f*3],b=idx[f*3+1],d=idx[f*3+2],ids=[a,b,d];if(ids.some(i=>Math.abs(pos.getY(i)-ground.getX(i)+(mesh.geometry.attributes.quarryWaterDrop?.getX(i)??0))>.01))continue;
   const u=(uv.getX(a)+uv.getX(b)+uv.getX(d))/3,v=(uv.getY(a)+uv.getY(b)+uv.getY(d))/3;if(hide.getComponent((u>=.5?1:0)+(v>=.5?2:0))>.5)continue;
   const ax=pos.getX(a),ay=pos.getY(a),az=pos.getZ(a),bx=pos.getX(b)-ax,by=pos.getY(b)-ay,bz=pos.getZ(b)-az,dx=pos.getX(d)-ax,dy=pos.getY(d)-ay,dz=pos.getZ(d)-az;
   const side=(by*dz-bz*dy)*(c.position.x-ax)+(bz*dx-bx*dz)*(c.position.y-ay)+(bx*dy-by*dx)*(c.position.z-az);flags[f]=side>0?1:side<0?-1:0;
   if(flags[f]<0){backEdges.add(edgeKey(a,b));backEdges.add(edgeKey(b,d));backEdges.add(edgeKey(d,a));}
  }
  for(let f=0;f<flags.length;f++)if(flags[f]>0){const ids=[idx[f*3],idx[f*3+1],idx[f*3+2]];for(let j=0;j<3;j++){const a=ids[j],b=ids[(j+1)%3];if(!backEdges.has(edgeKey(a,b)))continue;const p=new THREE.Vector3(pos.getX(a),pos.getY(a),pos.getZ(a)).project(c),q=new THREE.Vector3(pos.getX(b),pos.getY(b),pos.getZ(b)).project(c);if(p.z<-1||p.z>1||q.z<-1||q.z>1)continue;const line=[[(p.x+1)*W/2,(1-p.y)*H/2],[(q.x+1)*W/2,(1-q.y)*H/2]];if(Math.max(line[0][1],line[1][1])>=H*.5&&Math.min(line[0][1],line[1][1])<=H+3)segments.push(line);}}
  for(const pool of k.water.meshes)if(pool.visible){const plane=pool.position.y;
   for(let i=0;i<idx.length;i+=3){const a=idx[i],b=idx[i+1],d=idx[i+2],ya=pos.getY(a)-plane,yb=pos.getY(b)-plane,yd=pos.getY(d)-plane;if((ya>0&&yb>0&&yd>0)||(ya<0&&yb<0&&yd<0))continue;
    if(Math.max(Math.abs(pos.getY(a)-ground.getX(a)+(mesh.geometry.attributes.quarryWaterDrop?.getX(a)??0)),Math.abs(pos.getY(b)-ground.getX(b)+(mesh.geometry.attributes.quarryWaterDrop?.getX(b)??0)),Math.abs(pos.getY(d)-ground.getX(d)+(mesh.geometry.attributes.quarryWaterDrop?.getX(d)??0)))>.01)continue; // skirts/canopy are not a true bank
    const u=(uv.getX(a)+uv.getX(b)+uv.getX(d))/3,v=(uv.getY(a)+uv.getY(b)+uv.getY(d))/3;if(hide.getComponent((u>=.5?1:0)+(v>=.5?2:0))>.5)continue;
    const ids=[a,b,d],ys=[ya,yb,yd],hits=[];for(let j=0;j<3;j++){const l=(j+1)%3;if((ys[j]<0)===(ys[l]<0)||ys[j]===ys[l])continue;const f=ys[j]/(ys[j]-ys[l]),p=new THREE.Vector3(pos.getX(ids[j])+(pos.getX(ids[l])-pos.getX(ids[j]))*f,plane,pos.getZ(ids[j])+(pos.getZ(ids[l])-pos.getZ(ids[j]))*f).project(c);if(p.z>=-1&&p.z<=1)hits.push([(p.x+1)*W/2,(1-p.y)*H/2]);}
    if(hits.length===2&&Math.max(hits[0][0],hits[1][0])>=-3&&Math.min(hits[0][0],hits[1][0])<=W+3&&Math.max(hits[0][1],hits[1][1])>=H*.5&&Math.min(hits[0][1],hits[1][1])<=H+3)segments.push(hits);
   }
  }
 }
 for(const mesh of k.water.meshes)if(mesh.visible){const mat=new THREE.MeshBasicMaterial({color:0x00ff00,side:THREE.DoubleSide,toneMapped:false}),copy=new THREE.Mesh(mesh.geometry,mat);copy.matrixAutoUpdate=false;copy.matrix.copy(mesh.matrixWorld);copy.renderOrder=1;scene.add(copy);wet.push(copy);}
 r.setRenderTarget(target);r.setClearColor(0,0);r.clear();r.render(scene,c);const pixels=new Uint8Array(W*H*4);r.readRenderTargetPixels(target,0,0,W,H,pixels);r.setRenderTarget(old);r.setClearColor(clear,alpha);
 const label=(x,y)=>{const i=((H-1-y)*W+x)*4;return pixels[i]>200?1:pixels[i+1]>200?2:0;},adj=new Map(),point=new Map();
 const link=(a,b)=>{const ka=a.join(','),kb=b.join(',');point.set(ka,a.map(v=>v/2));point.set(kb,b.map(v=>v/2));const A=adj.get(ka)??[],B=adj.get(kb)??[];A.push(kb);B.push(ka);adj.set(ka,A);adj.set(kb,B);};
 for(let y=Math.floor(H*.55);y<H-1;y++)for(let x=0;x<W-1;x++){
  const v=[label(x,y),label(x+1,y),label(x+1,y+1),label(x,y+1)],p=[];if(v.includes(0))continue;
  for(let i=0;i<4;i++)if(v[i]!==v[(i+1)%4])p.push(i===0?[2*x+1,2*y]:i===1?[2*x+2,2*y+1]:i===2?[2*x+1,2*y+2]:[2*x,2*y+1]);
  if(p.length===2)link(p[0],p[1]);else if(p.length===4){link(p[0],p[1]);link(p[2],p[3]);}
 }
 const visited=new Set(),paths=[];for(const start of [...adj.keys()].sort((a,b)=>adj.get(a).length-adj.get(b).length))if(!visited.has(start)){let prev=null,key=start;const path=[];while(key&&!visited.has(key)){visited.add(key);path.push(point.get(key));const next=adj.get(key).find(n=>n!==prev&&!visited.has(n));prev=key;key=next;}if(path.length>20)paths.push(path);}
 const distance=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],f=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-f*dx,p[1]-a[1]-f*dy);};
 let sharp=0,supported=0,maxUnsupported=0;const unsupported=[];
 for(const path of paths)for(let i=1;i<path.length-1;i++){
  let a=i,b=i,length=0;while(a>0&&length<window){length+=Math.hypot(path[a][0]-path[a-1][0],path[a][1]-path[a-1][1]);a--;}if(length<window)continue;
  length=0;while(b<path.length-1&&length<window){length+=Math.hypot(path[b][0]-path[b+1][0],path[b][1]-path[b+1][1]);b++;}if(length<window)continue;
  const p=path[i],u=[p[0]-path[a][0],p[1]-path[a][1]],v=[path[b][0]-p[0],path[b][1]-p[1]],angle=Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v)||1))))*180/Math.PI;
  if(angle<=50)continue;sharp++;let support=Infinity;for(const s of segments)support=Math.min(support,distance(p,s[0],s[1]));if(support<=supportLimit){supported++;continue;}maxUnsupported=Math.max(maxUnsupported,angle);if(unsupported.length<12)unsupported.push({pixel:p.map(x=>x/scale),angle,supportPixels:support/scale});
 }
 if(unsupported.length){
  const detail=new THREE.WebGLRenderTarget(W,H,{type:THREE.FloatType,format:THREE.RGBAFormat});for(const m of wet)m.visible=false;
  for(const m of land){m.material.fragmentShader=m.material.fragmentShader.replace('gl_FragColor=vec4(1.0,0.0,0.0,1.0);','gl_FragColor=vec4(vWorld.xyz,vGround);');m.material.needsUpdate=true;}
  r.setRenderTarget(detail);r.setClearColor(0,0);r.clear();r.render(scene,c);const positions=new Float32Array(W*H*4);r.readRenderTargetPixels(detail,0,0,W,H,positions);r.setRenderTarget(old);r.setClearColor(clear,alpha);
  const ray=new THREE.Raycaster(),ndc=new THREE.Vector2(),meshes=t.group.children.filter(m=>m.visible&&m.isMesh);
  for(const sample of unsupported.slice(0,3)){
   const px=sample.pixel.map(v=>v*scale);let at=null;for(let dy=-1;dy<=1&&!at;dy++)for(let dx=-1;dx<=1;dx++){const x=Math.round(px[0])+dx,y=Math.round(px[1])+dy;if(x>=0&&x<W&&y>=0&&y<H&&label(x,y)===1){at=[x,y];break;}}if(!at)continue;
   const i=((H-1-at[1])*W+at[0])*4,x=positions[i],y=positions[i+1],z=positions[i+2],g=positions[i+3];ndc.set((at[0]+.5)/W*2-1,1-(at[1]+.5)/H*2);ray.setFromCamera(ndc,c);
   sample.land={e:x+t.manifest.village[0],n:t.manifest.village[1]-z,y,ground:g,mapped:k.site.waterLevel(x,z),water:ray.intersectObjects(k.water.meshes.filter(m=>m.visible),false).map(h=>({distance:h.distance,e:h.point.x+t.manifest.village[0],n:t.manifest.village[1]-h.point.z,y:h.point.y})),hits:ray.intersectObjects(meshes,false).slice(0,4).map(h=>{const pos=h.object.geometry.attributes.position,ground=h.object.geometry.attributes.ground,coast=h.object.geometry.attributes.coast;return{distance:h.distance,vertices:[h.face.a,h.face.b,h.face.c].map(i=>({e:pos.getX(i)+t.manifest.village[0],n:t.manifest.village[1]-pos.getZ(i),y:pos.getY(i),ground:ground.getX(i),wet:coast.getY(i)}))};})};
  }
  detail.dispose();
 }
 for(const m of land)m.material.dispose();for(const m of wet)m.material.dispose();target.dispose();
 return{probe:[W,H],referenceWidth:1392,maxAngle:50,screenLength:16,landSupportPixels:3,paths:paths.length,sharp,supported,unsupportedCount:sharp-supported,maxUnsupported,examples:unsupported};
}
