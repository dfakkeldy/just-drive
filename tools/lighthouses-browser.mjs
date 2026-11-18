// RUN=lighthouses-browser.mjs tools/yard-shots.sh 1280 720. Serial, same-page kit-off control.
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {open,sleep} from './cdp.mjs';
import {execFileSync} from 'node:child_process';
const mutation=process.env.MMM_MUTATION;
// The kit-absent replay (MMM_MUTATION only) swaps in main's main.ts, so it needs a branch whose other render
// modules equal main's. Plain runs, including runs on main after landing, need no git history at all.
const git=args=>execFileSync('git',args,{encoding:'utf8',cwd:new URL('..',import.meta.url)});
const baseline=mutation?git(['merge-base','HEAD','origin/main']).trim():null;
if(mutation){
 const changed=git(['diff',baseline,'--name-only','--','web/src']).split('\n').filter(Boolean);
 assert.ok(changed.includes('web/src/main.ts'),'the kit-absent replay needs a branch that changes main.ts');
 assert.ok(changed.every(p=>p==='web/src/main.ts'||p==='web/src/credits.ts'||p.startsWith('web/src/harbour-light')),'main replay requires unchanged existing render modules');
}
const currentMain=readFileSync(new URL('../web/src/main.ts',import.meta.url),'utf8'),baseMain=mutation?git(['show',baseline+':web/src/main.ts']):null;
const [out,first]=process.argv.slice(2),origin=new URL(first).origin,results=[];
for(const size of [{id:'desktop',w:1280,h:720,q:'high'},{id:'phone',w:844,h:390,q:'low'}])for(const area of ['mabou','porthood'])for(const night of [false,true]){
 const caseName=`${area}-${size.id}-${night?'night':'day'}`;
 if(process.env.LIGHTS_ONLY&&!process.env.LIGHTS_ONLY.split(',').includes(caseName))continue;
 const e=area==='mabou'?618648.09:612660.25,n=area==='mabou'?5104734.16:5097955.97;
 const url=`${origin}/?area=${area}&mode=explore&hud=0&radio=0&res=1&q=${size.q}&${size.id==='phone'?'touch=1&':''}date=2026-10-10&time=${night?'21:30':'13:00'}&cam=${e+30},${n-45},12,326,-6,48&camground=1`;
 const p=await open(url);
 try{
  await p.send('Emulation.setDeviceMetricsOverride',{width:size.w,height:size.h,deviceScaleFactor:1,mobile:size.id==='phone'});await p.navigate(url);
  for(let k=0;k<60;k++){if(await p.read('mmm.terrain.pending===0'))break;await sleep(500);}
  const state=await p.read(`(()=>{const g=mmm.harbourLights.group,r=mmm.renderer,s=mmm.scene,c=mmm.camera;
   const measure=()=>{r.info.reset();r.render(s,c);return {calls:r.info.render.calls,triangles:r.info.render.triangles,programs:r.info.programs.length};};
   const branch=measure();g.visible=false;const control=measure();g.visible=true;
   return {sites:mmm.harbourLights.sites,beacons:!!g.getObjectByName('harbour beacons'),branch,control,meshes:g.children.length};})()`);
  if(night){
   state.pixels=await p.read(`(()=>{const r=mmm.renderer,g=mmm.harbourLights.group,b=g.getObjectByName('harbour beacons'),T=mmm.camera.position.constructor,gl=r.getContext(),s=mmm.harbourLights.sites.find(s=>s.number==='${area==='mabou'?'876':'876.8'}');
    const point=new T(s.x,s.beaconY,s.z).project(mmm.camera),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,x=Math.floor((point.x+1)*w/2)-3,y=Math.floor((point.y+1)*h/2)-3;
    if(x<0||y<0||x+7>w||y+7>h||point.z>1)throw Error('beacon offscreen');
    const saved=b.onBeforeRender;const read=t=>{b.onBeforeRender=()=>{b.material.uniforms.seconds.value=t;b.material.uniforms.viewportHeight.value=h;};r.render(mmm.scene,mmm.camera);const px=new Uint8Array(196);gl.readPixels(x,y,7,7,gl.RGBA,gl.UNSIGNED_BYTE,px);return px;};
    try{const on=read(0);b.visible=false;const off=read(0);b.visible=true;let difference=0;for(let i=0;i<196;i+=4)for(let c=0;c<3;c++)difference+=Math.abs(on[i+c]-off[i+c]);
     return {difference,point:point.toArray()};}finally{b.visible=true;b.onBeforeRender=saved;}
   })()`);
   state.farPixels=await p.read(`(()=>{const r=mmm.renderer,g=mmm.harbourLights.group,b=g.getObjectByName('harbour beacons'),T=mmm.camera.position.constructor,gl=r.getContext(),s=mmm.harbourLights.sites.find(s=>s.number==='${area==='mabou'?'876':'876.8'}');
    const cameraPosition=mmm.camera.position.clone(),cameraQuaternion=mmm.camera.quaternion.clone();mmm.camera.position.set(s.x+600,s.beaconY+200,s.z+800);mmm.camera.lookAt(s.x,s.beaconY,s.z);mmm.camera.updateMatrixWorld(true);
    const point=new T(s.x,s.beaconY,s.z).project(mmm.camera),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,x=Math.floor((point.x+1)*w/2)-3,y=Math.floor((point.y+1)*h/2)-3;
    if(x<0||y<0||x+7>w||y+7>h||point.z>1)throw Error('beacon offscreen');
    const saved=b.onBeforeRender;const read=t=>{b.onBeforeRender=()=>{b.material.uniforms.seconds.value=t;b.material.uniforms.viewportHeight.value=h;};r.render(mmm.scene,mmm.camera);const px=new Uint8Array(196);gl.readPixels(x,y,7,7,gl.RGBA,gl.UNSIGNED_BYTE,px);return px;};
    try{const on=read(0);b.visible=false;const off=read(0);b.visible=true;let difference=0;for(let i=0;i<196;i+=4)for(let c=0;c<3;c++)difference+=Math.abs(on[i+c]-off[i+c]);
     return {difference,point:point.toArray()};}finally{b.visible=true;b.onBeforeRender=saved;mmm.camera.position.copy(cameraPosition);mmm.camera.quaternion.copy(cameraQuaternion);mmm.camera.updateMatrixWorld(true);}
   })()`);
   assert.ok(state.farPixels.difference>30,'far beacon changes visible pixels');
   assert.ok(state.pixels.difference>30,'beacon changes visible pixels');
  }
  state.baseline=baseline;
  assert.ok(state.sites.length>0);assert.equal(state.beacons,night);assert.ok(state.branch.calls>state.control.calls,'light kit is in view');
  assert.deepEqual(p.errors,[]);
  if(mutation){
   writeFileSync(mutation,JSON.stringify({edits:[{file:'web/src/main.ts',from:currentMain,to:baseMain}]}));
   await fetch(origin+'/__mmm_mutation');await p.navigate(url);
   for(let k=0;k<60;k++){if(await p.read('mmm.terrain.pending===0'))break;await sleep(500);}
   state.main=await p.read(`(()=>{const r=mmm.renderer;r.info.reset();r.render(mmm.scene,mmm.camera);return {calls:r.info.render.calls,triangles:r.info.render.triangles,programs:r.info.programs.length,hasKit:!!mmm.harbourLights};})()`);
   assert.equal(state.main.hasKit,false);writeFileSync(mutation,JSON.stringify({edits:[]}));await fetch(origin+'/__mmm_mutation');await p.navigate(url);
  }
  const name=caseName;if(night)await p.read(`(()=>{const b=mmm.harbourLights.group.getObjectByName('harbour beacons');b.onBeforeRender=()=>{b.material.uniforms.seconds.value=0;};return true;})()`);await p.shot(`${out}/${name}.png`);results.push({name,...state});console.log('PASS',name,JSON.stringify(state));
 }finally{if(mutation){writeFileSync(mutation,JSON.stringify({edits:[]}));await fetch(origin+'/__mmm_mutation');}await p.close();}
}
writeFileSync(`${out}/counts.json`,JSON.stringify(results,null,2));
