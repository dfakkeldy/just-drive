#!/usr/bin/env node
// Actual land programs, rendered triangles, phone budgets and paired pictures. Run with yard-shots.sh.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {recessProbe} from './coast-recess-browser.mjs';
import {installCoastScene} from './coast-scene-browser.mjs';
const [out,first]=process.argv.slice(2),port=process.env.CDP_PORT,base=new URL(first).origin;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
let id=0;const pending=new Map(),errors=[];
ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' '));};
const send=(method,params={})=>new Promise((r,j)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);j(Error('CDP timeout '+method))},300000);pending.set(n,m=>{clearTimeout(timer);r(m)});ws.send(JSON.stringify({id:n,method,params}));});
const read=async expression=>{const m=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(m.error||m.result?.exceptionDetails)throw Error(JSON.stringify(m));return m.result.result.value;};
const capture=async name=>{const m=await send('Page.captureScreenshot',{format:'png'});const b=Buffer.from(m.result.data,'base64');if(name)writeFileSync(`${out}/${name}.png`,b);return b;};
export const views={
 'lookoff-south':'618976,5109274,4,235,-17,64',
 'lookoff-north':'618976,5109274,4,343,-8,62',
 'finlay-recesses':'618725,5110083,4,337,0,55',
 'finlay-recesses-close':'618622,5110218,4,355,12,58',
 'sea-east':'618780,5109300,25,90,-8,55',
 'beach-close':'618770,5109210,2,205,-12,66',
 'whole-coast':'618700,5109450,1800,0,-90,75',
};
const results=[];
async function load(cam,phone=false,hill=1.5,on=true){
 await send('Emulation.setDeviceMetricsOverride',{width:phone?(process.env.COAST_LANDSCAPE?844:390):1400,height:phone?(process.env.COAST_LANDSCAPE?390:844):950,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:`${base}/?cam=${cam}&camground=1&exag=${hill}&coast=${on?1:0}&q=${phone?'low':'high'}&touch=${phone?1:0}&hud=0&radio=0&res=1&shadows=1`});
 let ready=false;
 for(let i=0;i<1200;i++){await sleep(250);if(await read("document.title==='settled' && !!window.mmm?.terrain")){ready=true;break;}}
 assert.ok(ready,'settled '+cam);
 await read('window.requestAnimationFrame=f=>{window.coastFrame=f;return 0}');await sleep(100);
 await read(`(async()=>{
  const THREE=await import('/node_modules/three/build/three.module.js'),{terrain:t,camera:c,renderer:r,coast:k}=mmm;
  let scene=mmm.vehicle.car.root;while(scene.parent)scene=scene.parent;if(!scene.isScene||!scene.getObjectById(t.group.id))throw Error('Expected the real game scene containing the actual terrain');
  window.ct={THREE,t,c,r,k,scene};
  ct.draw=()=>{t.uniforms.time.value=120;const saved=r.info.autoReset;r.info.autoReset=false;r.info.reset();try{mmm.water?.update(c);r.render(scene,c);mmm.water?.settle();mmm.water?.afterRender(c);return {calls:r.info.render.calls,triangles:r.info.render.triangles}}finally{r.info.autoReset=saved}};
  ct.switch=on=>{if(k){k.enabled=on;k.update(c.position);for(const tile of t.tiles.values())for(const mat of [tile.mesh?.material,tile.mirror?.material])if(mat?.uniforms.coastOn)mat.uniforms.coastOn.value=on?1:0;}};
  ct.contact=()=>{
   const ray=new THREE.Raycaster(),meshes=[...t.tiles.values()].filter(q=>q.mesh?.visible).map(q=>q.mesh);t.group.updateMatrixWorld(true);
   const down=(x,z)=>{ray.set(new THREE.Vector3(x,2000,z),new THREE.Vector3(0,-1,0));const drawn=meshes.filter(mesh=>{const p=mesh.geometry.attributes.position,b=mesh.geometry.boundingBox;mesh.geometry.computeBoundingBox();if(x<mesh.geometry.boundingBox.min.x||x>mesh.geometry.boundingBox.max.x||z<mesh.geometry.boundingBox.min.z||z>mesh.geometry.boundingBox.max.z)return false;const box=mesh.geometry.boundingBox,q=(x>(box.min.x+box.max.x)/2?1:0)+(z>(box.min.z+box.max.z)/2?2:0);return mesh.material.uniforms.hideQuad.value.getComponent(q)<.5;});return ray.intersectObjects(drawn,false)[0]?.point.y??null};
   const p=k.mesh.geometry.attributes.position,m=new THREE.Matrix4(),v=new THREE.Vector3();
   let min=Infinity,max=-Infinity,alignedMin=Infinity,count=0,missing=0;
   for(let j=0;j<k.mesh.count;j++){k.mesh.getMatrixAt(j,m);for(let i=0;i<p.count;i++)if(p.getY(i)===0){v.fromBufferAttribute(p,i).applyMatrix4(m).applyMatrix4(k.mesh.matrixWorld);const h=down(v.x,v.z);if(h===null)missing++;else {min=Math.min(min,v.y-h);alignedMin=Math.min(alignedMin,v.y-h+k.blocks[j].burial);max=Math.max(max,v.y-h);count++;}}}
   return {blocks:k.mesh.count,maxDiameter:Math.max(0,...k.blocks.map(b=>b.size*2)),min,max,alignedMin,buried:k.blocks.filter(b=>b.burial>.1).length,count,missing};
  };
  for(let i=0;i<300;i++){t.update(c);mmm.trees?.update(t.drawnFine,c.position);k?.update(c.position);ct.draw();await new Promise(r=>setTimeout(r,60));if(t.pending===0&&!(mmm.trees?.pending??0)&&i>12)break;}
  for(let i=0;i<5;i++)ct.draw();
 })()`);
 assert.ok(await read('ct.r.info.programs.every(p=>!p.diagnostics||p.diagnostics.runnable)'),'programs compile');
 const active=await read("(()=>{const gl=ct.r.getContext();return ct.r.info.programs.filter(p=>(gl.getShaderSource(p.fragmentShader)??'').includes('#define COAST_SHORE')).map(p=>Array.from({length:gl.getProgramParameter(p.program,gl.ACTIVE_UNIFORMS)},(_,i)=>gl.getActiveUniform(p.program,i)).filter(u=>u.type===gl.SAMPLER_2D).map(u=>u.name))})()");
 await coastSamplers(active,phone);

}
const reject=(name,check,bad)=>{assert.throws(()=>check(bad),undefined,'mutation '+name+' must be rejected');console.log('REJECTED '+name);};
// The open paved-lot layer (on by default since #195) adds its own tPaved to the same land program; it is not a coast
// sampler. Every other active sampler counts against the coast's limit, and a program over that limit must still be rejected.
async function coastSamplers(active,phone){
 const paved=await read('!!ct.t.paved');
 const cap=phone?4:7,check=(a,exclude=paved)=>assert.ok(a.every(p=>p.filter(n=>!(exclude&&n==='tPaved')).length<=cap),'no added active coast samplers '+JSON.stringify(a));
 check(active);reject('extra coast sampler',check,[Array.from({length:cap+1},(_,i)=>'t'+i)]);
 // Where a program sits at the cap with tPaved, counting tPaved must fail: the exclusion is what lets it pass.
 if(paved&&active.some(p=>p.includes('tPaved')&&p.length===cap+1))reject('tPaved counted as a coast sampler',a=>check(a,false),active);
}
const treeAudit = `(async()=>{
    const t=ct.t,trees=mmm.trees,m=t.manifest,keys=[];
    for(const key of m.trees.tiles){const [i,j]=key.split('_').map(Number),x=m.origin[0]+i*256-m.village[0],z=m.village[1]-m.origin[1]+j*256;if(t.coast.intersects(x,z,256)){keys.push(key);const tile=t.tile(8,i,j);if(tile)t.request(tile,0);}}
    for(let i=0;i<500&&t.pending;i++){t.update(ct.c);await new Promise(r=>setTimeout(r,30));}
    for(const key of keys){if(trees.tiles.get(key)==='loading'){for(let i=0;i<100&&trees.tiles.get(key)==='loading';i++)await new Promise(r=>setTimeout(r,20));}if(!trees.tiles.has(key))await trees.load(key);}
    const counts={checked:0,rejected:0,grounded:0};for(const a of trees.coastAudit.values())for(const k of Object.keys(counts))counts[k]+=a[k];
    let retained=0,sea=0,beach=0,cliff=0,float=0;
    for(const tile of trees.tiles.values())if(tile!=='loading')for(const batch of tile.batches){const a=batch.matrices;for(let i=0;i<a.length;i+=16){const x=a[i+12],z=a[i+14];if(!t.coast.contains(x,z))continue;retained++;const h=t.heightAt(x,z),raw=-.2+(h+.2)/t.exag,dx=(t.heightAt(x+2,z)-t.heightAt(x-2,z))/(4*t.exag),dz=(t.heightAt(x,z+2)-t.heightAt(x,z-2))/(4*t.exag),slope=Math.hypot(dx,dz);if(raw<=.75)sea++;if(t.coast.weights(x,z,raw,slope)[3]>=.15)beach++;if(!t.coast.treeAllowed(x,z,raw,slope))cliff++;if(Math.abs(a[i+13]+.25-t.meshHeightAt(x,z))>.01)float++;}}

    // For this full instance audit render the actual finest meshes that carry single trees.
    // Restrict each ray to its real indexed cell for speed, then restore the geometry's draw range.
    const keySet=new Set(keys),visible=[];
    for(const q of t.tiles.values())if(q.mesh){visible.push([q,q.mesh.visible]);q.mesh.visible=q.level===8&&keySet.has(q.i+'_'+q.j);if(q.mesh.visible)q.mesh.material.uniforms.hideQuad.value.set(0,0,0,0);}
    t.group.updateMatrixWorld(true);ct.r.render(ct.scene,ct.c);
    const ray=new ct.THREE.Raycaster();let rays=0,misses=0,maxRayError=0;
    for(const tile of trees.tiles.values())if(tile!=='loading')for(const batch of tile.batches){const a=batch.matrices;for(let i=0;i<a.length;i+=16){const x=a[i+12],z=a[i+14];if(!t.coast.contains(x,z))continue;
      const q=t.find(x,z),mesh=q?.mesh;if(!mesh?.visible){misses++;continue;}
      const g=mesh.geometry,seg=Math.round(Math.sqrt(g.attributes.position.count))-3,n=seg+3,ca=Math.max(0,Math.min(seg-1,Math.floor((x-q.x0)*seg/q.size))),cb=Math.max(0,Math.min(seg-1,Math.floor((z-q.z0)*seg/q.size))),old={...g.drawRange};
      g.setDrawRange(((cb+1)*(n-1)+ca+1)*6,6);ray.set(new ct.THREE.Vector3(x,2000,z),new ct.THREE.Vector3(0,-1,0));const hit=ray.intersectObject(mesh,false)[0];g.setDrawRange(old.start,old.count);
      if(!hit)misses++;else{rays++;maxRayError=Math.max(maxRayError,Math.abs(a[i+13]+.25-hit.point.y));}
    }}
    for(const [q,on] of visible)q.mesh.visible=on;
    t.update(ct.c);trees.update(t.drawnFine,ct.c.position);ct.k.update(ct.c.position);ct.draw();return {...counts,retained,sea,beach,cliff,float,rays,misses,maxRayError};
  })()`;

