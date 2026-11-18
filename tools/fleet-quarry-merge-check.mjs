import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {png} from './quarry-height-read.mjs';
import {Terrain} from '../web/src/terrain.ts';
import {Roads} from '../web/src/roads.ts';
import {Quarry} from '../web/src/quarry.ts';
import {QuarrySite,APRON,GATE} from '../web/src/quarry-site.ts';
import {Fleet} from '../web/src/fleet.ts';
import {AreaContacts} from '../web/src/world-contacts.ts';
import {Vehicle} from '../web/src/vehicle.ts';
import {createTruck,TRUCK_SPEC} from '../web/src/truck.ts';
import {Towing} from '../web/src/towing.ts';
const root=process.cwd(),base=root+'/data/baked/areas/westbay',manifest=JSON.parse(readFileSync(base+'/manifest.json'));
globalThis.fetch=async path=>new Response(readFileSync(path));globalThis.createImageBitmap=async blob=>png(Buffer.from(await blob.arrayBuffer()));
globalThis.OffscreenCanvas=class{getContext(){let image;return{drawImage(b){image=b},getImageData(){return{data:image.pixels}}}}};
const context=new Proxy({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),getImageData:(_x,_y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}),measureText:t=>({width:String(t).length*8}),createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>k in o?o[k]:()=>{},set:(o,k,v)=>(o[k]=v,true)});
globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>context})};
const loader=THREE.TextureLoader.prototype.load;THREE.TextureLoader.prototype.load=()=>new THREE.Texture();
const terrain=new Terrain(manifest,base,{},1,-.2);terrain.low=true;terrain.split=1;const site=new QuarrySite(manifest.village);terrain.sites.push(site);terrain.coast=site;
const roads=new Roads(JSON.parse(readFileSync(base+'/roads.json')),manifest.village,terrain);THREE.TextureLoader.prototype.load=loader;
const p={x:APRON.e-manifest.village[0],z:manifest.village[1]-APRON.n};
for(const centre of [p,{x:0,z:0}]){const keys=new Set();for(let x=centre.x-300;x<=centre.x+300;x+=60)for(let z=centre.z-300;z<=centre.z+300;z+=60)for(let l=8;l>=0;l--){const size=manifest.size/2**l,i=Math.floor((x+manifest.village[0]-manifest.origin[0])/size),j=Math.floor((z-manifest.village[1]+manifest.origin[1])/size),name=i+'_'+j;if(manifest.levels[l]?.includes(name)){keys.add(l+'/'+name);break}}for(const key of keys){const[l,i,j]=key.split(/[\/_]/).map(Number);await terrain.loadNow(l,i,j)}}
terrain.group.traverse(n=>{if(n.isMesh)n.visible=true});
const quarry=new Quarry(site,terrain,roads),contacts=new AreaContacts(),main=process.env.MERGE_BASE_REF?execFileSync('git',['show',process.env.MERGE_BASE_REF+':web/src/main.ts'],{encoding:'utf8'}):readFileSync('web/src/main.ts','utf8');
const registered=/fleetContacts\.add\(quarry\.contactProvider\(\)\)/.test(main);if(registered)contacts.add(quarry.contactProvider());
const truck=new Vehicle(createTruck(false),terrain,roads,-.2,TRUCK_SPEC);quarry.bindVehicle(truck,registered?contacts:undefined);truck.place(p.x,p.z,GATE.heading);
const tow=new Towing(truck,terrain,roads,true,false,{contacts},true),scene=new THREE.Scene();scene.add(truck.car.root,tow.trailer.root,quarry.group);
const fleet=new Fleet(truck,tow,terrain,roads,scene,false,()=>{},-.2,contacts);fleet.verifyTransitions=true;
const step=()=>{terrain.withGroundContact(fleet.driven.vehicle,()=>fleet.drive(1/120,{throttle:0,steer:0,handbrake:true},()=>fleet.resolve()));fleet.refresh(1/120);fleet.assertDriven()};
const finish=()=>{for(let i=0;i<3600&&fleet.busy;i++)step();assert.equal(fleet.busy,false,fleet.message)};
const use=(kind,id)=>{fleet.refresh(1);fleet.actionIndex=fleet.actions.findIndex(a=>a.kind===kind&&a.id===id);assert.ok(fleet.actionIndex>=0,kind+'/'+id+' '+fleet.message);assert.equal(fleet.activate(),true,fleet.message);finish()};
for(let i=0;i<240;i++)step();use('unload','bike');use('unload','sxs');
quarry.update(new THREE.Vector3(p.x,terrain.heightAt(p.x,p.z)+12,p.z),truck);const gate=quarry.staticSolids.find(s=>Math.abs(s.half-.16)<.0001),rubble=quarry.solids[quarry.staticSolids.length];assert.ok(rubble,'drawn park rubble has a production solid');contacts.invalidate();
for(const id of ['sxs','bike']){use('drive',id);const v=fleet.driven.vehicle;for(const[kind,solid]of[['gate post',gate],['rubble',rubble]]){const pose={x:solid.x,z:solid.z,heading:0};assert.equal(quarry.allowPlacement(pose,v.spec),false,'park solid is real');const before=[v.x,v.y,v.z];const accepted=v.placementGuard({...pose});console.log('GUARD',JSON.stringify({id,kind,accepted,registered}));assert.equal(accepted,false,id+' switched placement guard refuses '+kind);v.place(pose.x,pose.z,pose.heading);assert.deepEqual([v.x,v.y,v.z],before,'ordinary placement refuses the swept move into a park solid');assert.equal(contacts.allows({...pose,y:v.y,spec:v.spec}),false,'shared provider also protects trailer and parked bodies');const checkpoint=fleet.saved(),reset=fleet.nativeRespawn.get(v);fleet.nativeRespawn.set(v,()=>{v.x=pose.x;v.z=pose.z;v.heading=0});fleet.respawn();assert.equal(quarry.allowPlacement({x:v.x,z:v.z,heading:v.heading},v.spec),true,'R searches past a blocked park destination');fleet.nativeRespawn.set(v,reset);checkpoint.rollback()}
 if(registered){const guard=v.placementGuard;quarry.bindVehicle(v,contacts);quarry.bindVehicle(v,contacts);assert.equal(v.placementGuard,guard,'binding is idempotent')}
}
console.log('PASS quarry/fleet switched solid guards on real park land');

// A cold start is retried only after support changes, with the original exact-start predicate.
const realGround=fleet.ground,requested={x:p.x,z:p.z,heading:GATE.heading};let retryChecks=0;
const exact=pose=>{retryChecks++;return Math.hypot(pose.x-requested.x,pose.z-requested.z)<1e-6&&Math.abs(Math.sin(pose.heading-requested.heading))<1e-6};
fleet.ground=()=>null;fleet.spawned=false;assert.equal(fleet.startVisit(requested.x,requested.z,requested.heading,exact),false);
fleet.ground=realGround;retryChecks=0;fleet.visitDirty=true;fleet.refresh(0,false);
assert.ok(retryChecks>0,'deferred visit must revalidate the original start predicate');assert.equal(fleet.spawned,true);
assert.ok(Math.hypot(fleet.truck.x-requested.x,fleet.truck.z-requested.z)<1e-6);
console.log('PASS deferred exact start retains and revalidates its placement predicate');
