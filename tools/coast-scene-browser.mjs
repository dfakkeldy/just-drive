// Acceptance uses only the game's existing terrain meshes/materials and the real scene framebuffer.
// No replacement material, test quad or imitation of the coast function is used here.
export const installCoastScene = String.raw`(async()=>{
 const T=ct.THREE,t=ct.t,r=ct.r,c=ct.c;
 ct.baseShaders=new Map();ct.zeroFootprint=false;const callbacks=new WeakMap();
 ct.materials=()=>{const mats=new Set();for(const q of t.tiles.values())for(const m of [q.mesh?.material,q.mirror?.material])if(m?.defines?.COAST_SHORE){mats.add(m);if(!ct.baseShaders.has(m))ct.baseShaders.set(m,m.fragmentShader);}return [...mats]};
 ct.recipe=(outer='normal',feature='normal')=>{
  for(const m of ct.materials()){
   let s=ct.baseShaders.get(m),call='coastSurface(p, vGround, fine, dist, albedo, n);';
   if(outer==='noLow')s=s.replace(call,'\n#ifndef LOW\n'+call+'\n#endif\n');
   if(outer==='noCall')s=s.replace(call,'');
   if(outer==='noFade')s=s.replace('float openingFade = smoothstep(3.5,4.0,extent/pixel) * smoothstep(3.0,6.0,extent/pixel);','float openingFade = 1.0;');
   if(feature==='recess')s=s.replace('coastRecess(en,h,','coastRecess(en,h+1000.0,');
   if(feature==='seam')s=s.replaceAll('float coal =','float coal = 0.0 *');
   if(/^seam[012]$/.test(feature))s=s.replaceAll('float c'+feature.at(-1)+' =','float c'+feature.at(-1)+' = 0.0 *');
   if(m.fragmentShader!==s){m.fragmentShader=s;m.needsUpdate=true;}
  }
  for(const q of t.tiles.values())if(q.mesh?.material.defines?.COAST_SHORE&&!callbacks.has(q.mesh)){
   const original=q.mesh.onBeforeRender;callbacks.set(q.mesh,original);q.mesh.onBeforeRender=function(...args){original.apply(this,args);const u=args[4].uniforms?.coastPixelScale;if(u&&ct.zeroFootprint)u.value=0;};
  }
 };
 ct.settle=async()=>{c.updateMatrixWorld();for(let i=0;i<160;i++){t.update(c);mmm.trees?.update(t.drawnFine,c.position);ct.k?.update(c.position);ct.recipe();ct.draw();await new Promise(r=>setTimeout(r,40));if(!t.pending&&!(mmm.trees?.pending??0)&&i>8)break;}for(let i=0;i<3;i++)ct.draw()};
 ct.jump=async(position,aim,w,h,fov=55)=>{r.setSize(w,h,false);c.aspect=w/h;c.fov=fov;c.position.copy(position);c.lookAt(aim);c.updateProjectionMatrix();await ct.settle()};
 ct.frame=()=>{ct.draw();const size=r.getDrawingBufferSize(new T.Vector2()),pixels=new Uint8Array(size.x*size.y*4),gl=r.getContext();gl.readPixels(0,0,size.x,size.y,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return {w:size.x,h:size.y,pixels}};
 ct.project=(p,frame)=>{const v=new T.Vector3(p.x,p.y,p.z).project(c);return {x:(v.x*.5+.5)*frame.w,y:(.5-v.y*.5)*frame.h,z:v.z}};
 ct.luma=(f,x,y)=>{x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=f.w||y>=f.h)return 255;const i=((f.h-y-1)*f.w+x)*4;return f.pixels[i]*.2126+f.pixels[i+1]*.7152+f.pixels[i+2]*.0722};
 ct.patch=(f,p)=>{const a=[];for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)a.push(ct.luma(f,p.x+x,p.y+y));return a.sort((a,b)=>a-b)[4]};
 ct.point=(e,n)=>ct.hitAt(e-t.manifest.village[0],t.manifest.village[1]-n);
 ct.asVector=p=>new T.Vector3(p.x,p.y,p.z);
 ct.visible=p=>{
  const direction=ct.asVector(p).sub(c.position),distance=direction.length(),ray=new T.Raycaster(c.position,direction.normalize(),0,distance+.05);
  const hits=ray.intersectObjects([...t.tiles.values()].filter(q=>q.mesh?.visible).map(q=>q.mesh),false).filter(h=>{
   const q=[...t.tiles.values()].find(q=>q.mesh===h.object),p=h.point,quarter=(p.x>=q.x0+q.size/2?1:0)+(p.z>=q.z0+q.size/2?2:0);return q.mesh.material.uniforms.hideQuad.value.getComponent(quarter)<.5;
  });return !!hits[0]&&Math.abs(hits[0].distance-distance)<.06;
 };
 ct.strata=(point,e,n)=>{const h=t.seaLevel+(point.y-t.seaLevel)/t.exag,ny=5109000-n;let u=Math.max(0,Math.min(1,(ny-130)/230));const dip=.24+1.91*(1-u*u*(3-2*u));return ny< -1100?h-(e-618000)-.7*ny:h-ny*dip+450};
 ct.seamCandidates=(south=false)=>{
  const all=[[],[],[]],levels=[235,277,326],range=south?[5108580,5108950,618240,618560]:[5110240,5110280,618545,618715];
  for(let n=range[0];n<=range[1];n+=.5){let previous=null;
   for(let e=range[2];e<=range[3];e+=1){const p=ct.point(e,n);if(!p||p.mask[1]<(south?.5:.8)){previous=null;continue;}const phase=ct.strata(p,e,n);
    if(previous)for(let i=0;i<3;i++){const level=levels[i];if((phase-level)*(previous.phase-level)<=0){let a=previous.e,b=e,pa=previous.phase;for(let j=0;j<12;j++){const mid=(a+b)/2,q=ct.point(mid,n);if(!q)break;const f=ct.strata(q,mid,n);if((pa-level)*(f-level)<=0)b=mid;else{a=mid;pa=f;}}const q=ct.point((a+b)/2,n);if(q?.mask[1]>(south?.5:.8))all[i].push({...q,level,south});}}
    previous={e,phase};
   }
  }return all;
 };
 ct.neighbours=(point,width)=>{
  const found=[];for(const sign of [-1,1]){let hit=null;for(const k of [1.5,2,2.5,3,4]){const p=ct.hitAt(point.x+sign*width*k,point.z);if(p&&p.mask[1]>.8&&p.mask[3]<.05){hit=p;break;}}if(hit)found.push(hit);}return found;
 };
 ct.seamNeighbours=point=>{
  const offsets=[];for(const d of [1.5,2.5,4,6])for(const [dx,dz] of [[d,0],[-d,0],[0,d],[0,-d]])offsets.push([dx,dz]);
  const points=[];for(const [dx,dz] of offsets){const q=ct.hitAt(point.x+dx,point.z+dz);if(!q||q.mask[1]<.5)continue;const phase=ct.strata(q,q.x+t.manifest.village[0],t.manifest.village[1]-q.z);if(Math.min(...[235,277,326].map(n=>Math.abs(phase-n)))>.8)points.push(q);if(points.length===2)break;}return points;
 };
 ct.refineSeam=(point,level)=>{
  const phase=p=>ct.strata(p,p.x+t.manifest.village[0],t.manifest.village[1]-p.z);
  if(Math.abs(phase(point)-level)<.002)return point;
  const roots=[];for(const [vx,vz] of [[1,0],[0,1]]){let prev=null;for(let d=-12;d<=12;d+=.5){const p=ct.hitAt(point.x+vx*d,point.z+vz*d);if(!p||p.mask[1]<.5){prev=null;continue;}const f=phase(p);if(prev&&(f-level)*(prev.f-level)<=0){let a=prev.d,b=d,fa=prev.f;for(let j=0;j<14;j++){const m=(a+b)/2,q=ct.hitAt(point.x+vx*m,point.z+vz*m),fm=phase(q);if((fa-level)*(fm-level)<=0)b=m;else{a=m;fa=fm;}}const m=(a+b)/2;roots.push({p:ct.hitAt(point.x+vx*m,point.z+vz*m),distance:Math.abs(m)});}prev={d,f};}}
  if(!roots.length)throw Error('No nearby drawn seam crossing for '+level);return roots.sort((a,b)=>a.distance-b.distance)[0].p;
 };
 ct.featureRow=(on,off,point,neighbours)=>{
  const at=ct.project(point,on);let best={delta:-Infinity,on:0,off:0,pixel:null};
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const x=Math.round(at.x)+dx,y=Math.round(at.y)+dy,a=ct.luma(on,x,y),b=ct.luma(off,x,y);if(b-a>best.delta)best={delta:b-a,on:a,off:b,pixel:[x,y]};}
  const adjacent=Math.max(...neighbours.map(p=>ct.patch(on,ct.project(p,on))));
  return {...best,adjacent,visible:ct.visible(point),point,screen:at};
 };
 ct.selectSeams=async()=>{
  const selected=[null,null,null],diagnostics=[];
  for(const south of [false,true]){
   if(south)await ct.jump(new T.Vector3(618120-t.manifest.village[0],18,t.manifest.village[1]-5108890),new T.Vector3(618380-t.manifest.village[0],24,t.manifest.village[1]-5108910),1400,950,65);
   else await ct.jump(new T.Vector3(618725-t.manifest.village[0],4,t.manifest.village[1]-5110083),new T.Vector3(618632-t.manifest.village[0],10,t.manifest.village[1]-5110256),1400,950);
   const candidates=ct.seamCandidates(south);ct.recipe();const on=ct.frame();
   for(let i=0;i<3;i++)if(!selected[i]){ct.recipe('normal','seam'+i);const off=ct.frame();ct.recipe();
    const ranked=candidates[i].map(p=>{const s=ct.project(p,on);let delta=-100;if(s.x>4&&s.x<on.w-4&&s.y>4&&s.y<on.h-4)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)delta=Math.max(delta,ct.luma(off,s.x+x,s.y+y)-ct.luma(on,s.x+x,s.y+y));return {p,delta}}).sort((a,b)=>b.delta-a.delta);
    const chosen=ranked.find(x=>x.delta>2&&ct.visible(x.p));diagnostics.push({south,level:[235,277,326][i],candidates:candidates[i].length,best:ranked[0]?.delta});if(chosen)selected[i]=chosen.p;
   }if(selected.every(Boolean))break;
  }
  if(!selected.every(Boolean))throw Error('No real visible seam segments: '+JSON.stringify(diagnostics));return selected;
 };
 ct.connectivity=outer=>{
  ct.recipe(outer);const points=[...ct.recessMetadata,...[[618800,5109230],[618770,5109210],[618740,5109170],[618730,5109140],[618700,5109080]].map(([e,n])=>({e,n}))].map(p=>ct.point(p.e,p.n)).filter(Boolean);
  const on=ct.frame(),saved=ct.materials().map(m=>[m.uniforms.coastOn,m.uniforms.coastOn.value]);for(const [u] of saved)u.value=0;const off=ct.frame();for(const [u,v] of saved)u.value=v;
  const samples=points.map(p=>({point:p,screen:ct.project(p,on)})).filter(x=>x.screen.z<1&&x.screen.z> -1&&x.screen.x>2&&x.screen.y>2&&x.screen.x<on.w-2&&x.screen.y<on.h-2&&Math.max(...x.point.mask)>.2&&ct.visible(x.point)).map(x=>({...x,delta:Math.max(...[-1,0,1].flatMap(dy=>[-1,0,1].map(dx=>Math.abs(ct.luma(on,x.screen.x+dx,x.screen.y+dy)-ct.luma(off,x.screen.x+dx,x.screen.y+dy)))))}));
  ct.recipe();ct.draw();return {materials:saved.length,samples,maxDelta:Math.max(0,...samples.map(p=>p.delta))};
 };
 ct.liveDetails=async(onlyRecesses=false)=>{
  const saved={position:c.position.clone(),quaternion:c.quaternion.clone(),fov:c.fov,size:r.getSize(new T.Vector2()),ratio:r.getPixelRatio()};
  try{
   const connection={normal:ct.connectivity('normal'),noLow:ct.connectivity('noLow'),noCall:ct.connectivity('noCall')};
   const seams=onlyRecesses?[]:await ct.selectSeams(),features=[...ct.recessMetadata.map((p,i)=>({kind:'recess',id:i,e:p.e,n:p.n,h:p.h,width:p.width})),...seams.map((p,i)=>({kind:'seam',id:[235,277,326][i],e:p.x+t.manifest.village[0],n:t.manifest.village[1]-p.z,width:2,south:p.south,y:p.y}))];
   const result={normal:[],noLow:[],noCall:[],seams,connection,hill:t.exag};
   for(const f of features){const point=ct.point(f.e,f.n)??{x:f.e-t.manifest.village[0],z:t.manifest.village[1]-f.n,y:f.y??t.seaLevel+(f.h-t.seaLevel)*t.exag};const from=f.south?[618120,5108890]:[618725,5110083],dx=from[0]-f.e,dz=f.n-from[1],length=Math.hypot(dx,dz);await ct.jump(new T.Vector3(point.x+dx/length*45,point.y,point.z+dz/length*45),ct.asVector(point),mmm.low?390:1400,mmm.low?844:950);
    let actual=ct.point(f.e,f.n);if(!actual)throw Error('Missing drawn feature '+f.kind+' '+f.id);if(f.kind==='seam')actual=ct.refineSeam(actual,f.id);if(!ct.visible(actual)){const n=new T.Vector3(...actual.normal);c.position.copy(ct.asVector(actual)).addScaledVector(n,45).add(new T.Vector3(0,8,0));c.lookAt(ct.asVector(actual));await ct.settle();actual=ct.hitAt(actual.x,actual.z);if(f.kind==='seam')actual=ct.refineSeam(actual,f.id);}const neighbours=f.kind==='recess'?ct.neighbours(actual,f.width):ct.seamNeighbours(actual);
    for(const outer of ['normal','noLow','noCall']){ct.recipe(outer);const on=ct.frame();ct.recipe(outer,f.kind==='seam'?'seam'+[235,277,326].indexOf(f.id):f.kind);const off=ct.frame();result[outer].push({kind:f.kind,id:f.id,...ct.featureRow(on,off,actual,neighbours)});ct.recipe();}
   }return result;
  }finally{ct.recipe();r.setPixelRatio(saved.ratio);r.setSize(saved.size.x,saved.size.y,false);c.position.copy(saved.position);c.quaternion.copy(saved.quaternion);c.fov=saved.fov;c.aspect=saved.size.x/saved.size.y;c.updateProjectionMatrix();await ct.settle();}
 };
 ct.phoneProfile=(outer='normal',fixed=null)=>{
  ct.zeroFootprint=outer==='zero';ct.recipe(outer);const on=ct.frame();ct.recipe(outer,'seam');const noSeam=ct.frame();ct.recipe(outer,'recess');const noRecess=ct.frame();ct.recipe();
  const candidates=fixed??ct.seamCandidates();const profiles=[];
  for(let level=0;level<3;level++){
   const list=candidates[level];
   for(let j=0;j<list.length;j+=Math.max(1,Math.floor(list.length/48))){
    const point=list[j],at=ct.project(point,on);if(point.mask[1]<.98||at.x<14||at.y<14||at.x>on.w-14||at.y>on.h-14)continue;
    const nearby=list.filter(q=>{const d=Math.hypot(q.x-point.x,q.z-point.z);return d>.6&&d<4}).sort((a,b)=>Math.hypot(a.x-point.x,a.z-point.z)-Math.hypot(b.x-point.x,b.z-point.z))[0];if(!nearby)continue;
    const b=ct.project(nearby,on),length=Math.hypot(b.x-at.x,b.y-at.y);if(length<.1)continue;const nx=-(b.y-at.y)/length,ny=(b.x-at.x)/length;
    const samples=[];let previous='';for(let k=-12;k<=12;k++){const x=Math.round(at.x+nx*k),y=Math.round(at.y+ny*k),key=x+','+y;if(key===previous)continue;previous=key;samples.push({k,x,y,delta:Math.max(0,ct.luma(noSeam,x,y)-ct.luma(on,x,y))});}
    const centre=samples.map((q,i)=>({...q,i})).filter(q=>Math.abs(q.k)<=3).sort((a,b)=>b.delta-a.delta)[0],peak=centre?.delta??0,threshold=Math.max(.75,peak*.25);
    let lo=centre?.i??0,hi=lo;if(peak>=2){while(lo>0&&samples[lo-1].delta>=threshold)lo--;while(hi<samples.length-1&&samples[hi+1].delta>=threshold)hi++;}
    profiles.push({key:[235,277,326][level]+':'+point.x.toFixed(3)+':'+point.z.toFixed(3),level:[235,277,326][level],point,screen:at,peak,width:peak>=2?hi-lo+1:0,flux:samples.reduce((a,b)=>a+b.delta,0),samples:samples.map(q=>+q.delta.toFixed(3))});
   }
  }
  const openings=ct.recessMetadata.map((p,i)=>{
   const point=ct.point(p.e,p.n);if(!point)return {i,absent:true,reason:'not drawn'};const at=ct.project(point,on),distance=c.position.distanceTo(ct.asVector(point)),scale=2/(c.projectionMatrix.elements[5]*on.h),pixel=scale*distance,extent=Math.min(2*p.width/1.3,p.rise*t.exag*.75),extentPixels=extent/pixel;
   if(at.x<0||at.x>=on.w||at.y<0||at.y>=on.h||at.z>1)return {i,absent:true,reason:'outside view',extentPixels};
   const radius=Math.min(65,Math.ceil((2*p.width+p.rise*t.exag)/pixel)+3),x0=Math.max(0,Math.floor(at.x)-radius),y0=Math.max(0,Math.floor(at.y)-radius),x1=Math.min(on.w-1,Math.ceil(at.x)+radius),y1=Math.min(on.h-1,Math.ceil(at.y)+radius);
   const W=x1-x0+1,H=y1-y0+1,delta=new Float32Array(W*H);let peak=0;
   for(let y=0;y<H;y++)for(let x=0;x<W;x++){const d=Math.max(0,ct.luma(noRecess,x+x0,y+y0)-ct.luma(on,x+x0,y+y0));delta[y*W+x]=d;if(Math.hypot(x+x0-at.x,y+y0-at.y)<4)peak=Math.max(peak,d);}
   if(peak<2)return {i,absent:true,peak,extentPixels};const threshold=Math.max(1,peak*.2),seen=new Uint8Array(W*H),components=[];
   for(let start=0;start<delta.length;start++)if(!seen[start]&&delta[start]>=threshold){const stack=[start],pts=[];seen[start]=1;while(stack.length){const k=stack.pop(),x=k%W,y=Math.floor(k/W);pts.push([x+x0,y+y0]);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const a=x+dx,b=y+dy,n=b*W+a;if(a>=0&&a<W&&b>=0&&b<H&&!seen[n]&&delta[n]>=threshold){seen[n]=1;stack.push(n);}}}components.push(pts);}
   const component=components.sort((a,b)=>Math.min(...a.map(q=>Math.hypot(q[0]-at.x,q[1]-at.y)))-Math.min(...b.map(q=>Math.hypot(q[0]-at.x,q[1]-at.y))))[0];if(!component)return {i,absent:true,peak,extentPixels};
   const N=component.length,mx=component.reduce((a,b)=>a+b[0],0)/N,my=component.reduce((a,b)=>a+b[1],0)/N;let xx=0,xy=0,yy=0;for(const [x,y] of component){xx+=(x-mx)**2/N;xy+=(x-mx)*(y-my)/N;yy+=(y-my)**2/N;}const minor=(xx+yy-Math.sqrt((xx-yy)**2+4*xy*xy))/2;
   return {i,absent:false,peak,extentPixels,pixels:N,minorWidth:Math.sqrt(12*(Math.max(0,minor)+1/12)),bbox:[Math.min(...component.map(q=>q[0])),Math.min(...component.map(q=>q[1])),Math.max(...component.map(q=>q[0])),Math.max(...component.map(q=>q[1]))]};
  });
  const scales=[...t.tiles.values()].filter(q=>q.mesh?.visible&&q.mesh.material.defines?.COAST_SHORE).map(q=>q.mesh.material.uniforms.coastPixelScale?.value).filter(v=>v!==undefined);
  ct.zeroFootprint=false;ct.recipe();ct.draw();return {w:on.w,h:on.h,profiles,openings,scales,expectedScale:2/(c.projectionMatrix.elements[5]*on.h),candidates};
 };

})()`;