async function isolatedMaterialProfile(phone){
   const expression=String.raw`(async()=>{
    const {LAND_LIGHT,COAST_SURFACE}=await import('/src/shaders.ts'),{coastRecessUniforms}=await import('/src/coast-site.ts'),T=ct.THREE,r=ct.r;
    const mat=new T.ShaderMaterial({defines:{COAST_SHORE:1,...(mmm.low?{LOW:1}:{})},
      vertexShader:'varying vec4 vCoast;uniform vec4 mask;void main(){vCoast=mask;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:LAND_LIGHT+COAST_SURFACE+'uniform vec2 point;uniform float height;uniform float probe;uniform float probeDistance;void main(){\n#ifndef LOW\ncoastPixel=vec3(0.);\n#endif\nvec3 c=vec3(.12,.19,.04),n=normalize(vec3(-1.,.1,0.));coastSurface(point,height,.5,probeDistance,c,n);vec3 result=mix(c,n*.5+.5,step(.5,probe));\n#ifndef LOW\nif(probe>1.5)result=vec3(coastBed(height).y/17.);\n#endif\ngl_FragColor=vec4(result,1.);}',
      uniforms:{...coastRecessUniforms(),seaLevel:{value:-.2},coastOrigin:{value:new T.Vector2(6271,5699)},coastExag:{value:1.5},coastOn:{value:1},mask:{value:new T.Vector4()},point:{value:new T.Vector2()},height:{value:0},probe:{value:0},probeDistance:{value:30}}});
    const scene=new T.Scene(),camera=new T.Camera(),quad=new T.Mesh(new T.PlaneGeometry(2,2),mat),target=new T.WebGLRenderTarget(1,1),px=new Uint8Array(4);scene.add(quad);
    const sample=(e,n,h,mask,probe=0,distance=30)=>{mat.uniforms.probeDistance.value=distance;mat.uniforms.probe.value=probe;mat.uniforms.point.value.set(e-624271,5103301-n);mat.uniforms.height.value=-.2+(h+.2)*1.5;mat.uniforms.mask.value.set(...mask);r.setRenderTarget(target);r.render(scene,camera);r.readRenderTargetPixels(target,0,0,1,1,px);return [...px].slice(0,3)};
    const white=sample(618840,5109300,2.66,[1,0,0,0]),bench=sample(618862,5109300,18.55,[0,0,0,0]);
    const dry=sample(618700,5109080,1.97,[0,0,0,1]),wet=sample(618700,5109080,.2,[0,0,0,1]);
    const completeShader=mat.fragmentShader;
    const span=a=>Math.max(...a)-Math.min(...a);
    const profile=()=>{const colour=[],normal=[],width=[];for(let h=0;h<=17;h+=.25){colour.push(sample(618680,5110260,h,[0,1,0,0])[0]);normal.push(sample(618680,5110260,h,[0,1,0,0],1)[1]);width.push(sample(618680,5110260,h,[0,1,0,0],2)[0]*17/255);}return {colour:span(colour),normal:span(normal),thin:Math.min(...width),thick:Math.max(...width)}};
    const relief=mmm.low?null:profile();let noRelief=null,regular=null;
    if(!mmm.low){mat.fragmentShader=completeShader.replace('normal = normalize(normal + bedUp * (top * 0.65 - under * 0.27) * relief * w.y);','normal = normal;');mat.needsUpdate=true;noRelief=profile();}
    if(!mmm.low){mat.fragmentShader=completeShader.replace('vec3 coastBed(float strata) {','vec3 coastBed(float strata) { if(strata> -10000.0)return vec3(fract(strata*.2),5.0,.5);');mat.needsUpdate=true;regular=profile();}
    mat.fragmentShader=completeShader;mat.needsUpdate=true;
    const strandPoints=[];for(let e=618700;e<=618840;e+=20)for(const h of [.30,.78])strandPoints.push([e,5109200,h]);
    const strandOn=strandPoints.map(p=>sample(...p,[0,0,0,1])[0]);
    mat.fragmentShader=completeShader.replace('float strand =','float strand = 0.0 *');mat.needsUpdate=true;
    const strandOff=strandPoints.map(p=>sample(...p,[0,0,0,1])[0]);
    const strandDelta=Math.max(...strandOn.map((v,i)=>strandOff[i]-v));
    r.setRenderTarget(null);quad.geometry.dispose();mat.dispose();target.dispose();ct.draw();return {white,bench,dry,wet,relief,noRelief,regular,strandDelta,strandOn,strandOff};
   })()`;
   new Function(`return (${expression});`);
   const colours=await read(expression);
   console.log('ISOLATED DESKTOP PROFILE',phone,JSON.stringify(colours));results.push({phone,colours});
   assert.ok(colours.white[0]>130&&colours.bench[1]>colours.bench[0],'isolated mineral palette and and green bench');
   assert.ok(colours.dry[0]>colours.wet[0]*1.4,'isolated dry/wet sand');
   if(!phone){const reliefCheck=x=>assert.ok(x.normal>x.colour&&x.normal>15&&x.thick>x.thin*4,'relief-led uneven beds');reliefCheck(colours.relief);reject('bed relief removed',reliefCheck,colours.noRelief);reject('regular bed thickness',reliefCheck,colours.regular);const strandCheck=a=>assert.ok(Math.max(...a.map((v,i)=>colours.strandOff[i]-v))>2,'actual thin strand lines');strandCheck(colours.strandOn);reject('strand lines removed',strandCheck,colours.strandOff);}

}

