// Count exposed vertices against the drawn triangles, with grass enabled in the player's wall-toe view.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {open} from './cdp.mjs';
const[out,first]=process.argv.slice(2),origin=new URL(first).origin,rows=[];
for(const hill of [1,1.5]){
 const p=await open(`${origin}/?area=westbay&mode=explore&cam=631796.361,5064433.895,1.8,295,-6,65&camground=1&exag=${hill}&hud=0&radio=0&res=1&shadows=1`);
 try{const result=await p.read(`(async()=>{window.requestAnimationFrame=()=>0;const THREE=await import('/node_modules/three/build/three.module.js');const{terrain:t,trees,quarry:k,camera:c,renderer:r,vehicle:v,water,roads}=mmm;let scene=v.car.root;while(scene.parent)scene=scene.parent;
  for(let i=0;i<200;i++){t.update(c);trees?.update(t.drawnFine,c.position);roads.update(c.position);k.update(c.position,v);water?.update(c);r.render(scene,c);water?.settle();water?.afterRender(c);await new Promise(r=>setTimeout(r,20));if(!t.pending&&!(trees?.pending??0)&&i>20)break;}
  c.position.y=t.meshHeightAt(c.position.x,c.position.z,true)+1.8;c.updateMatrixWorld();for(let i=0;i<12;i++){t.update(c);trees?.update(t.drawnFine,c.position);k.update(c.position,v);water?.update(c);r.render(scene,c);water?.settle();water?.afterRender(c);await new Promise(r=>setTimeout(r,20));}
  const mesh=k.rocks.mesh,pos=mesh.geometry.attributes.position,matrix=new THREE.Matrix4(),point=new THREE.Vector3();mesh.updateWorldMatrix(true,false);let count=0,buried=0,under20=0,exposed25=0,missing=0;const large=[];
  for(let b=0;b<mesh.count;b++){const block=k.rocks.blocks[b],e=block.x+t.manifest.village[0],n=t.manifest.village[1]-block.z;if(e>631850||n<5063900||n>5065000)continue;mesh.getMatrixAt(b,matrix);let high=-Infinity;for(let i=0;i<pos.count;i++){point.fromBufferAttribute(pos,i).applyMatrix4(matrix).applyMatrix4(mesh.matrixWorld);const ground=t.meshHeightAt(point.x,point.z,true);if(ground===null)missing++;else high=Math.max(high,point.y-ground);}count++;if(high<0)buried++;if(high<.20)under20++;if(high>=.25)exposed25++;if(block.height>.65)large.push(high);}
  const wasVisible=mesh.visible,target=new THREE.WebGLRenderTarget(700,Math.round(700/c.aspect)),saved=r.getRenderTarget(),draw=visible=>{mesh.visible=visible;r.setRenderTarget(target);r.clear();r.render(scene,c);const a=new Uint8Array(target.width*target.height*4);r.readRenderTargetPixels(target,0,0,target.width,target.height,a);return a;},shown=draw(wasVisible),hidden=draw(false);let visiblePixels=0;for(let i=0;i<shown.length;i+=4)if(Math.max(Math.abs(shown[i]-hidden[i]),Math.abs(shown[i+1]-hidden[i+1]),Math.abs(shown[i+2]-hidden[i+2]))>8)visiblePixels++;mesh.visible=wasVisible;r.setRenderTarget(saved);target.dispose();r.render(scene,c);
  const nearby=k.rocks.blocks.map(b=>({e:b.x+t.manifest.village[0],n:t.manifest.village[1]-b.z,y:b.y,size:b.size,height:b.height,d:Math.hypot(b.x-c.position.x,b.z-c.position.z)})).sort((a,b)=>a.d-b.d).slice(0,8);
  return{visiblePixels,cameraY:c.position.y,nearby,count,buried,under20,exposed25,missing,large:large.length,largeVisible:large.filter(h=>h>=.25).length,eye:c.position.y-t.meshHeightAt(c.position.x,c.position.z,true),grass:!new URLSearchParams(location.search).has('grass')};})()`);
  rows.push({hill,...result});console.log(JSON.stringify(rows.at(-1)));writeFileSync(out+'/pass3-wall-toe-counts.json',JSON.stringify(rows,null,2));await p.shot(out+`/wall-toe-hill-${hill}.png`);
  assert.ok(result.visiblePixels>=1200&&result.count<=(hill===1?781:621)&&result.count>300&&result.buried===0&&result.exposed25>=200&&result.largeVisible===result.large&&result.missing===0&&Math.abs(result.eye-1.8)<.01,'drawn wall toe has exposed rubble, including every larger chunk');
 }finally{await p.close();}
}
