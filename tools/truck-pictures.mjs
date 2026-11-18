#!/usr/bin/env node
// Truck art views. Live-land views are produced by truck-browser.mjs after its wheel-contact checks.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { open } from './truck-cdp.mjs';
const [out,first]=process.argv.slice(2),origin=new URL(first).origin;
const p=await open(`${origin}/truck.html?view=front`);
try{for(const [name,view,extra]of [['truck-front34','front',''],['truck-rear34','rear',''],['truck-side','side',''],['truck-top','top',''],['truck-and-car','front','&pair=1']]){
 await p.navigate(`${origin}/truck.html?view=${view}${extra}`);await p.read(`window.requestAnimationFrame=()=>0;if(!new URLSearchParams(location.search).has('pair')){const {camera,controls}=truckPreview;if(document.body.dataset.view==='rear')camera.position.set(-2.4,1.10,7.8);else if(['front','side'].includes(document.body.dataset.view))camera.position.x=-Math.abs(camera.position.x);camera.lookAt(controls.target);}for(const w of [...Object.values(truckPreview.car.wheels),...truckPreview.car.extraWheels])w.rotation.x=0;truckPreview.renderer.render(truckPreview.scene,truckPreview.camera)`);await p.shot(`${out}/${name}-v2.png`);
 if(extra){const proof=await p.read(`(()=>{const {car,scene}=truckPreview,other=scene.children.find(n=>n.isGroup&&n!==car.root),materials=new Set();other.traverse(n=>{if(n.isMesh)for(const m of Array.isArray(n.material)?n.material:[n.material])materials.add(m);});const paint=[...materials].find(m=>m.name==='Body paint');return {sceneEnvironmentIsNull:scene.environment===null,carHasEnvironmentMap:[...materials].some(m=>!!m.envMap),carMaterialCount:materials.size,paintType:paint.type,paintColor:paint.color.getHex(),paintRoughness:paint.roughness,paintMetalness:paint.metalness};})()`);assert.deepEqual(proof,{sceneEnvironmentIsNull:true,carHasEnvironmentMap:false,carMaterialCount:11,paintType:'MeshStandardMaterial',paintColor:0xc7c4b9,paintRoughness:.36,paintMetalness:.28});writeFileSync(`${out}/truck-art-v2-car-materials.json`,JSON.stringify(proof,null,2)+'\n');}

}}finally{await p.close();}