async function materialCheck(phone,onlyRecesses=false){
 await read(recessProbe);await read(installCoastScene);
 const live=await read('ct.liveDetails('+onlyRecesses+')');results.push({phone,onlyRecesses,live});console.log('LIVE MATERIAL',phone,JSON.stringify(live));
 const check=rows=>assert.ok(rows.length===(onlyRecesses?5:8)&&rows.every(r=>r.visible&&r.delta>=3&&r.adjacent-r.on>=2),'actual game '+(onlyRecesses?'five recesses':'five recesses and three seams')+' darker: paired delta >=3, adjacent >=2');
 const connected=x=>assert.ok(x.samples.length>0&&x.maxDelta>=3,'current-camera real terrain call contributes to actual land pixels');connected(live.connection.normal);if(phone)reject('current live call removed under LOW',connected,live.connection.noLow);else connected(live.connection.noLow);reject('current live call removed outright',connected,live.connection.noCall);
 check(live.normal);
 if(phone)reject('real terrain coast call removed under LOW',check,live.noLow);else check(live.noLow);
 reject('real terrain coast call removed outright',check,live.noCall);
}

async function phonePictures(){
 const poses={a:views['finlay-recesses'],b:views['lookoff-north'],c:'618617,5110198,10,0,6,65'};
 const quality=x=>{const visible=x.profiles.filter(p=>p.peak>=2);assert.ok(visible.length>=5,'measurable seam profiles at the breakwater');assert.ok(visible.every(p=>p.width>=2),'seams have at least two pixel samples across quarter-contrast support');assert.ok(x.openings.every(p=>p.absent||p.minorWidth>=3),'openings absent or minor pixel width >=3');assert.ok(x.openings.every(p=>p.absent||p.extentPixels>=3),'sub-three-pixel openings fade out');};
 for(const landscape of [false,true])for(const [pose,cam] of Object.entries(poses)){
  if(landscape)process.env.COAST_LANDSCAPE='1';else delete process.env.COAST_LANDSCAPE;
  await load(cam,true);await read(recessProbe);await read(installCoastScene);
  const profile=await read('ct.phoneProfile()');results.push({picture:pose,landscape,profile});console.log('PHONE PROFILE',pose,landscape,JSON.stringify({...profile,candidates:undefined,profiles:profile.profiles.map(p=>({level:p.level,peak:p.peak,width:p.width,flux:p.flux}))}));
  await capture('pass4-'+pose+'-'+(landscape?'landscape':'portrait'));
  assert.ok(profile.scales.length>0&&profile.scales.every(v=>Math.abs(v-profile.expectedScale)<1e-12),'active coast footprint matches the camera and buffer');
  if(pose==='a')quality(profile);
  if(pose==='a'){
   const zero=await read('ct.phoneProfile("zero")');reject('footprint uniform forced zero',quality,zero);results.push({landscape,zero});
   if(landscape){const noFade=await read('ct.phoneProfile("noFade")');reject('opening fade removed',quality,noFade);results.push({landscape,noFade});}
   const candidates=profile.candidates;
   const shifted=[];for(let step=1;step<=2;step++){
    await read('(async()=>{ct.c.position.addScaledVector(new ct.THREE.Vector3(1,0,0).applyQuaternion(ct.c.quaternion),.5);await ct.settle()})()');
    const moved=await read('ct.phoneProfile("normal",'+JSON.stringify(candidates)+')');quality(moved);shifted.push(moved);await capture('pass4-a-'+(landscape?'landscape':'portrait')+'-side-'+step);
   }
   const tracked=profile.profiles.map((p,i)=>({i,key:p.key,peak:p.peak,fluxes:[p.flux,...shifted.map(s=>s.profiles.find(q=>q.key===p.key)?.flux??NaN)]})).filter(p=>p.peak>=3&&p.fluxes.every(Number.isFinite));
   assert.ok(tracked.length>=3&&tracked.every(p=>Math.min(...p.fluxes)>=Math.max(...p.fluxes)*.45),'half-metre sideways proxy: no clear seam vanishes');console.log('SIDEWAYS',landscape,JSON.stringify(tracked));results.push({landscape,tracked});
   await send('Emulation.setDeviceMetricsOverride',{width:landscape?844:390,height:landscape?390:844,deviceScaleFactor:2,mobile:false});
   const sizing=await read('(async()=>{const ratio=ct.r.getPixelRatio(),size=ct.r.getSize(new ct.THREE.Vector2()),fov=ct.c.fov;const sample=()=>{ct.draw();const q=[...ct.t.tiles.values()].find(q=>q.mesh?.visible&&q.mesh.material.uniforms.coastPixelScale);return {actual:q.mesh.material.uniforms.coastPixelScale.value,expected:2/(ct.c.projectionMatrix.elements[5]*ct.r.getDrawingBufferSize(new ct.THREE.Vector2()).y)}};const savedChoice=localStorage.getItem("mmm.picture"),panel=document.createElement("div"),before=document.createElement("button");panel.style.display="none";panel.append(before);document.body.append(panel);localStorage.setItem("mmm.picture","fast");const {pictureSetting}=await import("/src/picture.ts"),control=pictureSetting(ct.r,panel,before);const original=sample();panel.querySelector("[data-picture=sharp]").click();const picture=sample();panel.querySelector("[data-picture=fast]").click();const measured=control.measuring;panel.remove();if(savedChoice===null)localStorage.removeItem("mmm.picture");else localStorage.setItem("mmm.picture",savedChoice);ct.r.setPixelRatio(ratio);ct.r.setSize(size.y,size.x,false);ct.c.aspect=size.y/size.x;ct.c.updateProjectionMatrix();const resize=sample();ct.c.fov=70;ct.c.updateProjectionMatrix();const fovChanged=sample();ct.r.setSize(size.x,size.y,false);ct.c.aspect=size.x/size.y;ct.c.fov=fov;ct.c.updateProjectionMatrix();ct.draw();return {original,picture,resize,fovChanged,measured}})()');
   assert.ok(!sizing.measured&&[sizing.original,sizing.picture,sizing.resize,sizing.fovChanged].every(p=>Math.abs(p.actual-p.expected)<1e-12)&&Math.abs(sizing.picture.actual-sizing.original.actual/2)<1e-12,'real draw callback follows resize, Picture pixel ratio and FOV');console.log('SIZING',JSON.stringify(sizing));results.push({landscape,sizing});await send('Emulation.setDeviceMetricsOverride',{width:landscape?844:390,height:landscape?390:844,deviceScaleFactor:1,mobile:false});
  }
 }
 delete process.env.COAST_LANDSCAPE;
}

