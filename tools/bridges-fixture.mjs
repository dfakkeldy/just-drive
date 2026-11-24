// Node adapter: reuse the existing production Terrain PNG loader, with an explicit area.
// Bundles and source variants stay in memory. No live bake, source copy, renderer or network.
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {readFileSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
export const root=fileURLToPath(new URL('../',import.meta.url));
export const areas=['mabou','judique','porthood','westbay','pointtupper','cansocauseway'];
export async function fixture(area='mabou',exag=1,replacements={}){
  assert.ok(areas.includes(area));
  const base=root+'data/baked/'+(area==='mabou'?'terrain':'areas/'+area);
  const adapter=readFileSync(root+'tools/phone-ground.mjs','utf8')
    .replace("const base = '../data/baked/terrain';",`const base = ${JSON.stringify(base)};`)
    .replace('Number(process.env.PHONE_EXAG??1.5)',String(exag));
  const result=await build({stdin:{contents:`export * from './tools/phone-ground.mjs'; export {cutRasterHeight,rasterCuts} from './web/src/road-cut-raster.ts';export {RoadCuts} from './web/src/road-cuts.ts';export {Animals} from './web/src/animals.ts';export {YardDogSite} from './web/src/yard-dog-site.ts';export {vehicleChoice,restoreVehiclePose} from './web/src/vehicle-choice.ts';export {TERRAIN_FRAG} from './web/src/shaders.ts';export {Terrain,placeBoxes} from './web/src/terrain.ts';export {Vehicle} from './web/src/vehicle.ts';export {Towing} from './web/src/towing.ts';export {Fleet} from './web/src/fleet.ts';export {createTruck,TRUCK_SPEC} from './web/src/truck.ts';export {createBike} from './web/src/bike.ts';export {BikeCamera} from './web/src/bike-camera.ts'; export {BikeRide} from './web/src/bike-ride.ts'; export {Roads} from './web/src/roads.ts';export {railAccess} from './web/src/guardrail-access.ts'; export {pushOut} from './web/src/parked.ts'; export {QuarrySite} from './web/src/quarry-site.ts'; export {MineSite,mineRoadEnd} from './web/src/mine-site.ts';export {AmbientTraffic,highwayChains} from './web/src/ambient-traffic.ts';`,resolveDir:root},
    bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'area-and-variants',setup(b){
      b.onResolve({filter:/^three$/},()=>({path:pathToFileURL(root+'web/node_modules/three/build/three.module.js').href,external:true}));
      b.onResolve({filter:/three\/build\/three\.module\.js$/},()=>({path:pathToFileURL(root+'web/node_modules/three/build/three.module.js').href,external:true}));
      b.onLoad({filter:/\.(mjs|ts)$/},a=>{
        const file=a.path.slice(root.length);
        if(file==='tools/phone-ground.mjs')return{contents:adapter,loader:'js'};
        if(file in replacements)return{contents:replacements[file],loader:'ts'};
      });
    }}]});
  const mod=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
  const {terrain,roads}=mod.makeGround();
  // Background rail scouting can ask about unloaded land. Keep the strict route
  // oracle for driving, and production null semantics during that scout only.
  const rails=roads.guardrails;if(rails){const update=rails.update.bind(rails);rails.update=cam=>{const h=terrain.heightAt,s=terrain.surfaceAt;terrain.heightAt=mod.Terrain.prototype.heightAt.bind(terrain);terrain.surfaceAt=mod.Terrain.prototype.surfaceAt.bind(terrain);try{update(cam);}finally{terrain.heightAt=h;terrain.surfaceAt=s;}};}
  const update=roads.update.bind(roads);roads.update=cam=>{update(cam);terrain.updateRoadCuts();let frames=0;while(terrain.roadCuts.pending){terrain.roadCuts.step();if(++frames>20000)throw Error('cut atlas did not settle');}};
  return{...mod,terrain,roads,load:points=>mod.preload(terrain,points,120)};
}
export function rig(THREE){
  const node=()=>new THREE.Object3D();return{root:node(),body:node(),steer:{fl:node(),fr:node()},wheels:{fl:node(),fr:node(),rl:node(),rr:node()}};
}
export function line(road){
  const cum=[0],p=road.pts;for(let i=1;i<p.length;i++)cum.push(cum.at(-1)+Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]));
  const len=cum.at(-1);
  return{len,at(s){let i=0;while(i<p.length-2&&s>cum[i+1])i++;const a=p[i],b=p[i+1],d=cum[i+1]-cum[i]||1,t=(s-cum[i])/d;return{x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,heading:Math.atan2(b[0]-a[0],a[1]-b[1])};}};
}
export function dispose(f){
  f.terrain.roadCuts.dispose();
  for(const t of f.terrain.tiles.values()){t.mesh?.geometry.dispose();t.mesh?.material.dispose();}
  f.terrain.tiles.clear();
  for(const m of f.roads.group.children){m.geometry.dispose();}
}

const atlasViews=new WeakMap();
export function atlasRaster(t,raster){
 if(!raster||!t.mesh.material.uniforms.roadCuts.value)return null;
 const u=t.mesh.material.uniforms,image=u.tRoadCut.value.image,layout=u.roadCutLayout.value,rect=u.roadCutRect.value,old=atlasViews.get(t);
 if(old?.raster===raster&&old.texture===u.tRoadCut.value&&old.first===layout.z)return old.view;
 if(image.width!==layout.w||image.height!==layout.w)throw Error('atlas page layout mismatch');
 const offset=layout.z*image.width*image.height*4,view={...raster,x0:rect.x,z0:rect.y,width:layout.x,height:layout.y,data:image.data.subarray(offset,offset+raster.data.length)};
 atlasViews.set(t,{raster,texture:u.tRoadCut.value,first:layout.z,view});return view;
}
