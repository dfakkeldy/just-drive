import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {writeFileSync,mkdirSync} from 'node:fs';
import {open} from './cdp.mjs';
const [out,url]=process.argv.slice(2);
const evidence=resolve(out,'evidence/road-scene-delta-browser');mkdirSync(evidence,{recursive:true});
const page=await open(url);
try{
 const result=await page.read(`(async()=>{
 const THREE=await import('/node_modules/three/build/three.module.js');
 const {Props}=await import('/src/props.ts');
 const {Roads}=await import('/src/roads.ts');
 const {RAIL_METAL_POST}=await import('/src/guardrail-look.ts');
 const scene=new THREE.Scene();scene.background=new THREE.Color(0xd8e0e2);
 scene.add(new THREE.HemisphereLight(0xffffff,0x646354,3));
 const sun=new THREE.DirectionalLight(0xffffff,3);sun.position.set(-3,7,4);scene.add(sun);
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(32,220),new THREE.MeshLambertMaterial({color:0x948c73}));floor.rotation.x=-Math.PI/2;floor.position.set(0,0,70);scene.add(floor);
 const terrain={cartRoads:false,low:false,dataRevision:1,exag:1,seaLevel:-10,heightAt:()=>0,meshHeightAt:()=>0,surfaceAt:()=>({ground:0,level:8,canopy:10})};
 // Invented, local fixture positions. These are never a source for real mailbox placement.
 const boxes=[0,0,6,7].map((style,i)=>({x:(i-1.5)*1.3,y:0,heading:180,style,tilt:0,group:i<2?1:null,parcelBox:false}));
 const props=new Props({crs:'EPSG:2961',mailboxes:boxes,communityBoxes:[],poles:[]},[0,0],terrain);scene.add(props.group);
 const camera=new THREE.PerspectiveCamera(38,1280/900,.05,500);camera.position.set(4,2.7,7);camera.lookAt(0,1,0);camera.updateMatrixWorld();props.update(camera,0);
 const names=props.group.children.flatMap(c=>c.children).map(m=>m.name);
 const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1280,900);renderer.domElement.style.cssText='position:fixed;inset:0;z-index:99999;width:100vw;height:100vh';document.body.append(renderer.domElement);
 renderer.render(scene,camera);const mailboxCounts={...renderer.info.render};
 const pixels=new Uint8Array(4);renderer.getContext().readPixels(640,450,1,1,renderer.getContext().RGBA,renderer.getContext().UNSIGNED_BYTE,pixels);
 const hits=boxes.map((b,i)=>props.mailHit(b.x,1.18,2,b.x,1.18,-2,false));
 window.dashcamFixture={renderer,scene,camera,props,rails:[]};
 const road={id:1,name:'Invented rail fixture',kind:2,halfWidth:3,bridge:false,pts:[[0,10],[0,-180]],guardrailRuns:[{start:40,end:110,side:1,posts:'metal'}]};
 const modes=[];props.group.visible=false;camera.position.set(-10,2.3,45);camera.lookAt(-4,.5,60);camera.updateMatrixWorld();
 for(const low of [false,true]){terrain.low=low;const roads=new Roads({roads:[road]},[0,0],terrain),g=roads.guardrails;for(let i=0;i<2000;i++){g.update(new THREE.Vector3(0,4,65));if(!g.audit.pending)break;}
 scene.add(g.group);const metal=g.group.children.reduce((n,m)=>n+Array.from(m.geometry.attributes.rail.array).filter((v,i)=>i%3===2&&v===RAIL_METAL_POST).length,0);
 renderer.render(scene,camera);modes.push({low,metal,spans:g.chunks.flatMap(c=>c.spans).length,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles});g.group.visible=false;window.dashcamFixture.rails.push(g.group);}
 props.group.visible=true;camera.position.set(4,2.7,7);camera.lookAt(0,1,0);camera.updateMatrixWorld();renderer.render(scene,camera);
 return {names,hits,pixel:Array.from(pixels),mailboxCounts,modes,errors:renderer.getContext().getError()};
 })()`);
 assert.ok(result,'fixture evaluation failed: '+page.errors.join(' | '));
 assert.deepEqual(page.errors,[],'browser page/shader errors');
 for(const name of ['box-0','box-6','box-7','curved-pedestal','house-mail-roof','house-mail-gable','plastic-pedestal','plastic-foot'])assert.ok(result.names.includes(name),name);
 assert.deepEqual(result.hits,[0,1,2,3]);assert.equal(result.errors,0);
 assert.equal(result.pixel[3],255);assert.ok(result.pixel.slice(0,3).some(v=>v>10&&v<245),'rendered floor pixel');
 assert.ok(result.mailboxCounts.calls<35&&result.mailboxCounts.triangles<2500,JSON.stringify(result.mailboxCounts));
 for(const mode of result.modes)assert.ok(mode.metal>100&&mode.spans>30&&mode.calls>=2&&mode.triangles>350,JSON.stringify(mode));
 await page.shot(resolve(evidence,'dashcam-mailbox-variety.png'));
 for(const [i,name] of ['desktop','low'].entries()){
  await page.read(`(()=>{const f=window.dashcamFixture;f.props.group.visible=false;f.rails.forEach((g,n)=>g.visible=n===${i});f.camera.position.set(-10,2.3,45);f.camera.lookAt(-4,.5,60);f.camera.updateMatrixWorld();f.renderer.render(f.scene,f.camera);return true;})()`);
  await page.shot(resolve(evidence,`dashcam-metal-rail-${name}.png`));
 }
 writeFileSync(resolve(evidence,'dashcam-runtime.json'),JSON.stringify(result,null,2));
 console.log('PASS browser generic rural pair, miniature house and plastic pedestal; metal rails desktop/LOW; counts',JSON.stringify(result));
}finally{await page.close();}