async function recessCheck(phone,hill){
   const recess=await read(recessProbe);
   console.log('RECESS DIAGNOSTIC',phone,hill,JSON.stringify(recess));results.push({phone,hill,recess});
   const contactCheck=x=>assert.ok(x.ray&&x.ray.mask[1]>.4&&Math.abs(x.ray.y-x.expectedY)<.03,'opening centre on drawn cliff triangle within 3cm');
   for(const row of recess.rows)contactCheck(row);
   await materialCheck(phone,true);
   console.log('PASS RECESSES',phone,hill);
}

async function beachCheck(){
  await capture('pass4-beach-seam-after');
  const beachInputs=await read(`(()=>{const T=ct.THREE,ray=new T.Raycaster(),cover=ct.t.uniforms.tCover.value.image,canvas=new OffscreenCanvas(cover.width,cover.height),ctx=canvas.getContext("2d"),rect=ct.t.uniforms.coverRect.value;ctx.drawImage(cover,0,0);ct.t.group.updateMatrixWorld(true);return [[200,500],[200,550],[200,600],[450,390],[450,440],[600,450]].map(([sx,sy])=>{ray.setFromCamera(new T.Vector2(sx/1400*2-1,1-sy/950*2),ct.c);const hit=ray.intersectObjects([...ct.t.tiles.values()].filter(q=>q.mesh?.visible).map(q=>q.mesh),false).find(hit=>{hit.object.geometry.computeBoundingBox();const box=hit.object.geometry.boundingBox;const p=hit.point,q=(p.x>=(box.min.x+box.max.x)/2?1:0)+(p.z>=(box.min.z+box.max.z)/2?2:0);return hit.object.material.uniforms.hideQuad.value.getComponent(q)<.5});if(!hit)return {sx,sy};const g=hit.object.geometry,f=hit.face,p=g.attributes.position,a=new T.Vector3().fromBufferAttribute(p,f.a),b=new T.Vector3().fromBufferAttribute(p,f.b),c=new T.Vector3().fromBufferAttribute(p,f.c),bary=T.Triangle.getBarycoord(hit.point,a,b,c,new T.Vector3()),mask=new T.Vector4(0,0,0,0);for(const [idx,w] of [[f.a,bary.x],[f.b,bary.y],[f.c,bary.z]])mask.addScaledVector(new T.Vector4().fromBufferAttribute(g.attributes.coast,idx),w);const nm=hit.object.material.uniforms.tNormal.value.image,x=Math.max(0,Math.min(256,Math.round(hit.uv.x*256))),y=Math.max(0,Math.min(256,Math.round(hit.uv.y*256))),k=(y*257+x)*4;const cx=Math.max(0,Math.min(cover.width-1,Math.floor((hit.point.x-rect.x)*rect.z*cover.width))),cy=Math.max(0,Math.min(cover.height-1,Math.floor((hit.point.z-rect.y)*rect.w*cover.height)));return {sx,sy,coverClass:ctx.getImageData(cx,cy,1,1).data[2],point:hit.point.toArray(),mask:mask.toArray(),normalMap:Array.from(nm.data.slice(k,k+4)),hull:hit.object.material.uniforms.hull.value,grassFocus:hit.object.material.uniforms.grassFocus?.value?.toArray()}})})()`);
  results.push({beachInputs});console.log('BEACH INPUTS',JSON.stringify(beachInputs));
  await read(`ct.beachPixels=()=>{ct.draw();const gl=ct.r.getContext(),size=ct.r.getDrawingBufferSize(new ct.THREE.Vector2()),p=new Uint8Array(4);return [[200,500],[200,550],[200,600],[450,390],[450,440],[600,450]].map(([x,y])=>{gl.readPixels(x,size.y-y-1,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p].slice(0,3)})}`);
  const normal=await read('ct.beachPixels()');
  const shade=await read('(()=>{const u=ct.t.uniforms.grassFocus.value,z=u.z;u.z=0;ct.draw();return z})()'),off=await read('ct.beachPixels()');
  await capture('pass4-beach-grass-shade-off');await read('ct.t.uniforms.grassFocus.value.z='+shade+';ct.draw()');
  await read(`ct.savedCoast=[];for(const q of ct.t.tiles.values())for(const m of [q.mesh?.material,q.mirror?.material])if(m?.defines?.COAST_SHORE){ct.savedCoast.push([m,m.fragmentShader]);m.fragmentShader=m.fragmentShader.replace('ring *= 1.0 - smoothstep(0.05,0.20,vCoast.w);','ring *= 1.0;');m.needsUpdate=true;}`);
  const broken=await read('ct.beachPixels()');await capture('pass4-beach-grass-guard-removed');
  await read('for(const [m,s] of ct.savedCoast){m.fragmentShader=s;m.needsUpdate=true;}ct.draw()');
  const check=p=>assert.ok(Math.max(...p.flatMap((a,i)=>a.map((v,j)=>Math.abs(v-off[i][j]))))<=1,'bare beach pixels unaffected by grass-root shading');
  check(normal);reject('beach grass shading guard removed',check,broken);results.push({beachShade:{normal,off,broken,shade}});console.log('BEACH SHADE',JSON.stringify({normal,off,broken,shade}));
}

