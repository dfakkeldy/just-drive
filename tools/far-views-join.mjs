#!/usr/bin/env node
// Production sea geometry/vertex/mask on the GPU, against independent camera-ray
// intersections with the join's reference plane. No image texture inputs.
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {cdp,cdpFetch,sleep} from './cdp.mjs';
const baseline=process.env.FAR_MAIN_BASELINE==='1';
const[out,base]=process.argv.slice(2),port=process.env.CDP_PORT,rows=[];mkdirSync(out+'/join',{recursive:true});
const views=[['canso-low','cansocauseway',622000,5058500,2,330],['mabou-low','mabou',617300,5104000,2,270],['mabou-high','mabou',617300,5104000,300,270]];
for(const low of [false,true])for(const[name,area,e,n,h,yaw]of views){
 let tab,c;
 try{
  tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();c=await cdp(tab.webSocketDebuggerUrl);await c.send('Page.enable');await c.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  const read=async expression=>{const r=await c.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
  await fetch(base+'/__far-views-mode?mode=after');await c.send('Page.navigate',{url:`${base}/?area=${area}&cam=${e},${n},${h},${yaw},0,60&mode=explore&bare=1&res=1&hud=0&shadows=0&exag=1&q=${low?'low':'high'}&far=full`});const since=Date.now();
  while(!await read(baseline?"document.title==='settled'&&!!window.mmm":"document.title==='settled'&&!!window.mmm?.farLand")){assert.ok(Date.now()-since<240000,'settled join view');await sleep(300);}
  await read('window.requestAnimationFrame=()=>0');await sleep(100);
  const result=await read(`(async()=>{const T=await import('/node_modules/three/build/three.module.js'),{farSeaFragment}=await import('/src/far-land.ts');const{scene:s,camera:c,renderer:r}=mmm,sea=s.getObjectByName('near-sea')??s.children.find(o=>o.geometry?.parameters?.width===600000&&o.geometry?.parameters?.height===600000),W=1280,H=720;
   if(!sea){const o=s.children.find(o=>o.geometry?.parameters?.width===600000&&o.geometry?.parameters?.height===600000);if(!o)throw Error('sea missing');o.name='near-sea';}const callbacks=[];s.traverse(o=>{if(o.isMesh){callbacks.push([o,o.onBeforeRender,o.onAfterRender]);o.onBeforeRender=o.onAfterRender=()=>{};}});
   const actual=sea.material,fragment=${baseline}?\`#include <common>
#include <logdepthbuf_pars_fragment>
void main(){
#include <logdepthbuf_fragment>
gl_FragColor=vec4(1.0,0.0,0.0,1.0); }\`:farSeaFragment(\`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float seaLevel;
varying vec3 vWorld;
void main() {
 #include <logdepthbuf_fragment>
 gl_FragColor=vec4(vSeaPatch<0.5?vec3(1.0,0.0,0.0):vec3(0.0,1.0,0.0),1.0);
}\`);
   const mat=new T.ShaderMaterial({vertexShader:actual.vertexShader,fragmentShader:fragment,uniforms:actual.uniforms,defines:actual.defines,side:actual.side,depthTest:true,depthWrite:true});
   const probe=new T.Scene(),mesh=new T.Mesh(sea.geometry,mat);mesh.position.copy(sea.position);mesh.frustumCulled=false;probe.add(mesh);let blended=false;mesh.onAfterRender=()=>{blended ||= r.getContext().isEnabled(r.getContext().BLEND);};
   const target=new T.WebGLRenderTarget(W,H,{depthBuffer:true}),savedTarget=r.getRenderTarget(),clear=r.getClearColor(new T.Color()),alpha=r.getClearAlpha();r.setClearColor(0x0000ff,0);c.fov=60;c.aspect=W/H;c.updateProjectionMatrix();c.position.set(${e}-mmm.terrain.manifest.village[0],${h},mmm.terrain.manifest.village[1]-${n});c.rotation.order='YXZ';
   const eye=c.position.y-actual.uniforms.seaLevel.value,tan=Math.tan(Math.PI/6),offset=Math.atan(((360.5/H)*2-1)*tan),basePitch=-Math.atan(eye/3004)-offset;
   const draw=()=>{r.setRenderTarget(target);r.clear();r.render(probe,c);const p=new Uint8Array(W*H*4);r.readRenderTargetPixels(target,0,0,W,H,p);return p;};
   const reference=()=>{const a=c.matrixWorld.elements,eligible=[],overlap=[],distances=new Map();for(let y=320;y<400;y++){const vy=((y+.5)/H*2-1)*tan;for(let x=0;x<W;x++){const vx=((x+.5)/W*2-1)*tan*W/H,dx=a[0]*vx+a[4]*vy-a[8],dy=a[1]*vx+a[5]*vy-a[9],dz=a[2]*vx+a[6]*vy-a[10];if(dy>=0)continue;const d=eye*Math.hypot(dx,dz)/(-dy),i=y*W+x;if(d>=2700&&d<=3300){eligible.push(i);distances.set(i,d);}if(d>=3002.2&&d<=3063.8)overlap.push(i);}}return{eligible,overlap,distances};};
   const crackExamples=[];let tested=0,cracks=0,temporal=0,zFight=0,overlapTests=0,mutantCracks=0,restoredCracks=0,draws=0;
   for(let sweep=0;sweep<16;sweep++){
    c.rotation.set(basePitch+(sweep-8)*.025*(2*tan/H),-${yaw}*Math.PI/180,0);c.updateMatrixWorld();const ref=reference(),a=draw(),b=draw();draws=Math.max(draws,r.info.render.calls);tested+=ref.eligible.length;overlapTests+=ref.overlap.length;
    for(const i of ref.eligible){if(a[i*4+3]===0){cracks++;if(crackExamples.length<12)crackExamples.push({sweep,x:i%W,y:Math.floor(i/W),flatRange:ref.distances.get(i)});}if(a[i*4]!==b[i*4]||a[i*4+1]!==b[i*4+1]||a[i*4+3]!==b[i*4+3])temporal++;}
    c.position.x+=.0001;c.updateMatrixWorld();const jitter=draw();c.position.x-=.0001;c.updateMatrixWorld();for(const i of ref.overlap)if(a[i*4]!==jitter[i*4]||a[i*4+1]!==jitter[i*4+1])zFight++;
    if(sweep===8){
     mat.fragmentShader=${baseline}?fragment.replace('void main(){','void main(){ discard;'):fragment.replace('void main() {','void main() { if(vSeaPatch>0.5) discard;');mat.needsUpdate=true;const fault=draw();for(const i of ref.eligible)if(fault[i*4+3]===0)mutantCracks++;
     mat.fragmentShader=fragment;mat.needsUpdate=true;const restored=draw();for(const i of ref.eligible)if(restored[i*4+3]===0)restoredCracks++;
    }
   }
   c.rotation.set(basePitch,-${yaw}*Math.PI/180,0);c.updateMatrixWorld();r.setRenderTarget(savedTarget);r.setClearColor(clear,alpha);r.render(s,c);const image=r.domElement.toDataURL('image/png');for(const[o,b,a]of callbacks){o.onBeforeRender=b;o.onAfterRender=a;}mat.dispose();target.dispose();return{tested,cracks,crackExamples,temporal,zFight,overlapTests,blended,mutantCracks,restoredCracks,draws,geometryGroups:sea.geometry.groups.length,materialArray:Array.isArray(sea.material),image,programErrors:r.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).map(p=>p.diagnostics),camera:c.position.toArray()};})()`);
  writeFileSync(`${out}/join/${name}-${low?'LOW':'desktop'}.png`,Buffer.from(result.image.split(',')[1],'base64'));delete result.image;
  const row={name,low,source:baseline?'f965706':'head',...result};rows.push(row);writeFileSync(out+'/join/coverage.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(row));assert.deepEqual(result.programErrors,[],'all sea programs compile');assert.ok(result.tested>1000);assert.equal(result.cracks,0,'no sky/seabed crack pixels');assert.equal(result.temporal,0,'frozen-frame stable');assert.equal(result.zFight,0,'submillimetre camera jitter has no overlap ownership changes');assert.equal(result.blended,false,'no double-blended strip');assert.equal(result.restoredCracks,0);assert.ok(result.mutantCracks>0,'missing curved patch is detected');assert.equal(result.draws,1);assert.equal(result.geometryGroups,0);assert.equal(result.materialArray,false);
 }catch(e){console.error(e.stack);process.exitCode=1;}
 finally{c?.close();if(tab)await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});}
}
