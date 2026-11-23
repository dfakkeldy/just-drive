#!/usr/bin/env node
// Full production scene. Hiding only a target's far-land region proves whether
// it contributes real depth-tested pixels, instead of guessing from a thin PNG horizon.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {cdp,cdpFetch,sleep} from './cdp.mjs';
const[out,base]=process.argv.slice(2),port=process.env.CDP_PORT,fixture=JSON.parse(readFileSync(new URL('./far-views-visibility.json',import.meta.url))),rows=[];
if(process.env.FAR_VISIBLE_VIEWS&&existsSync(out+'/visible/pixels.json'))rows.push(...JSON.parse(readFileSync(out+'/visible/pixels.json')));
mkdirSync(out+'/visible',{recursive:true});
const boxes={'PEI east end':[561000,5132000,581000,5152000],'Cape George highlands':[575000,5069000,589000,5085000]};
let tab,c;
try{
 tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();c=await cdp(tab.webSocketDebuggerUrl);await c.send('Page.enable');await c.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
 const read=async expression=>{const r=await c.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
 for(const row of fixture.rows){
  if(process.env.FAR_VISIBLE_VIEWS&&!process.env.FAR_VISIBLE_VIEWS.split(',').includes(row.view))continue;
  const[e,n,h]=row.observer,[te,tn,th]=row.point,area=row.view.startsWith('Marble')||row.view.startsWith('Port Hood')?'porthood':row.view.startsWith('Judique')?'judique':'mabou';
  const yaw=Math.atan2(te-e,tn-n)*180/Math.PI,pitch=Math.atan2(row.renderedTarget-row.drop-h,row.distance)*180/Math.PI;
  await fetch(base+'/__far-views-mode?mode=after');await c.send('Page.navigate',{url:`${base}/?area=${area}&cam=${e},${n},${h},${yaw},${pitch},60&mode=explore&bare=1&res=1&hud=0&shadows=0&exag=1&q=high`});const start=Date.now();
  while(!await read("document.title==='settled'&&!!window.mmm?.farLand")){assert.ok(Date.now()-start<240000,'settled visibility view');await sleep(300);}
  await read('window.requestAnimationFrame=()=>0');await sleep(100);
  await read(`mmm.camera.position.set(${e}-mmm.terrain.manifest.village[0],${h},mmm.terrain.manifest.village[1]-${n});mmm.camera.updateMatrixWorld();`);
  const result=await read(`(()=>{const{scene:s,camera:c,renderer:r,farLand:f}=mmm,W=1280,H=720,m=f.land.material,original=m.fragmentShader,origin=mmm.terrain.manifest.village,b=${JSON.stringify(boxes[row.target])};const callbacks=[];s.traverse(o=>{if(o.isMesh){callbacks.push([o,o.onBeforeRender,o.onAfterRender]);o.onBeforeRender=o.onAfterRender=()=>{};}});
   // Hold farVisibility's query meshes visible once before compare so 5 Hz retry timers cannot flip visibility between a and restored or unhide objects during bare.
   for(const rec of mmm.farVisibility?.records??[])rec.mesh.visible=true;
   const draw=()=>{r.setRenderTarget(null);r.render(s,c);const g=r.getContext(),a=new Uint8Array(W*H*4);g.readPixels(0,0,W,H,g.RGBA,g.UNSIGNED_BYTE,a);return a;};
   const removed=original.replace('void main() {','void main() { if(vWorld.x>='+(b[0]-origin[0]).toFixed(3)+' && vWorld.x<='+(b[2]-origin[0]).toFixed(3)+' && vWorld.z>='+(origin[1]-b[3]).toFixed(3)+' && vWorld.z<='+(origin[1]-b[1]).toFixed(3)+') discard;');
   const compare=()=>{draw();const a=draw(),image=r.domElement.toDataURL('image/png');m.fragmentShader=removed;m.needsUpdate=true;const hidden=draw();m.fragmentShader=original;m.needsUpdate=true;const restored=draw();let changed=0,unstable=0;for(let i=0;i<a.length;i+=4){if(a[i]!==hidden[i]||a[i+1]!==hidden[i+1]||a[i+2]!==hidden[i+2])changed++;if(a[i]!==restored[i]||a[i+1]!==restored[i+1]||a[i+2]!==restored[i+2])unstable++;}return{changed,unstable,image};};
   const full=compare();
   // The numerical receipt is bare earth. Keep the same real terrain, sea and
   // far mesh for that proof; report foreground vegetation/buildings separately.
   const terrainMeshes=new Set();mmm.terrain.group.traverse(o=>terrainMeshes.add(o));terrainMeshes.add(f.land);terrainMeshes.add(s.getObjectByName('near-sea'));
   const visibility=[];s.traverse(o=>{if((o.isMesh||o.isLine||o.isPoints)&&!terrainMeshes.has(o)){visibility.push([o,o.visible]);o.visible=false;}});
   const bare=compare();
   // Marble Hill's PEI clearance is only 0.035 pixels at 720p/FOV60. A narrow
   // FOV resolves that same geometry without changing camera height or vertices.
   c.fov=1;c.updateProjectionMatrix();const zoom=compare();c.fov=60;c.updateProjectionMatrix();
   for(const[o,v]of visibility)o.visible=v;for(const[o,b,a]of callbacks){o.onBeforeRender=b;o.onAfterRender=a;}return{full,bare,zoom,zoomFov:1,camera:c.position.toArray(),ground:mmm.terrain.heightAt(c.position.x,c.position.z),drawn:mmm.terrain.meshHeightAt(c.position.x,c.position.z,true),programErrors:r.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).map(p=>p.diagnostics)};})()`);
  const id=fixture.rows.indexOf(row);for(const label of ['full','bare','zoom']){writeFileSync(`${out}/visible/${id}-${label}.png`,Buffer.from(result[label].image.split(',')[1],'base64'));delete result[label].image;}
  rows[id]={view:row.view,target:row.target,expected:row.visible,...result};writeFileSync(out+'/visible/pixels.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(rows[id]));assert.deepEqual(result.programErrors,[]);for(const label of ['full','bare','zoom'])assert.equal(result[label].unstable,0);assert.equal(result.zoom.changed>0,row.visible,'resolved bare game geometry matches physical sightline table');if(!row.visible){assert.equal(result.full.changed,0,'hidden target stays hidden with foreground scenery');assert.equal(result.bare.changed,0);}
 }
}catch(e){console.error(e.stack);process.exitCode=1;}
finally{c?.close();if(tab)await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});}