async function blockCheck(phone){
 const colours=await read(`(async()=>{
  const T=ct.THREE,{COAST_BLOCK_VERT,COAST_BLOCK_FRAG}=await import('/src/coast-block-shaders.ts'),r=ct.r;
  const uniforms={sunDir:{value:new T.Vector3(.2,1,.2).normalize()},sunColor:{value:new T.Color(1,1,1)},skyColor:{value:new T.Color(.2,.2,.2)},fogColor:{value:new T.Color(.5,.5,.5)},fogDensity:{value:0},time:{value:0},seaLevel:{value:-.2},coastExag:{value:1.5}};
  const mat=new T.ShaderMaterial({clipping:ct.k.mesh.material.clipping,vertexShader:COAST_BLOCK_VERT,fragmentShader:COAST_BLOCK_FRAG,defines:{LOW:1},uniforms});
  const geo=ct.k.mesh.geometry.clone();geo.setAttribute('coastFoot',new T.InstancedBufferAttribute(new Float32Array(1),1));
  const mesh=new T.InstancedMesh(geo,mat,1),scene=new T.Scene(),camera=new T.OrthographicCamera(-1.6,1.6,1.6,-1.6,.1,30),target=new T.WebGLRenderTarget(64,64),px=new Uint8Array(64*64*4);scene.add(mesh);mesh.frustumCulled=false;
  const sample=y=>{geo.attributes.coastFoot.setX(0,y+.2);geo.attributes.coastFoot.needsUpdate=true;mesh.setMatrixAt(0,new T.Matrix4().makeTranslation(0,y,0));mesh.instanceMatrix.needsUpdate=true;camera.position.set(3,y+4,5);camera.lookAt(0,y+.45,0);camera.updateMatrixWorld();r.setRenderTarget(target);r.setClearColor(0,0);r.render(scene,camera);r.readRenderTargetPixels(target,0,0,64,64,px);let n=0,a=[0,0,0];for(let i=0;i<px.length;i+=4)if(px[i+3]){n++;for(let j=0;j<3;j++)a[j]+=px[i+j];}return {n,rgb:a.map(v=>v/Math.max(1,n))}};
  const clear=new T.Color();r.getClearColor(clear);const alpha=r.getClearAlpha();
  const dry=sample(5),wet=sample(.3);mat.fragmentShader=COAST_BLOCK_FRAG.replace('vec3(.721,.694,.617)','vec3(.25,.38,.55)');mat.needsUpdate=true;const blue=sample(5);mat.fragmentShader=COAST_BLOCK_FRAG.replace('float damp=','float damp=0.0*');mat.needsUpdate=true;const noDamp=sample(.3);
  const oldPlanes=r.clippingPlanes,broken=mat.clone();broken.clipping=false;delete broken.uniforms.clippingPlanes;broken.defines={LOW:1,BROKEN_CLIP_CONTROL:1};
  r.clippingPlanes=[new T.Plane(new T.Vector3(0,1,0),-5.6)];mesh.material=broken;const noClip=sample(5);mesh.material=mat;const clipped=sample(5);r.clippingPlanes=oldPlanes;
  r.setRenderTarget(null);r.setClearColor(clear,alpha);mesh.dispose();geo.dispose();mat.dispose();broken.dispose();target.dispose();ct.draw();return {dry,wet,noDamp,blue,noClip,clipped};
 })()`);
 const warm=x=>assert.ok(x.n>100&&x.rgb[0]>x.rgb[2]+2&&x.rgb[0]>x.rgb[1],'warm gypsum palette');warm(colours.dry);reject('blue gypsum palette',warm,colours.blue);
 const damp=x=>assert.ok(x.rgb[0]<colours.dry.rgb[0]-.5,'damp foot band');damp(colours.wet);reject('damp band removed',damp,colours.noDamp);
 const clip=x=>assert.ok(x.n<colours.dry.n*.85&&x.n>10,'mirror clips the submerged portion');clip(colours.clipped);reject('mirror clipping disabled',clip,colours.noClip);console.log('BLOCK PALETTE',phone,JSON.stringify(colours));results.push({phone,blockColours:colours});
}

