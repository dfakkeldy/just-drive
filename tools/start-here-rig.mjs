// Production classes on analytic flat land. No Vehicle/Roads/Towing methods are replaced.
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { TRAILER_SPEC } from '../web/src/trailer.ts';
import { Vehicle } from '../web/src/vehicle.ts';
import { Roads } from '../web/src/roads.ts';
import { Towing } from '../web/src/towing.ts';
import { createTruck, TRUCK_SPEC } from '../web/src/truck.ts';
export function createStartRig(kind) {
  const straight=kind==='nearest'||kind==='same-refused',reverse=kind==='nearest-reversed';
  const point={e:624271,n:5103301},target=reverse?[0,42]:straight?[0,-10]:[-47.5,-47.5];
  const village=[point.e-target[0],point.n+target[1]];
  const lines=reverse?[[[0,44],[0,42]]]:straight?[[[-20,-10],[20,-10]]]:[[[-49,-49],[-47.5,-47.5]],...(kind==='next'?[[[-20,-10],[20,-10]]]:[])];
  let contact=null;
  const terrain={manifest:{village},heightAt(){return 0;},surfaceAt(){return {ground:0,kind:2,halfWidth:4,roadDist:0,canopy:0,level:8,washboard:false};},
    withGroundContact(body,read){const old=contact;contact=body;try{return read();}finally{contact=old;}},
    withContactHeight(body,read){return contact?this.withGroundContact(body,read):read();}};
  const roads=new Roads({roads:lines.map((pts,i)=>({id:i+1,name:null,kind:2,halfWidth:4,bridge:false,pts:pts.map(([x,z])=>[village[0]+x,village[1]-z])}))},village,terrain);
  const vehicle=new Vehicle(createTruck(),terrain,roads,-.2,TRUCK_SPEC);
  vehicle.bounds=[-50,-50,50,50];vehicle.place(0,0,0);
  const towing=new Towing(vehicle,terrain,roads,true,false,{},true);
  if(kind==='same-refused'){vehicle.restart(0,-10,Math.PI/2);vehicle.bounds=[-4,-14,4,-6];}
  const couplerGap=()=>{
    towing.update();
    const tail=towing.trailer.root.localToWorld(new THREE.Vector3(0,TRAILER_SPEC.couplerHeight,-TRAILER_SPEC.drawbar));
    const hitch=new THREE.Vector3(0,vehicle.spec.hitch.height,vehicle.spec.hitch.back).applyEuler(new THREE.Euler(vehicle.pitch,-vehicle.heading,vehicle.roll,'YXZ')).add(new THREE.Vector3(vehicle.x,vehicle.y,vehicle.z));
    return tail.distanceTo(hitch);
  };
  const dispose=()=>{const geometries=new Set(),materials=new Set();for(const root of [vehicle.car.root,towing.trailer.root,roads.group])root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();};
  return {vehicle,roads,towing,point,village,target,couplerGap,dispose};
}
