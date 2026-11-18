// Use the project's complete-frame gate, with its actual shadow/mirror/main passes and settling.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {measure} from './frame-budget-check.mjs';
import {open} from './cdp.mjs';
import {scenes,modes} from './frame-budget-policy.mjs';
const out=process.argv[2],rows=[];
for(const split of (process.env.QUARRY_SPLIT_PROBE??'current').split(',')){
 const result=await measure(scenes.find(s=>s.id==='quarry-gate'),modes.find(m=>m.id==='phone-explore-truck'),split==='current'?undefined:async page=>page.read(`mmm.terrain.split=${Number(split)}`));
 rows.push({split,...result});console.log(JSON.stringify(rows.at(-1)));writeFileSync(out+'/pass3-low-gate.json',JSON.stringify(rows,null,2));
 if(split==='current')assert.ok(result.counts.triangles<=1480000,'LOW gate <= 1,480,000 triangles; actual '+result.counts.triangles);
}

if(!process.env.QUARRY_SPLIT_PROBE){
 const origin=new URL(process.argv[3]).origin,p=await open(origin+'/?area=westbay&mode=explore&cam=632015,5061860,10,340,-10,65&camground=1&exag=1.5&q=low&hud=0&radio=0&res=1');
 try{
  await p.send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true});
  await p.read(`(async()=>{window.requestAnimationFrame=()=>0;const THREE=await import('/node_modules/three/build/three.module.js');const{terrain:t,trees,quarry:k,camera:c,renderer:r,vehicle:v,water,roads}=mmm;let scene=v.car.root;while(scene.parent)scene=scene.parent;window.qa={t,c,r,k,trees,scene,water,v,roads,THREE,previous:null};
   qa.view=async(e,n,eye,heading,pitch)=>{const x=e-t.manifest.village[0],z=t.manifest.village[1]-n;c.position.set(x,(t.heightAt(x,z)??0)+eye,z);c.rotation.order='YXZ';c.rotation.set(pitch*Math.PI/180,-heading*Math.PI/180,0);c.fov=65;c.updateProjectionMatrix();c.updateMatrixWorld();for(let i=0;i<160;i++){t.update(c);trees?.update(t.drawnFine,c.position);roads.update(c.position);k.update(c.position,v);water?.update(c);r.render(scene,c);water?.settle();water?.afterRender(c);await new Promise(r=>setTimeout(r,15));if(!t.pending&&!(trees?.pending??0)&&i>12)break;}c.position.y=(t.meshHeightAt(x,z,true)??t.heightAt(x,z))+eye;c.updateMatrixWorld();for(let i=0;i<8;i++){t.update(c);trees?.update(t.drawnFine,c.position);k.update(c.position,v);water?.update(c);r.render(scene,c);water?.settle();water?.afterRender(c);await new Promise(r=>setTimeout(r,15));}
    const set=new Map(),matrix=new THREE.Matrix4(),point=new THREE.Vector3();trees.group.updateMatrixWorld(true);trees.group.traverse(o=>{if(o.isInstancedMesh&&o.visible)for(let i=0;i<o.count;i++){o.getMatrixAt(i,matrix);point.setFromMatrixPosition(matrix).applyMatrix4(o.matrixWorld);set.set(point.x.toFixed(2)+','+point.z.toFixed(2),Math.hypot(point.x-c.position.x,point.z-c.position.z));}});let nearest=Infinity,added=0;if(qa.previous)for(const[key,d]of set)if(!qa.previous.has(key)){nearest=Math.min(nearest,d);added++;}qa.previous=set;return{added,nearest:Number.isFinite(nearest)?nearest:null,trees:set.size,split:t.split};};})()`);
  const approach=[];
  for(let d=120;d>=0;d-=5){const e=631996.45-Math.sin(-.467)*d,n=5061904.73-Math.cos(-.467)*d,result=await p.read(`qa.view(${e},${n},2.2,333.24,4)`);approach.push({metres:d,...result});if(d%30===0)await p.shot(out+`/gate-low-approach-${d}.png`);assert.ok(result.nearest===null||result.nearest>=120,'new fine tree instances stay beyond 120 m on the LOW approach');}
  await p.read('qa.view(632015,5061860,10,340,-10)');await p.shot(out+'/gate-low.png');writeFileSync(out+'/pass3-low-approach.json',JSON.stringify(approach,null,2));
 }finally{await p.close();}
}