try{
 await send('Runtime.enable');await send('Page.enable');
 if(process.env.COAST_PHASE==='pass4-accept'){await phonePictures();for(const phone of [false,true]){await load(views['finlay-recesses'],phone);await materialCheck(phone);}}else if(process.env.COAST_PHASE==='pass4-pictures'){await phonePictures();}else if(process.env.COAST_PHASE==='pass4-live'){for(const phone of [false,true]){await load(views['finlay-recesses'],phone);await materialCheck(phone);await capture('pass4-live-'+(phone?'phone':'desktop'));}}else if(process.env.COAST_PHASE==='pass3-diagnose'){
  for(const phone of [false,true]){await load(views['finlay-recesses'],phone);if(!phone)await isolatedMaterialProfile(false);await materialCheck(phone);await recessCheck(phone,1.5);}
  await load(views['beach-close']);await capture('pass3-beach-seam-current');
  for(const variant of ['no-shadow','flat-normal','no-coast']){
   await read(`(()=>{ct.saved=[];for(const q of ct.t.tiles.values())for(const mat of [q.mesh?.material,q.mirror?.material])if(mat?.defines?.COAST_SHORE){ct.saved.push([mat,mat.fragmentShader]);mat.fragmentShader=mat.fragmentShader.replace(${JSON.stringify(variant==='no-shadow'?'diff *= sunShadow(vWorld);':variant==='flat-normal'?'coastSurface(p, vGround, fine, dist, albedo, n);':'coastSurface(p, vGround, fine, dist, albedo, n);')},${JSON.stringify(variant==='no-shadow'?'diff *= 1.0;':variant==='flat-normal'?'coastSurface(p, vGround, fine, dist, albedo, n); n=normalize(mix(n,vec3(0.,1.,0.),vCoast.w));':'')});mat.needsUpdate=true;}ct.draw()})()`);
   await capture('pass3-beach-'+variant);await read('for(const [m,s] of ct.saved){m.fragmentShader=s;m.needsUpdate=true;}ct.draw()');
  }
 }else if(process.env.COAST_PHASE==='pass3-pictures'){await load(views['finlay-recesses'],true);await capture('finlay-recesses-phone-after');await load(views['beach-close']);await capture('pass3-beach-seam-after');}else if(process.env.COAST_PHASE==='pass3-before'){await load(views['finlay-recesses'],true);await capture('finlay-recesses-phone-before');await load(views['beach-close']);await capture('pass3-beach-seam-before');}else if(process.env.COAST_PHASE==='materials'){for(const phone of [false,true]){await load(views['beach-close'],phone);if(!phone)await isolatedMaterialProfile(false);await materialCheck(phone);await blockCheck(phone);}}else if(process.env.COAST_PHASE==='trees'){
  for(const phone of [false,true])for(const hill of [1,1.5,2,2.5]){
   await load(views['sea-east'],phone,hill);const trees=await read(treeAudit);
   console.log('TREE DIAGNOSTIC',phone,hill,JSON.stringify(trees));
   assert.ok(trees.checked>4000&&trees.rejected>0&&trees.retained>4000&&trees.sea===0&&trees.beach===0&&trees.cliff===0&&trees.float===0&&trees.rays===trees.retained&&trees.misses===0&&trees.maxRayError<.01,'every retained tree on actual drawn triangles');
   console.log('TREE RAYS',phone,hill,JSON.stringify(trees));results.push({phone,hill,trees});
  }
 }else if(process.env.COAST_PHASE==='pass2-final'){for(const phone of [false,true]){await load(views['beach-close'],phone);if(!phone)await isolatedMaterialProfile(false);await materialCheck(phone);await blockCheck(phone);}for(const name of ['finlay-recesses','finlay-recesses-close','lookoff-north','beach-close','sea-east']){await load(views[name]);await capture(name+'-after');results.push({picture:name,stats:await read('ct.draw()')});}await load(views['lookoff-south'],true);await capture('phone-lookoff-after');results.push({picture:'phone-lookoff',stats:await read('ct.draw()')});}else if(process.env.COAST_PHASE==='pass2-pictures'){
  for(const name of ['finlay-recesses','finlay-recesses-close','lookoff-north','beach-close','sea-east']){
   await load(views[name]);await capture(name+'-after');const stats=await read('({blocks:ct.k.mesh.count,budget:ct.draw(),position:ct.c.position.toArray()})');results.push({picture:name,stats});console.log('PICTURE',name,JSON.stringify(stats));
  }
  await load(views['lookoff-south'],true);await capture('phone-lookoff-after');results.push({picture:'phone-lookoff',stats:await read('ct.draw()')});
 }else if(process.env.COAST_PHASE==='pictures'){
  for(const [name,cam] of Object.entries(views))for(const on of [false,true]){
   await load(cam,false,1.5,on);if(on&&name==='finlay-recesses'){await isolatedMaterialProfile(false);await materialCheck(false);}await capture(`${name}-${on?'after':'before'}`);const stats=await read('({blocks:ct.k?.mesh.count,position:ct.c.position.toArray(),budget:ct.draw()})');results.push({picture:name,on,stats});console.log('PICTURE',name,on,JSON.stringify(stats));
  }
  for(const on of [false,true]){await load(views['lookoff-south'],true,1.5,on);if(on)await materialCheck(true);await capture(`phone-lookoff-${on?'after':'before'}`);const stats=await read('({blocks:ct.k?.mesh.count,position:ct.c.position.toArray(),budget:ct.draw()})');results.push({picture:'phone-lookoff',on,stats});console.log('PICTURE phone-lookoff',on,JSON.stringify(stats));}
 }else{
  await load(views['beach-close']);await beachCheck();
  for(const phone of [false,true]){
   await load(views['lookoff-south'],phone);
   const budget=await read(`(()=>{const result={};for(const on of [false,true]){ct.switch(on);for(let i=0;i<3;i++)ct.draw();result[on?'with':'without']=ct.draw();}ct.switch(true);return {...result,extra:{calls:result.with.calls-result.without.calls,triangles:result.with.triangles-result.without.triangles},blocks:ct.k.mesh.count}})()`);
   results.push({mode:phone?'phone':'desktop',budget});console.log('BUDGET',phone,JSON.stringify(budget));
   const check=b=>assert.ok(b.extra.calls>=1&&b.extra.calls<=(phone?1:2)&&b.extra.triangles<=1760&&b.blocks>=24,'local draw/triangle budget');check(budget);await read('ct.extra=ct.k.mesh.clone();ct.k.group.add(ct.extra);ct.draw()');
   const tooMany=await read('(()=>{const n=ct.draw();return {extra:{calls:n.calls-'+budget.without.calls+',triangles:n.triangles-'+budget.without.triangles+'},blocks:ct.k.mesh.count}})()');
   reject('extra block draw',check,tooMany);await read('ct.k.group.remove(ct.extra);ct.extra.dispose();ct.draw()');
   const away=await read("(()=>{const mesh=ct.k.mesh,callback=mesh.onBeforeRender;let submitted=0;mesh.onBeforeRender=function(...args){submitted++;return callback.apply(this,args)};const q=ct.c.quaternion.clone();ct.c.rotateY(Math.PI);ct.c.updateMatrixWorld();const counts={};for(const on of [false,true]){ct.switch(on);for(let i=0;i<3;i++)ct.draw();counts[on?'with':'without']=ct.draw();}const awaySubmitted=submitted;mesh.onBeforeRender=callback;ct.c.quaternion.copy(q);ct.c.updateMatrixWorld();ct.switch(true);ct.draw();return {counts,submitted:awaySubmitted,blocks:ct.k.mesh.count,culled:ct.k.mesh.frustumCulled}})()");assert.ok(away.blocks>0&&away.culled&&away.submitted===0,'offscreen coast batch adds zero draws');console.log('OFFSCREEN',phone,JSON.stringify(away));
   const masks=await read(`(async()=>{const {coastWeights}=await import('/src/coast-site.ts');return {gypsum:coastWeights(618840,5109300,2.66,1.315),bench:coastWeights(618862,5109300,18.55,.125),beach:coastWeights(618700,5109080,1.97,.124),finlay:coastWeights(618602,5110261,8.255,1.435),away:coastWeights(624000,5103000,20,1)}})()`);
   const maskCheck=m=>{assert.ok(m.gypsum[0]>.7,'gypsum zone');assert.ok(m.bench.every(x=>x===0),'green bench');assert.ok(m.beach[3]>.8,'beach');assert.ok(m.finlay[1]>.8,'bedded Finlay');assert.ok(m.away.every(x=>x===0),'no away mask');};maskCheck(masks);console.log('MASKS',JSON.stringify(masks));
   reject('missing gypsum',maskCheck,{...masks,gypsum:[0,0,0,0]});reject('paint green bench',maskCheck,{...masks,bench:[1,0,0,0]});reject('paint unrelated ground',maskCheck,{...masks,away:[1,0,0,0]});
   if(!phone)await isolatedMaterialProfile(false);await materialCheck(phone);await blockCheck(phone);
   // This reads authored attributes and linked WebGL sources, not an imitation of the material function.
   const programs=await read(`(()=>{const gl=ct.r.getContext(),tiles=[...ct.t.tiles.values()].filter(t=>t.mesh?.material.defines.COAST_SHORE),sample=tiles.find(t=>t.mesh.visible);return {tiles:tiles.length,attributes:sample?.mesh.geometry.attributes.coast.count,programs:ct.r.info.programs.map(p=>gl.getShaderSource(p.fragmentShader)).filter(s=>s.includes('#define COAST_SHORE')).map(s=>({low:s.includes('#define LOW'),samplers:[...s.matchAll(/uniform sampler2D (\\w+)/g)].map(m=>m[1])}))}})()`);
   console.log('PROGRAMS',phone,JSON.stringify(programs));assert.ok(programs.attributes>0&&programs.programs.length>0);
   const active=await read("(()=>{const gl=ct.r.getContext();return ct.r.info.programs.filter(p=>(gl.getShaderSource(p.fragmentShader)??'').includes('#define COAST_SHORE')).map(p=>Array.from({length:gl.getProgramParameter(p.program,gl.ACTIVE_UNIFORMS)},(_,i)=>gl.getActiveUniform(p.program,i)).filter(u=>u.type===gl.SAMPLER_2D).map(u=>u.name))})()");console.log('ACTIVE SAMPLERS',phone,JSON.stringify(active));await coastSamplers(active,phone);
   // An inland picture must stay byte-for-byte identical with the coast path enabled/disabled.
   await load('625200,5103900,30,30,-14,62',phone);
   await read('ct.switch(false);ct.draw()');const a=await capture();await read('ct.switch(true);ct.draw()');const b=await capture();
   assert.ok(a.equals(b),'unrelated picture pixel equal');writeFileSync(`${out}/unrelated-${phone?'phone':'desktop'}.png`,a);console.log('PASS unrelated picture pixel equal',phone);
   await read('ct.c.position.y+=1;ct.c.updateMatrixWorld();ct.draw()');const changed=await capture();
   reject('unrelated image changed',x=>assert.ok(a.equals(x),'unrelated image'),changed);await read('ct.c.position.y-=1;ct.c.updateMatrixWorld();ct.draw()');
  }
  for(const phone of [false,true])for(const hill of [1,1.5,2,2.5]){
   await load('618755,5109170,11,80,-18,72',phone,hill);
   const contact=await read('ct.contact()');console.log('CONTACT',phone,hill,JSON.stringify(contact));results.push({phone,hill,contact});
   const check=x=>assert.ok(x.blocks>=24&&x.maxDiameter>3&&x.count>100&&x.missing===0&&x.max<.045&&x.alignedMin>-.25&&x.buried>=2,'block feet on drawn triangles');check(contact);
   await read('ct.k.mesh.position.y=1;ct.k.mesh.updateMatrixWorld(true)');
   // The matrix used by the contact check also needs the batch's world transform.
   const bad=await read('ct.contact()');reject('floating blocks',check,bad);await read('ct.k.mesh.position.y=0;ct.k.mesh.updateMatrixWorld(true)');check(await read('ct.contact()'));
   await load(views['finlay-recesses'],phone,hill);
   await recessCheck(phone,hill);
  }
  await load(views['beach-close']);
  const grass=await read(`(()=>{const g=mmm.grass,t=ct.t,sea=t.seaLevel,exag=t.exag;
    const test=()=>{let planted=0,bad=0;for(const map of [g.patches,g.dense])for(const p of map.values())for(let i=0;i<p.count;i++){const x=p.roots[i*4],z=p.roots[i*4+2];if(!t.coast.contains(x,z))continue;planted++;const h=t.heightAt(x,z),dx=(t.heightAt(x+1,z)-t.heightAt(x-1,z))/(2*exag),dz=(t.heightAt(x,z+1)-t.heightAt(x,z-1))/(2*exag);if(t.coast.weights(x,z,sea+(h-sea)/exag,Math.hypot(dx,dz))[3]>.15)bad++;}return {planted,bad};};
    const normal=test(),saved=t.coast;let broken={planted:0,bad:0},tested=0;
    for(let x=-5500;x<=-5460&&broken.bad===0;x+=8)for(let z=-5960;z<=-5880&&broken.bad===0;z+=8){
      t.coast=null;const patch=g.patch(x,z,true);g.populate(patch,performance.now()+1000);t.coast=saved;tested++;
      g.dense.set('mutation',patch);broken=test();g.dense.delete('mutation');if(patch.mesh){g.group.remove(patch.mesh);patch.mesh.geometry.dispose();}
    }
    return {normal,broken,tested};})()`);
  assert.equal(grass.normal.bad,0,'no planted grass on coast beach');reject('beach grass guard removed',x=>assert.equal(x.bad,0,'no planted grass on coast beach'),grass.broken);console.log('BEACH GRASS',JSON.stringify(grass));
  for(const phone of [false,true])for(const hill of [1,1.5,2,2.5]){
   await load(views['sea-east'],phone,hill);const trees=await read(treeAudit);
   console.log('TREE DIAGNOSTIC',phone,hill,JSON.stringify(trees));
   assert.ok(trees.checked>4000&&trees.rejected>0&&trees.retained>4000&&trees.sea===0&&trees.beach===0&&trees.cliff===0&&trees.float===0&&trees.rays===trees.retained&&trees.misses===0&&trees.maxRayError<.01,'all actual coast tree batches filtered and on drawn triangles');
   console.log('TREE RAYS',phone,hill,JSON.stringify(trees));results.push({phone,hill,trees});
  }
 }
 if(!process.env.COAST_PHASE){await load(views['finlay-recesses'],true);await capture('pass4-finlay-recesses-phone-after');await phonePictures();}
 assert.deepEqual(errors,[],'no script/shader errors');writeFileSync(`${out}/coast-${process.env.COAST_PHASE??'checks'}.json`,JSON.stringify(results,null,2));console.log('PASS coast '+(process.env.COAST_PHASE??'checks'));
}finally{writeFileSync(`${out}/coast-${process.env.COAST_PHASE??'checks'}.partial.json`,JSON.stringify(results,null,2));await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);ws.close();}
