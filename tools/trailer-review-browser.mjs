// Focused R5 replay. Baseline source is served by the dev-only mutation plugin.
import assert from 'node:assert/strict';import{writeFileSync,readFileSync}from'node:fs';import{execFileSync}from'node:child_process';import{fileURLToPath}from'node:url';import{mutationSession,serveMutation}from'./mutation-session.mjs';import{open}from'./truck-cdp.mjs';import{tyreContacts}from'./tyre-contacts.mjs';
export async function contactRegression(p,baseline=null){
 const result=await p.read(`(async()=>{const THREE=await import('/node_modules/three/build/three.module.js'),{Vehicle}=await import('/src/vehicle.ts'),{createTruck,TRUCK_SPEC}=await import('/src/truck.ts'),{Towing}=await import('/src/towing.ts');
 window.requestAnimationFrame=()=>0;let context=null;const terrain={withGroundContact(body,read){const old=context;context=body;try{return read();}finally{context=old;}},withContactHeight(body,read){return context?this.withGroundContact(body,read):read();},heightAt(x,z){return 20+x;},surfaceAt(x,z){return{ground:20+x,kind:9,halfWidth:20,roadDist:0,canopy:0,level:8};}};
 const roads={roads:[],deckHeight(){return null;},nearest(){return null;}},v=new Vehicle(createTruck(),terrain,roads,-.2,TRUCK_SPEC);v.assist=0;v.place(0,0,0);const t=new Towing(v,terrain,roads);for(let i=0;i<240;i++)terrain.withGroundContact(v,()=>v.update(1/120,{throttle:0,steer:0,handbrake:false},()=>t.step()));t.update();
 const g=new THREE.PlaneGeometry(80,80,1,1);g.rotateX(-Math.PI/2);const pos=g.attributes.position;for(let i=0;i<pos.count;i++)pos.setY(i,20+pos.getX(i));g.computeVertexNormals();
 const land=new THREE.Group(),mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0x90988b,side:THREE.DoubleSide}));land.add(mesh);land.updateMatrixWorld(true);
 const scene=new THREE.Scene();scene.add(land,v.car.root,t.trailer.root,new THREE.HemisphereLight(0xffffff,0x555555,3));const cam=new THREE.PerspectiveCamera(58,mmm.camera.aspect,.1,1000);cam.position.set(12,32,25);cam.lookAt(0,21,8);cam.updateMatrixWorld(true);mmm.renderer.render(scene,cam);
 const probe=${tyreContacts.toString()};const contacts=probe(THREE,t.trailer.wheels.map((wheel,i)=>({name:String(i),wheel,radius:.34})),[land]);const truck=probe(THREE,[...Object.entries(v.car.wheels).map(([name,wheel])=>({name,wheel,radius:.43})),...(v.car.extraWheels??[]).map((wheel,i)=>({name:'dual'+i,wheel,radius:.43}))],[land]);
 const legacy=t.trailer.wheels.map(w=>{const b=new THREE.Box3().setFromObject(w,true),c=b.getCenter(new THREE.Vector3());return b.min.y-20-c.x;});return{contacts,truck,legacy};})()`);
 return result;
}
export function assertContactRegression(result){
 const metrics=a=>a.map(c=>({name:c.name,penetration:c.penetration,float:c.float,count:c.count,misses:c.misses}));
 console.log('R5_PER_VERTEX_TRAILER',JSON.stringify(metrics(result.contacts)));console.log('R5_PER_VERTEX_TRUCK',JSON.stringify(metrics(result.truck)));console.log('LEGACY_CENTRE_GAPS',JSON.stringify(result.legacy));
 assert.ok(result.contacts.every(c=>c.ray&&c.penetration<.002&&c.float<.01),'R5_per_vertex_drawn_cross_slope_contacts');
}
if(process.argv[1]?.endsWith('/trailer-review-browser.mjs')){
 const[out,first]=process.argv.slice(2),origin=first?new URL(first).origin:'',baseline=process.env.TRAILER_BASELINE;
 const root=fileURLToPath(new URL('..',import.meta.url));
 const document=baseline?{name:'trailer review baseline',edits:[{file:'web/src/towing.ts',from:readFileSync(root+'/web/src/towing.ts','utf8'),to:execFileSync('git',['show',`${baseline}:web/src/towing.ts`],{cwd:root,encoding:'utf8'})}]}:null;
 if(document && await mutationSession(root,'trailer-review-browser.mjs',[document],process.argv.slice(2),'vehicle=truck&trailer=1')) { /* outer owns cleanup */ }
 else {
 let p=null;
 try{
  if(document)await serveMutation(document,first);
  p=await open(`${origin}/?vehicle=truck&trailer=1&road=Highway%2019&f=.77&scene=0&hud=0`);
  const result=await contactRegression(p,baseline);writeFileSync(`${out}/review-r1-${baseline?'baseline':'fixed'}-browser.json`,JSON.stringify(result,null,2)+'\n');assertContactRegression(result);
 }finally{if(p)await p.close();if(document)await serveMutation({edits:[]},first);}
 }
}
